import type { MediaKind } from "../../../../shared/media";
import { parseFragment } from "parse5";
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

const FOURCHAN_API_HOST = "a.4cdn.org";
const FOURCHAN_MEDIA_HOST = "i.4cdn.org";
const FOURCHAN_THREAD_HOSTS = new Set(["boards.4chan.org", "boards.4channel.org"]);
const THREAD_REFRESH_MS = 10_000;
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

type ThreadAttachment = {
  key: string;
  name: string;
  kind: MediaKind;
  sizeBytes: number;
  timestampMs: number;
  mediaUrl: string;
  thumbnailUrl: string;
};

type FourChanThread = {
  reference: FourChanThreadReference;
  title: string;
  attachments: ThreadAttachment[];
};

type CachedThread = {
  thread: FourChanThread;
  checkedAtMs: number;
  lastModified: string;
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

function parseThread(
  reference: FourChanThreadReference,
  payload: unknown
): FourChanThread {
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

  const attachments = posts.flatMap((post) => {
    if (!post || typeof post !== "object") return [];
    const attachment = parseAttachment(reference, post as FourChanPost);
    return attachment ? [attachment] : [];
  });
  if (attachments.length === 0) {
    throw new ProviderError(
      "no-supported-media",
      "The thread does not contain supported media."
    );
  }

  const firstPost = posts[0];
  const subject =
    firstPost && typeof firstPost === "object"
      ? textFromHtml((firstPost as FourChanPost).sub)
      : null;
  return {
    reference,
    title: subject ?? `/${reference.board}/ · Thread ${reference.threadId}`,
    attachments
  };
}

function parseAttachment(
  reference: FourChanThreadReference,
  post: FourChanPost
): ThreadAttachment | null {
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

  const originalName =
    typeof post.filename === "string" && post.filename.trim()
      ? post.filename.trim()
      : String(post.tim);
  const mediaBaseUrl =
    `https://${FOURCHAN_MEDIA_HOST}/${reference.board}/${post.tim}`;
  return {
    key: `${post.no}-${post.tim}`,
    name: `${originalName}${extension}`,
    kind,
    sizeBytes: numberOrZero(post.fsize),
    timestampMs: numberOrZero(post.time) * 1_000,
    mediaUrl: `${mediaBaseUrl}${extension}`,
    thumbnailUrl: `${mediaBaseUrl}s.jpg`
  };
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

export class FourChanProvider implements MediaProvider {
  readonly id = "four-chan";
  readonly sourceKind = "web";
  private readonly threads = new Map<string, CachedThread>();
  private readonly resources = new ResourceAcquisitions();

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
      return this.createCollection(cached.thread);
    }

    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": USER_AGENT
    });
    if (cached) headers.set("If-Modified-Since", cached.lastModified);

    const task = broker.request<{
      thread: FourChanThread;
      lastModified: string;
    }>({
      policy: API_POLICY,
      priority: "high",
      timeoutMs: API_TIMEOUT_MS,
      request: new Request(reference.apiUrl, {
        method: "GET",
        headers,
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (response.status === 304 && cached) {
          await cancelResponse(response);
          return {
            thread: cached.thread,
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
          thread: parseThread(reference, payload),
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
      thread: result.thread,
      checkedAtMs: Date.now(),
      lastModified: result.lastModified
    });
    return this.createCollection(result.thread);
  }

  // Every load gets its own viewing runtime because the library deactivates
  // the previous collection on commit, even when the thread is unchanged.
  // Acquisitions are provider-wide, so overlapping work survives a refresh.
  private createCollection(thread: FourChanThread): ProviderCollection {
    const { reference, attachments } = thread;
    const runtime = new ProviderCollectionRuntime<CachedFile>(this.resources, {
      itemCount: attachments.length,
      mediaKey: (index) => `four-chan:media:${attachments[index].mediaUrl}`,
      loadMedia: (index, io) => {
        const attachment = attachments[index];
        const isImage = attachment.kind === "image";
        return this.loadFile(io, {
          cacheKey: `four-chan:media:${attachment.mediaUrl}`,
          url: attachment.mediaUrl,
          pageUrl: reference.pageUrl,
          accept: isImage ? "image/*" : "video/*",
          supportedTypes: isImage
            ? supportedImageContentTypes
            : supportedVideoContentTypes,
          policy: MEDIA_POLICY
        });
      },
      thumbnailKey: (index) =>
        `four-chan:thumbnail:${attachments[index].thumbnailUrl}`,
      loadThumbnail: (index, io) =>
        this.loadFile(io, {
          cacheKey: `four-chan:thumbnail:${attachments[index].thumbnailUrl}`,
          url: attachments[index].thumbnailUrl,
          pageUrl: reference.pageUrl,
          accept: "image/*",
          supportedTypes: supportedImageContentTypes,
          policy: THUMBNAIL_POLICY
        })
    });
    const indexByKey = new Map(
      attachments.map((attachment, index) => [attachment.key, index])
    );

    const items = attachments.map((attachment, index): ProviderMediaItem => ({
      key: attachment.key,
      name: attachment.name,
      kind: attachment.kind,
      sizeBytes: attachment.sizeBytes,
      lastOpenedMs: attachment.timestampMs,
      addedMs: attachment.timestampMs,
      modifiedMs: attachment.timestampMs,
      createdMs: attachment.timestampMs,
      media: {
        respond: (request, priority) =>
          fileResponse(request, () =>
            runtime.getMedia(index, priority, request)
          )
      },
      externalUrl: attachment.mediaUrl,
      thumbnail: {
        kind: "resource",
        resource: {
          respond: (request, priority) =>
            fileResponse(request, () =>
              runtime.getThumbnail(index, priority, request)
            )
        }
      }
    }));

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
      title: thread.title,
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

  private loadFile(
    io: ProviderIO,
    file: {
      cacheKey: string;
      url: string;
      pageUrl: string;
      accept: string;
      supportedTypes: ReadonlySet<string>;
      policy: RequestPolicy;
    }
  ): Promise<CachedFile> {
    return io.cachedFile(file.cacheKey, () =>
      io.requestFile({
        cacheKey: file.cacheKey,
        policy: file.policy,
        timeoutMs: MEDIA_TIMEOUT_MS,
        request: new Request(file.url, {
          method: "GET",
          headers: {
            Accept: file.accept,
            "User-Agent": USER_AGENT
          },
          referrer: file.pageUrl,
          referrerPolicy: "unsafe-url",
          redirect: "error"
        }),
        validate: (response) => {
          if (!response.ok) {
            throw new Error(`4chan media returned ${response.status}.`);
          }
          const contentType = responseContentType(response);
          if (!contentType || !file.supportedTypes.has(contentType)) {
            throw new Error(
              `4chan returned an unsupported media type: ${contentType ?? "unknown"}.`
            );
          }
          return contentType;
        }
      })
    );
  }
}
