import { createHash } from "node:crypto";
import type { MediaCollection, MediaItem } from "../../shared/media";
import {
  MediaRegistry,
  type RegisteredMediaItem
} from "./mediaRegistry";
import type { MediaResource, ProviderCollection } from "./providers";

function createPublicMediaId(collectionId: string, providerKey: string): string {
  return createHash("sha256")
    .update(collectionId)
    .update("\0")
    .update(providerKey)
    .digest("hex")
    .slice(0, 32);
}

function createMediaUrl(kind: "media" | "thumbnail", id: string): string {
  return `pixvitta-media://${kind}/${id}`;
}

export class MediaCatalog {
  readonly collection: MediaCollection;
  private readonly registry = new MediaRegistry();

  constructor(collectionId: string, providerCollection: ProviderCollection) {
    const registeredItems: RegisteredMediaItem[] = [];
    const items: MediaItem[] = providerCollection.items.map((item) => {
      const id = createPublicMediaId(collectionId, item.key);
      registeredItems.push({
        id,
        name: item.name,
        downloadable: providerCollection.capabilities.canDownload,
        media: item.media,
        thumbnail:
          item.thumbnail.kind === "resource"
            ? item.thumbnail.resource
            : undefined,
        externalUrl: item.externalUrl,
        localPath: item.localPath
      });

      return {
        id,
        name: item.name,
        kind: item.kind,
        sizeBytes: item.sizeBytes,
        lastOpenedMs: item.lastOpenedMs,
        addedMs: item.addedMs,
        modifiedMs: item.modifiedMs,
        createdMs: item.createdMs,
        url: createMediaUrl("media", id),
        thumbnailUrl:
          item.thumbnail.kind === "direct"
            ? item.thumbnail.url
            : createMediaUrl("thumbnail", id)
      };
    });

    this.registry.setItems(registeredItems);
    const selectedItem = providerCollection.selectedKey
      ? providerCollection.items.findIndex(
          (item) => item.key === providerCollection.selectedKey
        )
      : -1;

    this.collection = {
      source: {
        id: collectionId,
        title: providerCollection.title,
        originLabel: providerCollection.origin?.label,
        capabilities: {
          canDownload: providerCollection.capabilities.canDownload,
          canRefresh: providerCollection.capabilities.canRefresh,
          canSort: providerCollection.capabilities.canSort,
          canOpenOrigin: !!providerCollection.origin
        }
      },
      items,
      selectedId:
        selectedItem >= 0
          ? items[selectedItem]?.id ?? null
          : items[0]?.id ?? null
    };
  }

  resolveId(id: string): RegisteredMediaItem | null {
    return this.registry.resolveId(id);
  }

  resolveUrl(url: string): MediaResource | null {
    return this.registry.resolveUrl(url);
  }
}
