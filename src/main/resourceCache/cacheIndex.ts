type IndexedEntry = {
  byteLength: number;
  lastUsedMs: number;
};

export type CacheLimits = {
  maxBytes: number;
  /** Entries used within this window are never evicted. */
  protectedMs: number;
};

// The resource cache is cleared on launch, so this session index knows every
// entry. Map insertion order is kept as least-recently-used first.
export class CacheIndex {
  private readonly entries = new Map<string, IndexedEntry>();
  private totalBytes = 0;

  constructor(private readonly limits: CacheLimits) {}

  get byteLength(): number {
    return this.totalBytes;
  }

  use(id: string, byteLength: number, nowMs: number): void {
    this.forget(id);
    this.entries.set(id, { byteLength, lastUsedMs: nowMs });
    this.totalBytes += byteLength;
  }

  forget(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.totalBytes -= entry.byteLength;
  }

  /**
   * Removes the oldest entries until the index fits its limit and returns
   * their IDs for deletion. Recently used entries stay even over the limit.
   */
  takeEvictions(nowMs: number): string[] {
    const evicted: string[] = [];
    for (const [id, entry] of this.entries) {
      if (this.totalBytes <= this.limits.maxBytes) break;
      // Every later entry was used more recently than this one.
      if (nowMs - entry.lastUsedMs < this.limits.protectedMs) break;
      this.forget(id);
      evicted.push(id);
    }
    return evicted;
  }
}
