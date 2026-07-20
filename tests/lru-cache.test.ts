/**
 * Generic LRUCache unit tests.
 */

import { describe, it, expect } from "vitest";
import { LRUCache } from "../src/LRUCache.js";

describe("LRUCache", () => {
  it("should store and retrieve values", () => {
    const cache = new LRUCache<string, number>(10);
    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBeUndefined();
  });

  it("should evict LRU item when capacity exceeded", () => {
    const cache = new LRUCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    // Access order: a → b

    cache.get("a"); // promotes a
    // Access order: b → a

    cache.set("c", 3);
    // Evicts b (LRU)

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("should update value and promote on re-set of existing key", () => {
    const cache = new LRUCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // Updates a, promotes it

    cache.set("c", 3);
    // Should evict b (not a)

    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("b")).toBeUndefined();
  });

  it("should report correct size", () => {
    const cache = new LRUCache<string, number>(10);
    expect(cache.size).toBe(0);

    cache.set("a", 1);
    expect(cache.size).toBe(1);

    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("should clear all entries", () => {
    const cache = new LRUCache<string, number>(10);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("should check existence with has()", () => {
    const cache = new LRUCache<string, number>(10);
    cache.set("a", 1);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("should handle capacity of 1", () => {
    const cache = new LRUCache<string, number>(1);

    cache.set("a", 1);
    cache.set("b", 2);

    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
  });
});
