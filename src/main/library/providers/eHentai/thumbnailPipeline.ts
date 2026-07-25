import type {
  CachedResource,
  ResourceCache
} from "../../../resourceCache/diskResourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";

const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_BATCH_INTERVAL_MS = 1_000;
const DEFAULT_MAX_CONCURRENCY = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_BACKOFF_MS = 30_000;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

type ThumbnailPipelineOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  batchSize?: number;
  batchIntervalMs?: number;
  maxConcurrency?: number;
};

type QueueEntry = {
  cacheKey: string;
  thumbnailUrl: string;
  resolve(resource: CachedResource): void;
  reject(error: unknown): void;
};

function isApprovedThumbnailUrl(rawUrl: string): boolean {
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
        url.hostname.endsWith(".hath.network"))
    );
  } catch {
    return false;
  }
}

/**
 * E-Hentai's gallery HTML eagerly exposes thumbnails in groups of twenty.
 * This pipeline mirrors that traffic shape while bounding both starts and
 * active transfers. Cache hits never enter the scheduler.
 */
export class EHentaiThumbnailPipeline {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly batchSize: number;
  private readonly batchIntervalMs: number;
  private readonly maxConcurrency: number;
  private readonly queue: QueueEntry[] = [];
  private readonly inFlight = new Map<string, Promise<CachedResource>>();
  private readonly transferStarts: number[] = [];
  private activeCount = 0;
  private wakePending = false;
  private blockedUntilMs = 0;

  constructor(
    private readonly cache: ResourceCache,
    options: ThumbnailPipelineOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
    this.batchIntervalMs = Math.max(
      1,
      options.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS
    );
    this.maxConcurrency = Math.max(
      1,
      options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
    );
  }

  async get(cacheKey: string, thumbnailUrl: string): Promise<CachedResource> {
    const cached = await this.cache.read(cacheKey);
    if (cached) return cached;
    if (!isApprovedThumbnailUrl(thumbnailUrl)) {
      throw new Error("E-Hentai exposed an unsafe thumbnail URL.");
    }

    const existing = this.inFlight.get(cacheKey);
    if (existing) return existing;

    const operation = new Promise<CachedResource>((resolve, reject) => {
      this.queue.push({ cacheKey, thumbnailUrl, resolve, reject });
      this.drain();
    });
    this.inFlight.set(cacheKey, operation);
    void operation.then(
      () => this.clearInFlight(cacheKey, operation),
      () => this.clearInFlight(cacheKey, operation)
    );
    return operation;
  }

  private drain(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const delay = this.delayBeforeNextStart();
      if (delay > 0) {
        this.wakeAfter(delay);
        return;
      }

      const entry = this.queue.shift()!;
      this.transferStarts.push(this.now());
      this.activeCount += 1;
      void this.run(entry)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }

  private async run(entry: QueueEntry): Promise<CachedResource> {
    const response = await this.fetchImpl(entry.thumbnailUrl, {
      method: "GET",
      headers: {
        Accept: "image/*",
        "User-Agent": USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (response.status === 429 || response.status === 503) {
      this.blockedUntilMs = Math.max(
        this.blockedUntilMs,
        this.now() + this.retryDelayMs(response)
      );
    }
    if (!response.ok) {
      throw new Error(`E-Hentai thumbnail server returned ${response.status}.`);
    }

    const contentType = response.headers
      .get("Content-Type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType || !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
      throw new Error(
        `E-Hentai returned an unsupported thumbnail type: ${contentType ?? "unknown"}.`
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error("E-Hentai thumbnail server returned an empty image.");
    }

    const resource = { bytes, contentType };
    await this.cache.write(entry.cacheKey, resource);
    return resource;
  }

  private delayBeforeNextStart(): number {
    const now = this.now();
    while (
      this.transferStarts.length > 0 &&
      now - this.transferStarts[0] >= this.batchIntervalMs
    ) {
      this.transferStarts.shift();
    }
    const rateDelay =
      this.transferStarts.length < this.batchSize
        ? 0
        : this.batchIntervalMs - (now - this.transferStarts[0]);
    return Math.max(0, rateDelay, this.blockedUntilMs - now);
  }

  private wakeAfter(milliseconds: number): void {
    if (this.wakePending) return;
    this.wakePending = true;
    void this.wait(milliseconds).then(() => {
      this.wakePending = false;
      this.drain();
    });
  }

  private retryDelayMs(response: Response): number {
    const retryAfter = Number(response.headers.get("Retry-After"));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1_000
      : DEFAULT_BACKOFF_MS;
  }

  private clearInFlight(
    cacheKey: string,
    operation: Promise<CachedResource>
  ): void {
    if (this.inFlight.get(cacheKey) === operation) {
      this.inFlight.delete(cacheKey);
    }
  }
}
