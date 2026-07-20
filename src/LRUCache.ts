/**
 * Generic LRU (Least Recently Used) cache with bounded capacity.
 *
 * Used internally by TemplateMiner for caching parameter extraction
 * regexes — each unique template generates a compiled regex, and the
 * cache prevents redundant compilation for frequently seen templates.
 *
 * Eviction policy: when capacity is exceeded, the least recently
 * accessed item is removed. An item's access time is updated on
 * every `get()` and `set()` call.
 *
 * Maps to Python `LRUCache` used by Drain3's parameter extraction
 * caching (via `cachedmethod` decorator).
 *
 * @typeParam K - The key type.
 * @typeParam V - The value type.
 *
 * @internal
 */
export class LRUCache<K, V> {
  private readonly _store: Map<K, V>;
  private readonly _maxSize: number;

  /**
   * @param maxSize - Maximum number of entries before eviction.
   */
  constructor(maxSize: number) {
    this._maxSize = maxSize;
    this._store = new Map();
  }

  /**
   * Retrieves a cached value and updates its access time (LRU promotion).
   *
   * @returns The cached value, or undefined if the key is not present.
   */
  get(key: K): V | undefined {
    if (!this._store.has(key)) return undefined;

    // LRU promotion: move accessed item to the end
    const value = this._store.get(key)!;
    this._store.delete(key);
    this._store.set(key, value);
    return value;
  }

  /**
   * Stores a value in the cache, evicting the LRU item if capacity is
   * exceeded. If the key already exists, updates the value and promotes
   * the access time.
   */
  set(key: K, value: V): void {
    if (this._store.has(key)) {
      // Update existing entry — promote access time
      this._store.delete(key);
    } else if (this._store.size >= this._maxSize) {
      // Evict the least recently used entry (first key in insertion order)
      const firstKey = this._store.keys().next().value;
      if (firstKey !== undefined) {
        this._store.delete(firstKey);
      }
    }
    this._store.set(key, value);
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._store.size;
  }

  /** Removes all entries. */
  clear(): void {
    this._store.clear();
  }

  /** Checks whether a key exists. */
  has(key: K): boolean {
    return this._store.has(key);
  }
}
