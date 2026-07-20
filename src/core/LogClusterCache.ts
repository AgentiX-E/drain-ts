import type { LogCluster } from "./LogCluster.js";

/**
 * LRU-backed cache for LogCluster instances.
 *
 * Maps 1:1 to Python `LogClusterCache(LRUCache)` class (drain.py L54-L70).
 *
 * Critical design decisions:
 * - The `get()` method bypasses LRU eviction tracking (used by `fastMatch` for
 *   low-overhead lookups without perturbing the access order).
 * - The `touch()` method explicitly updates the LRU access record (used by
 *   `addLogMessage` after a cluster is matched and updated).
 * - Eviction removes the least-recently-used cluster when `maxSize` is exceeded.
 *
 * This dual-access pattern matches Python's behavior where `Cache.__getitem__`
 * triggers LRU update but `LogClusterCache.get()` (calling `Cache.__getitem__`
 * directly) does not.
 */

export class LogClusterCache implements Map<number, LogCluster> {
  private readonly _store: Map<number, LogCluster>;
  private readonly _accessOrder: number[] = [];
  private readonly _maxSize: number;

  /**
   * @param maxSize - Maximum number of clusters before LRU eviction begins.
   */
  constructor(maxSize: number) {
    this._maxSize = maxSize;
    this._store = new Map();
  }

  // ============================================================
  // Map interface implementation
  // ============================================================

  get size(): number {
    return this._store.size;
  }

  get [Symbol.toStringTag](): string {
    return "LogClusterCache";
  }

  clear(): void {
    this._store.clear();
    this._accessOrder.length = 0;
  }

  delete(key: number): boolean {
    const idx = this._accessOrder.indexOf(key);
    if (idx >= 0) {
      this._accessOrder.splice(idx, 1);
    }
    return this._store.delete(key);
  }

  forEach(
    callback: (value: LogCluster, key: number, map: Map<number, LogCluster>) => void,
  ): void {
    this._store.forEach((value, key) => callback(value, key, this));
  }

  has(key: number): boolean {
    return this._store.has(key);
  }

  set(key: number, value: LogCluster): this {
    const existed = this._store.has(key);
    this._store.set(key, value);

    if (!existed) {
      this._accessOrder.push(key);
      this._evictIfNeeded();
    }
    // If the key already existed, we don't update the access order.
    // This mirrors Python behavior where replacing an existing key
    // doesn't change its LRU position.
    return this;
  }

  entries(): IterableIterator<[number, LogCluster]> {
    return this._store.entries();
  }

  keys(): IterableIterator<number> {
    return this._store.keys();
  }

  values(): IterableIterator<LogCluster> {
    return this._store.values();
  }

  [Symbol.iterator](): IterableIterator<[number, LogCluster]> {
    return this._store[Symbol.iterator]();
  }

  // ============================================================
  // LRU-specific methods
  // ============================================================

  /**
   * Retrieves a cluster WITHOUT updating the LRU access order.
   *
   * Python: LogClusterCache.get(key) → Cache.__getitem__(key)
   *
   * Used by `fastMatch` for efficient lookups — we don't want every
   * similarity check to perturb the eviction order.
   *
   * @returns The cluster, or undefined if the key doesn't exist.
   */
  get(key: number): LogCluster | undefined {
    return this._store.get(key);
  }

  /**
   * Explicitly records an access to the given key for LRU tracking.
   *
   * Python: self.id_to_cluster[cluster.cluster_id]
   * (triggers Cache.__getitem__ which updates the access order)
   *
   * Call this after a cluster has been matched and updated in `addLogMessage`
   * to ensure the cluster is marked as recently used.
   */
  touch(key: number): void {
    if (!this._store.has(key)) return;

    const idx = this._accessOrder.indexOf(key);
    if (idx >= 0) {
      this._accessOrder.splice(idx, 1);
      this._accessOrder.push(key);
    }
  }

  // ============================================================
  // Internal
  // ============================================================

  /**
   * Evicts the least-recently-used cluster(s) until the size is within limits.
   */
  private _evictIfNeeded(): void {
    while (this._store.size > this._maxSize && this._accessOrder.length > 0) {
      const lruKey = this._accessOrder.shift()!;
      this._store.delete(lruKey);
    }
  }
}
