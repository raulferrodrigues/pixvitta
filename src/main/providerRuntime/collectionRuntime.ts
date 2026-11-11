import { RequestCancelledError, type RequestPriority } from "../requestBroker";
import type { CachedFile } from "../resourceCache";
import { ResourceAcquisitions, type ProviderIO, type ResourceLease } from "./acquisitions";

export type CollectionAdapter<Thumbnail> = {
  itemCount: number;
  mediaKey(index: number): string;
  loadMedia(index: number, io: ProviderIO): Promise<CachedFile>;
  thumbnailKey(index: number): string;
  loadThumbnail(index: number, io: ProviderIO): Promise<Thumbnail>;
  assertCurrent?(): void;
};

// The viewing window belongs to a collection; acquisitions can outlive it when
// a download still holds a lease. Providers do not manage revisions or tasks.
export class ProviderCollectionRuntime<Thumbnail> {
  private selectedIndex: number | null = null;
  // Whether the selected item is the one on screen. A collection that shares
  // the screen with others, such as one source of a mix, keeps its place while
  // another collection's item is on screen.
  private onScreen = false;
  private active = true;
  private revision = 0;
  private readonly window = new Map<number, ResourceLease<CachedFile>>();
  private readonly viewerRequests = new Set<ResourceLease<unknown>>();
  private readonly selectionWaiters = new Set<{ index: number; complete(): void; cancel(): void }>();

  constructor(private readonly resources: ResourceAcquisitions, private readonly adapter: CollectionAdapter<Thumbnail>) {}

  /** The item on screen, or null when nothing of this collection is needed. */
  select(index: number | null): void {
    this.place(index, true);
  }

  /**
   * Nothing of this collection is on screen, but the user may come back to it.
   * It keeps its selected item and prefetch window, and every request for them
   * runs at prefetch priority, so none competes with the item on screen. A
   * collection with no selected item yet takes `index` as its place, so it
   * does not start cold.
   */
  standBy(index?: number): void {
    const place = this.selectedIndex ?? index;
    if (place !== undefined) this.place(place, false);
  }

  private place(index: number | null, onScreen: boolean): void {
    if (!this.active) return;
    if (index === this.selectedIndex && (index === null || onScreen === this.onScreen)) return;
    if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= this.adapter.itemCount)) return;
    // Coming back on screen at the same place keeps the running prefetch,
    // unless the selected item is gone and must be fetched again.
    const restart = index === null || index !== this.selectedIndex || !this.window.has(index);
    this.selectedIndex = index;
    this.onScreen = index !== null && onScreen;
    const revision = restart ? ++this.revision : this.revision;
    const demand = index === null ? new Map<number, RequestPriority>() : this.demandFrom(index);

    // Add the new selected consumer before dropping any old consumers.
    const selected = index === null ? null : this.windowLease(index, this.onScreen ? "high" : "normal");
    for (const [item, lease] of this.window) {
      const priority = demand.get(item);
      if (priority) lease.setPriority(priority);
      else { this.window.delete(item); lease.release(); }
    }
    // Requests the renderer made for the item that was on screen.
    for (const lease of this.viewerRequests) lease.release();
    this.viewerRequests.clear();
    for (const waiter of this.selectionWaiters) {
      if (index === null) waiter.cancel();
      else if (this.onScreen && waiter.index === index) waiter.complete();
    }
    if (restart && index !== null && selected) void this.prefetch(index, revision, selected);
  }

  deactivate(): void {
    this.select(null);
    this.active = false;
    for (const waiter of this.selectionWaiters) waiter.cancel();
  }

  async getMedia(index: number, priority: RequestPriority, request: Request): Promise<CachedFile> {
    this.adapter.assertCurrent?.();
    const viewing = priority === "high";
    if (viewing && !this.active) throw new RequestCancelledError();
    // Protocol delivery and selection IPC can arrive in either order. Waiting
    // avoids rejecting the new selection or inferring navigation from a stale
    // media request. Aborted requests never acquire a resource lease.
    if (viewing) {
      await this.waitForSelection(index, request.signal);
      // Selection may change again before the waiter resumes.
      if (!this.isOnScreen(index) || request.signal.aborted) throw new RequestCancelledError();
    }
    const lease = this.resources.acquire(this.adapter.mediaKey(index), (io) => this.adapter.loadMedia(index, io), priority, request.signal);
    if (viewing) this.viewerRequests.add(lease);
    try {
      const file = await lease.result;
      this.adapter.assertCurrent?.();
      return file;
    } finally {
      this.viewerRequests.delete(lease);
      lease.release();
    }
  }

  private isOnScreen(index: number): boolean {
    return this.active && this.onScreen && this.selectedIndex === index;
  }

  private waitForSelection(index: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.active) return Promise.reject(new RequestCancelledError());
    if (this.isOnScreen(index)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.selectionWaiters.delete(waiter);
        signal.removeEventListener("abort", waiter.cancel);
      };
      const waiter = {
        index,
        complete: () => { cleanup(); resolve(); },
        cancel: () => { cleanup(); reject(new RequestCancelledError()); }
      };
      this.selectionWaiters.add(waiter);
      signal.addEventListener("abort", waiter.cancel, { once: true });
      if (signal.aborted) waiter.cancel();
    });
  }

  async getThumbnail(index: number, priority: RequestPriority, request: Request): Promise<Thumbnail> {
    this.adapter.assertCurrent?.();
    const lease = this.resources.acquire(this.adapter.thumbnailKey(index), (io) => this.adapter.loadThumbnail(index, io), priority, request.signal);
    try {
      const thumbnail = await lease.result;
      this.adapter.assertCurrent?.();
      return thumbnail;
    } finally { lease.release(); }
  }

  private windowLease(index: number, priority: RequestPriority): ResourceLease<CachedFile> {
    let lease = this.window.get(index);
    if (!lease) {
      lease = this.resources.acquire(this.adapter.mediaKey(index), (io) => { this.adapter.assertCurrent?.(); return this.adapter.loadMedia(index, io); }, priority);
      // Selection may move before the sequential worker reaches this lease.
      const created = lease;
      void lease.result.catch(() => {
        if (this.window.get(index) === created) this.window.delete(index);
      });
      this.window.set(index, lease);
    } else lease.setPriority(priority);
    return lease;
  }

  private demandFrom(index: number): Map<number, RequestPriority> {
    const demand = new Map<number, RequestPriority>([[index, this.onScreen ? "high" : "normal"]]);
    for (let offset = 1; offset <= 20 && index + offset < this.adapter.itemCount; offset++) {
      demand.set(index + offset, offset <= 5 ? "normal" : "low");
    }
    for (let offset = 1; offset <= 5 && index - offset >= 0; offset++) demand.set(index - offset, "normal");
    return demand;
  }

  private async prefetch(index: number, revision: number, selected: ResourceLease<CachedFile>): Promise<void> {
    try { await selected.result; }
    catch { return; }
    try {
      const order: number[] = [];
      for (let offset = 1; offset <= 5 && index + offset < this.adapter.itemCount; offset++) order.push(index + offset);
      for (let offset = 1; offset <= 5 && index - offset >= 0; offset++) order.push(index - offset);
      for (let offset = 6; offset <= 20 && index + offset < this.adapter.itemCount; offset++) order.push(index + offset);
      for (const item of order) {
        if (revision !== this.revision || !this.active) return;
        await this.windowLease(item, item > index + 5 ? "low" : "normal").result;
      }
    } catch (error) {
      if (revision === this.revision && !(error instanceof RequestCancelledError)) {
        console.error("[provider-runtime] Prefetch stopped.", error);
      }
    }
  }
}
