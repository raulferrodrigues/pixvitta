import { createHash } from "node:crypto";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest
} from "../provider";
import { ProviderError } from "../provider";
import { DiskResourceCache } from "../../../resourceCache/diskResourceCache";
import { EHentaiGallerySession } from "./gallerySession";
import { EHentaiImagePipeline } from "./imagePipeline";
import { EHentaiThumbnailPipeline } from "./thumbnailPipeline";

const API_URL = "https://api.e-hentai.org/api.php";
const USER_AGENT =
  "Pixvitta media viewer (+https://github.com/raulferrodrigues/pixvitta)";
const REQUEST_TIMEOUT_MS = 15_000;

export type EHentaiGalleryReference = {
  galleryId: string;
  galleryToken: string;
  pageUrl: string;
};

type GalleryMetadata = {
  title: string;
  postedMs: number;
  fileCount: number;
};

type EHentaiProviderOptions = {
  cacheDirectory: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  imageIntervalMs?: number;
  thumbnailFetchImpl?: typeof fetch;
};

export function parseEHentaiGalleryUrl(
  input: string
): EHentaiGalleryReference | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (
    url.protocol !== "https:" ||
    url.hostname !== "e-hentai.org" ||
    url.port ||
    url.username ||
    url.password ||
    url.search
  ) {
    return null;
  }

  const [route, galleryId, galleryToken, ...extra] = url.pathname
    .split("/")
    .filter(Boolean);
  if (
    route !== "g" ||
    !galleryId ||
    !/^[1-9]\d*$/.test(galleryId) ||
    !galleryToken ||
    !/^[a-f0-9]{10}$/i.test(galleryToken) ||
    extra.length > 0
  ) {
    return null;
  }

  return {
    galleryId,
    galleryToken: galleryToken.toLowerCase(),
    pageUrl: `https://e-hentai.org/g/${galleryId}/${galleryToken.toLowerCase()}/`
  };
}

function isEHentaiLocation(input: string): boolean {
  try {
    return new URL(input.trim()).hostname === "e-hentai.org";
  } catch {
    return false;
  }
}

function parseMetadata(
  payload: unknown,
  reference: EHentaiGalleryReference
): GalleryMetadata {
  if (!payload || typeof payload !== "object") {
    throw new ProviderError("invalid-response", "Gallery metadata was not an object.");
  }
  const entries = (payload as { gmetadata?: unknown }).gmetadata;
  const entry = Array.isArray(entries) ? entries[0] : null;
  if (!entry || typeof entry !== "object") {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata did not contain a gallery."
    );
  }

  const metadata = entry as Record<string, unknown>;
  if (metadata.error) {
    throw new ProviderError("not-found", "The gallery is unavailable.");
  }
  const title =
    typeof metadata.title === "string" && metadata.title.trim()
      ? metadata.title.trim()
      : `E-Hentai gallery ${reference.galleryId}`;
  const fileCount = Number(metadata.filecount);
  const postedSeconds = Number(metadata.posted);
  if (!Number.isSafeInteger(fileCount) || fileCount < 1) {
    throw new ProviderError(
      "invalid-response",
      "Gallery metadata contained an invalid file count."
    );
  }

  return {
    title,
    fileCount,
    postedMs:
      Number.isFinite(postedSeconds) && postedSeconds >= 0
        ? postedSeconds * 1_000
        : 0
  };
}

export class EHentaiProvider implements MediaProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly imagePipeline: EHentaiImagePipeline;
  private readonly thumbnailPipeline: EHentaiThumbnailPipeline;

  constructor(options: EHentaiProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.imagePipeline = new EHentaiImagePipeline(
      new DiskResourceCache(options.cacheDirectory, "e-hentai-images-v1"),
      {
        fetchImpl: this.fetchImpl,
        now: options.now,
        wait: options.wait,
        intervalMs: options.imageIntervalMs
      }
    );
    this.thumbnailPipeline = new EHentaiThumbnailPipeline(
      new DiskResourceCache(options.cacheDirectory, "e-hentai-thumbnails-v1"),
      {
        fetchImpl: options.thumbnailFetchImpl ?? this.fetchImpl,
        now: options.now,
        wait: options.wait
      }
    );
  }

  matches(location: string): boolean {
    return isEHentaiLocation(location);
  }

  async load(request: ProviderLoadRequest): Promise<ProviderCollection> {
    const reference = parseEHentaiGalleryUrl(request.location);
    if (!reference) {
      throw new ProviderError(
        "invalid-location",
        "Enter a full public E-Hentai gallery URL."
      );
    }

    const metadata = await this.fetchMetadata(reference);
    const session = new EHentaiGallerySession({
      reference,
      fileCount: metadata.fileCount,
      pipeline: this.imagePipeline,
      thumbnailPipeline: this.thumbnailPipeline,
      fetchImpl: this.fetchImpl
    });
    const nameWidth = Math.max(3, String(metadata.fileCount).length);
    const galleryHash = createHash("md5")
      .update(`${reference.galleryId}:${reference.galleryToken}`)
      .digest("hex")
      .slice(0, 12);
    const items = Array.from({ length: metadata.fileCount }, (_, index) => {
      const pageNumber = index + 1;
      const pageLabel = String(pageNumber).padStart(nameWidth, "0");
      return {
        key: `${reference.galleryId}:page:${pageNumber}`,
        name: `Page ${pageLabel}`,
        downloadName: `${galleryHash}-page-${pageLabel}`,
        kind: "image" as const,
        sizeBytes: 0,
        lastOpenedMs: metadata.postedMs,
        addedMs: metadata.postedMs,
        modifiedMs: metadata.postedMs,
        createdMs: metadata.postedMs,
        media: {
          respond: () => session.respond(pageNumber)
        },
        thumbnail: {
          kind: "resource" as const,
          resource: {
            respond: () => session.respondThumbnail(pageNumber)
          }
        }
      };
    });

    return {
      canonicalLocation: reference.pageUrl,
      title: metadata.title,
      origin: {
        label: `E-Hentai · ${metadata.fileCount} pages`,
        url: reference.pageUrl
      },
      capabilities: {
        canDownload: true,
        canRefresh: true,
        canSort: false
      },
      remember: false,
      items,
      selectedKey: items[0]?.key ?? null
    };
  }

  private async fetchMetadata(
    reference: EHentaiGalleryReference
  ): Promise<GalleryMetadata> {
    let response: Response;
    try {
      response = await this.fetchImpl(API_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({
          method: "gdata",
          gidlist: [[Number(reference.galleryId), reference.galleryToken]],
          namespace: 1
        }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new ProviderError("unavailable", "Could not reach E-Hentai.");
    }
    if (response.status === 429 || response.status === 503) {
      throw new ProviderError("rate-limited", "E-Hentai asked the app to slow down.");
    }
    if (!response.ok) {
      throw new ProviderError(
        "unavailable",
        `The gallery API returned ${response.status}.`
      );
    }

    try {
      return parseMetadata(await response.json(), reference);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "invalid-response",
        "The gallery API returned invalid JSON."
      );
    }
  }
}
