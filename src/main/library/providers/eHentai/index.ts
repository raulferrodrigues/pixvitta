import { createHash } from "node:crypto";
import { DiskResourceCache } from "../../../resourceCache/diskResourceCache";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderLoadRequest
} from "../provider";
import { ProviderError } from "../provider";
import {
  isEHentaiLocation,
  parseEHentaiGalleryUrl,
  type EHentaiGalleryReference
} from "./galleryReference";
import { EHentaiGallerySession } from "./gallerySession";
import { EHentaiImagePipeline } from "./imagePipeline";
import { EHentaiMetadataClient } from "./metadataClient";
import { EHentaiThumbnailPipeline } from "./thumbnailPipeline";

export {
  parseEHentaiGalleryUrl,
  type EHentaiGalleryReference
} from "./galleryReference";

type EHentaiProviderOptions = {
  cacheDirectory: () => string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  imageIntervalMs?: number;
  thumbnailFetchImpl?: typeof fetch;
};

export class EHentaiProvider implements MediaProvider {
  readonly id = "e-hentai";
  readonly sourceKind = "web";
  private readonly fetchImpl: typeof fetch;
  private readonly metadataClient: EHentaiMetadataClient;
  private readonly imagePipeline: EHentaiImagePipeline;
  private readonly thumbnailPipeline: EHentaiThumbnailPipeline;

  constructor(options: EHentaiProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.metadataClient = new EHentaiMetadataClient(this.fetchImpl);
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

    const metadata = await this.metadataClient.load(reference);
    const session = new EHentaiGallerySession({
      reference,
      fileCount: metadata.fileCount,
      imagePipeline: this.imagePipeline,
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
      remember: true,
      items,
      selectedKey: items[0]?.key ?? null
    };
  }
}
