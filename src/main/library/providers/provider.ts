import type { MediaItem, OpenSourceError } from "../../../shared/media";
import type { RecentSourceKind } from "../../../shared/recentSources";
import type { AppSettings } from "../../../shared/settings";
import type { RequestPriority } from "../../requestBroker";

export type MediaResource = {
  respond(
    request: Request,
    priority: RequestPriority
  ): Promise<Response>;
};

export type ProviderThumbnail =
  | { kind: "direct"; url: string }
  | { kind: "resource"; resource: MediaResource }
  | { kind: "none" };

export type ProviderMediaItem = Omit<MediaItem, "id" | "url" | "thumbnailUrl"> & {
  key: string;
  media: MediaResource;
  thumbnail: ProviderThumbnail;
  // A URL some providers only learn after fetching an index page, so they
  // pass a resolver that looks it up when the user asks for it.
  externalUrl?: string | (() => Promise<string>);
  localPath?: string;
};

export type ProviderCollection = {
  viewing?: {
    select(key: string | null): void;
    deactivate(): void;
  };
  canonicalLocation: string;
  title: string;
  origin?: {
    label: string;
    url: string;
  };
  capabilities: {
    canRefresh: boolean;
    canSort: boolean;
    canDownload: boolean;
    canDownloadCollection: boolean;
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

// An account a provider signs in to. isSignedIn reads what is stored on this
// machine and never sends a request; a sign-in the site rejects surfaces as an
// authentication-required error the next time the provider uses it. signIn
// resolves once the user finishes or gives up, true when it worked.
export interface ProviderAccount {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  isSignedIn(): Promise<boolean>;
  signIn(parent: Electron.BrowserWindow | null): Promise<boolean>;
  signOut(): Promise<void>;
}

export interface MediaProvider {
  readonly id: string;
  readonly sourceKind: RecentSourceKind;
  readonly account?: ProviderAccount;
  matches(location: string): boolean;
  load(request: ProviderLoadRequest): Promise<ProviderCollection>;
}

export class ProviderError extends Error {
  constructor(
    readonly code: OpenSourceError,
    message: string,
    // The account to sign in to, for authentication-required errors.
    readonly accountId?: string
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
