import { randomBytes } from "node:crypto";
import type { MediaCollection } from "../../shared/media";
import type { AppSettings } from "../../shared/settings";
import type {
  MediaProvider,
  ProviderCollection,
  ProviderRegistry
} from "./providers";
import { ProviderError } from "./providers";

type ActiveSource = {
  provider: MediaProvider;
  canonicalLocation: string;
  originUrl?: string;
};

type MediaLibraryDependencies = {
  providers: ProviderRegistry;
  getSettings(): Promise<AppSettings>;
  activate(collectionId: string, collection: ProviderCollection): MediaCollection;
  remember(location: string): Promise<void>;
  createCollectionId?: () => string;
};

export type MediaLibraryRequest = {
  openLocation(location: string): Promise<MediaCollection | null>;
  refresh(collectionId: string): Promise<MediaCollection | null>;
};

export class MediaLibrary {
  private readonly activeSources = new Map<string, ActiveSource>();
  private readonly createCollectionId: () => string;
  private latestRequestId = 0;

  constructor(private readonly dependencies: MediaLibraryDependencies) {
    this.createCollectionId =
      dependencies.createCollectionId ?? (() => randomBytes(16).toString("hex"));
  }

  beginRequest(): MediaLibraryRequest {
    const requestId = ++this.latestRequestId;
    return Object.freeze({
      openLocation: (location: string) =>
        this.openLocation(requestId, location),
      refresh: (collectionId: string) =>
        this.refresh(requestId, collectionId)
    });
  }

  private async openLocation(
    requestId: number,
    location: string
  ): Promise<MediaCollection | null> {
    if (!location.trim()) {
      throw new ProviderError("invalid-location", "Enter a media location.");
    }
    if (!this.isCurrentRequest(requestId)) return null;

    const exactProvider = this.dependencies.providers.find(location);
    const normalizedLocation = exactProvider ? location : location.trim();
    const provider =
      exactProvider ?? this.dependencies.providers.find(normalizedLocation);
    if (!provider) {
      throw new ProviderError(
        "unsupported-location",
        "No installed provider supports this location."
      );
    }

    const settings = await this.dependencies.getSettings();
    if (!this.isCurrentRequest(requestId)) return null;

    const providerCollection = await provider.load({
      location: normalizedLocation,
      refresh: false,
      settings
    });
    if (!this.isCurrentRequest(requestId)) return null;

    if (providerCollection.remember) {
      await this.dependencies.remember(providerCollection.canonicalLocation);
    }
    if (!this.isCurrentRequest(requestId)) return null;

    return this.activate(
      this.createCollectionId(),
      provider,
      providerCollection
    );
  }

  private async refresh(
    requestId: number,
    collectionId: string
  ): Promise<MediaCollection | null> {
    if (!this.isCurrentRequest(requestId)) return null;

    const activeSource = this.activeSources.get(collectionId);
    if (!activeSource) {
      throw new ProviderError("not-found", "The media source is no longer active.");
    }

    const settings = await this.dependencies.getSettings();
    if (!this.isCurrentRequest(requestId)) return null;

    const providerCollection = await activeSource.provider.load({
      location: activeSource.canonicalLocation,
      refresh: true,
      settings
    });
    if (!this.isCurrentRequest(requestId)) return null;

    return this.activate(
      collectionId,
      activeSource.provider,
      providerCollection
    );
  }

  originUrl(collectionId: string): string | null {
    return this.activeSources.get(collectionId)?.originUrl ?? null;
  }

  private isCurrentRequest(requestId: number): boolean {
    return requestId === this.latestRequestId;
  }

  private activate(
    collectionId: string,
    provider: MediaProvider,
    providerCollection: ProviderCollection
  ): MediaCollection {
    this.activeSources.clear();
    this.activeSources.set(collectionId, {
      provider,
      canonicalLocation: providerCollection.canonicalLocation,
      originUrl: providerCollection.origin?.url
    });
    return this.dependencies.activate(collectionId, providerCollection);
  }
}
