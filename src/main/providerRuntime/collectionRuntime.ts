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
  private active = true;
  private revision = 0;
  private readonly window = new Map<number, ResourceLease<CachedFile>>();
  private readonly viewerRequests = new Set<ResourceLease<unknown>>();
  private readonly selectionWaiters = new Set<{ index: number; complete(): void; cancel(): void }>();

  constructor(private readonly resources: ResourceAcquisitions, private readonly adapter: CollectionAdapter<Thumbnail>) {}

  select(index: number | null): void {
    if (!this.active || index === this.selectedIndex) return;
    if (index !== null && (!Number.isSafeInteger(index) || index < 0 || index >= this.adapter.itemCount)) return;
    this.selectedIndex = index;
    const revision = ++this.revision;
    const demand = index === null ? new Map<number, RequestPriority>() : this.demandFrom(index);

    // Add the new selected consumer before dropping any old consumers.
    const selected = index === null ? null : this.windowLease(index, "high");
    for (const [item, lease] of this.window) {
      const priority = demand.get(item);
      if (priority) lease.setPriority(priority);
      else { this.window.delete(item); lease.release(); }
    }
    for (const lease of this.viewerRequests) lease.release();
    this.viewerRequests.clear();
    for (const waiter of this.selectionWaiters) {
      if (index === null) waiter.cancel();
      else if (waiter.index === index) waiter.complete();
    }
    if (index !== null && selected) void this.prefetch(index, revision, selected);
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
      if (!this.active || this.selectedIndex !== index || request.signal.aborted) throw new RequestCancelledError();
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

  private waitForSelection(index: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.active) return Promise.reject(new RequestCancelledError());
    if (index === this.selectedIndex) return Promise.resolve();
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
    const demand = new Map<number, RequestPriority>([[index, "high"]]);
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
