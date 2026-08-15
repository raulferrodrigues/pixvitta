import { createHash } from "node:crypto";
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
  shouldStart: () => boolean;
};

const priorityRanks: Record<RequestPriority, number> = {
  low: 0,
  normal: 1,
  high: 2
};

function acquisitionId(cacheKey: string): string {
  return createHash("sha256").update(cacheKey).digest("hex").slice(0, 12);
}

function debugPriority(message: string): void {
  console.debug(`[e-hentai-priority ${new Date().toISOString()}] ${message}`);
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === "TimeoutError"
  );
}

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
    shouldStart: () => boolean = () => true,
    retryJoinedTimeout = true
  ): Promise<CachedFile> {
    const id = acquisitionId(cacheKey);
    const existing = this.inFlight[cacheKey];
    if (existing) {
      const joinedLowerPriority =
        priorityRanks[priority] > priorityRanks[existing.priority];
      const previousShouldStart = existing.shouldStart;
      existing.shouldStart = () => previousShouldStart() || shouldStart();
      if (joinedLowerPriority) {
        const previousPriority = existing.priority;
        existing.priority = priority;
        if (existing.brokerTask) {
          broker.promote(existing.brokerTask, priority);
        }
        debugPriority(
          `joined id=${id} promoted=${previousPriority}->${priority} brokerTask=${existing.brokerTask ? "present" : "pending"}`
        );
      } else {
        debugPriority(
          `joined id=${id} requested=${priority} current=${existing.priority}`
        );
      }
      if (existing.promise) {
        const shouldRetry =
          retryJoinedTimeout &&
          priority === "high" &&
          joinedLowerPriority;
        if (!shouldRetry) return existing.promise;
        return existing.promise.catch((error) => {
          if (!isTimeoutError(error) || !shouldStart()) throw error;
          debugPriority(`retrying id=${id} priority=high after joined timeout`);
          return this.get(
            cacheKey,
            imagePageUrl,
            priority,
            shouldStart,
            false
          );
        });
      }
      throw new Error(
        "An E-Hentai image acquisition was registered without a promise."
      );
    }

    const entry: InFlightEntry = {
      priority,
      brokerTask: null,
      promise: null,
      shouldStart
    };
    this.inFlight[cacheKey] = entry;
    debugPriority(`created id=${id} priority=${priority}`);
    const operation = this.acquire(
      cacheKey,
      imagePageUrl,
      entry
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
    entry: InFlightEntry
  ): Promise<CachedFile> {
    const cached = await cache.find(cacheKey);
    if (cached) return cached;
    if (this.imageLimitReached) throw new EHentaiImageLimitError();
    if (!entry.shouldStart()) throw new ImageRequestSupersededError();

    debugPriority(
      `submitted id=${acquisitionId(cacheKey)} stage=image-page priority=${entry.priority}`
    );
    const pageTask = broker.request<string>({
      policy: PAGES_POLICY,
      priority: entry.priority,
      timeoutMs: PAGE_TIMEOUT_MS,
      request: new Request(imagePageUrl, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": USER_AGENT
        },
        redirect: "error",
        signal: this.imageLimitAbortController.signal
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
    if (!entry.shouldStart()) throw new ImageRequestSupersededError();

    debugPriority(
      `submitted id=${acquisitionId(cacheKey)} stage=image-file priority=${entry.priority}`
    );
    const imageTask = broker.request<CachedFile>({
      policy: IMAGES_POLICY,
      priority: entry.priority,
      timeoutMs: IMAGE_TIMEOUT_MS,
      request: new Request(deliveryUrl, {
        method: "GET",
        headers: {
          Accept: "image/*",
          "User-Agent": USER_AGENT
        },
        referrer: imagePageUrl,
        referrerPolicy: "unsafe-url",
        redirect: "error",
        signal: this.imageLimitAbortController.signal
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
