import { readFile } from "node:fs/promises";
import { createMediaFileResponse } from "../../../media/mediaResponses";
import {
  broker,
  type BrokerTask,
  type RequestPriority
} from "../../../requestBroker";
import type { EHentaiGalleryReference } from ".";
import {
  type EHentaiImagePageReference,
  parseGalleryImagePages
} from "./html";
import {
  EHentaiImagePipeline,
  ImageRequestSupersededError
} from "./imagePipeline";
import { PAGES_POLICY } from "./requestPolicies";
import { renderSpriteThumbnail } from "./spriteThumbnail";
import { EHentaiThumbnailPipeline } from "./thumbnailPipeline";

const INDEX_PAGE_SIZE = 20;
const PREFETCH_COUNT = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";

type GallerySessionOptions = {
  reference: EHentaiGalleryReference;
  fileCount: number;
  pipeline: Pick<EHentaiImagePipeline, "get">;
  thumbnailPipeline: Pick<EHentaiThumbnailPipeline, "get">;
};

type IndexRequestEntry = {
  priority: RequestPriority;
  brokerTask: BrokerTask<unknown> | null;
  promise: Promise<void>;
};

const priorityRanks: Record<RequestPriority, number> = {
  low: 0,
  normal: 1,
  high: 2
};

function debugPriority(message: string): void {
  console.debug(`[e-hentai-priority ${new Date().toISOString()}] ${message}`);
}

async function cancelResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The session is already rejecting this response.
  }
}

export class EHentaiGallerySession {
  private readonly pages = new Map<number, EHentaiImagePageReference>();
  private readonly indexRequests: {
    [indexPage: string]: IndexRequestEntry | undefined;
  } = {};
  private desiredPages = new Set<number>();
  private demandRevision = 0;

  constructor(private readonly options: GallerySessionOptions) {}

  async respond(
    pageNumber: number,
    request: Request,
    priority: RequestPriority
  ): Promise<Response> {
    if (!this.isValidPage(pageNumber)) {
      return new Response(null, { status: 404 });
    }

    const isSelected = priority === "high";
    debugPriority(`requested page=${pageNumber} priority=${priority}`);
    const revision = isSelected ? ++this.demandRevision : 0;
    if (isSelected) {
      this.desiredPages = new Set(this.windowFrom(pageNumber));
    }

    try {
      const page = await this.resolvePage(pageNumber, priority);
      const file = await this.options.pipeline.get(
        this.cacheKey(page),
        page.pageUrl,
        priority,
        isSelected
          ? () =>
              revision === this.demandRevision &&
              !request.signal.aborted
          : () => true
      );
      if (isSelected && revision === this.demandRevision) {
        void this.prefetch(pageNumber, revision);
      }
      return createMediaFileResponse(
        file.filePath,
        request.headers,
        file.contentType
      );
    } catch (error) {
      if (error instanceof ImageRequestSupersededError) {
        return new Response(null, { status: 409 });
      }
      throw error;
    }
  }

  async respondThumbnail(
    pageNumber: number,
    request: Request,
    priority: RequestPriority
  ): Promise<Response> {
    if (!this.isValidPage(pageNumber)) {
      return new Response(null, { status: 404 });
    }

    try {
      const page = await this.resolvePage(pageNumber, priority);
      if (!page.thumbnail) return emptyThumbnailResponse();
      const file = await this.options.thumbnailPipeline.get(
        this.thumbnailCacheKey(page.thumbnail.url),
        page.thumbnail.url,
        priority
      );
      if (page.thumbnail.kind === "direct") {
        return createMediaFileResponse(
          file.filePath,
          request.headers,
          file.contentType
        );
      }

      const rendered = renderSpriteThumbnail(
        {
          bytes: new Uint8Array(await readFile(file.filePath)),
          contentType: file.contentType
        },
        page.thumbnail.crop
      );
      return bytesResponse(rendered.bytes, rendered.contentType);
    } catch {
      return emptyThumbnailResponse();
    }
  }

  private async prefetch(
    selectedPage: number,
    revision: number
  ): Promise<void> {
    for (const pageNumber of this.prefetchOrderFrom(selectedPage)) {
      if (revision !== this.demandRevision) return;
      try {
        debugPriority(`prefetch page=${pageNumber} priority=normal`);
        const page = await this.resolvePage(pageNumber, "normal");
        if (revision !== this.demandRevision) return;
        await this.options.pipeline.get(
          this.cacheKey(page),
          page.pageUrl,
          "normal",
          () =>
            revision === this.demandRevision &&
            this.desiredPages.has(pageNumber)
        );
      } catch (error) {
        if (error instanceof ImageRequestSupersededError) return;
        console.error(
          `[e-hentai] Could not prefetch gallery page ${pageNumber}.`,
          error
        );
        return;
      }
    }
  }

  private async resolvePage(
    pageNumber: number,
    priority: RequestPriority
  ): Promise<EHentaiImagePageReference> {
    const existingPage = this.pages.get(pageNumber);
    if (existingPage) return existingPage;

    const indexPage = Math.floor((pageNumber - 1) / INDEX_PAGE_SIZE);
    const key = String(indexPage);
    let entry = this.indexRequests[key];
    if (entry) {
      if (priorityRanks[priority] > priorityRanks[entry.priority]) {
        const previousPriority = entry.priority;
        entry.priority = priority;
        if (entry.brokerTask) {
          broker.promote(entry.brokerTask, priority);
        }
        debugPriority(
          `joined index=${indexPage} promoted=${previousPriority}->${priority} brokerTask=${entry.brokerTask ? "present" : "pending"}`
        );
      }
    } else {
      entry = {
        priority,
        brokerTask: null,
        promise: Promise.resolve()
      };
      this.indexRequests[key] = entry;
      debugPriority(`created index=${indexPage} priority=${priority}`);
      entry.promise = this.loadIndexPage(indexPage, entry);
      const cleanup = () => {
        if (this.indexRequests[key] === entry) {
          delete this.indexRequests[key];
        }
      };
      void entry.promise.then(cleanup, cleanup);
    }
    await entry.promise;

    const resolved = this.pages.get(pageNumber);
    if (!resolved) {
      throw new Error(
        `E-Hentai gallery index ${indexPage} did not contain page ${pageNumber}.`
      );
    }
    return resolved;
  }

  private async loadIndexPage(
    indexPage: number,
    entry: IndexRequestEntry
  ): Promise<void> {
    const indexUrl =
      indexPage === 0
        ? this.options.reference.pageUrl
        : `${this.options.reference.pageUrl}?p=${indexPage}`;
    debugPriority(
      `submitted index=${indexPage} stage=gallery-page priority=${entry.priority}`
    );
    const task = broker.request<Map<number, EHentaiImagePageReference>>({
      policy: PAGES_POLICY,
      priority: entry.priority,
      timeoutMs: REQUEST_TIMEOUT_MS,
      request: new Request(indexUrl, {
        method: "GET",
        headers: {
          Accept: "text/html",
          "User-Agent": USER_AGENT
        },
        redirect: "error"
      }),
      handleResponse: async (response) => {
        if (!response.ok) {
          const status = response.status;
          await cancelResponse(response);
          throw new Error(`E-Hentai gallery index returned ${status}.`);
        }
        const references = parseGalleryImagePages(
          await response.text(),
          this.options.reference.pageUrl,
          this.options.reference.galleryId
        );
        if (references.size === 0) {
          throw new Error(
            "E-Hentai gallery index did not contain image pages."
          );
        }
        return references;
      }
    });
    entry.brokerTask = task;
    let references: Map<number, EHentaiImagePageReference>;
    try {
      references = await task.result;
    } finally {
      if (entry.brokerTask === task) entry.brokerTask = null;
    }
    for (const [pageNumber, reference] of references) {
      if (this.isValidPage(pageNumber)) {
        this.pages.set(pageNumber, reference);
      }
    }
  }

  private windowFrom(pageNumber: number): number[] {
    return [pageNumber, ...this.prefetchOrderFrom(pageNumber)];
  }

  private prefetchOrderFrom(pageNumber: number): number[] {
    const forward = Array.from(
      {
        length:
          Math.min(this.options.fileCount, pageNumber + PREFETCH_COUNT) -
          pageNumber
      },
      (_, index) => pageNumber + index + 1
    );
    const backward = Array.from(
      { length: Math.min(PREFETCH_COUNT, pageNumber - 1) },
      (_, index) => pageNumber - index - 1
    );
    return [...forward, ...backward];
  }

  private isValidPage(pageNumber: number): boolean {
    return (
      Number.isSafeInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= this.options.fileCount
    );
  }

  private cacheKey(page: EHentaiImagePageReference): string {
    return (
      `e-hentai:image:${this.options.reference.galleryId}:` +
      `${page.pageToken}:${page.pageNumber}`
    );
  }

  private thumbnailCacheKey(thumbnailUrl: string): string {
    return `e-hentai:thumbnail:${thumbnailUrl}`;
  }
}

const EMPTY_GIF = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255,
  33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1,
  0, 59
]);

function bytesResponse(bytes: Uint8Array, contentType: string): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Length": String(bytes.byteLength),
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "cross-origin"
    }
  });
}

function emptyThumbnailResponse(): Response {
  return bytesResponse(EMPTY_GIF, "image/gif");
}
