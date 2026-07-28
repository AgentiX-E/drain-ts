/**
 * I16.2 coverage hardening — targeted tests for uncovered branches.
 *
 * Focus: DrainStream Buffer path, RoundRobinPool config, FilePersistence loadState,
 * MemoryPersistence save/load, TokenNormalizerPipeline registerAll edge.
 */
import { describe, it, expect } from "vitest";
import { DrainStream } from "../../src/DrainStream.js";
import { RoundRobinPool } from "../../src/RoundRobinPool.js";
import { FilePersistence } from "../../src/persistence/FilePersistence.js";
import { MemoryPersistence } from "../../src/persistence/MemoryPersistence.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { TokenNormalizerPipeline } from "../../src/core/TokenNormalizer.js";

describe("DrainStream: Buffer input and split lines", () => {
  it("should handle Buffer input chunks", async () => {
    const stream = new DrainStream();
    const results: unknown[] = [];
    const endPromise = new Promise<void>((resolve) => stream.on("end", resolve));
    stream.on("data", (data) => results.push(data));
    stream.write(Buffer.from("user logged in\n"));
    stream.end();
    await endPromise;
    expect(results.length).toBeGreaterThan(0);
  });

  it("should handle split lines across chunks", async () => {
    const stream = new DrainStream();
    const results: unknown[] = [];
    const endPromise = new Promise<void>((resolve) => stream.on("end", resolve));
    stream.on("data", (data) => results.push(data));
    stream.write("user logged ");
    stream.write("in\n");
    stream.end();
    await endPromise;
    expect(results.length).toBe(1);
  });
});

describe("RoundRobinPool: config edge", () => {
  it("should accept custom config and process lines", () => {
    const config = TemplateMinerConfig.from({ simTh: 0.5, depth: 3 });
    const pool = new RoundRobinPool({ instanceCount: 2, config });
    pool.addLine("user alice logged in");
    pool.addLine("user bob logged in");
    const results = pool.flush();
    expect(results.length).toBe(2);
  });
});

describe("FilePersistence: missing file guard", () => {
  it("should return null for non-existent file", () => {
    const fp = new FilePersistence("/tmp/nonexistent-162/drain-state.json");
    expect(fp.loadState()).toBeNull();
  });
});

describe("MemoryPersistence: save/load cycle", () => {
  it("should save and load state correctly", () => {
    const mp = new MemoryPersistence();
    mp.saveState(new Uint8Array([1, 2, 3]));
    const state = mp.loadState();
    expect(state).toBeInstanceOf(Uint8Array);
    expect(state!.length).toBe(3);
  });
});

describe("TokenNormalizerPipeline: registerAll edge", () => {
  it("should handle empty registerAll without error", () => {
    const pipeline = new TokenNormalizerPipeline();
    pipeline.registerAll([]);
    expect(pipeline).toBeDefined();
  });
});
