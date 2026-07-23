import type { MediaResource } from "../library/providers/provider";

export type RegisteredMediaItem = {
  id: string;
  name: string;
  downloadable: boolean;
  media: MediaResource;
  thumbnail?: MediaResource;
  localPath?: string;
};

type ResourceKind = "media" | "thumbnail";

function safelyDecode(rawValue: string): string | null {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return null;
  }
}

function parseResourceUrl(rawUrl: string): { kind: ResourceKind; id: string } | null {
  const decodedRawUrl = safelyDecode(rawUrl);
  if (!decodedRawUrl || decodedRawUrl.includes("..") || decodedRawUrl.includes("\\")) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "pixvitta-media:") return null;
  const kind = url.hostname;
  if (kind !== "media" && kind !== "thumbnail") return null;

  const id = url.pathname.replace(/^\/+/, "");
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
  return { kind, id };
}

export class MediaRegistry {
  private readonly byId = new Map<string, RegisteredMediaItem>();

  setItems(items: RegisteredMediaItem[]): void {
    this.byId.clear();
    for (const item of items) this.byId.set(item.id, item);
  }

  resolveId(id: string): RegisteredMediaItem | null {
    if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) return null;
    return this.byId.get(id) ?? null;
  }

  resolveUrl(rawUrl: string): MediaResource | null {
    const parsed = parseResourceUrl(rawUrl);
    if (!parsed) return null;

    const item = this.resolveId(parsed.id);
    if (!item) return null;
    return parsed.kind === "media" ? item.media : (item.thumbnail ?? null);
  }
}
