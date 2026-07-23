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

export class MediaLibrary {
  private readonly activeSources = new Map<string, ActiveSource>();
  private readonly createCollectionId: () => string;

  constructor(private readonly dependencies: MediaLibraryDependencies) {
    this.createCollectionId =
      dependencies.createCollectionId ?? (() => randomBytes(16).toString("hex"));
  }

  async openLocation(location: string): Promise<MediaCollection> {
    if (!location.trim()) {
      throw new ProviderError("invalid-location", "Enter a media location.");
    }

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

    const providerCollection = await provider.load({
      location: normalizedLocation,
      refresh: false,
      settings: await this.dependencies.getSettings()
    });
    const collectionId = this.createCollectionId();
    const collection = this.activate(
      collectionId,
      provider,
      providerCollection
    );

    if (providerCollection.remember) {
      await this.dependencies.remember(providerCollection.canonicalLocation);
    }
    return collection;
  }

  async refresh(collectionId: string): Promise<MediaCollection> {
    const activeSource = this.activeSources.get(collectionId);
    if (!activeSource) {
      throw new ProviderError("not-found", "The media source is no longer active.");
    }

    const providerCollection = await activeSource.provider.load({
      location: activeSource.canonicalLocation,
      refresh: true,
      settings: await this.dependencies.getSettings()
    });
    return this.activate(
      collectionId,
      activeSource.provider,
      providerCollection
    );
  }

  originUrl(collectionId: string): string | null {
    return this.activeSources.get(collectionId)?.originUrl ?? null;
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
