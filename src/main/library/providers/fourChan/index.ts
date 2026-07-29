import type { MediaKind } from "../../../../shared/media";
import { parseFragment } from "parse5";
import { createMediaFileResponse } from "../../../media/mediaResponses";
import {
  broker,
  type BrokerTask,
  type RequestPolicy,
  type RequestPriority
} from "../../../requestBroker";
import { cache, type CachedFile } from "../../../resourceCache";
import { mediaFileTypes } from "../../../utils/mediaTypes";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest,
  ProviderMediaItem
} from "../provider";
import { ProviderError } from "../provider";

const FOURCHAN_API_HOST = "a.4cdn.org";
const FOURCHAN_MEDIA_HOST = "i.4cdn.org";
const FOURCHAN_THREAD_HOSTS = new Set(["boards.4chan.org", "boards.4channel.org"]);
const THREAD_REFRESH_MS = 10_000;
const PREFETCH_COUNT = 5;
const API_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 60_000;
const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";

const API_POLICY = {
  id: "four-chan:api",
  delayMs: 1_000
} satisfies RequestPolicy;

const MEDIA_POLICY = {
  id: "four-chan:media",
  delayMs: 1_000
} satisfies RequestPolicy;

const THUMBNAIL_POLICY = {
  id: "four-chan:thumbnails",
  delayMs: 200
} satisfies RequestPolicy;

const supportedAttachmentKinds = new Map<string, MediaKind>([
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".gif", "image"],
  [".webp", "image"],
  [".webm", "video"],
  [".mp4", "video"]
]);

const supportedImageContentTypes = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "image")
    .map((fileType) => fileType.mimeType)
);

const supportedVideoContentTypes = new Set<string>(
  mediaFileTypes
    .filter((fileType) => fileType.kind === "video")
    .map((fileType) => fileType.mimeType)
);

export type FourChanThreadReference = {
  board: string;
  threadId: string;
  pageUrl: string;
  apiUrl: string;
};

type FourChanPost = {
  no?: unknown;
  sub?: unknown;
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
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

type HtmlTextNode = {
  value?: string;
  childNodes?: HtmlTextNode[];
};

function textFromHtml(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const fragment = parseFragment(value) as unknown as HtmlTextNode;
  const parts: string[] = [];
  function visit(node: HtmlTextNode): void {
    if (typeof node.value === "string") parts.push(node.value);
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(fragment);
  const title = parts.join(" ").replace(/\s+/g, " ").trim();
  return title || null;
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

export class FourChanProvider implements MediaProvider {
  readonly id = "four-chan";
  readonly sourceKind = "web";
  private readonly threads = new Map<string, CachedThread>();
  private readonly inFlight: {
    [cacheKey: string]: InFlightEntry | undefined;
  } = {};

  matches(location: string): boolean {
    return isFourChanLocation(location);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const reference = parseFourChanThreadUrl(request.location);
    if (!reference) {
      throw new ProviderError("invalid-location", "Enter a full 4chan thread URL.");
    }

    const cached = this.threads.get(reference.apiUrl);
    if (cached && Date.now() - cached.checkedAtMs < THREAD_REFRESH_MS) {
      return cached.collection;
    }

    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": USER_AGENT
    });
    if (cached) headers.set("If-Modified-Since", cached.lastModified);

    const task = broker.request<{
      collection: ProviderCollection;
      lastModified: string;
    }>({
      policy: API_POLICY,
      priority: "high",
      request: new Request(reference.apiUrl, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      }),
      handleResponse: async (response) => {
        if (response.status === 304 && cached) {
          await cancelResponse(response);
          return {
            collection: cached.collection,
            lastModified: cached.lastModified
          };
        }
        if (response.status === 404 || response.status === 410) {
          await cancelResponse(response);
          throw new ProviderError("not-found", "The thread could not be found.");
        }
        if (response.status === 503) {
          await cancelResponse(response);
          throw new ProviderError(
            "rate-limited",
            "The thread API asked the app to slow down."
          );
        }
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new ProviderError(
            "unavailable",
            `The thread API returned ${status}.`
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new ProviderError(
            "invalid-response",
            "The thread API returned invalid JSON."
          );
        }
        return {
          collection: this.createCollection(reference, payload),
          lastModified:
            response.headers.get("Last-Modified") ??
            new Date().toUTCString()
        };
      }
    });

    let result;
    try {
      result = await task.result;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("unavailable", "Could not reach the thread API.");
    }

    this.threads.set(reference.apiUrl, {
      collection: result.collection,
      checkedAtMs: Date.now(),
      lastModified: result.lastModified
    });
    return result.collection;
  }

  private createCollection(
    reference: FourChanThreadReference,
    payload: unknown
  ): ProviderCollection {
    if (!payload || typeof payload !== "object") {
      throw new ProviderError(
        "invalid-response",
        "The thread response was not an object."
      );
    }

    const posts = (payload as { posts?: unknown }).posts;
    if (!Array.isArray(posts)) {
      throw new ProviderError(
        "invalid-response",
        "The thread response did not contain posts."
      );
    }

    const items = posts.flatMap((post) => {
      if (!post || typeof post !== "object") return [];
      const item = this.attachmentToMediaItem(
        reference,
        post as FourChanPost
      );
      return item ? [item] : [];
    });
    if (items.length === 0) {
      throw new ProviderError(
        "no-supported-media",
        "The thread does not contain supported media."
      );
    }
    this.installMediaPrefetch(items, reference.pageUrl);

    const firstPost = posts[0];
    const subject =
      firstPost && typeof firstPost === "object"
        ? textFromHtml((firstPost as FourChanPost).sub)
        : null;

    return {
      canonicalLocation: reference.pageUrl,
      title: subject ?? `/${reference.board}/ · Thread ${reference.threadId}`,
      origin: {
        label: `/${reference.board}/ · 4chan`,
        url: reference.pageUrl
      },
      capabilities: {
        canRefresh: true,
        canSort: false
      },
      remember: true,
      items,
      selectedKey: items[0].key
    };
  }

  private attachmentToMediaItem(
    reference: FourChanThreadReference,
    post: FourChanPost
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
    const mediaBaseUrl =
      `https://${FOURCHAN_MEDIA_HOST}/${reference.board}/${post.tim}`;
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
        respond: (request, priority) =>
          this.respondWithCachedFile(
            `four-chan:media:${mediaUrl}`,
            mediaUrl,
            reference.pageUrl,
            kind === "image" ? "image/*" : "video/*",
            kind === "image"
              ? supportedImageContentTypes
              : supportedVideoContentTypes,
            request,
            priority
          )
      },
      externalUrl: mediaUrl,
      thumbnail: {
        kind: "resource",
        resource: {
          respond: (request, priority) =>
            this.respondWithCachedFile(
              `four-chan:thumbnail:${thumbnailUrl}`,
              thumbnailUrl,
              reference.pageUrl,
              "image/*",
              supportedImageContentTypes,
              request,
              priority,
              THUMBNAIL_POLICY
            )
        }
      }
    };
  }

  private installMediaPrefetch(
    items: ProviderMediaItem[],
    pageUrl: string
  ): void {
    let selectedIndex: number | null = null;
    let demandRevision = 0;

    const prefetchOrderFrom = (index: number): number[] => {
      const forward = Array.from(
        {
          length: Math.min(items.length, index + PREFETCH_COUNT + 1) - index - 1
        },
        (_, offset) => index + offset + 1
      );
      const backward = Array.from(
        { length: Math.min(PREFETCH_COUNT, index) },
        (_, offset) => index - offset - 1
      );
      return [...forward, ...backward];
    };

    const prefetch = async (
      index: number,
      revision: number
    ): Promise<void> => {
      for (const prefetchIndex of prefetchOrderFrom(index)) {
        if (revision !== demandRevision) return;
        const item = items[prefetchIndex];
        if (!item?.externalUrl) continue;

        try {
          await this.getCachedFile(
            `four-chan:media:${item.externalUrl}`,
            item.externalUrl,
            pageUrl,
            item.kind === "image" ? "image/*" : "video/*",
            item.kind === "image"
              ? supportedImageContentTypes
              : supportedVideoContentTypes,
            "low"
          );
        } catch (error) {
          console.error(
            `[4chan] Could not prefetch media item ${prefetchIndex + 1}.`,
            error
          );
          return;
        }
      }
    };

    items.forEach((item, index) => {
      const respond = item.media.respond;
      item.media = {
        respond: async (request, priority) => {
          const startsNewDemand =
            priority === "high" && selectedIndex !== index;
          let revision: number | null = null;
          if (startsNewDemand) {
            selectedIndex = index;
            revision = ++demandRevision;
          }

          const response = await respond(request, priority);
          if (revision !== null && revision === demandRevision) {
            void prefetch(index, revision);
          }
          return response;
        }
      };
    });
  }

  private respondWithCachedFile(
    cacheKey: string,
    remoteUrl: string,
    pageUrl: string,
    accept: string,
    supportedTypes: ReadonlySet<string>,
    request: Request,
    priority: RequestPriority,
    policy: RequestPolicy = MEDIA_POLICY
  ): Promise<Response> {
    return this.getCachedFile(
      cacheKey,
      remoteUrl,
      pageUrl,
      accept,
      supportedTypes,
      priority,
      policy
    ).then((file) =>
      createMediaFileResponse(
        file.filePath,
        request.headers,
        file.contentType
      )
    );
  }

  private getCachedFile(
    cacheKey: string,
    remoteUrl: string,
    pageUrl: string,
    accept: string,
    supportedTypes: ReadonlySet<string>,
    priority: RequestPriority,
    policy: RequestPolicy = MEDIA_POLICY
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
      throw new Error("A 4chan acquisition was registered without a promise.");
    }

    const entry: InFlightEntry = {
      priority,
      brokerTask: null,
      promise: null
    };
    this.inFlight[cacheKey] = entry;
    const operation = this.acquireFile(
      cacheKey,
      remoteUrl,
      pageUrl,
      accept,
      supportedTypes,
      entry,
      policy
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

  private async acquireFile(
    cacheKey: string,
    remoteUrl: string,
    pageUrl: string,
    accept: string,
    supportedTypes: ReadonlySet<string>,
    entry: InFlightEntry,
    policy: RequestPolicy
  ): Promise<CachedFile> {
    const cached = await cache.find(cacheKey);
    if (cached) return cached;

    const task = broker.request<CachedFile>({
      policy,
      priority: entry.priority,
      request: new Request(remoteUrl, {
        method: "GET",
        headers: {
          Accept: accept,
          "User-Agent": USER_AGENT
        },
        referrer: pageUrl,
        referrerPolicy: "unsafe-url",
        redirect: "error",
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS)
      }),
      handleResponse: async (response) => {
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new Error(`4chan media returned ${status}.`);
        }
        const contentType = responseContentType(response);
        if (!contentType || !supportedTypes.has(contentType)) {
          await cancelResponse(response);
          throw new Error(
            `4chan returned an unsupported media type: ${contentType ?? "unknown"}.`
          );
        }
        if (!response.body) {
          throw new Error("4chan returned an empty media response.");
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
