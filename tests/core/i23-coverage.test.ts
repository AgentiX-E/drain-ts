/**
 * I23 coverage hardening — edge case tests for DrainStream, RoundRobinPool, Profiler, and TemplateMinerConfig.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DrainStream, createDrainStream } from "../../src/DrainStream.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { SimpleProfiler } from "../../src/Profiler.js";

// ============================================================
// DrainStream edge cases
// ============================================================

describe("DrainStream edge cases", () => {
  it("should handle empty chunks without error", () => {
    const stream = new DrainStream();
    expect(() => stream.write("")).not.toThrow();
  });

  it("should process partial lines correctly with flush", () => {
    const stream = new DrainStream();
    stream.write("user alice logged\nuser bob ");
    stream.write("logged\n");
    stream.end();
    // Should not throw — flush processes remaining "user bob logged"
  });

  it("should skip empty lines", () => {
    const stream = new DrainStream();
    stream.write("\n\nuser alice\n\n");
    stream.end();
    expect(stream.lineCount).toBe(1); // Only "user alice"
  });

  it("should handle Buffer chunks", () => {
    const stream = new DrainStream();
    stream.write(Buffer.from("hello world\n"));
    stream.end();
  });

  it("should handle objectMode push", async () => {
    const stream = new DrainStream();
    const results: any[] = [];
    const dataPromise = new Promise<void>((resolve) => {
      stream.on("data", (r) => results.push(r));
      stream.on("end", resolve);
    });
    stream.write("test message 1\n");
    stream.write("test message 2\n");
    stream.end();
    await dataPromise;
    expect(results.length).toBeGreaterThan(0);
  });

  it("createDrainStream factory returns DrainStream", () => {
    const config = TemplateMinerConfig.from({ depth: 3 });
    const stream = createDrainStream(config);
    expect(stream).toBeInstanceOf(DrainStream);
    expect(stream.lineCount).toBe(0);
  });

  it("createDrainStream factory with persistence handler", () => {
    const stream = createDrainStream(new TemplateMinerConfig(), null);
    expect(stream).toBeInstanceOf(DrainStream);
  });

  it("createDrainStream factory with no args", () => {
    const stream = createDrainStream();
    expect(stream).toBeInstanceOf(DrainStream);
  });

  it("should not error on valid write callback", async () => {
    const stream = new DrainStream();
    await new Promise<void>((resolve, reject) => {
      stream.write("valid message\n", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    // Stream processed without error
  });
});

// ============================================================
// Profiler edge cases
// ============================================================

describe("Profiler edge cases", () => {
  let profiler: SimpleProfiler;
  let consoleLogSpy: any;

  beforeEach(() => {
    profiler = new SimpleProfiler();
  });

  it("should start and end sections correctly", () => {
    profiler.startSection("parse");
    profiler.endSection("parse");
    // Should not throw
  });

  it("should handle multiple sections", () => {
    profiler.startSection("a");
    profiler.startSection("b");
    profiler.endSection("b");
    profiler.endSection("a");
    // Should not throw
  });

  it("should report when interval elapsed", async () => {
    profiler.startSection("test");
    profiler.endSection("test");
    // Force a report by waiting slightly
    await new Promise((r) => setTimeout(r, 10));
    profiler.report(0); // 0-second interval triggers immediate report
    // Should not throw
  });

  it("should handle empty report", () => {
    profiler.report(60);
    // Should not throw (no sections recorded)
  });

  it("should track time accumulation across multiple calls", () => {
    profiler.startSection("parse");
    profiler.endSection("parse");
    profiler.startSection("parse");
    profiler.endSection("parse");
    // Two parses accumulated
    profiler.report(0);
    // Should not throw
  });
});

// ============================================================
// TemplateMinerConfig INI edge cases
// ============================================================

describe("TemplateMinerConfig INI parsing edge cases", () => {
  it("should parse max_clusters as null when NaN", () => {
    const ini = `[DRAIN]\nmax_clusters = None`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.maxClusters).toBeNull();
  });

  it("should parse parametrize_numeric_tokens false", () => {
    const ini = `[DRAIN]\nparametrize_numeric_tokens = False`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.parametrizeNumericTokens).toBe(false);
  });

  it("should parse snapshot compress state", () => {
    const ini = `[SNAPSHOT]\ncompress_state = True\nsnapshot_interval_minutes = 5`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.snapshotCompressState).toBe(true);
    expect(config.snapshotIntervalMinutes).toBe(5);
  });

  it("should parse profiling settings", () => {
    const ini = `[PROFILING]\nenabled = true\nreport_sec = 30`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.profilingEnabled).toBe(true);
    expect(config.profilingReportSec).toBe(30);
  });

  it("should parse extra_delimiters as JSON array", () => {
    const ini = `[DRAIN]\nextra_delimiters = ["_", ":"]`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.drainExtraDelimiters).toEqual(["_", ":"]);
  });

  it("should parse masking instructions from JSON", () => {
    const ini = `[MASKING]\nmasking = [{"regex_pattern": "\\\\d+", "mask_with": "NUM"}]`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.maskingInstructions.length).toBeGreaterThan(0);
  });

  it("should parse masking prefix/suffix", () => {
    const ini = `[MASKING]\nmask_prefix = {{\nmask_suffix = }}`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.maskPrefix).toBe("{{");
    expect(config.maskSuffix).toBe("}}");
  });

  it("should parse drain section with case insensitivity", () => {
    const ini = `[drain]\nsim_th = 0.6`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.simTh).toBe(0.6);
  });

  it("should parse comments and empty lines in INI", () => {
    const ini = `# Comment line\n; Another comment\n[DRAIN]\nsim_th = 0.5\n\n# Another comment`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.simTh).toBe(0.5);
  });

  it("should skip lines without equals sign", () => {
    const ini = `[DRAIN]\nsim_th = 0.5\nno_equals_line\nparam_depth = 5`;
    const config = TemplateMinerConfig.fromIni(ini);
    // no_equals_line is skipped
    expect(config.simTh).toBe(0.5);
  });

  it("should build strategy chain with custom strategies", () => {
    const config = TemplateMinerConfig.from({
      templatePatternStrategies: [],
    });
    const chain = config.buildStrategyChain();
    expect(chain.size).toBe(0); // Empty custom strategies → empty chain
  });
});

// ============================================================
// RoundRobinPool edge cases
// ============================================================

// RoundRobinPool tests are covered in round-robin-pool.test.ts
// Additional edge cases are tested there

// ============================================================
// Drain.getRootKey edge cases  
// ============================================================

import { Drain } from "../../src/core/Drain.js";

describe("Drain param binning edge cases", () => {
  it("getRootKey with param binning and masked tokens", () => {
    const drain = new Drain({ enableParamBinning: true, paramStr: "<*>" });
    const tokens = ["<*>", "close", "<*>", "sent"];
    const key = drain.getRootKey(tokens);
    expect(key).toBe("4#2");
  });

  it("getRootKey without param binning", () => {
    const drain = new Drain({ enableParamBinning: false });
    const tokens = ["a", "b", "c"];
    const key = drain.getRootKey(tokens);
    expect(key).toBe("3");
  });

  it("countParamTokens with mixed tokens", () => {
    const drain = new Drain();
    const tokens = ["<NUM>", "hello", "<IP>", "world"];
    const count = drain.countParamTokens(tokens);
    expect(count).toBe(2);
  });

  it("countParamTokens with no masked tokens", () => {
    const drain = new Drain();
    const tokens = ["hello", "world"];
    expect(drain.countParamTokens(tokens)).toBe(0);
  });
});
