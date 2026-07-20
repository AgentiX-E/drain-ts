/**
 * LogCluster unit tests.
 *
 * Tests the immutable template token semantics and utility methods.
 */

import { describe, it, expect } from "vitest";
import { LogCluster } from "../../src/core/LogCluster.js";

describe("LogCluster", () => {
  it("should create cluster with correct initial state", () => {
    const c = new LogCluster(["hello", "world"], 1);
    expect(c.clusterId).toBe(1);
    expect(c.size).toBe(1);
    expect(c.logTemplateTokens).toEqual(["hello", "world"]);
    expect(c.getTemplate()).toBe("hello world");
  });

  it("should produce correct toString representation", () => {
    const c = new LogCluster(["hello", "world", "<*>"], 42);
    const str = c.toString();
    expect(str).toContain("42");
    expect(str).toContain("1");
    expect(str).toContain("hello");
  });

  it("should replace template tokens immutably", () => {
    const c = new LogCluster(["old", "template"], 1);
    const originalTokens = c.logTemplateTokens;

    c.logTemplateTokens = ["new", "template"];
    expect(c.logTemplateTokens).toEqual(["new", "template"]);
    // Original should be unchanged (immutability)
    expect(originalTokens).toEqual(["old", "template"]);
  });

  it("should freeze template tokens on construction", () => {
    const c = new LogCluster(["hello", "world"], 1);
    expect(Object.isFrozen(c.logTemplateTokens)).toBe(true);
  });

  it("should increment size", () => {
    const c = new LogCluster(["test"], 1);
    c.size += 1;
    expect(c.size).toBe(2);
    c.size += 1;
    expect(c.size).toBe(3);
  });
});
