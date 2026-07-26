/**
 * WorkerPool tests — parallel log processing.
 */
import { describe, it, expect } from "vitest";
import { WorkerPool } from "../src/WorkerPool.js";

describe("WorkerPool", () => {
  it("should create pool with default worker count", () => {
    const pool = new WorkerPool();
    expect(pool.workerCount).toBeGreaterThanOrEqual(1);
  });

  it("should create pool with custom worker count", () => {
    const pool = new WorkerPool({ workerCount: 3 });
    expect(pool.workerCount).toBe(3);
  });

  it("should distribute lines across workers", () => {
    const pool = new WorkerPool({ workerCount: 2 });
    pool.addLines([
      "user alice logged in",
      "user bob logged in",
      "user carol logged in",
      "user dave logged in",
    ]);
    const stats = pool.stats();
    // Each worker should have roughly half the lines
    expect(stats.totalLines).toBe(4);
    expect(stats.workerStats).toHaveLength(2);
    expect(stats.workerStats[0]!.lines).toBe(2);
    expect(stats.workerStats[1]!.lines).toBe(2);
  });

  it("should round-robin distribution", () => {
    const pool = new WorkerPool({ workerCount: 3 });
    pool.addLine("msg1");
    pool.addLine("msg2");
    pool.addLine("msg3");
    pool.addLine("msg4");
    pool.addLine("msg5");
    pool.addLine("msg6");
    const stats = pool.stats();
    // Each worker gets 2 lines
    expect(stats.workerStats[0]!.lines).toBe(2);
    expect(stats.workerStats[1]!.lines).toBe(2);
    expect(stats.workerStats[2]!.lines).toBe(2);
  });

  it("should produce results via flush", () => {
    const pool = new WorkerPool({ workerCount: 2 });
    pool.addLines([
      "user alice logged in",
      "user bob logged in",
      "user carol logged in",
    ]);
    const results = pool.flush();
    expect(results.length).toBe(3);
    // Each result should have the expected AddLogResult shape
    for (const r of results) {
      expect(r).toHaveProperty("clusterId");
      expect(r).toHaveProperty("templateMined");
      expect(r).toHaveProperty("changeType");
    }
  });

  it("should handle single worker gracefully", () => {
    const pool = new WorkerPool({ workerCount: 1 });
    pool.addLines(["msg1", "msg2"]);
    const stats = pool.stats();
    expect(stats.totalLines).toBe(2);
  });

  it("should reset and clear results", () => {
    const pool = new WorkerPool({ workerCount: 2 });
    pool.addLines(["msg1", "msg2"]);
    pool.reset();
    pool.addLine("msg3");
    const stats = pool.stats();
    expect(stats.totalLines).toBe(1);
  });

  it("should track cluster counts per worker", () => {
    const pool = new WorkerPool({ workerCount: 2 });
    pool.addLines([
      "template A value 1",
      "template A value 2",
      "template B value 1",
      "template B value 2",
    ]);
    const stats = pool.stats();
    // With 2 workers, each gets 2 lines of 2 different templates
    expect(stats.totalClusters).toBeGreaterThanOrEqual(1);
  });
});
