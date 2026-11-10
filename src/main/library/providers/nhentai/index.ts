import { app } from "electron";
import { createMediaFileResponse } from "../../../media/mediaResponses";
import {
  ProviderCollectionRuntime,
  ResourceAcquisitions,
  type ProviderIO
} from "../../../providerRuntime";
import {
  broker,
  RequestCancelledError,
  type RequestPolicy
} from "../../../requestBroker";
import type { CachedFile } from "../../../resourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest,
  ProviderMediaItem
} from "../provider";
import { ProviderError } from "../provider";
import {
  cdnUrl,
  isNHentaiLocation,
  parseNHentaiCdnServers,
  parseNHentaiGallery,
  parseNHentaiGalleryUrl,
  type NHentaiCdnServers,
  type NHentaiGallery,
  type NHentaiGalleryReference
} from "./gallery";

export { parseNHentaiGalleryUrl } from "./gallery";

const CDN_CONFIG_URL = "https://nhentai.net/api/v2/cdn";
const CDN_CONFIG_LIFETIME_MS = 60 * 60 * 1_000;
const API_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 60_000;

// The anonymous gallery-detail limit is 20 requests per minute per IP.
const API_POLICY = {
  id: "nhentai:api",
  delayMs: 3_000
} satisfies RequestPolicy;

// The CDN publishes no number, only that normal browsing rates are generous.
const IMAGES_POLICY = {
  id: "nhentai:images",
  delayMs: 1_000
} satisfies RequestPolicy;

// The CDN documents that a gallery's thumbnails may load as one burst.
const THUMBNAILS_POLICY = {
  id: "nhentai:thumbnails",
  delayMs: 200
} satisfies RequestPolicy;

const supportedImageContentTypes = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

function userAgent(): string {
  return `Pixvitta/${app.getVersion()} (+https://github.com/raulferrodrigues/pixvitta)`;
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider is already rejecting this response.
  }
}

function responseContentType(response: Response): string | null {
  return (
    response.headers
      .get("Content-Type")
      ?.split(";")[0]
      .trim()
      .toLowerCase() ?? null
  );
}

async function fileResponse(
  request: Request,
  load: () => Promise<CachedFile>
): Promise<Response> {
  try {
    const file = await load();
    return await createMediaFileResponse(
      file.filePath,
      request.headers,
      file.contentType
    );
  } catch (error) {
    if (error instanceof RequestCancelledError) {
      return new Response(null, { status: 409 });
    }
    throw error;
  }
}

export class NHentaiProvider implements MediaProvider {
  readonly id = "nhentai";
  readonly sourceKind = "web";
  readonly siteName = "nhentai";
  private readonly galleries = new Map<string, NHentaiGallery>();
  private readonly resources = new ResourceAcquisitions();
  private cdn: { servers: NHentaiCdnServers; fetchedAtMs: number } | null = null;

  matches(location: string): boolean {
    return isNHentaiLocation(location);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const reference = parseNHentaiGalleryUrl(request.location);
    if (!reference) {
      throw new ProviderError("invalid-location", "Enter a full nhentai gallery URL.");
    }

    let gallery = request.refresh
      ? undefined
      : this.galleries.get(reference.galleryId);
    if (!gallery) {
      gallery = await this.fetchGallery(reference);
      this.galleries.set(reference.galleryId, gallery);
    }
    const servers = await this.cdnServers();
    return this.createCollection(reference, gallery, servers);
  }

  private fetchGallery(reference: NHentaiGalleryReference): Promise<NHentaiGallery> {
    return this.requestJson(reference.apiUrl, "gallery", (payload) =>
      parseNHentaiGallery(reference, payload)
    );
  }

  private async cdnServers(): Promise<NHentaiCdnServers> {
    if (this.cdn && Date.now() - this.cdn.fetchedAtMs < CDN_CONFIG_LIFETIME_MS) {
      return this.cdn.servers;
    }
    const servers = await this.requestJson(
      CDN_CONFIG_URL,
      "CDN configuration",
      parseNHentaiCdnServers
    );
    this.cdn = { servers, fetchedAtMs: Date.now() };
    return servers;
  }

  private async requestJson<T>(
    url: string,
    label: string,
    parse: (payload: unknown) => T
  ): Promise<T> {
    const task = broker.request<T>({
      policy: API_POLICY,
      priority: "high",
      timeoutMs: API_TIMEOUT_MS,
      request: new Request(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent()
        },
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (response.status === 404) {
          await cancelResponse(response);
          throw new ProviderError("not-found", `The nhentai ${label} could not be found.`);
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new ProviderError("unavailable", `The nhentai ${label} request returned ${status}.`);
        }
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new ProviderError("invalid-response", `The nhentai ${label} was not valid JSON.`);
        }
        return parse(payload);
      }
    });

    try {
      return await task.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", "Could not reach nhentai.");
    }
  }

  // Every load gets its own viewing runtime because the library deactivates
  // the previous collection on commit, even when the gallery is unchanged.
  // Acquisitions are provider-wide, so overlapping work survives a refresh.
  private createCollection(
    reference: NHentaiGalleryReference,
    gallery: NHentaiGallery,
    servers: NHentaiCdnServers
  ): ProviderCollection {
    const { pages } = gallery;
    const runtime = new ProviderCollectionRuntime<CachedFile>(this.resources, {
      itemCount: pages.length,
      mediaKey: (index) => `nhentai:media:${pages[index].path}`,
      loadMedia: (index, io) =>
        this.loadImage(io, {
          cacheKey: `nhentai:media:${pages[index].path}`,
          url: cdnUrl(servers.imageServers, pages[index].number, pages[index].path),
          policy: IMAGES_POLICY
        }),
      // Only pages with a thumbnail path expose a thumbnail resource.
      thumbnailKey: (index) => `nhentai:thumbnail:${pages[index].thumbnailPath}`,
      loadThumbnail: (index, io) => {
        const { number, thumbnailPath } = pages[index];
        if (!thumbnailPath) {
          return Promise.reject(new Error("This page has no thumbnail."));
        }
        return this.loadImage(io, {
          cacheKey: `nhentai:thumbnail:${thumbnailPath}`,
          url: cdnUrl(servers.thumbnailServers, number, thumbnailPath),
          policy: THUMBNAILS_POLICY
        });
      }
    });

    const items = pages.map((page, index): ProviderMediaItem => ({
      key: `${gallery.galleryId}:page:${page.number}`,
      name: page.name,
      kind: "image",
      sizeBytes: 0,
      lastOpenedMs: gallery.uploadedMs,
      addedMs: gallery.uploadedMs,
      modifiedMs: gallery.uploadedMs,
      createdMs: gallery.uploadedMs,
      media: {
        respond: (mediaRequest, priority) =>
          fileResponse(mediaRequest, () =>
            runtime.getMedia(index, priority, mediaRequest)
          )
      },
      externalUrl: page.readerUrl,
      thumbnail: page.thumbnailPath
        ? {
            kind: "resource",
            resource: {
              respond: (thumbnailRequest, priority) =>
                fileResponse(thumbnailRequest, () =>
                  runtime.getThumbnail(index, priority, thumbnailRequest)
                )
            }
          }
        : { kind: "none" }
    }));
    const indexByKey = new Map(items.map((item, index) => [item.key, index]));
    const requestedIndex = pages.findIndex(
      (page) => page.number === reference.pageNumber
    );

    return {
      viewing: {
        select(key) {
          if (key === null) {
            runtime.select(null);
            return;
          }
          const index = indexByKey.get(key);
          if (index !== undefined) runtime.select(index);
        },
        deactivate: () => runtime.deactivate()
      },
      canonicalLocation: reference.pageUrl,
      title: gallery.title,
      origin: {
        label: `nhentai · ${pages.length} pages`,
        url: reference.pageUrl
      },
      capabilities: {
        canRefresh: true,
        canSort: false,
        canDownload: true,
        // nhentai asks clients not to rebuild whole galleries from page URLs.
        canDownloadCollection: false
      },
      remember: true,
      items,
      selectedKey: items[Math.max(0, requestedIndex)].key
    };
  }

  private loadImage(
    io: ProviderIO,
    file: { cacheKey: string; url: string; policy: RequestPolicy }
  ): Promise<CachedFile> {
    return io.cachedFile(file.cacheKey, () =>
      io.requestFile({
        cacheKey: file.cacheKey,
        policy: file.policy,
        timeoutMs: MEDIA_TIMEOUT_MS,
        request: new Request(file.url, {
          method: "GET",
          headers: {
            Accept: "image/*",
            "User-Agent": userAgent()
          },
          redirect: "error"
        }),
        validate: (response) => {
          if (!response.ok) {
            throw new Error(`The nhentai CDN returned ${response.status}.`);
          }
          const contentType = responseContentType(response);
          if (!contentType || !supportedImageContentTypes.has(contentType)) {
            throw new Error(
              `The nhentai CDN returned an unsupported media type: ${contentType ?? "unknown"}.`
            );
          }
          return contentType;
        }
      })
    );
  }
}
