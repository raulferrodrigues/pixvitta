import {
  broker,
  type BrokerTask,
  type RequestPriority
} from "../../../requestBroker";
import { cache, type CachedFile } from "../../../resourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";
import { parseDisplayedImageUrl } from "./html";
import { IMAGES_POLICY, PAGES_POLICY } from "./requestPolicies";

const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const PAGE_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 60_000;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

type InFlightEntry = {
  priority: RequestPriority;
  brokerTask: BrokerTask<unknown> | null;
  promise: Promise<CachedFile> | null;
};

const priorityRanks: Record<RequestPriority, number> = {
  low: 0,
  normal: 1,
  high: 2
};

export class ImageRequestSupersededError extends Error {
  constructor() {
    super("The image is no longer in the active demand window.");
    this.name = "ImageRequestSupersededError";
  }
}

class EHentaiImageLimitError extends Error {
  constructor() {
    super("E-Hentai image viewing limits have been reached for this session.");
    this.name = "EHentaiImageLimitError";
  }
}

function isApprovedDeliveryUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "e-hentai.org" ||
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

function contentTypeFor(response: Response): string | null {
  return (
    response.headers
      .get("Content-Type")
      ?.split(";")[0]
      .trim()
      .toLowerCase() ?? null
  );
}

export class EHentaiImagePipeline {
  private readonly inFlight: {
    [cacheKey: string]: InFlightEntry | undefined;
  } = {};
  private imageLimitReached = false;
  private readonly imageLimitAbortController = new AbortController();

  get(
    cacheKey: string,
    imagePageUrl: string,
    priority: RequestPriority,
    shouldStart: () => boolean = () => true
  ): Promise<CachedFile> {
    const existing = this.inFlight[cacheKey];
    if (existing) {
      if (priorityRanks[priority] > priorityRanks[existing.priority]) {
        existing.priority = priority;
        if (existing.brokerTask) {
          broker.promote(existing.brokerTask, priority);
        }
      }
      if (existing.promise) return existing.promise;
      throw new Error(
        "An E-Hentai image acquisition was registered without a promise."
      );
    }

    const entry: InFlightEntry = {
      priority,
      brokerTask: null,
      promise: null
    };
    this.inFlight[cacheKey] = entry;
    const operation = this.acquire(
      cacheKey,
      imagePageUrl,
      entry,
      shouldStart
    );
    entry.promise = operation;
    const cleanup = () => {
      if (this.inFlight[cacheKey] === entry) {
        delete this.inFlight[cacheKey];
      }
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  private async acquire(
    cacheKey: string,
    imagePageUrl: string,
    entry: InFlightEntry,
    shouldStart: () => boolean
  ): Promise<CachedFile> {
    const cached = await cache.find(cacheKey);
    if (cached) return cached;
    if (this.imageLimitReached) throw new EHentaiImageLimitError();
    if (!shouldStart()) throw new ImageRequestSupersededError();

    const pageTask = broker.request<string>({
      policy: PAGES_POLICY,
      priority: entry.priority,
      request: new Request(imagePageUrl, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": USER_AGENT
        },
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(PAGE_TIMEOUT_MS),
          this.imageLimitAbortController.signal
        ])
      }),
      handleResponse: async (response) => {
        if (response.status === 509) {
          this.reachImageLimit();
          await cancelResponse(response);
          throw new EHentaiImageLimitError();
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new Error(`The E-Hentai image page returned ${status}.`);
        }
        return response.text();
      }
    });
    entry.brokerTask = pageTask;

    let pageHtml: string;
    try {
      pageHtml = await pageTask.result;
    } finally {
      if (entry.brokerTask === pageTask) entry.brokerTask = null;
    }
    const deliveryUrl = parseDisplayedImageUrl(pageHtml, imagePageUrl);
    if (!deliveryUrl || !isApprovedDeliveryUrl(deliveryUrl)) {
      throw new Error(
        "The E-Hentai image page did not expose a safe image URL."
      );
    }
    if (this.imageLimitReached) throw new EHentaiImageLimitError();
    if (!shouldStart()) throw new ImageRequestSupersededError();

    const imageTask = broker.request<CachedFile>({
      policy: IMAGES_POLICY,
      priority: entry.priority,
      request: new Request(deliveryUrl, {
        method: "GET",
        headers: {
          Accept: "image/*",
          Referer: imagePageUrl,
          "User-Agent": USER_AGENT
        },
        redirect: "error",
        signal: AbortSignal.any([
          AbortSignal.timeout(IMAGE_TIMEOUT_MS),
          this.imageLimitAbortController.signal
        ])
      }),
      handleResponse: async (response) => {
        if (response.status === 509) {
          this.reachImageLimit();
          await cancelResponse(response);
          throw new EHentaiImageLimitError();
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new Error(`The E-Hentai image server returned ${status}.`);
        }
        const contentType = contentTypeFor(response);
        if (
          !contentType ||
          !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)
        ) {
          await cancelResponse(response);
          throw new Error(
            `E-Hentai returned an unsupported image type: ${contentType ?? "unknown"}.`
          );
        }
        if (!response.body) {
          throw new Error("The E-Hentai image server returned an empty image.");
        }
        return cache.writeStream(cacheKey, {
          contentType,
          stream: response.body
        });
      }
    });
    entry.brokerTask = imageTask;
    try {
      return await imageTask.result;
    } finally {
      if (entry.brokerTask === imageTask) entry.brokerTask = null;
    }
  }

  private reachImageLimit(): void {
    if (this.imageLimitReached) return;
    this.imageLimitReached = true;
    this.imageLimitAbortController.abort(new EHentaiImageLimitError());
  }
}
