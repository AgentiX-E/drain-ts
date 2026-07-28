/**
 * I16 branch coverage hardening — targeted tests for uncovered branches.
 */
import { describe, it, expect } from "vitest";
import { Drain } from "../../src/core/Drain.js";
import { JaccardDrain } from "../../src/core/JaccardDrain.js";
import { DrainBase } from "../../src/core/DrainBase.js";
import { MatchStrategy, ChangeType } from "../../src/core/types.js";
import { TemplateMiner } from "../../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { PositionWiseSimilarity, SimilarityStrategyChain } from "../../src/core/SimilarityStrategy.js";
import { RoundRobinPool } from "../../src/RoundRobinPool.js";

describe("DrainBase: custom similarity strategy", () => {
  it("should accept custom SimilarityStrategyChain", () => {
    const chain = new SimilarityStrategyChain();
    chain.register(new PositionWiseSimilarity());
    const drain = new Drain({ similarityStrategy: chain });
    const result = drain.addLogMessage("user logged in");
    expect(result.changeType).toBe(ChangeType.ClusterCreated);
  });
});

describe("Drain: match strategies", () => {
  it("should match with Never strategy", () => {
    const drain = new Drain({ simTh: 0.3 });
    drain.addLogMessage("user alice logged in");
    drain.addLogMessage("user bob logged in");
    const match = drain.match("user carol logged in", MatchStrategy.Never);
    expect(match).not.toBeNull();
  });

  it("should match with Always strategy", () => {
    const drain = new Drain({ simTh: 0.3 });
    drain.addLogMessage("user alice logged in");
    drain.addLogMessage("user bob logged in");
    const match = drain.match("user carol logged in", MatchStrategy.Always);
    expect(match).not.toBeNull();
  });

  it("should use Fallback strategy", () => {
    const drain = new Drain({ simTh: 0.3 });
    drain.addLogMessage("user alice logged in");
    drain.addLogMessage("user bob logged in");
    const match = drain.match("user carol logged in", MatchStrategy.Fallback);
    expect(match).not.toBeNull();
  });
});

describe("JaccardDrain: edge cases", () => {
  it("should cluster similar messages", () => {
    const drain = new JaccardDrain({ simTh: 0.2 });
    drain.addLogMessage("user alice logged in");
    drain.addLogMessage("user bob logged in");
    // Jaccard similarity with simTh 0.2 should group these
    expect(drain.clusters.length).toBeGreaterThanOrEqual(1);
  });

  it("should handle single-token messages", () => {
    const drain = new JaccardDrain();
    drain.addLogMessage("error");
    drain.addLogMessage("warning");
    expect(drain.clusters.length).toBeGreaterThan(0);
  });
});

describe("TemplateMiner: config edges", () => {
  it("should accept explicit simTh", () => {
    const config = TemplateMinerConfig.from({ simTh: 0.5 });
    const miner = new TemplateMiner({ config });
    expect(miner.config.simTh).toBe(0.5);
  });

  it("should handle AEL similarity config path", () => {
    const config = TemplateMinerConfig.from({ enableAELSimilarity: true, maxDiffRatio: 0.5 });
    const miner = new TemplateMiner({ config });
    miner.addLogMessage("user alice logged in");
    const result = miner.addLogMessage("admin bob logged out");
    expect(result).toBeDefined();
  });

  it("should handle cluster merge config path", () => {
    const config = TemplateMinerConfig.from({ enableClusterMerge: true, clusterMergePercent: 0.5 });
    const miner = new TemplateMiner({ config });
    miner.addLogMessage("template A value 1");
    miner.addLogMessage("template A value 2");
    miner.addLogMessage("template B value 1");
    expect(miner.addLogMessage("template B value 2")).toBeDefined();
  });
});

describe("SimilarityStrategyChain: heuristics", () => {
  it("should chain strategies", () => {
    const chain = new SimilarityStrategyChain();
    chain.register(new PositionWiseSimilarity());
    const drain = new Drain({ similarityStrategy: chain, simTh: 0.3 });
    drain.addLogMessage("user alice logged in");
    drain.addLogMessage("user bob logged in");
    expect(drain.clusters.length).toBe(1);
  });

  it("should report empty chain size", () => {
    expect(new SimilarityStrategyChain().size).toBe(0);
  });
});

describe("TemplateMiner: custom paramStr", () => {
  it("should use custom paramStr in templates", () => {
    const config = TemplateMinerConfig.from({ paramStr: "<P>", simTh: 0.5 });
    const miner = new TemplateMiner({ config });
    miner.addLogMessage("user alice logged in");
    const result = miner.addLogMessage("user bob logged in");
    expect(result.changeType).toBe(ChangeType.ClusterTemplateChanged);
  });
});

describe("RoundRobinPool: constructor with config", () => {
  it("should distribute lines across instances", () => {
    const cfg = TemplateMinerConfig.from({ simTh: 0.5 });
    const pool = new RoundRobinPool({ instanceCount: 2, config: cfg });
    pool.addLine("user alice logged in");
    pool.addLine("user bob logged in");
    expect(pool.flush().length).toBe(2);
  });
});
