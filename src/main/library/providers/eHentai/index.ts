import { broker, type RequestPriority } from "../../../requestBroker";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest
} from "../provider";
import { ProviderError } from "../provider";
import { EHentaiGallerySession } from "./gallerySession";
import { EHentaiImagePipeline } from "./imagePipeline";
import { API_POLICY } from "./requestPolicies";
import { EHentaiThumbnailPipeline } from "./thumbnailPipeline";
import { eHentaiSite, galleryRequest, isAuthenticationResponse, type GallerySite } from "./gallerySite";
import { parseGalleryImagePages, type EHentaiImagePageReference } from "./html";
import { PAGES_POLICY } from "./requestPolicies";
import { parseEHentaiGalleryUrl, type EHentaiGalleryReference } from "./galleryUrl";
import type { GalleryAccess } from "./galleryAccess";

export { parseEHentaiGalleryUrl } from "./galleryUrl";
export type { EHentaiGalleryReference } from "./galleryUrl";

const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const REQUEST_TIMEOUT_MS = 15_000;

type GalleryMetadata = {
  title: string;
  postedMs: number;
  fileCount: number;
};

function isEHentaiLocation(input: string, site: GallerySite): boolean {
  try {
    return new URL(input.trim()).hostname === new URL(site.origin).hostname;
  } catch {
    return false;
  }
}

function parseMetadata(
  payload: unknown,
  reference: EHentaiGalleryReference,
  site: GallerySite
): GalleryMetadata {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata was not an object."
    );
  }
  const entries = (payload as { gmetadata?: unknown }).gmetadata;
  const item = Array.isArray(entries) ? entries[0] : null;
  if (!item || typeof item !== "object") {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata did not contain a gallery."
    );
  }

  const metadata = item as Record<string, unknown>;
  if (metadata.error) {
    throw new ProviderError("not-found", "The gallery is unavailable.");
  }
  const title =
    typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : `${site.name} gallery ${reference.galleryId}`;
  const fileCount = Number(metadata.filecount);
  const postedSeconds = Number(metadata.posted);
  if (!Number.isSafeInteger(fileCount) || fileCount < 1) {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata contained an invalid file count."
    );
  }

  return {
    title,
    fileCount,
    postedMs:
      Number.isFinite(postedSeconds) && postedSeconds >= 0
        ? postedSeconds * 1_000
        : 0
  };
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider is already rejecting this response.
  }
}

export class EHentaiProvider implements MediaProvider {
  readonly id: string;
  readonly sourceKind = "web";
  private readonly imagePipeline: EHentaiImagePipeline;
  private readonly thumbnailPipeline: EHentaiThumbnailPipeline;

  constructor(private readonly site: GallerySite = eHentaiSite) {
    this.id = site.id;
    this.imagePipeline = new EHentaiImagePipeline(site);
    this.thumbnailPipeline = new EHentaiThumbnailPipeline(site);
  }

  matches(location: string): boolean {
    return isEHentaiLocation(location, this.site);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const reference = parseEHentaiGalleryUrl(request.location, this.site);
    if (!reference) {
      throw new ProviderError(
        "invalid-location",
        `Enter a full ${this.site.name} gallery URL.`
      );
    }

    const access = this.site.prepare
      ? await this.site.prepare()
      : undefined;
    const initialPages = this.site.authenticated
      ? await this.fetchInitialIndex(reference, access)
      : undefined;
    const metadata = await this.fetchMetadata(reference, access);
    access?.assertCurrent();
    const session = new EHentaiGallerySession({
      site: this.site,
      cacheNamespace: access ? `${this.site.id}:${access.accountId}` : this.site.id,
      access,
      initialPages,
      reference,
      fileCount: metadata.fileCount,
      pipeline: this.imagePipeline,
      thumbnailPipeline: this.thumbnailPipeline
    });
    const nameWidth = Math.max(3, String(metadata.fileCount).length);
    const items = Array.from({ length: metadata.fileCount }, (_, index) => {
      const pageNumber = index + 1;
      const pageLabel = String(pageNumber).padStart(nameWidth, "0");
      return {
        key: `${reference.galleryId}:page:${pageNumber}`,
        name: `Page ${pageLabel}`,
        kind: "image" as const,
        sizeBytes: 0,
        lastOpenedMs: metadata.postedMs,
        addedMs: metadata.postedMs,
        modifiedMs: metadata.postedMs,
        createdMs: metadata.postedMs,
        media: {
          respond: (
            mediaRequest: Request,
            priority: RequestPriority
          ) => session.respond(pageNumber, mediaRequest, priority)
        },
        thumbnail: {
          kind: "resource" as const,
          resource: {
            respond: (
              thumbnailRequest: Request,
              priority: RequestPriority
            ) =>
              session.respondThumbnail(
                pageNumber,
                thumbnailRequest,
                priority
              )
          }
        }
      };
    });

    return {
      canonicalLocation: reference.pageUrl,
      title: metadata.title,
      origin: {
        label: `${this.site.name} · ${metadata.fileCount} pages`,
        url: reference.pageUrl
      },
      capabilities: {
        canRefresh: true,
        canSort: false
      },
      remember: true,
      items,
      selectedKey: items[0]?.key ?? null
    };
  }

  private async fetchMetadata(
    reference: EHentaiGalleryReference,
    access?: GalleryAccess
  ): Promise<GalleryMetadata> {
    const task = broker.request<GalleryMetadata>({
      policy: API_POLICY,
      priority: "high",
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetch: access?.fetch,
      request: galleryRequest(this.site, this.site.apiUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({
          method: "gdata",
          gidlist: [
            [Number(reference.galleryId), reference.galleryToken]
          ],
          namespace: 1
        }),
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (this.site.authenticated && isAuthenticationResponse(response)) {
          await cancelResponse(response);
          throw new ProviderError("authentication-required", "Sign in to ExHentai again.");
        }
        if (response.status === 503) {
          await cancelResponse(response);
          throw new ProviderError(
            "rate-limited",
            `${this.site.name} asked the app to slow down.`
          );
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new ProviderError(
            "unavailable",
            `The ${this.site.name} gallery API returned ${status}.`
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (this.site.authenticated) {
            throw new ProviderError("authentication-required", "ExHentai did not accept the saved sign-in.");
          }
          throw new ProviderError(
            "invalid-response",
            "The gallery API returned invalid JSON."
          );
        }
        return parseMetadata(payload, reference, this.site);
      }
    });

    try {
      return await task.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", `Could not reach ${this.site.name}.`);
    }
  }

  private async fetchInitialIndex(
    reference: EHentaiGalleryReference,
    access?: GalleryAccess
  ): Promise<Map<number, EHentaiImagePageReference>> {
    const task = broker.request<Map<number, EHentaiImagePageReference>>({
      policy: PAGES_POLICY,
      priority: "high",
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetch: access?.fetch,
      request: galleryRequest(this.site, reference.pageUrl, {
        method: "GET",
        headers: { Accept: "text/html", "User-Agent": USER_AGENT },
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (isAuthenticationResponse(response)) {
          await cancelResponse(response);
          throw new ProviderError("authentication-required", "Sign in to ExHentai again.");
        }
        if (response.status === 404) {
          await cancelResponse(response);
          throw new ProviderError("not-found", "The ExHentai gallery was not found.");
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new ProviderError("unavailable", `ExHentai returned ${status}.`);
        }
        const pages = parseGalleryImagePages(
          await response.text(),
          reference.pageUrl,
          reference.galleryId,
          this.site.origin
        );
        if (pages.size === 0) {
          throw new ProviderError("authentication-required", "ExHentai did not accept the saved sign-in.");
        }
        return pages;
      }
    });
    try {
      return await task.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", "Could not reach ExHentai.");
    }
  }
}
