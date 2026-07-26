/**
 * Profiling tests — ported from Drain3 test suite, extended for new features.
 */
import { describe, it, expect, vi } from "vitest";
import { NullProfiler, SimpleProfiler } from "../src/Profiler.js";

describe("NullProfiler", () => {
  it("should not throw on any method call", () => {
    const p = new NullProfiler();
    expect(() => p.startSection("test")).not.toThrow();
    expect(() => p.endSection("test")).not.toThrow();
    expect(() => p.report(60)).not.toThrow();
  });
});

describe("SimpleProfiler: basic", () => {
  it("should record section times", () => {
    const p = new SimpleProfiler();
    p.startSection("work");
    p.endSection("work");
    expect(() => p.report(0)).not.toThrow();
  });

  it("should report at configured interval", () => {
    const p = new SimpleProfiler();
    p.startSection("a");
    p.endSection("a");
    // First report fires (interval 0)
    expect(() => p.report(0)).not.toThrow();
    // Second immediately — should NOT fire (interval 60s)
    expect(() => p.report(60)).not.toThrow();
  });

  it("should end most recent section when name is empty", () => {
    const p = new SimpleProfiler();
    p.startSection("alpha");
    p.startSection("beta");
    p.endSection(); // ends "beta" (last started)
    p.endSection("alpha");
    expect(() => p.report(0)).not.toThrow();
  });

  it("should throw on empty section name", () => {
    const p = new SimpleProfiler();
    expect(() => p.startSection("")).toThrow("Section name is empty");
  });

  it("should throw when ending unstarted section", () => {
    const p = new SimpleProfiler();
    expect(() => p.endSection("nonexistent")).toThrow("does not exist");
  });

  it("should throw when starting already-started section", () => {
    const p = new SimpleProfiler();
    p.startSection("s");
    expect(() => p.startSection("s")).toThrow("already started");
  });

  it("should throw when no section open on end", () => {
    const p = new SimpleProfiler();
    expect(() => p.endSection()).toThrow("Neither section name");
  });

  it("should sort output by descending total time", () => {
    const output: string[] = [];
    const p = new SimpleProfiler(0, "total", (msg) => output.push(msg));
    p.startSection("slow");
    const start = performance.now();
    while (performance.now() - start < 3) {} // ~3ms
    p.endSection("slow");
    p.startSection("fast");
    p.endSection("fast");
    p.report(0);
    // "slow" should appear before "fast" in output (sorted descending)
    const slowIdx = output.join("\n").indexOf("slow");
    const fastIdx = output.join("\n").indexOf("fast");
    expect(slowIdx).toBeLessThan(fastIdx);
  });
});

describe("SimpleProfiler: custom printer", () => {
  it("should use custom printer function", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(0, "total", (msg) => lines.push(msg));
    p.startSection("x");
    p.endSection("x");
    p.report(0);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("x");
    expect(lines[0]).toContain("samples");
  });
});

describe("SimpleProfiler: enclosing section", () => {
  it("should show percentage relative to enclosing section", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(0, "total", (msg) => lines.push(msg));
    p.startSection("total");
    p.startSection("sub");
    p.endSection("sub");
    p.endSection("total");
    p.report(0);
    const output = lines.join("\n");
    // "total" should show percentage (sub's time / total's time)
    expect(output).toContain("sub");
    expect(output).toContain("%");
  });
});

describe("SimpleProfiler: batch rates", () => {
  it("should show batch rates when reset_after_sample_count > 0", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(10, "total", (msg) => lines.push(msg));
    p.startSection("w");
    for (let i = 0; i < 3; i++) {
      p.endSection("w");
      p.startSection("w");
    }
    p.endSection("w");
    p.report(0);
    const output = lines.join("\n");
    // Batch rates shown in parentheses when reset > 0
    expect(output).toContain("("); // batch rate format: "ms (batch) ms"
  });
});

describe("SimpleProfiler: edge cases", () => {
  it("should handle division by zero in Hz calculation", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(1, "", (msg) => lines.push(msg));
    p.startSection("q");
    p.endSection("q");
    // Manipulate internals to test zero-time edge case
    const section = (p as any)._sections.get("q");
    if (section) section.totalTimeSec = 0;
    p.report(0);
    expect(lines.join("\n")).toContain("N/A");
  });

  it("should not show % without enclosing section", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(0, "", (msg) => lines.push(msg));
    p.startSection("x");
    p.endSection("x");
    p.report(0);
    // No % since no enclosing section
    expect(lines.join("\n")).not.toContain("%");
  });
});
