import { randomBytes } from "node:crypto";
import type { AddSourceResult, MediaCollection, OpenSourceError } from "../../shared/media";
import type { RecentSourceInput } from "../../shared/recentSources";
import type { AppSettings } from "../../shared/settings";
import { MediaCatalog } from "./mediaCatalog";
import { mergedItemKey, mergeSources } from "./mergedSources";
import type { RegisteredMediaItem } from "./mediaRegistry";
import type {
  MediaProvider,
  MediaResource,
  ProviderCollection,
  ProviderRegistry
} from "./providers";
import { ProviderError } from "./providers/provider";

export type MediaLibraryPhase = "idle" | "loading" | "awaiting-renderer";

// One source behind the active collection, as its provider loaded it. The ID
// is opaque to the renderer and survives a refresh of the member.
type LibraryMember = {
  id: string;
  provider: MediaProvider;
  collection: ProviderCollection;
};

type ActiveLibraryState = {
  members: LibraryMember[];
  originUrl?: string;
  catalog: MediaCatalog;
};

type MediaLibraryDependencies = {
  providers: ProviderRegistry;
  getSettings(): Promise<AppSettings>;
  remember(source: RecentSourceInput): Promise<void>;
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
  collectionId: string;
  members: LibraryMember[];
  // The merged item key to keep selected, for a candidate that replaces the
  // active collection in place. Absent, the first member's selection stands.
  selectedKey?: string | null;
  rememberedMember: LibraryMember | null;
};

// What loading a candidate can come to besides a collection to commit: null
// when there is nothing to do (a cancelled pick), or a source that is already a
// member, which the add reports without touching the collection.
const ALREADY_MEMBER = Symbol("already-member");
type CandidateOutcome = LoadedCandidate | null | typeof ALREADY_MEMBER;
type SourceOperationResult = "committed" | "already-member" | "not-committed";

const DEFAULT_ACKNOWLEDGEMENT_TIMEOUT_MS = 1_000;

// A refresh reloads from the source's canonical location, so the provider has
// no idea what was being viewed. Every provider gets the same rule: the item
// stays selected wherever it moved to, and only when it is gone does the
// selection fall back to the first item.
function keepSelection(
  collection: ProviderCollection,
  selectedKey: string | null
): ProviderCollection {
  const stillPresent =
    selectedKey !== null &&
    collection.items.some((item) => item.key === selectedKey);
  return {
    ...collection,
    selectedKey: stillPresent ? selectedKey : (collection.items[0]?.key ?? null)
  };
}

// When the selected item belongs to the source being removed, the selection
// moves to the nearest remaining item in the merged order: the next one, else
// the previous one. Otherwise it stays where it is.
function selectionAfterRemoving(
  members: readonly ProviderCollection[],
  removed: ProviderCollection,
  selectedKey: string | null
): string | null {
  const removedKeys = new Set(
    removed.items.map((item) =>
      mergedItemKey(removed.canonicalLocation, item.key)
    )
  );
  if (selectedKey === null || !removedKeys.has(selectedKey)) return selectedKey;
  const order = mergeSources(members).items.map((item) => item.key);
  const position = order.indexOf(selectedKey);
  const remains = (key: string) => !removedKeys.has(key);
  return (
    order.slice(position + 1).find(remains) ??
    order.slice(0, position).reverse().find(remains) ??
    null
  );
}

function addResult(result: SourceOperationResult): AddSourceResult {
  if (result === "committed") return "added";
  return result === "already-member" ? "already-added" : "not-added";
}

export class MediaLibrary {
  private phase: MediaLibraryPhase = "idle";
  private active: ActiveLibraryState | null = null;
  private previousCatalog: MediaCatalog | null = null;
  private pendingRecentSource: RecentSourceInput | null = null;
  private acknowledgementTimer: unknown | null = null;
  private memberCount = 0;
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
    return (await this.runSourceOperation(async () => this.loadOpen(location))) === "committed";
  }

  async openPickedLocation(
    pickLocation: () => Promise<string | null>
  ): Promise<boolean> {
    const result = await this.runSourceOperation(async () => {
      const location = await pickLocation();
      return location === null ? null : this.loadOpen(location);
    });
    return result === "committed";
  }

  /**
   * Adds a source to the active collection, or opens it when none is open. A
   * source that is already a member leaves the collection untouched and comes
   * back as "already-added", so the requester can say so; it is not an error.
   */
  async addLocation(location: string): Promise<AddSourceResult> {
    return addResult(
      await this.runSourceOperation(async () => this.loadAddition(location))
    );
  }

  async addPickedLocation(
    pickLocation: () => Promise<string | null>
  ): Promise<AddSourceResult> {
    return addResult(
      await this.runSourceOperation(async () => {
        const location = await pickLocation();
        return location === null ? null : this.loadAddition(location);
      })
    );
  }

  /**
   * Removes one member source from a collection of several. Nothing reloads:
   * the collection ID and the remaining items' IDs stay, and only the removed
   * member is deactivated. Ignored for the last member and for unknown IDs.
   */
  async removeSource(memberId: string): Promise<boolean> {
    const active = this.active;
    if (this.phase !== "idle" || !active || active.members.length < 2) return false;
    const removed = active.members.find((member) => member.id === memberId);
    if (!removed) return false;

    const result = await this.runSourceOperation(async () => ({
      collectionId: active.catalog.collection.source.id,
      members: active.members.filter((member) => member !== removed),
      selectedKey: selectionAfterRemoving(
        active.members.map((member) => member.collection),
        removed.collection,
        active.catalog.selectedKey
      ),
      rememberedMember: null
    }));
    return result === "committed";
  }

  async refresh(): Promise<boolean> {
    const result = await this.runSourceOperation(async () => {
      const active = this.active;
      if (!active) {
        throw new ProviderError(
          "not-found",
          "The media source is no longer active."
        );
      }

      const members = await this.reloadMembers(
        active.members,
        await this.dependencies.getSettings()
      );
      return {
        collectionId: active.catalog.collection.source.id,
        members,
        // Read after the load, so navigation during it is kept too.
        selectedKey: active.catalog.selectedKey,
        rememberedMember: null
      };
    });
    return result === "committed";
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
    const recentSource = this.pendingRecentSource;
    this.pendingRecentSource = null;
    this.phase = "idle";
    this.dependencies.publishLoading(false);
    if (recentSource) {
      void this.dependencies.remember(recentSource).catch((error) => {
        console.error("Could not save recent source.", error);
      });
    }
  }

  selectMedia(mediaId: string | null): void {
    this.active?.catalog.selectMedia(mediaId);
  }

  originUrl(collectionId: string): string | null {
    if (this.active?.catalog.collection.source.id !== collectionId) return null;
    return this.active.originUrl ?? null;
  }

  canDownloadCollection(): boolean {
    return (
      this.active?.catalog.collection.source.capabilities.canDownloadCollection ??
      false
    );
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
    loadCandidate: () => Promise<CandidateOutcome>
  ): Promise<SourceOperationResult> {
    if (this.phase !== "idle") return "not-committed";

    this.phase = "loading";
    this.dependencies.publishLoading(true);
    let candidate: CandidateOutcome;
    try {
      candidate = await loadCandidate();
    } catch (error) {
      this.finishWithoutCommit();
      this.dependencies.publishError(this.sourceError(error));
      return "not-committed";
    }

    if (candidate === null || candidate === ALREADY_MEMBER) {
      this.finishWithoutCommit();
      return candidate === ALREADY_MEMBER ? "already-member" : "not-committed";
    }

    this.commit(candidate);
    return "committed";
  }

  private async loadOpen(location: string): Promise<LoadedCandidate> {
    const member = await this.loadMember(location);
    return {
      collectionId: this.createCollectionId(),
      members: [member],
      rememberedMember: member.collection.remember ? member : null
    };
  }

  private async loadAddition(location: string): Promise<CandidateOutcome> {
    const active = this.active;
    if (!active) return this.loadOpen(location);
    // Commands are ignored while loading, so the active collection cannot
    // change before this candidate commits.
    const isMember = (canonicalLocation: string) =>
      active.members.some(
        (member) => member.collection.canonicalLocation === canonicalLocation
      );
    if (isMember(location.trim())) return ALREADY_MEMBER;

    const member = await this.loadMember(location);
    if (isMember(member.collection.canonicalLocation)) {
      member.collection.viewing?.deactivate();
      return ALREADY_MEMBER;
    }
    return {
      collectionId: active.catalog.collection.source.id,
      members: [...active.members, member],
      selectedKey: active.catalog.selectedKey,
      rememberedMember: member.collection.remember ? member : null
    };
  }

  // Members that can refresh reload in parallel; the rest are reused. Any
  // failure fails the refresh, and the members it already reloaded are dropped.
  private async reloadMembers(
    members: readonly LibraryMember[],
    settings: AppSettings
  ): Promise<LibraryMember[]> {
    const results = await Promise.allSettled(
      members.map(async (member) =>
        member.collection.capabilities.canRefresh
          ? {
              id: member.id,
              provider: member.provider,
              collection: await member.provider.load({
                location: member.collection.canonicalLocation,
                refresh: true,
                settings
              })
            }
          : member
      )
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) {
      return results.map(
        (result) => (result as PromiseFulfilledResult<LibraryMember>).value
      );
    }
    results.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value !== members[index]) {
        result.value.collection.viewing?.deactivate();
      }
    });
    throw failure.reason;
  }

  private async loadMember(location: string): Promise<LibraryMember> {
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

    const collection = await provider.load({
      location: normalizedLocation,
      refresh: false,
      settings: await this.dependencies.getSettings()
    });
    return { id: `source-${++this.memberCount}`, provider, collection };
  }

  private commit(candidate: LoadedCandidate): void {
    const merged = mergeSources(
      candidate.members.map((member) => member.collection)
    );
    const providerCollection =
      candidate.selectedKey === undefined
        ? merged
        : keepSelection(merged, candidate.selectedKey);
    const catalog = new MediaCatalog(
      candidate.collectionId,
      providerCollection,
      candidate.members.map((member) => ({
        id: member.id,
        title: member.collection.title,
        kind: member.provider.sourceKind,
        itemCount: member.collection.items.length,
        ...(member.provider.siteName ? { siteName: member.provider.siteName } : {}),
        // The location recents keep a remembered source under, so the
        // renderer can tell which recent sources are already members.
        ...(member.collection.remember
          ? { recentLocation: member.collection.canonicalLocation }
          : {})
      }))
    );
    const previous = this.active;

    // Viewing demand belongs to member sources, not to a catalog: adding a
    // source carries every loaded member into the new catalog, and a refresh
    // carries over the members it did not reload. Only members the new
    // collection no longer holds are deactivated.
    const carried = new Set(
      candidate.members.map((member) => member.collection)
    );
    for (const member of previous?.members ?? []) {
      if (!carried.has(member.collection)) {
        member.collection.viewing?.deactivate();
      }
    }

    this.active = {
      members: candidate.members,
      originUrl: providerCollection.origin?.url,
      catalog
    };
    // Establish demand on every commit, including refreshes whose public item
    // IDs are unchanged and therefore produce no renderer selection change.
    catalog.selectMedia(catalog.collection.selectedId);
    this.previousCatalog = previous?.catalog ?? null;
    // An added source is remembered on its own; the merge itself is not.
    const remembered = candidate.rememberedMember;
    this.pendingRecentSource = remembered
      ? {
          location: remembered.collection.canonicalLocation,
          title: remembered.collection.title,
          providerId: remembered.provider.id,
          kind: remembered.provider.sourceKind
        }
      : null;
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
    this.pendingRecentSource = null;
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
