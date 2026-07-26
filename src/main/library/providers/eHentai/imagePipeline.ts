import type {
  CachedResource,
  ResourceCache
} from "../../../resourceCache/diskResourceCache";
import { parseDisplayedImageUrl } from "./html";
import { mediaFileTypes } from "../../../utils/mediaTypes";

const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const DEFAULT_INTERVAL_MS = 2_000;
const PAGE_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 60_000;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

type ImagePipelineOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  intervalMs?: number;
};

export class ImageRequestSupersededError extends Error {
  constructor() {
    super("The image is no longer in the active demand window.");
    this.name = "ImageRequestSupersededError";
  }
}

function isApprovedDeliveryUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "e-hentai.org" || url.hostname.endsWith(".hath.network"))
    );
  } catch {
    return false;
  }
}

export function cachedResourceResponse(resource: CachedResource): Response {
  const body = Uint8Array.from(resource.bytes).buffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(resource.bytes.byteLength),
      "Content-Type": resource.contentType,
      "Cross-Origin-Resource-Policy": "cross-origin"
    }
  });
}

/**
 * The only E-Hentai component allowed to resolve and transfer displayed image
 * bytes. Cache hits bypass the gate; every miss is serialized through it.
 */
export class EHentaiImagePipeline {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly intervalMs: number;
  private readonly inFlight = new Map<string, Promise<CachedResource>>();
  private queue: Promise<void> = Promise.resolve();
  private lastTransferStartedAtMs: number | null = null;

  constructor(
    private readonly cache: ResourceCache,
    options: ImagePipelineOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  async get(
    cacheKey: string,
    imagePageUrl: string,
    shouldStart: () => boolean = () => true
  ): Promise<CachedResource> {
    const cached = await this.cache.read(cacheKey);
    if (cached) return cached;

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const operation = this.enqueue(async () => {
      const queuedCacheHit = await this.cache.read(cacheKey);
      if (queuedCacheHit) return queuedCacheHit;

      if (!shouldStart()) throw new ImageRequestSupersededError();
      const deliveryUrl = await this.resolveDisplayedImageUrl(imagePageUrl);
      await this.waitForTransferSlot(shouldStart);
      const resource = await this.fetchDisplayedImage(
        deliveryUrl,
        imagePageUrl
      );
      await this.cache.write(cacheKey, resource);
      return resource;
    });
    this.inFlight.set(cacheKey, operation);
    void operation.then(
      () => this.clearInFlight(cacheKey, operation),
      () => this.clearInFlight(cacheKey, operation)
    );
    return operation;
  }

  private clearInFlight(
    cacheKey: string,
    operation: Promise<CachedResource>
  ): void {
    if (this.inFlight.get(cacheKey) === operation) {
      this.inFlight.delete(cacheKey);
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async waitForTransferSlot(shouldStart: () => boolean): Promise<void> {
    if (this.lastTransferStartedAtMs !== null) {
      const remaining =
        this.intervalMs - (this.now() - this.lastTransferStartedAtMs);
      if (remaining > 0) await this.wait(remaining);
    }
    if (!shouldStart()) throw new ImageRequestSupersededError();
    this.lastTransferStartedAtMs = this.now();
  }

  private async resolveDisplayedImageUrl(
    imagePageUrl: string
  ): Promise<string> {
    const pageResponse = await this.fetchImpl(imagePageUrl, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    });
    if (!pageResponse.ok) {
      throw new Error(`The E-Hentai image page returned ${pageResponse.status}.`);
    }

    const deliveryUrl = parseDisplayedImageUrl(
      await pageResponse.text(),
      imagePageUrl
    );
    if (!deliveryUrl || !isApprovedDeliveryUrl(deliveryUrl)) {
      throw new Error("The E-Hentai image page did not expose a safe image URL.");
    }
    return deliveryUrl;
  }

  private async fetchDisplayedImage(
    deliveryUrl: string,
    imagePageUrl: string
  ): Promise<CachedResource> {
    const imageResponse = await this.fetchImpl(deliveryUrl, {
      method: "GET",
      headers: {
        Accept: "image/*",
        Referer: imagePageUrl,
        "User-Agent": USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)
    });
    if (!imageResponse.ok) {
      throw new Error(`The E-Hentai image server returned ${imageResponse.status}.`);
    }

    const contentType = imageResponse.headers.get("Content-Type")?.split(";")[0].trim();
    if (!contentType || !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new Error(
        `E-Hentai returned an unsupported image type: ${contentType ?? "unknown"}.`
      );
    }

    const bytes = new Uint8Array(await imageResponse.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("The E-Hentai image server returned an empty image.");
    }
    return { bytes, contentType };
  }
}
