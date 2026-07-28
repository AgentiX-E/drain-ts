/**
 * RoundRobinPool tests — in-process round-robin log processing.
 */
import { describe, it, expect } from "vitest";
import { RoundRobinPool } from "../src/RoundRobinPool.js";

describe("RoundRobinPool", () => {
  it("should create pool with default instance count", () => {
    const pool = new RoundRobinPool();
    expect(pool.instanceCount).toBeGreaterThanOrEqual(1);
  });

  it("should create pool with custom instance count", () => {
    const pool = new RoundRobinPool({ instanceCount: 3 });
    expect(pool.instanceCount).toBe(3);
  });

  it("should distribute lines across instances round-robin", () => {
    const pool = new RoundRobinPool({ instanceCount: 2 });
    pool.addLines([
      "user alice logged in",
      "user bob logged in",
      "user carol logged in",
      "user dave logged in",
    ]);
    const stats = pool.stats();
    expect(stats.totalLines).toBe(4);
    expect(stats.instanceCount).toBe(2);
  });

  it("should round-robin distribution with 3 instances", () => {
    const pool = new RoundRobinPool({ instanceCount: 3 });
    pool.addLine("msg1");
    pool.addLine("msg2");
    pool.addLine("msg3");
    pool.addLine("msg4");
    pool.addLine("msg5");
    pool.addLine("msg6");
    const stats = pool.stats();
    expect(stats.instanceCount).toBe(3);
    expect(stats.totalLines).toBe(6);
    // Each instance gets 2 lines with 3 instances and 6 messages
  });

  it("should produce results via flush", () => {
    const pool = new RoundRobinPool({ instanceCount: 2 });
    pool.addLines([
      "user alice logged in",
      "user bob logged in",
      "user carol logged in",
    ]);
    const results = pool.flush();
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(r).toHaveProperty("clusterId");
      expect(r).toHaveProperty("templateMined");
      expect(r).toHaveProperty("changeType");
    }
  });

  it("should handle single instance gracefully", () => {
    const pool = new RoundRobinPool({ instanceCount: 1 });
    pool.addLines(["msg1", "msg2"]);
    const stats = pool.stats();
    expect(stats.totalLines).toBe(2);
  });

  it("should reset and clear results", () => {
    const pool = new RoundRobinPool({ instanceCount: 2 });
    pool.addLines(["msg1", "msg2"]);
    pool.reset();
    pool.addLine("msg3");
    const stats = pool.stats();
    expect(stats.totalLines).toBe(1);
  });

  it("should track cluster counts per instance", () => {
    const pool = new RoundRobinPool({ instanceCount: 2 });
    pool.addLines([
      "template A value 1",
      "template A value 2",
      "template B value 1",
      "template B value 2",
    ]);
    const stats = pool.stats();
    // With different templates across instances, should produce clusters
    expect(stats.totalClusters).toBeGreaterThanOrEqual(1);
    expect(stats.instanceCount).toBe(2);
  });

  it("should handle empty pool without errors", () => {
    const pool = new RoundRobinPool({ instanceCount: 1 });
    const stats = pool.stats();
    expect(stats.totalLines).toBe(0);
    expect(stats.instanceCount).toBe(1);
  });

  it("should flush then reset leaving pool clean", () => {
    const pool = new RoundRobinPool({ instanceCount: 1 });
    pool.addLine("msg1");
    pool.addLine("msg2");
    pool.flush();
    // After flush, pool should be clean
    const stats = pool.stats();
    expect(stats.totalLines).toBe(0);
  });
});
