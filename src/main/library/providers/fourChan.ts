import type { MediaKind } from "../../../shared/media";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest,
  ProviderMediaItem
} from "./provider";
import { ProviderError } from "./provider";

const FOURCHAN_API_HOST = "a.4cdn.org";
const FOURCHAN_MEDIA_HOST = "i.4cdn.org";
const FOURCHAN_THREAD_HOSTS = new Set(["boards.4chan.org", "boards.4channel.org"]);
const DEFAULT_REQUEST_INTERVAL_MS = 1_100;
const DEFAULT_THREAD_REFRESH_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const supportedAttachmentKinds = new Map<string, MediaKind>([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".webm", "video"],
  [".mp4", "video"]
]);

export type FourChanThreadReference = {
  board: string;
  threadId: string;
  pageUrl: string;
  apiUrl: string;
};

type FourChanPost = {
  no?: unknown;
  time?: unknown;
  tim?: unknown;
  filename?: unknown;
  ext?: unknown;
  fsize?: unknown;
  filedeleted?: unknown;
};

type CachedThread = {
  collection: ProviderCollection;
  checkedAtMs: number;
  lastModified: string;
};

type FourChanProviderOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  requestIntervalMs?: number;
  threadRefreshMs?: number;
  timeoutMs?: number;
};

export function parseFourChanThreadUrl(input: string): FourChanThreadReference | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    !FOURCHAN_THREAD_HOSTS.has(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search
  ) {
    return null;
  }

  const [board, route, threadId] = url.pathname.split("/").filter(Boolean);
  if (
    !board ||
    route !== "thread" ||
    !threadId ||
    !/^[a-z0-9]+$/.test(board) ||
    !/^[1-9]\d*$/.test(threadId)
  ) {
    return null;
  }

  return {
    board,
    threadId,
    pageUrl: `https://${url.hostname}/${board}/thread/${threadId}`,
    apiUrl: `https://${FOURCHAN_API_HOST}/${board}/thread/${threadId}.json`
  };
}

function isFourChanLocation(input: string): boolean {
  try {
    return FOURCHAN_THREAD_HOSTS.has(new URL(input.trim()).hostname);
  } catch {
    return false;
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

async function createRemoteMediaResponse(
  url: string,
  pageUrl: string,
  request: Request,
  fetchImpl: typeof fetch
): Promise<Response> {
  const headers = new Headers({
    Accept: request.headers.get("Accept") ?? "*/*",
    Referer: pageUrl
  });
  const range = request.headers.get("Range");
  if (range) headers.set("Range", range);

  const upstream = await fetchImpl(url, {
    method: "GET",
    headers,
    redirect: "error"
  });
  const responseHeaders = new Headers();
  for (const name of [
    "Accept-Ranges",
    "Content-Length",
    "Content-Range",
    "Content-Type",
    "ETag",
    "Last-Modified"
  ]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  });
}

function attachmentToMediaItem(
  reference: FourChanThreadReference,
  post: FourChanPost,
  fetchImpl: typeof fetch
): ProviderMediaItem | null {
  if (post.filedeleted === 1) return null;
  if (
    typeof post.no !== "number" ||
    !Number.isSafeInteger(post.no) ||
    post.no <= 0 ||
    typeof post.tim !== "number" ||
    !Number.isSafeInteger(post.tim) ||
    post.tim <= 0 ||
    typeof post.ext !== "string"
  ) {
    return null;
  }

  const extension = post.ext.toLowerCase();
  const kind = supportedAttachmentKinds.get(extension);
  if (!kind) return null;

  const timestampMs = numberOrZero(post.time) * 1_000;
  const originalName =
    typeof post.filename === "string" && post.filename.trim()
      ? post.filename.trim()
      : String(post.tim);
  const mediaBaseUrl = `https://${FOURCHAN_MEDIA_HOST}/${reference.board}/${post.tim}`;
  const mediaUrl = `${mediaBaseUrl}${extension}`;
  const thumbnailUrl = `${mediaBaseUrl}s.jpg`;

  return {
    key: `${post.no}-${post.tim}`,
    name: `${originalName}${extension}`,
    kind,
    sizeBytes: numberOrZero(post.fsize),
    lastOpenedMs: timestampMs,
    addedMs: timestampMs,
    modifiedMs: timestampMs,
    createdMs: timestampMs,
    media: {
      respond: (request) =>
        createRemoteMediaResponse(mediaUrl, reference.pageUrl, request, fetchImpl)
    },
    thumbnail: {
      kind: "resource",
      resource: {
        respond: (request) =>
          createRemoteMediaResponse(thumbnailUrl, reference.pageUrl, request, fetchImpl)
      }
    }
  };
}

export function createFourChanThreadCollection(
  reference: FourChanThreadReference,
  payload: unknown,
  fetchImpl: typeof fetch = fetch
): ProviderCollection {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError("invalid-response", "The thread response was not an object.");
  }

  const posts = (payload as { posts?: unknown }).posts;
  if (!Array.isArray(posts)) {
    throw new ProviderError("invalid-response", "The thread response did not contain posts.");
  }

  const items = posts.flatMap((post) => {
    if (!post || typeof post !== "object") return [];
    const item = attachmentToMediaItem(reference, post as FourChanPost, fetchImpl);
    return item ? [item] : [];
  });

  if (items.length === 0) {
    throw new ProviderError(
      "no-supported-media",
      "The thread does not contain supported media."
    );
  }

  return {
    canonicalLocation: reference.pageUrl,
    title: `/${reference.board}/ thread ${reference.threadId}`,
    origin: {
      label: `/${reference.board}/ · 4chan`,
      url: reference.pageUrl
    },
    capabilities: {
      canRefresh: true,
      canSort: false
    },
    remember: false,
    items,
    selectedKey: items[0].key
  };
}

export class FourChanProvider implements MediaProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly requestIntervalMs: number;
  private readonly threadRefreshMs: number;
  private readonly timeoutMs: number;
  private readonly cache = new Map<string, CachedThread>();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestStartedAtMs: number | null = null;

  constructor(options: FourChanProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.requestIntervalMs = options.requestIntervalMs ?? DEFAULT_REQUEST_INTERVAL_MS;
    this.threadRefreshMs = options.threadRefreshMs ?? DEFAULT_THREAD_REFRESH_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  matches(location: string): boolean {
    return isFourChanLocation(location);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const reference = parseFourChanThreadUrl(request.location);
    if (!reference) {
      throw new ProviderError("invalid-location", "Enter a full 4chan thread URL.");
    }

    const cached = this.cache.get(reference.apiUrl);
    if (cached && this.now() - cached.checkedAtMs < this.threadRefreshMs) {
      return cached.collection;
    }

    return this.enqueue(async () => {
      const queuedCache = this.cache.get(reference.apiUrl);
      if (queuedCache && this.now() - queuedCache.checkedAtMs < this.threadRefreshMs) {
        return queuedCache.collection;
      }

      if (this.lastRequestStartedAtMs !== null) {
        const remainingDelay =
          this.requestIntervalMs - (this.now() - this.lastRequestStartedAtMs);
        if (remainingDelay > 0) await this.wait(remainingDelay);
      }
      this.lastRequestStartedAtMs = this.now();

      const headers = new Headers({
        Accept: "application/json",
        "User-Agent":
          "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)"
      });
      if (queuedCache) headers.set("If-Modified-Since", queuedCache.lastModified);

      let response: Response;
      try {
        response = await this.fetchImpl(reference.apiUrl, {
          method: "GET",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch {
        throw new ProviderError("unavailable", "Could not reach the thread API.");
      }

      if (response.status === 304 && queuedCache) {
        const refreshed = { ...queuedCache, checkedAtMs: this.now() };
        this.cache.set(reference.apiUrl, refreshed);
        return refreshed.collection;
      }
      if (response.status === 404 || response.status === 410) {
        throw new ProviderError("not-found", "The thread could not be found.");
      }
      if (response.status === 429 || response.status === 503) {
        throw new ProviderError("rate-limited", "The thread API asked the app to slow down.");
      }
      if (!response.ok) {
        throw new ProviderError("unavailable", `The thread API returned ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new ProviderError("invalid-response", "The thread API returned invalid JSON.");
      }

      const collection = createFourChanThreadCollection(
        reference,
        payload,
        this.fetchImpl
      );
      this.cache.set(reference.apiUrl, {
        collection,
        checkedAtMs: this.now(),
        lastModified:
          response.headers.get("Last-Modified") ?? new Date(this.now()).toUTCString()
      });
      return collection;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.requestQueue.then(operation);
    this.requestQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
