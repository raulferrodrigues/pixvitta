import { randomBytes } from "node:crypto";
import type { MediaCollection, OpenSourceError } from "../../shared/media";
import type { AppSettings } from "../../shared/settings";
import { MediaCatalog } from "./mediaCatalog";
import type { RegisteredMediaItem } from "./mediaRegistry";
import type {
  MediaProvider,
  MediaResource,
  ProviderCollection,
  ProviderRegistry
} from "./providers";
import { ProviderError } from "./providers";

export type MediaLibraryPhase = "idle" | "loading" | "awaiting-renderer";

type ActiveLibraryState = {
  provider: MediaProvider;
  canonicalLocation: string;
  originUrl?: string;
  catalog: MediaCatalog;
};

type MediaLibraryDependencies = {
  providers: ProviderRegistry;
  getSettings(): Promise<AppSettings>;
  remember(location: string): Promise<void>;
  publishCollection(
    collection: MediaCollection,
    onDelivered: () => void
  ): void;
  publishLoading(isLoading: boolean): void;
  publishError(error: OpenSourceError): void;
  fatal(message: string): never;
  setAcknowledgementTimer(callback: () => void, timeoutMs: number): unknown;
  clearAcknowledgementTimer(timer: unknown): void;
  createCollectionId?: () => string;
  acknowledgementTimeoutMs?: number;
};

type LoadedCandidate = {
  provider: MediaProvider;
  collectionId: string;
  providerCollection: ProviderCollection;
};

const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_000;

export class MediaLibrary {
  private phase: MediaLibraryPhase = "idle";
  private active: ActiveLibraryState | null = null;
  private previousCatalog: MediaCatalog | null = null;
  private acknowledgementTimer: unknown | null = null;
  private readonly createCollectionId: () => string;
  private readonly acknowledgementTimeoutMs: number;

  constructor(private readonly dependencies: MediaLibraryDependencies) {
    this.createCollectionId =
      dependencies.createCollectionId ?? (() => randomBytes(16).toString("hex"));
    this.acknowledgementTimeoutMs =
      dependencies.acknowledgementTimeoutMs ??
      DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS;
  }

  getPhase(): MediaLibraryPhase {
    return this.phase;
  }

  async openLocation(location: string): Promise<boolean> {
    return this.runSourceOperation(async () =>
      this.loadLocation(location, false)
    );
  }

  async openPickedLocation(
    pickLocation: () => Promise<string | null>
  ): Promise<boolean> {
    return this.runSourceOperation(async () => {
      const location = await pickLocation();
      return location === null ? null : this.loadLocation(location, false);
    });
  }

  async refresh(): Promise<boolean> {
    return this.runSourceOperation(async () => {
      const active = this.active;
      if (!active) {
        throw new ProviderError(
          "not-found",
          "The media source is no longer active."
        );
      }

      const providerCollection = await active.provider.load({
        location: active.canonicalLocation,
        refresh: true,
        settings: await this.dependencies.getSettings()
      });
      return {
        provider: active.provider,
        collectionId: active.catalog.collection.source.id,
        providerCollection
      };
    });
  }

  acknowledgeRenderer(): void {
    if (
      this.phase !== "awaiting-renderer" ||
      this.acknowledgementTimer === null
    ) {
      this.failProtocol(
        `Unexpected renderer acknowledgement while library phase is ${this.phase}.`
      );
      return;
    }

    this.dependencies.clearAcknowledgementTimer(
      this.acknowledgementTimer
    );
    this.acknowledgementTimer = null;
    this.previousCatalog = null;
    this.phase = "idle";
    this.dependencies.publishLoading(false);
  }

  originUrl(collectionId: string): string | null {
    if (this.active?.catalog.collection.source.id !== collectionId) return null;
    return this.active.originUrl ?? null;
  }

  resolveMediaId(mediaId: string): RegisteredMediaItem | null {
    return (
      this.active?.catalog.resolveId(mediaId) ??
      this.previousCatalog?.resolveId(mediaId) ??
      null
    );
  }

  resolveMediaUrl(url: string): MediaResource | null {
    return (
      this.active?.catalog.resolveUrl(url) ??
      this.previousCatalog?.resolveUrl(url) ??
      null
    );
  }

  private async runSourceOperation(
    loadCandidate: () => Promise<LoadedCandidate | null>
  ): Promise<boolean> {
    if (this.phase !== "idle") return false;

    this.phase = "loading";
    this.dependencies.publishLoading(true);
    let candidate: LoadedCandidate | null;
    try {
      candidate = await loadCandidate();

      if (candidate?.providerCollection.remember) {
        await this.dependencies.remember(
          candidate.providerCollection.canonicalLocation
        );
      }
    } catch (error) {
      this.finishWithoutCommit();
      this.dependencies.publishError(this.sourceError(error));
      return false;
    }

    if (candidate === null) {
      this.finishWithoutCommit();
      return false;
    }

    this.commit(candidate);
    return true;
  }

  private async loadLocation(
    location: string,
    refresh: boolean
  ): Promise<LoadedCandidate> {
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
      refresh,
      settings: await this.dependencies.getSettings()
    });
    return {
      provider,
      collectionId: this.createCollectionId(),
      providerCollection
    };
  }

  private commit(candidate: LoadedCandidate): void {
    const catalog = new MediaCatalog(
      candidate.collectionId,
      candidate.providerCollection
    );
    const previousCatalog = this.active?.catalog ?? null;

    this.active = {
      provider: candidate.provider,
      canonicalLocation: candidate.providerCollection.canonicalLocation,
      originUrl: candidate.providerCollection.origin?.url,
      catalog
    };
    this.previousCatalog = previousCatalog;
    this.phase = "awaiting-renderer";

    try {
      this.dependencies.publishCollection(
        catalog.collection,
        () => this.startAcknowledgementTimer()
      );
    } catch (error) {
      this.failProtocol(
        `Could not publish the committed collection: ${String(error)}`
      );
    }
  }

  private startAcknowledgementTimer(): void {
    if (
      this.phase !== "awaiting-renderer" ||
      this.acknowledgementTimer !== null
    ) {
      this.failProtocol(
        "The committed collection was delivered more than once or outside the acknowledgement phase."
      );
      return;
    }

    this.acknowledgementTimer =
      this.dependencies.setAcknowledgementTimer(() => {
        this.failProtocol(
          `Renderer did not acknowledge the committed collection within ${this.acknowledgementTimeoutMs}ms.`
        );
      }, this.acknowledgementTimeoutMs);
  }

  private finishWithoutCommit(): void {
    this.phase = "idle";
    this.dependencies.publishLoading(false);
  }

  private sourceError(error: unknown): OpenSourceError {
    if (error instanceof ProviderError) return error.code;
    console.error(error);
    return "unavailable";
  }

  private failProtocol(message: string): never {
    return this.dependencies.fatal(message);
  }
}
