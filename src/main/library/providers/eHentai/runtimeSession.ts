import { readFile } from "node:fs/promises";
import { createMediaFileResponse } from "../../../media/mediaResponses";
import { ResourceAcquisitions, ProviderCollectionRuntime, type ProviderIO } from "../../../providerRuntime";
import { RequestCancelledError, type RequestPriority } from "../../../requestBroker";
import type { CachedFile } from "../../../resourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";
import { ProviderError } from "../provider";
import { GalleryAccessExpiredError, type GalleryAccess } from "./galleryAccess";
import { galleryRequest, isAuthenticationResponse, type GallerySite } from "./gallerySite";
import type { EHentaiGalleryReference } from "./galleryUrl";
import { parseGalleryImagePages, parseDisplayedImageUrl, type EHentaiImagePageReference, type EHentaiThumbnailReference } from "./html";
import { IMAGES_POLICY, PAGES_POLICY, THUMBNAILS_POLICY } from "./requestPolicies";
import { renderSpriteThumbnail } from "./spriteThumbnail";

const USER_AGENT = "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const imageTypes = new Set<string>(mediaFileTypes.filter((type) => type.kind === "image").map((type) => type.mimeType));

export type ImageLimit = { reached: boolean; controller: AbortController };

type Options = {
  site: GallerySite;
  reference: EHentaiGalleryReference;
  fileCount: number;
  cacheNamespace: string;
  access?: GalleryAccess;
  resources: ResourceAcquisitions;
  imageLimit: ImageLimit;
};

type Thumbnail = { file: CachedFile; reference: EHentaiThumbnailReference } | null;

// This adapter only describes the gallery's resources and site rules. The
// common runtime owns selection, sharing, prefetch and broker task lifetime.
export class EHentaiRuntimeSession {
  private readonly pages = new Map<number, EHentaiImagePageReference>();
  private readonly runtime: ProviderCollectionRuntime<Thumbnail>;

  constructor(private readonly options: Options) {
    this.runtime = new ProviderCollectionRuntime(options.resources, {
      itemCount: options.fileCount,
      mediaKey: (index) => `${this.sourceKey}:media:${index}`,
      loadMedia: (index, io) => this.loadMedia(index + 1, io),
      thumbnailKey: (index) => `${this.sourceKey}:thumbnail:${index}`,
      loadThumbnail: (index, io) => this.loadThumbnail(index + 1, io),
      assertCurrent: () => options.access?.assertCurrent()
    });
  }

  select(key: string | null): void {
    const page = key === null ? null : Number(key.split(":page:")[1]);
    this.runtime.select(page === null ? null : page - 1);
  }

  deactivate(): void { this.runtime.deactivate(); }

  async respond(page: number, request: Request, priority: RequestPriority): Promise<Response> {
    try {
      const file = await this.runtime.getMedia(page - 1, priority, request);
      const response = await createMediaFileResponse(file.filePath, request.headers, file.contentType);
      return response;
    } catch (error) {
      if (error instanceof RequestCancelledError || error instanceof GalleryAccessExpiredError) return new Response(null, { status: 409 });
      throw error;
    }
  }

  async respondThumbnail(page: number, request: Request, priority: RequestPriority): Promise<Response> {
    try {
      const thumbnail = await this.runtime.getThumbnail(page - 1, priority, request);
      if (!thumbnail) return emptyThumbnail();
      if (thumbnail.reference.kind === "direct") {
        return createMediaFileResponse(thumbnail.file.filePath, request.headers, thumbnail.file.contentType);
      }
      const rendered = renderSpriteThumbnail({
        bytes: new Uint8Array(await readFile(thumbnail.file.filePath)),
        contentType: thumbnail.file.contentType
      }, thumbnail.reference.crop);
      this.options.access?.assertCurrent();
      return new Response(Uint8Array.from(rendered.bytes), { headers: { "Content-Type": rendered.contentType, "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" } });
    } catch { return emptyThumbnail(); }
  }

  private get sourceKey(): string {
    return `${this.options.cacheNamespace}:${this.options.reference.galleryId}:${this.options.reference.galleryToken}:${this.options.access?.generation ?? 0}`;
  }

  private async resolvePage(page: number, io: ProviderIO): Promise<EHentaiImagePageReference> {
    this.options.access?.assertCurrent();
    const existing = this.pages.get(page);
    if (existing) return existing;
    const index = Math.floor((page - 1) / 20);
    const pages = await io.use(`${this.sourceKey}:index:${index}`, (indexIO) => indexIO.request({
      policy: PAGES_POLICY,
      timeoutMs: 15_000,
      fetch: this.options.access?.fetch,
      request: galleryRequest(this.options.site, index === 0 ? this.options.reference.pageUrl : `${this.options.reference.pageUrl}?p=${index}`, {
        headers: { Accept: "text/html", "User-Agent": USER_AGENT }, redirect: "error"
      }),
      handleResponse: async (response) => {
        await this.checkResponse(response);
        const references = parseGalleryImagePages(await response.text(), this.options.reference.pageUrl, this.options.reference.galleryId, this.options.site.origin);
        if (references.size === 0) throw new Error("The gallery index did not contain image pages.");
        return references;
      }
    }));
    for (const [number, reference] of pages) this.pages.set(number, reference);
    const resolved = this.pages.get(page);
    if (!resolved) throw new Error(`The gallery index did not contain page ${page}.`);
    return resolved;
  }

  private async loadMedia(number: number, io: ProviderIO): Promise<CachedFile> {
    const page = await this.resolvePage(number, io);
    const cacheKey = `${this.options.cacheNamespace}:image:${this.options.reference.galleryId}:${page.pageToken}:${number}`;
    return io.cachedFile(cacheKey, async () => {
      if (this.options.imageLimit.reached) throw new Error("E-Hentai image viewing limits have been reached for this session.");
      const html = await io.request({
        policy: PAGES_POLICY, timeoutMs: 15_000, fetch: this.options.access?.fetch,
        request: galleryRequest(this.options.site, page.pageUrl, {
          headers: { Accept: "text/html", "User-Agent": USER_AGENT }, redirect: "error", signal: this.options.imageLimit.controller.signal
        }),
        handleResponse: async (response) => { await this.checkResponse(response, true); return response.text(); }
      });
      const delivery = parseDisplayedImageUrl(html, page.pageUrl);
      if (!delivery || !this.approvedUrl(delivery, false)) throw new Error("The image page did not expose a safe image URL.");
      return io.requestFile({
        cacheKey, policy: IMAGES_POLICY, timeoutMs: 60_000, fetch: this.options.access?.fetch,
        request: galleryRequest(this.options.site, delivery, {
          headers: { Accept: "image/*", "User-Agent": USER_AGENT }, referrer: page.pageUrl,
          referrerPolicy: "unsafe-url", redirect: "error", signal: this.options.imageLimit.controller.signal
        }),
        validate: (response) => this.validateImage(response, true)
      });
    });
  }

  private async loadThumbnail(number: number, io: ProviderIO): Promise<Thumbnail> {
    const page = await this.resolvePage(number, io);
    if (!page.thumbnail) return null;
    const reference = page.thumbnail;
    if (!this.approvedUrl(reference.url, true)) throw new Error("The gallery exposed an unsafe thumbnail URL.");
    const cacheKey = `${this.options.cacheNamespace}:thumbnail:${reference.url}`;
    const file = await io.use(`${this.options.cacheNamespace}:thumbnail-file:${reference.url}`, (fileIO) => fileIO.cachedFile(cacheKey, () => fileIO.requestFile({
      cacheKey, policy: THUMBNAILS_POLICY, timeoutMs: 15_000, fetch: this.options.access?.fetch,
      request: galleryRequest(this.options.site, reference.url, { headers: { Accept: "image/*", "User-Agent": USER_AGENT }, redirect: "error" }),
      validate: (response) => this.validateImage(response, false)
    })));
    return { file, reference };
  }

  private approvedUrl(raw: string, thumbnail: boolean): boolean {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (thumbnail && (url.port || url.search || url.hash)) return false;
    return url.hostname.endsWith(".hath.network") || (thumbnail ? url.hostname === "ehgt.org" : url.origin === this.options.site.origin);
  }

  private async checkResponse(response: Response, fullImage = false): Promise<void> {
    if (response.ok) return;
    await response.body?.cancel().catch(() => {});
    if (this.options.site.authenticated && isAuthenticationResponse(response)) throw new ProviderError("authentication-required", "Sign in to ExHentai again.");
    if (fullImage && response.status === 509) {
      this.options.imageLimit.reached = true;
      this.options.imageLimit.controller.abort(new Error("E-Hentai image viewing limits have been reached."));
    }
    throw new Error(`E-Hentai returned ${response.status}.`);
  }

  private async validateImage(response: Response, fullImage: boolean): Promise<string> {
    await this.checkResponse(response, fullImage);
    const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (!type || !imageTypes.has(type)) throw new Error(`E-Hentai returned an unsupported image type: ${type ?? "unknown"}.`);
    return type;
  }
}

function emptyThumbnail(): Response {
  return new Response(Uint8Array.from([71,73,70,56,57,97,1,0,1,0,128,0,0,0,0,0,255,255,255,33,249,4,1,0,0,0,0,44,0,0,0,0,1,0,1,0,0,2,2,68,1,0,59]), {
    headers: { "Content-Type": "image/gif", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" }
  });
}
