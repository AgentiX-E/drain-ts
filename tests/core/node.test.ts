/**
 * Node unit tests.
 *
 * Tests the prefix tree node data structure.
 */

import { describe, it, expect } from "vitest";
import { Node } from "../../src/core/Node.js";

describe("Node", () => {
  it("should create empty node", () => {
    const node = new Node();
    expect(node.clusterIds).toEqual([]);
    expect(node.keyToChildNode.size).toBe(0);
  });

  it("should support child node operations", () => {
    const parent = new Node();
    const child = new Node();
    parent.keyToChildNode.set("token", child);
    expect(parent.keyToChildNode.get("token")).toBe(child);
    expect(parent.keyToChildNode.size).toBe(1);
  });

  it("should support clusterIds mutation", () => {
    const node = new Node();
    node.clusterIds = [1, 2, 3];
    expect(node.clusterIds).toEqual([1, 2, 3]);
    node.clusterIds.push(4);
    expect(node.clusterIds).toEqual([1, 2, 3, 4]);
  });
});
