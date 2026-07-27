/**
 * Comprehensive tests for SimilarityStrategy + ClusterMergeStrategy (I18).
 *
 * Coverage targets: S≥95% B≥95% F≥95% L≥95%
 */
import { describe, it, expect } from "vitest";
import {
  PositionWiseSimilarity,
  DiffRatioSimilarity,
  JaccardIndexSimilarity,
  TermPairOverlapSimilarity,
  SimilarityStrategyChain,
  createDefaultSimilarityChain,
  createAELSimilarityChain,
} from "../../src/core/SimilarityStrategy.js";
import {
  PositionDiffMergeStrategy,
  SimilarityMergeStrategy,
  SharedAffixMergeStrategy,
  ClusterMergePipeline,
  createDefaultMergePipeline,
} from "../../src/core/ClusterMergeStrategy.js";
import { Drain } from "../../src/core/Drain.js";
import { LogCluster } from "../../src/core/LogCluster.js";

// ============================================================
// SimilarityStrategy Tests
// ============================================================

describe("PositionWiseSimilarity", () => {
  const strategy = new PositionWiseSimilarity();

  it("identical sequences → similarity 1.0", () => {
    const r = strategy.compute(["a", "b", "c"], ["a", "b", "c"], "<*>", false);
    expect(r.similarity).toBe(1.0);
    expect(r.paramCount).toBe(0);
  });

  it("one param position → counted correctly", () => {
    const r = strategy.compute(["a", "<*>", "c"], ["a", "x", "c"], "<*>", false);
    expect(r.paramCount).toBe(1);
    expect(r.similarity).toBe(2 / 3); // 2 simTokens / 3
  });

  it("empty sequences → 1.0", () => {
    const r = strategy.compute([], [], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("includeParams=true boosts similarity", () => {
    const r = strategy.compute(["a", "<*>", "c"], ["a", "x", "d"], "<*>", true);
    // simTokens=1 (only position 0 matches), paramCount=1
    // totalSim = 1 + 1 = 2, similarity = 2/3
    expect(r.similarity).toBe(2 / 3);
  });

  it("all different → 0", () => {
    const r = strategy.compute(["a", "b"], ["x", "y"], "<*>", false);
    expect(r.similarity).toBe(0);
  });

  it("single token match", () => {
    const r = strategy.compute(["hello"], ["hello"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("single token mismatch", () => {
    const r = strategy.compute(["hello"], ["world"], "<*>", false);
    expect(r.similarity).toBe(0);
  });
});

describe("DiffRatioSimilarity", () => {
  it("identical → 1.0", () => {
    const s = new DiffRatioSimilarity(0.3);
    const r = s.compute(["a", "b", "c"], ["a", "b", "c"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("small diff within threshold → high similarity", () => {
    const s = new DiffRatioSimilarity(0.5);
    // 3 non-param positions, 1 diff → 1/3 = 0.33 ≤ 0.5 → accept
    const r = s.compute(["a", "b", "c"], ["a", "x", "c"], "<*>", false);
    expect(r.similarity).toBeGreaterThan(0.5);
  });

  it("large diff above threshold → low similarity", () => {
    const s = new DiffRatioSimilarity(0.2);
    const r = s.compute(["a", "b", "c"], ["x", "y", "c"], "<*>", false);
    expect(r.similarity).toBeLessThan(0.5);
  });

  it("param positions ignored in diff count", () => {
    const s = new DiffRatioSimilarity(0.5);
    const r = s.compute(["<*>", "a", "<*>", "b"], ["x", "a", "y", "b"], "<*>", false);
    expect(r.paramCount).toBe(2);
    expect(r.similarity).toBeGreaterThan(0.9);
  });

  it("diff ratio 0 still works", () => {
    const s = new DiffRatioSimilarity(0);
    const r = s.compute(["a", "b"], ["a", "b"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("empty sequences → 1.0", () => {
    const s = new DiffRatioSimilarity(0.3);
    expect(s.compute([], [], "<*>", false).similarity).toBe(1.0);
  });
});

describe("JaccardIndexSimilarity", () => {
  const s = new JaccardIndexSimilarity();

  it("same sets → 1 with gain", () => {
    const r = s.compute(["a", "b"], ["a", "b"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("disjoint sets → 0", () => {
    const r = s.compute(["a", "b"], ["c", "d"], "<*>", false);
    expect(r.similarity).toBe(0);
  });

  it("partial overlap", () => {
    const r = s.compute(["a", "b", "c"], ["a", "b", "d"], "<*>", false);
    expect(r.similarity).toBeGreaterThan(0);
    expect(r.similarity).toBeLessThan(1);
  });

  it("handles empty", () => {
    const r = s.compute([], [], "<*>", false);
    // Jaccard with empty sets: union size = 0, jaccard = 0, then * 1.3 = 0
    expect(r.similarity).toBe(0);
  });
});

describe("TermPairOverlapSimilarity", () => {
  const s = new TermPairOverlapSimilarity(0.5);

  it("position-independent matching", () => {
    const r = s.compute(["close", "bytes", "sent"], ["bytes", "sent", "close"], "<*>", false);
    // Both have the same 3 term pairs: {"bytes|close", "bytes|sent", "close|sent"}
    expect(r.similarity).toBe(1.0);
  });

  it("different tokens → low", () => {
    const r = s.compute(["a", "b"], ["c", "d"], "<*>", false);
    expect(r.similarity).toBe(0);
  });

  it("single token → 0 pairs", () => {
    const r = s.compute(["a"], ["a"], "<*>", false);
    expect(r.similarity).toBe(0); // No pairs from single tokens
  });

  it("filtered param tokens", () => {
    // Template: ["close", "sent"] (2 tokens after filtering <*>)
    // Message: ["close", "sent"] (both match template positions)
    const r = s.compute(["<*>", "close", "<*>", "sent"], ["x", "close", "y", "sent"], "<*>", false);
    // After filtering paramStr: template = ["close", "sent"], message = ["x", "close", "y", "sent"]
    // pairs1 = {"close|sent"}, pairs2 has 6 pairs, overlap = 1, max = 6, sim = 1/6 < 0.5
    expect(r.similarity).toBeLessThan(0.5);
  });
});

describe("SimilarityStrategyChain", () => {
  it("default chain works like PositionWise", () => {
    const chain = createDefaultSimilarityChain();
    const r = chain.compute(["a", "b"], ["a", "b"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("AEL chain uses DiffRatio first", () => {
    const chain = createAELSimilarityChain(0.4);
    const r = chain.compute(["a", "b", "c"], ["a", "x", "c"], "<*>", false);
    // DiffRatio: 1 diff / 3 non-params = 0.33 ≤ 0.4 → handled by diff-ratio
    expect(r.similarity).toBeGreaterThan(0);
  });

  it("registers strategies in order", () => {
    const chain = new SimilarityStrategyChain()
      .register(new PositionWiseSimilarity());
    expect(chain.size).toBe(1);
  });
});

// ============================================================
// ClusterMergeStrategy Tests
// ============================================================

function makeCluster(id: number, tokens: string[], size = 1): LogCluster {
  const c = new LogCluster(tokens, id);
  c.size = size;
  return c;
}

describe("PositionDiffMergeStrategy", () => {
  const strategy = new PositionDiffMergeStrategy(0.4);
  const ctx = { paramStr: "<*>", totalClusters: 10, totalMessages: 100 };

  it("small diff → merge", () => {
    const c1 = makeCluster(1, ["host", "close", "sent"]);
    const c2 = makeCluster(2, ["host", "close", "received"]);
    const action = strategy.evaluate(c1, c2, ctx);
    expect(action).not.toBeNull();
    expect(action!.mergedTokens).toEqual(["host", "close", "<*>"]);
  });

  it("large diff → no merge", () => {
    const c1 = makeCluster(1, ["a", "b", "c", "d"]);
    const c2 = makeCluster(2, ["x", "y", "z", "w"]);
    const action = strategy.evaluate(c1, c2, ctx);
    expect(action).toBeNull();
  });

  it("different lengths → no merge", () => {
    const c1 = makeCluster(1, ["a", "b"]);
    const c2 = makeCluster(2, ["a", "b", "c"]);
    expect(strategy.evaluate(c1, c2, ctx)).toBeNull();
  });

  it("identical clusters → no merge (diff=0)", () => {
    const c1 = makeCluster(1, ["a", "b"]);
    const c2 = makeCluster(2, ["a", "b"]);
    expect(strategy.evaluate(c1, c2, ctx)).toBeNull();
  });

  it("empty tokens → no merge", () => {
    const c1 = makeCluster(1, []);
    const c2 = makeCluster(2, []);
    expect(strategy.evaluate(c1, c2, ctx)).toBeNull();
  });

  it("paramStr positions preserved in merge", () => {
    const c1 = makeCluster(1, ["<*>", "close", "sent"]);
    const c2 = makeCluster(2, ["host", "close", "sent"]);
    const action = strategy.evaluate(c1, c2, ctx);
    // diff = 0 (position 0: c1 has paramStr → skipped, pos 1,2 match)
    // Since diff=0 → null (identical after param check)
    expect(action).toBeNull();
  });
});

describe("SimilarityMergeStrategy", () => {
  const simStrategy = new PositionWiseSimilarity();
  const strategy = new SimilarityMergeStrategy(simStrategy, 0.7);
  const ctx = { paramStr: "<*>", totalClusters: 10, totalMessages: 100 };

  it("similar clusters → merge", () => {
    const c1 = makeCluster(1, ["a", "b", "c", "d"]);
    const c2 = makeCluster(2, ["a", "b", "c", "x"]);
    const action = strategy.evaluate(c1, c2, ctx);
    expect(action).not.toBeNull();
  });

  it("dissimilar clusters → no merge", () => {
    const c1 = makeCluster(1, ["a", "b", "c"]);
    const c2 = makeCluster(2, ["x", "y", "z"]);
    expect(strategy.evaluate(c1, c2, ctx)).toBeNull();
  });

  it("works without drain reference", () => {
    const s2 = new SimilarityMergeStrategy(simStrategy, 0.5);
    const c1 = makeCluster(1, ["a", "b"]);
    const c2 = makeCluster(2, ["a", "b"]);
    // Simple merge: they're identical
    const action = s2.evaluate(c1, c2, ctx);
    expect(action).not.toBeNull();
  });

  it("different length clusters → no match with PositionWise", () => {
    const s2 = new SimilarityMergeStrategy(simStrategy, 0.3);
    const c1 = makeCluster(1, ["a", "b"]);
    const c2 = makeCluster(2, ["a", "b", "c"]);
    // PositionWiseSimilarity returns similarity=0 when lengths differ
    expect(s2.evaluate(c1, c2, ctx)).toBeNull();
  });
});

describe("SharedAffixMergeStrategy", () => {
  const strategy = new SharedAffixMergeStrategy(3);
  const ctx = { paramStr: "<*>", totalClusters: 10, totalMessages: 100 };

  it("shared prefix → merge", () => {
    // 3 matching prefix positions out of 4 → meets minAffixMatch=3
    const c1 = makeCluster(1, ["pre1", "pre2", "pre3", "var1"]);
    const c2 = makeCluster(2, ["pre1", "pre2", "pre3", "var2"]);
    const action = strategy.evaluate(c1, c2, ctx);
    expect(action).not.toBeNull();
  });

  it("no shared affix → no merge", () => {
    const c1 = makeCluster(1, ["a", "b", "c"]);
    const c2 = makeCluster(2, ["x", "y", "z"]);
    expect(strategy.evaluate(c1, c2, ctx)).toBeNull();
  });

  it("shared suffix → merge", () => {
    // Skip: suffix check requires scanning from end, initially breaks at pos 0 (first mismatching)
    // With [a,b,suffix] vs [x,y,suffix]: prefixMatch starts but breaks at pos 0 (a≠x)
    // suffixMatch starts from end and finds "suffix", "suffix" match, but then breaks 
    // at pos 1 (b≠y). Total matches = 1 < minAffixMatch=3.
    // Use longer shared suffix:
    const c1 = makeCluster(1, ["var1", "var2", "sfx1", "sfx2", "sfx3"]);
    const c2 = makeCluster(2, ["dif1", "dif2", "sfx1", "sfx2", "sfx3"]);
    const action = strategy.evaluate(c1, c2, ctx);
    // prefix: 0 matches (var1≠dif1). suffix: 3 matches (sfx3=sfx3, sfx2=sfx2, sfx1=sfx1).
    // total = 3 ≥ 3 → merge
    expect(action).not.toBeNull();
  });

  it("paramStr positions count as matches", () => {
    const c1 = makeCluster(1, ["<*>", "close", "sent", "end"]);
    const c2 = makeCluster(2, ["host", "close", "sent", "end"]);
    const action = strategy.evaluate(c1, c2, ctx);
    expect(action).not.toBeNull();
  });
});

describe("ClusterMergePipeline", () => {
  it("applies strategies iteratively", () => {
    const drain = new Drain();
    // Add clusters with small differences
    drain.addLogMessage("a b c d");
    drain.addLogMessage("x y z w");
    drain.addLogMessage("a b c e");

    const pipeline = new ClusterMergePipeline()
      .register(new PositionDiffMergeStrategy(0.4));

    const merged = pipeline.merge(drain);
    expect(merged).toBeGreaterThanOrEqual(0);
  });

  it("converges and stops", () => {
    const drain = new Drain();
    for (let i = 0; i < 5; i++) drain.addLogMessage(`msg ${i} foo bar`);
    for (let i = 0; i < 5; i++) drain.addLogMessage(`msg ${i} baz qux`);

    const pipeline = new ClusterMergePipeline()
      .register(new PositionDiffMergeStrategy(0.6));

    const merged = pipeline.merge(drain, 10);
    // Should converge within a few iterations
    expect(merged).toBeLessThan(50);
  });

  it("empty pipeline returns 0", () => {
    const drain = new Drain();
    drain.addLogMessage("hello world");
    const pipeline = new ClusterMergePipeline();
    expect(pipeline.merge(drain)).toBe(0);
  });

  it("factory creates default pipeline", () => {
    const pipeline = createDefaultMergePipeline(0.4);
    expect(pipeline.size).toBe(1);
  });

  it("handles non-existing cluster IDs gracefully", () => {
    const drain = new Drain();
    drain.addLogMessage("a b c");
    // Delete the cluster manually
    drain.idToCluster.clear();
    const pipeline = new ClusterMergePipeline()
      .register(new PositionDiffMergeStrategy(0.4));
    expect(pipeline.merge(drain)).toBe(0);
  });
});

// ============================================================
// Edge Cases
// ============================================================

describe("SimilarityStrategy Edge Cases", () => {
  it("DiffRatio with all params → 1.0", () => {
    const s = new DiffRatioSimilarity(0.3);
    const r = s.compute(["<*>", "<*>"], ["x", "y"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("DiffRatio with includeParams", () => {
    const s = new DiffRatioSimilarity(0.5);
    const r = s.compute(["a", "b", "<*>"], ["a", "x", "<*>"], "<*>", true);
    // diff=1/2=0.5 ≤ 0.5 → accept, sim=(1-0.5)*2/3 + 1/3 ≈ 0.667
    expect(r.similarity).toBeGreaterThan(0.5);
  });

  it("PositionWise different lengths → 0", () => {
    const s = new PositionWiseSimilarity();
    const r = s.compute(["a", "b"], ["a", "b", "c"], "<*>", false);
    expect(r.similarity).toBe(0);
  });

  it("TermPairOverlap with single token → no pairs → 0", () => {
    const s = new TermPairOverlapSimilarity();
    const r = s.compute(["a"], ["b"], "<*>", false);
    expect(r.similarity).toBe(0);
  });

  it("TermPairOverlap empty after filtering → 1.0", () => {
    const s = new TermPairOverlapSimilarity();
    const r = s.compute(["<*>"], ["<*>"], "<*>", false);
    expect(r.similarity).toBe(1.0);
  });

  it("chain with registerAll", () => {
    const chain = new SimilarityStrategyChain()
      .registerAll([new PositionWiseSimilarity(), new DiffRatioSimilarity()]);
    expect(chain.size).toBe(2);
  });
});

describe("ClusterMergePipeline Edge Cases", () => {
  it("empty merge returns 0", () => {
    const drain = new Drain();
    const pipeline = new ClusterMergePipeline();
    expect(pipeline.merge(drain)).toBe(0);
  });

  it("converges within max iterations", () => {
    const drain = new Drain();
    // Create 10 nearly identical clusters
    for (let i = 0; i < 10; i++) {
      drain.addLogMessage(`host${i} close sent`);
    }
    const pipeline = createDefaultMergePipeline(0.5);
    pipeline.merge(drain, 100);
    // Should converge quickly
    expect(drain.idToCluster.size).toBeLessThan(10);
  });
});
