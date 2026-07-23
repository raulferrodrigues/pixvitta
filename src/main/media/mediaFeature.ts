import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { createHash } from "node:crypto";
import type { MediaCollection, MediaItem } from "../../shared/media";
import type { ProviderCollection } from "../library/providers/provider";
import { showNativeMediaContextMenu } from "./mediaContextMenu";
import { MediaRegistry, type RegisteredMediaItem } from "./mediaRegistry";

const registry = new MediaRegistry();

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

async function createMediaResponse(request: Request): Promise<Response> {
  const resource = registry.resolveUrl(request.url);
  if (!resource) return new Response(null, { status: 404 });

  try {
    return await resource.respond(request);
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }
}

function showMediaContextMenu(window: BrowserWindow, mediaId: unknown): boolean {
  if (typeof mediaId !== "string") return false;

  const item = registry.resolveId(mediaId);
  if (!item?.localPath) return false;
  showNativeMediaContextMenu(window, item.localPath);
  return true;
}

function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "pixvitta-media",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

function registerMediaIpcHandler(): void {
  ipcMain.handle("media:show-context-menu", (event, mediaId: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? showMediaContextMenu(window, mediaId) : false;
  });
}

function registerMediaProtocolHandler(): void {
  protocol.handle("pixvitta-media", createMediaResponse);
}

registerMediaProtocolScheme();
registerMediaIpcHandler();
void app.whenReady().then(registerMediaProtocolHandler);

export function activateProviderCollection(
  collectionId: string,
  collection: ProviderCollection
): MediaCollection {
  const registeredItems: RegisteredMediaItem[] = [];
  const items: MediaItem[] = collection.items.map((item) => {
    const id = createPublicMediaId(collectionId, item.key);
    registeredItems.push({
      id,
      media: item.media,
      thumbnail: item.thumbnail.kind === "resource" ? item.thumbnail.resource : undefined,
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

  registry.setItems(registeredItems);
  const selectedItem = collection.selectedKey
    ? collection.items.findIndex((item) => item.key === collection.selectedKey)
    : -1;

  return {
    source: {
      id: collectionId,
      title: collection.title,
      originLabel: collection.origin?.label,
      capabilities: {
        canRefresh: collection.capabilities.canRefresh,
        canSort: collection.capabilities.canSort,
        canOpenOrigin: !!collection.origin
      }
    },
    items,
    selectedId: selectedItem >= 0 ? items[selectedItem]?.id ?? null : items[0]?.id ?? null
  };
}
