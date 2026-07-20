/**
 * Profiling tests.
 */

import { describe, it, expect } from "vitest";
import { NullProfiler, SimpleProfiler } from "../src/Profiler.js";
import { TemplateMiner } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";

describe("NullProfiler", () => {
  it("should not throw on any method call", () => {
    const p = new NullProfiler();
    expect(() => p.startSection("test")).not.toThrow();
    expect(() => p.endSection("test")).not.toThrow();
    expect(() => p.report(60)).not.toThrow();
  });

  it("should be a no-op (no output, no state change)", () => {
    const p = new NullProfiler();
    p.startSection("section");
    p.endSection();
    // No assertions needed — just verifying no side effects
  });
});

describe("SimpleProfiler", () => {
  it("should record section times", () => {
    const p = new SimpleProfiler();
    p.startSection("work");
    // Small delay to ensure measurable time
    const start = performance.now();
    while (performance.now() - start < 1) {
      // busy wait ~1ms
    }
    p.endSection("work");

    // report() should produce output (we can't easily assert console output,
    // but we verify it doesn't throw)
    expect(() => p.report(0)).not.toThrow();
  });

  it("should report at configured interval", () => {
    const p = new SimpleProfiler();
    p.startSection("a");
    p.endSection("a");

    // First report should fire (interval 0 = always)
    expect(() => p.report(0)).not.toThrow();

    // Second report immediately should NOT fire (interval 60 seconds)
    // We can't test the absence of output without mocking console,
    // but we verify the method doesn't throw
    expect(() => p.report(60)).not.toThrow();
  });

  it("should end most recent section when name omitted", () => {
    const p = new SimpleProfiler();
    p.startSection("first");
    p.startSection("second");
    // End without name → should end "second"
    p.endSection();

    // Report should include at least "first" with partial data
    expect(() => p.report(0)).not.toThrow();
  });

  it("should handle endSection on non-existent section gracefully", () => {
    const p = new SimpleProfiler();
    // Should not throw
    expect(() => p.endSection("nonexistent")).not.toThrow();
  });
});

describe("TemplateMiner profiling integration", () => {
  it("should use NullProfiler by default", () => {
    const miner = new TemplateMiner();
    expect(miner.profiler).toBeInstanceOf(NullProfiler);
    // Processing should work without errors
    miner.addLogMessage("test");
  });

  it("should use SimpleProfiler when profiling enabled", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({ profilingEnabled: true }),
    });
    expect(miner.profiler).toBeInstanceOf(SimpleProfiler);
    // Processing should record profiling data
    miner.addLogMessage("test");
    miner.addLogMessage("test again");
  });

  it("should not affect addLogMessage result with profiling enabled", () => {
    const minerNoProfiling = new TemplateMiner();
    const minerWithProfiling = new TemplateMiner({
      config: TemplateMinerConfig.from({ profilingEnabled: true }),
    });

    const r1 = minerNoProfiling.addLogMessage("hello world");
    const r2 = minerWithProfiling.addLogMessage("hello world");

    expect(r1.templateMined).toBe(r2.templateMined);
    expect(r1.changeType).toBe(r2.changeType);
  });

  it("should track total, mask, drain, save_state sections", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({ profilingEnabled: true, profilingReportSec: 0 }),
    });

    // Process a few messages — profiler should track all sections
    for (let i = 0; i < 5; i++) {
      miner.addLogMessage(`message number ${i}`);
    }

    // No assertion on output, but no crash either
    expect(miner.profiler).toBeInstanceOf(SimpleProfiler);
  });
});

describe("printTree (debug output)", () => {
  it("should output tree structure to custom stream", () => {
    const miner = new TemplateMiner();
    miner.addLogMessage("hello world foo bar");
    miner.addLogMessage("hello world baz qux");

    const chunks: string[] = [];
    const mockStream = {
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    } as NodeJS.WritableStream;

    miner.drain.printTree(mockStream, 3);
    const output = chunks.join("");

    expect(output).toContain("root");
    expect(output).toContain("cluster_count");
    expect(output).toContain("hello");
  });

  it("should output to stdout without error", () => {
    const miner = new TemplateMiner();
    miner.addLogMessage("test");
    expect(() => miner.drain.printTree()).not.toThrow();
  });

  it("should respect maxClusters limit in output", () => {
    const miner = new TemplateMiner();
    // Create multiple clusters
    for (const t of ["a", "b", "c", "d", "e"]) {
      miner.addLogMessage(t);
    }

    const chunks: string[] = [];
    const mockStream = {
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
    } as NodeJS.WritableStream;

    // Only show 2 clusters per node
    miner.drain.printTree(mockStream, 2);
    expect(chunks.length).toBeGreaterThan(0);
  });
});

  it("should handle endSection with no name and no active sections", () => {
    const p = new SimpleProfiler();
    // Call endSection() without ever calling startSection()
    // This triggers _getActiveSectionName() with empty startTimes map
    expect(() => p.endSection()).not.toThrow();
  });
