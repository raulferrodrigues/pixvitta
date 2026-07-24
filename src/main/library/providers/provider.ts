import type { MediaItem, OpenSourceError } from "../../../shared/media";
import type { AppSettings } from "../../../shared/settings";

export type MediaResource = {
  respond(request: Request): Promise<Response>;
};

export type ProviderThumbnail =
  | { kind: "direct"; url: string }
  | { kind: "resource"; resource: MediaResource };

export type ProviderMediaItem = Omit<MediaItem, "id" | "url" | "thumbnailUrl"> & {
  key: string;
  media: MediaResource;
  thumbnail: ProviderThumbnail;
  externalUrl?: string;
  localPath?: string;
};

export type ProviderCollection = {
  canonicalLocation: string;
  title: string;
  origin?: {
    label: string;
    url: string;
  };
  capabilities: {
    canDownload: boolean;
    canRefresh: boolean;
    canSort: boolean;
  };
  remember: boolean;
  items: ProviderMediaItem[];
  selectedKey: string | null;
};

export type ProviderLoadRequest = {
  location: string;
  refresh: boolean;
  settings: AppSettings;
};

export interface MediaProvider {
  matches(location: string): boolean;
  load(request: ProviderLoadRequest): Promise<ProviderCollection>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: OpenSourceError,
    message: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
