import type { EHentaiGalleryReference } from ".";
import {
  type EHentaiImagePageReference,
  parseGalleryImagePages
} from "./html";
import {
  cachedResourceResponse,
  EHentaiImagePipeline,
  ImageRequestSupersededError
} from "./imagePipeline";

const INDEX_PAGE_SIZE = 20;
const PREFETCH_COUNT = 5;
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";

type GallerySessionOptions = {
  reference: EHentaiGalleryReference;
  fileCount: number;
  pipeline: Pick<EHentaiImagePipeline, "get">;
  fetchImpl?: typeof fetch;
};

export class EHentaiGallerySession {
  private readonly fetchImpl: typeof fetch;
  private readonly pages = new Map<number, EHentaiImagePageReference>();
  private readonly indexRequests = new Map<number, Promise<void>>();
  private desiredPages = new Set<number>();
  private demandRevision = 0;

  constructor(private readonly options: GallerySessionOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async respond(pageNumber: number): Promise<Response> {
    if (!this.isValidPage(pageNumber)) return new Response(null, { status: 404 });

    const revision = ++this.demandRevision;
    this.desiredPages = new Set(this.windowFrom(pageNumber));

    try {
      const page = await this.resolvePage(pageNumber);
      const selected = this.options.pipeline.get(
        this.cacheKey(page),
        page.pageUrl,
        () => this.desiredPages.has(pageNumber)
      );
      const resource = await selected;
      if (revision === this.demandRevision) {
        void this.prefetch(pageNumber, revision);
      }
      return cachedResourceResponse(resource);
    } catch (error) {
      if (error instanceof ImageRequestSupersededError) {
        return new Response(null, { status: 409 });
      }
      throw error;
    }
  }

  private async prefetch(
    selectedPage: number,
    revision: number
  ): Promise<void> {
    for (
      let pageNumber = selectedPage + 1;
      pageNumber <= Math.min(this.options.fileCount, selectedPage + PREFETCH_COUNT);
      pageNumber += 1
    ) {
      if (revision !== this.demandRevision) return;
      try {
        const page = await this.resolvePage(pageNumber);
        if (revision !== this.demandRevision) return;
        await this.options.pipeline.get(
          this.cacheKey(page),
          page.pageUrl,
          () => this.desiredPages.has(pageNumber)
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
    pageNumber: number
  ): Promise<EHentaiImagePageReference> {
    const existing = this.pages.get(pageNumber);
    if (existing) return existing;

    const indexPage = Math.floor((pageNumber - 1) / INDEX_PAGE_SIZE);
    let request = this.indexRequests.get(indexPage);
    if (!request) {
      request = this.loadIndexPage(indexPage);
      this.indexRequests.set(indexPage, request);
      void request.catch(() => {
        if (this.indexRequests.get(indexPage) === request) {
          this.indexRequests.delete(indexPage);
        }
      });
    }
    await request;

    const resolved = this.pages.get(pageNumber);
    if (!resolved) {
      throw new Error(
        `E-Hentai gallery index ${indexPage} did not contain page ${pageNumber}.`
      );
    }
    return resolved;
  }

  private async loadIndexPage(indexPage: number): Promise<void> {
    const indexUrl =
      indexPage === 0
        ? this.options.reference.pageUrl
        : `${this.options.reference.pageUrl}?p=${indexPage}`;
    const response = await this.fetchImpl(indexUrl, {
      method: "GET",
      headers: {
        Accept: "text/html",
        "User-Agent": USER_AGENT
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) {
      throw new Error(`E-Hentai gallery index returned ${response.status}.`);
    }

    const references = parseGalleryImagePages(
      await response.text(),
      this.options.reference.pageUrl,
      this.options.reference.galleryId
    );
    if (references.size === 0) {
      throw new Error("E-Hentai gallery index did not contain image pages.");
    }
    for (const [pageNumber, reference] of references) {
      if (this.isValidPage(pageNumber)) this.pages.set(pageNumber, reference);
    }
  }

  private windowFrom(pageNumber: number): number[] {
    const lastPage = Math.min(
      this.options.fileCount,
      pageNumber + PREFETCH_COUNT
    );
    return Array.from(
      { length: lastPage - pageNumber + 1 },
      (_, index) => pageNumber + index
    );
  }

  private isValidPage(pageNumber: number): boolean {
    return (
      Number.isSafeInteger(pageNumber) &&
      pageNumber >= 1 &&
      pageNumber <= this.options.fileCount
    );
  }

  private cacheKey(page: EHentaiImagePageReference): string {
    return `${this.options.reference.galleryId}:${page.pageToken}:${page.pageNumber}`;
  }
}
