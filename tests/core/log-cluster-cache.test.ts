/**
 * LogClusterCache LRU eviction tests.
 *
 * Tests the dual-access LRU pattern:
 * - get() bypasses LRU (for fastMatch)
 * - touch() updates LRU (for addLogMessage)
 * - set() triggers eviction
 * - Full Map interface coverage
 */

import { describe, it, expect } from "vitest";
import { LogClusterCache } from "../../src/core/LogClusterCache.js";
import { LogCluster } from "../../src/core/LogCluster.js";

function makeCluster(id: number, template: string): LogCluster {
  return new LogCluster(template.split(" "), id);
}

describe("LogClusterCache", () => {
  it("should store and retrieve clusters", () => {
    const cache = new LogClusterCache(100);
    const c1 = makeCluster(1, "hello world");
    cache.set(1, c1);
    expect(cache.get(1)).toBe(c1);
    expect(cache.size).toBe(1);
  });

  it("should evict LRU item when exceeded max size", () => {
    const cache = new LogClusterCache(2);

    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));
    // LRU order: [1, 2]

    cache.set(3, makeCluster(3, "c"));
    // Should evict cluster 1 (least recently used)

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeDefined();
    expect(cache.get(3)).toBeDefined();
    expect(cache.size).toBe(2);
  });

  it("should NOT update LRU on get() call", () => {
    const cache = new LogClusterCache(2);

    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));
    // LRU order: [1, 2]

    // get() should NOT change LRU order
    cache.get(1);
    // LRU order should still be: [1, 2]

    cache.set(3, makeCluster(3, "c"));
    // Should evict cluster 1, not 2

    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeDefined();
  });

  it("should update LRU on touch() call", () => {
    const cache = new LogClusterCache(2);

    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));
    // LRU order: [1, 2]

    // touch() should move key 1 to the end
    cache.touch(1);
    // LRU order now: [2, 1]

    cache.set(3, makeCluster(3, "c"));
    // Should evict cluster 2, not 1

    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
  });

  it("should handle has() correctly", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "test"));
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
  });

  it("should handle delete() correctly", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "test"));
    expect(cache.size).toBe(1);

    const result = cache.delete(1);
    expect(result).toBe(true);
    expect(cache.size).toBe(0);
    expect(cache.get(1)).toBeUndefined();

    // Deleting non-existent key returns false
    expect(cache.delete(999)).toBe(false);
  });

  it("should handle clear() correctly", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.get(2)).toBeUndefined();
  });

  it("should iterate with entries()", () => {
    const cache = new LogClusterCache(10);
    const c1 = makeCluster(1, "a");
    const c2 = makeCluster(2, "b");
    cache.set(1, c1);
    cache.set(2, c2);

    const entries = [...cache.entries()];
    expect(entries).toHaveLength(2);
    expect(entries[0]!).toEqual([1, c1]);
    expect(entries[1]!).toEqual([2, c2]);
  });

  it("should iterate with keys()", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));

    const keys = [...cache.keys()];
    expect(keys).toEqual([1, 2]);
  });

  it("should iterate with values()", () => {
    const cache = new LogClusterCache(10);
    const c1 = makeCluster(1, "a");
    cache.set(1, c1);

    const values = [...cache.values()];
    expect(values).toEqual([c1]);
  });

  it("should iterate with Symbol.iterator", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "a"));

    const items = [...cache];
    expect(items).toHaveLength(1);
    expect(items[0]![1]).toBeDefined();
  });

  it("should support forEach()", () => {
    const cache = new LogClusterCache(10);
    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));

    const keys: number[] = [];
    cache.forEach((_value, key) => {
      keys.push(key);
    });
    expect(keys).toEqual([1, 2]);
  });

  it("should not update LRU on replace of existing key", () => {
    const cache = new LogClusterCache(2);

    cache.set(1, makeCluster(1, "a"));
    cache.set(2, makeCluster(2, "b"));
    // LRU: [1, 2]

    // Replace cluster 1 without changing LRU order
    cache.set(1, makeCluster(1, "x"));
    // LRU should still be: [1, 2]

    cache.set(3, makeCluster(3, "c"));
    // Should evict 1

    expect(cache.get(1)).toBeUndefined();
  });

  it("should handle touch on non-existent key gracefully", () => {
    const cache = new LogClusterCache(10);
    // Should not throw
    cache.touch(999);
    expect(cache.size).toBe(0);
  });

  it("should report correct Symbol.toStringTag", () => {
    const cache = new LogClusterCache(10);
    expect(cache[Symbol.toStringTag]).toBe("LogClusterCache");
  });
});
