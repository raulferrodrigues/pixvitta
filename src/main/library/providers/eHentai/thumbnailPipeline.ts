import {
  broker,
  type BrokerTask,
  type RequestPriority
} from "../../../requestBroker";
import { cache, type CachedFile } from "../../../resourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";
import { THUMBNAILS_POLICY } from "./requestPolicies";
import { eHentaiSite, galleryRequest, type GallerySite } from "./gallerySite";
import type { GalleryAccess } from "./galleryAccess";

const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const REQUEST_TIMEOUT_MS = 15_000;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

type InFlightEntry = {
  priority: RequestPriority;
  brokerTask: BrokerTask<unknown> | null;
  promise: Promise<CachedFile> | null;
  access?: GalleryAccess;
};

const priorityRanks: Record<RequestPriority, number> = {
  low: 0,
  normal: 1,
  high: 2
};

function isApprovedThumbnailUrl(rawUrl: string, site: GallerySite): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.hostname === "ehgt.org" ||
        (site.authenticated && url.hostname === "s.exhentai.org") ||
        url.hostname.endsWith(".hath.network"))
    );
  } catch {
    return false;
  }
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The pipeline is already rejecting this response.
  }
}

export class EHentaiThumbnailPipeline {
  private readonly inFlight: {
    [cacheKey: string]: InFlightEntry | undefined;
  } = {};

  constructor(private readonly site: GallerySite = eHentaiSite) {}

  get(
    cacheKey: string,
    thumbnailUrl: string,
    priority: RequestPriority,
    access?: GalleryAccess
  ): Promise<CachedFile> {
    access?.assertCurrent();
    const acquisitionKey = access ? `${cacheKey}:session:${access.generation}` : cacheKey;
    const existing = this.inFlight[acquisitionKey];
    if (existing) {
      if (priorityRanks[priority] > priorityRanks[existing.priority]) {
        existing.priority = priority;
        if (existing.brokerTask) {
          broker.promote(existing.brokerTask, priority);
        }
      }
      if (existing.promise) return existing.promise;
      throw new Error(
        "An E-Hentai thumbnail acquisition was registered without a promise."
      );
    }

    const entry: InFlightEntry = {
      priority,
      brokerTask: null,
      promise: null,
      access
    };
    this.inFlight[acquisitionKey] = entry;
    const operation = this.acquire(cacheKey, thumbnailUrl, entry).then((file) => {
      access?.assertCurrent();
      return file;
    });
    entry.promise = operation;
    const cleanup = () => {
      if (this.inFlight[acquisitionKey] === entry) {
        delete this.inFlight[acquisitionKey];
      }
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  private async acquire(
    cacheKey: string,
    thumbnailUrl: string,
    entry: InFlightEntry
  ): Promise<CachedFile> {
    const cached = await cache.find(cacheKey);
    if (cached) return cached;
    if (!isApprovedThumbnailUrl(thumbnailUrl, this.site)) {
      throw new Error("E-Hentai exposed an unsafe thumbnail URL.");
    }

    const task = broker.request<CachedFile>({
      policy: THUMBNAILS_POLICY,
      priority: entry.priority,
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetch: entry.access?.fetch,
      request: galleryRequest(this.site, thumbnailUrl, {
        method: "GET",
        headers: {
          Accept: "image/*",
          "User-Agent": USER_AGENT
        },
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new Error(
            `E-Hentai thumbnail server returned ${status}.`
          );
        }
        const contentType =
          response.headers
            .get("Content-Type")
            ?.split(";")[0]
            .trim()
            .toLowerCase() ?? null;
        if (
          !contentType ||
          !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)
        ) {
          await cancelResponse(response);
          throw new Error(
            `E-Hentai returned an unsupported thumbnail type: ${contentType ?? "unknown"}.`
          );
        }
        if (!response.body) {
          throw new Error(
            "E-Hentai thumbnail server returned an empty image."
          );
        }
        return cache.writeStream(cacheKey, {
          contentType,
          stream: response.body
        });
      }
    });
    entry.brokerTask = task;
    try {
      return await task.result;
    } finally {
      if (entry.brokerTask === task) entry.brokerTask = null;
    }
  }
}
