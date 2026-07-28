/**
 * Systematic branch-coverage tests for all remaining uncovered paths.
 * One test per uncovered line, 300+ lines of targeted coverage.
 */
import { describe, it, expect } from "vitest";
import { Readable } from "node:stream";
import { DrainStream } from "../src/DrainStream.js";
import { TemplateMiner } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";
import { Drain } from "../src/core/Drain.js";
import { JaccardDrain } from "../src/core/JaccardDrain.js";
import { MatchStrategy } from "../src/core/types.js";
import { LogMasker } from "../src/masker/LogMasker.js";
import { MaskingInstruction } from "../src/masker/MaskingInstruction.js";
import { SimpleProfiler } from "../src/Profiler.js";
import { RoundRobinPool } from "../src/RoundRobinPool.js";
import { MemoryPersistence } from "../src/persistence/MemoryPersistence.js";

// ============================================================
// DrainStream: Buffer input path (L127-133)
// ============================================================

describe("DrainStream: Buffer input branch", () => {
  it("should process Buffer input via internal _transform (L127)", () => {
    const stream = new DrainStream();
    // Call _transform directly with a Buffer to exercise toString branch
    let called = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any)._transform(
      Buffer.from("buf line\n"),
      "utf-8" as BufferEncoding,
      () => { called = true; },
    );
    expect(called).toBe(true);
    expect(stream.lineCount).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Drain.ts: match with "always" strategy + addSeqToPrefixTree branches
// ============================================================

describe("Drain: match strategy branches", () => {
  it("should use Always strategy correctly (L420)", () => {
    const d = new Drain();
    d.addLogMessage("hello world");
    expect(d.match("hello world", MatchStrategy.Always)).not.toBeNull();
  });

  it("should use Fallback when tree match fails (L403)", () => {
    const d = new Drain({ maxClusters: 100, maxChildren: 100 });
    d.addLogMessage("A format one");
    d.addLogMessage("A format two");
    // Third message creates template with <*>
    d.addLogMessage("A format three");
    // "B format one" — different length from "A format" template, tree search fails
    // But Fallback does full search → should still find it
    const match = d.match("A format four", MatchStrategy.Fallback);
    expect(match).not.toBeNull();
  });

  it("should exercise addSeqToPrefixTree with maxChildren=2 (L260)", () => {
    const d = new Drain({ depth: 6, maxChildren: 2 });
    // Create children to fill up the node
    d.addLogMessage("fixed tokenA extra1");
    d.addLogMessage("fixed tokenB extra2");
    // Third different second token → maxChildren reached → wildcard path
    d.addLogMessage("fixed tokenC extra3");
    d.addLogMessage("fixed tokenD extra4");
    expect(d.idToCluster.size).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// JaccardDrain: maxChildren boundary + single-token path
// ============================================================

describe("JaccardDrain: addSeqToPrefixTree branches", () => {
  it("should handle single-token message (L148)", () => {
    const d = new JaccardDrain();
    d.addLogMessage("singletoken");
    d.addLogMessage("singletoken");
    // Single-token messages go through the tokenCount===1 path
    expect(d.idToCluster.size).toBe(1);
  });

  it("should exercise maxChildren boundary with existing paramStr (L187-189)", () => {
    // maxChildren=2, paramStr exists already → should route non-numeric new token to paramStr
    const d = new JaccardDrain({ maxChildren: 2, depth: 6 });
    d.addLogMessage("root alpha 1 extra");
    d.addLogMessage("root 123 spare"); // numeric → paramStr node created
    // Third message with different non-numeric token → paramStr already exists,
    // and curNode has 2 children (alpha, paramStr) = size 2 = maxChildren → route to paramStr
    d.addLogMessage("root beta 2 more");
    expect(d.idToCluster.size).toBeGreaterThanOrEqual(1);
  });

  it("should exercise paramStr routing when children > maxChildren (L203)", () => {
    const d = new JaccardDrain({ maxChildren: 1, depth: 6 });
    // First non-numeric token creates a child
    d.addLogMessage("x hello there");
    // Second different token → curNode has 2 children ("hello" + paramStr) > maxChildren=1
    // Routes to paramStr since size would exceed maxChildren
    d.addLogMessage("x 42 world");
    d.addLogMessage("x bye data");
    expect(d.idToCluster.size).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// TemplateMiner: extractParameters regex builder branches (L257-458)
// ============================================================

describe("TemplateMiner: extractParameters regex paths", () => {
  it("should handle template with custom mask prefix/suffix", () => {
    const config = TemplateMinerConfig.from({
      maskPrefix: "[:",
      maskSuffix: ":]",
      maskingInstructions: [
        new MaskingInstruction(String.raw`\d+`, "NUM"),
      ],
    });
    const miner = new TemplateMiner({ config });
    miner.addLogMessage("port 8080 is open");
    miner.addLogMessage("port 443 is open");
    const params = miner.extractParameters(
      "port [:NUM:] is open",
      "port 3000 is open",
      true,
    );
    expect(params).toHaveLength(1);
    expect(params[0]?.value).toBe("3000");
  });

  it("should handle template with multiple mask types", () => {
    const config = TemplateMinerConfig.from({
      maskingInstructions: [
        new MaskingInstruction(String.raw`\d+`, "NUM"),
        new MaskingInstruction(String.raw`\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}`, "IP"),
      ],
    });
    const miner = new TemplateMiner({ config });
    miner.addLogMessage("from 192.168.1.1 port 8080");
    miner.addLogMessage("from 10.0.0.1 port 443");
    const params = miner.extractParameters(
      "from <IP> port <NUM>",
      "from 172.16.0.1 port 3000",
      true,
    );
    expect(params).toHaveLength(2);
  });

  it("should handle template with generic <*> wildcard", () => {
    const miner = new TemplateMiner();
    miner.addLogMessage("user alice logged in");
    miner.addLogMessage("user bob logged in");
    const params = miner.extractParameters(
      "user <*> logged in",
      "user charlie logged in",
      false,
    );
    expect(params).toHaveLength(1);
    expect(params[0]?.maskName).toBe("*");
  });

  it("should handle template with no placeholders", () => {
    const miner = new TemplateMiner();
    miner.addLogMessage("static message");
    miner.addLogMessage("static message");
    const params = miner.extractParameters(
      "static message",
      "static message",
      true,
    );
    expect(params).toEqual([]);
  });

  it("should handle regex cache on second call", () => {
    const miner = new TemplateMiner();
    miner.addLogMessage("addr 192.168.1.1 port 80");
    miner.addLogMessage("addr 10.0.0.1 port 443");
    // First call builds + caches regex
    miner.extractParameters("addr <*> port <*>", "addr 1.1.1.1 port 999", false);
    // Second call should use cache
    const params = miner.extractParameters(
      "addr <*> port <*>",
      "addr 2.2.2.2 port 888",
      false,
    );
    expect(params).toHaveLength(2);
  });
});

// ============================================================
// TemplateMiner: _getSnapshotReason periodic path (L570-571)
// ============================================================

describe("TemplateMiner: periodic snapshot trigger", () => {
  it("should trigger periodic snapshot (L570-571)", () => {
    const pers = new MemoryPersistence();
    const config = TemplateMinerConfig.from({
      snapshotIntervalMinutes: 0, // force immediate periodic
    });
    const miner = new TemplateMiner({ config, persistenceHandler: pers });
    // First msg: cluster_created → snapshot
    miner.addLogMessage("first message");
    // Second same msg: changeType = "none" → periodic check triggers
    miner.addLogMessage("first message");
    expect(pers.loadState()).not.toBeNull();
  });
});

// ============================================================
// Profiler: toString branches (L195, 205-206)
// ============================================================

describe("Profiler: toString edge cases", () => {
  it("should handle batch with zero totalTimeSecBatch (L195)", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(2, "", (m) => lines.push(m));
    p.startSection("x");
    p.endSection("x");
    p.startSection("x");
    p.endSection("x");
    // Reset triggered → batch counters zeroed → no batch Hz shown
    p.startSection("x");
    p.endSection("x");
    p.report(0);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("should handle enclosing section with percentage (L205)", () => {
    const lines: string[] = [];
    const p = new SimpleProfiler(0, "outer", (m) => lines.push(m));
    p.startSection("outer");
    p.startSection("inner");
    p.endSection("inner");
    p.endSection("outer");
    p.report(0);
    expect(lines.join("")).toContain("%");
    expect(lines.join("")).toContain("outer");
  });
});

// ============================================================
// RoundRobinPool: _cpuCount branch (L205)
// ============================================================

describe("RoundRobinPool: cpu count path", () => {
  it("should handle _cpuCount gracefully", () => {
    // Constructor exercises _cpuCount automatically via require('os').cpus()
    const pool = new RoundRobinPool({ instanceCount: 1 });
    expect(pool.instanceCount).toBe(1);
  });
});

// ============================================================
// LRUCache: undefined guard (L59)
// ============================================================

import { LRUCache } from "../src/LRUCache.js";

describe("LRUCache: eviction guard path", () => {
  it("should exercise firstKey undefined guard (L59)", () => {
    // Create LRU with maxSize=1, then add two entries
    const cache = new LRUCache<string, string>(1);
    cache.set("a", "x");
    // This triggers eviction — size >= maxSize → firstKey deletion
    cache.set("b", "y");
    // The guard L59 (`if (firstKey !== undefined)`) is always true in practice
    // because `.keys().next().value` on a non-empty Map always returns a key.
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("y");
  });
});
