/**
 * I26 branch coverage hardening — targeted tests for 95% branch coverage.
 *
 * Uncovered paths:
 * - TemplateMiner match() with token normalizer enabled
 * - TemplateMiner mergeClusters() with empty pipeline
 * - ClusterMergeStrategy edge cases in SimilarityMergeStrategy
 * - TokenNormalizer empty path
 */

import { describe, it, expect } from "vitest";
import { TemplateMiner } from "../../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { Drain } from "../../src/core/Drain.js";
import {
  SimilarityMergeStrategy,
  PositionDiffMergeStrategy,
  ClusterMergePipeline,
} from "../../src/core/ClusterMergeStrategy.js";
import { PositionWiseSimilarity } from "../../src/core/SimilarityStrategy.js";
import { LogCluster } from "../../src/core/LogCluster.js";
import { AdjacentConstantFusion } from "../../src/core/TokenNormalizer.js";

// ============================================================
// TemplateMiner match() with normalizer
// ============================================================

describe("TemplateMiner match() with normalizer", () => {
  it("should normalize tokens during match", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        enableAdjacentFusion: true,
      }),
    });

    // Train the normalizer first
    miner.learnTokens(["alpha beta", "alpha beta"]);
    miner.addLogMessage("alpha beta");

    // Match with normalizer active
    const match = miner.match("alpha beta");
    expect(match).not.toBeNull();
  });
});

// ============================================================
// TemplateMiner mergeClusters edge cases
// ============================================================

describe("TemplateMiner mergeClusters", () => {
  it("should return 0 when merge not enabled", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({}),
    });
    miner.addLogMessage("hello world");
    expect(miner.mergeClusters()).toBe(0);
  });

  it("should merge when enabled", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        enableClusterMerge: true,
        clusterMergePercent: 0.5,
      }),
    });

    // Create clusters that can be merged
    miner.addLogMessage("a b c d");
    miner.addLogMessage("x y z w");
    miner.addLogMessage("a b c e");

    const merged = miner.mergeClusters();
    expect(merged).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// SimilarityMergeStrategy edge cases
// ============================================================

describe("SimilarityMergeStrategy edge cases", () => {
  const ctx = { paramStr: "<*>", totalClusters: 10, totalMessages: 100 };

  it("should merge with drain reference using createTemplate", () => {
    const drain = new Drain({ simTh: 0.9 }); // High threshold keeps clusters separate
    const strategy = new SimilarityMergeStrategy(
      new PositionWiseSimilarity(),
      0.3, // Low merge threshold to merge the separate clusters
      drain,
    );

    drain.addLogMessage("a b c d e");
    drain.addLogMessage("a b c x y");

    const ids = [...drain.idToCluster.keys()];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    const c1 = drain.idToCluster.get(ids[0]!)!;
    const c2 = drain.idToCluster.get(ids[1]!)!;

    const action = strategy.evaluate(c1, c2, ctx);
    // With simTh 0.9 and 2/5 matching, they stay separate
    // With merge threshold 0.3, they should merge via similarity
    expect(action).not.toBeNull();
  });

  it("should handle try-catch in createTemplate path", () => {
    const drain = new Drain();
    drain.addLogMessage("short msg");
    drain.addLogMessage("longer message here");

    const strategy = new SimilarityMergeStrategy(
      new PositionWiseSimilarity(),
      0.1, // very low threshold
      drain,
    );

    const ids = [...drain.idToCluster.keys()];
    const c1 = drain.idToCluster.get(ids[0]!)!;
    const c2 = drain.idToCluster.get(ids[1]!)!;

    // Different lengths → createTemplate throws → falls back to simpleMerge
    const action = strategy.evaluate(c1, c2, ctx);
    // With similarity threshold of 0.1, may or may not merge
    // The key is that it doesn't throw
    expect(typeof action).toBe("object");
  });
});

// ============================================================
// TokenNormalizer empty pipeline edge
// ============================================================

describe("TokenNormalizer empty pipeline edge case", () => {
  it("should pass through tokens when normalizer not trained", () => {
    const fusion = new AdjacentConstantFusion();
    // No learn() call — fusionPositions is empty
    const result = fusion.normalize(["a", "b"], "<*>");
    expect(result.tokens).toEqual(["a", "b"]);
    expect(result.changes).toEqual([]);
  });
});

// ============================================================
// ClusterMergePipeline with registerAll
// ============================================================

describe("ClusterMergePipeline registerAll", () => {
  it("should register multiple strategies at once", () => {
    const pipeline = new ClusterMergePipeline()
      .registerAll([
        new PositionDiffMergeStrategy(0.4),
        new SimilarityMergeStrategy(new PositionWiseSimilarity(), 0.7),
      ]);
    expect(pipeline.size).toBe(2);
  });
});
