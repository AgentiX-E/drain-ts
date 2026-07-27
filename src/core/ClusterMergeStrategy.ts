/**
 * Cluster Merge Strategy — Post-training cluster consolidation.
 *
 * ## Purpose
 *
 * Applied AFTER all messages have been clustered. Scans existing clusters
 * and merges those that represent the same underlying template but were
 * split during training due to:
 *
 * - Token count differences (variable-length message formats)
 * - Parameter value variations (different hosts, ports, durations)
 * - Tree routing decisions (different branches for similar content)
 *
 * This is the mechanism that gives AEL 0.974 GA on Proxifier —
 * its `reconcile()` method merges events within the same bin that
 * differ by only a few tokens.
 *
 * ## Architecture
 *
 * - Interface: `ClusterMergeStrategy`
 * - Pipeline: `ClusterMergePipeline` (iterative, runs until convergence)
 * - 4 built-in strategies + user-customizable
 * - Non-invasive: operates on existing clusters, doesn't modify training logic
 *
 * @module ClusterMergeStrategy
 */

import type { DrainBase } from "./DrainBase.js";
import type { LogCluster } from "./LogCluster.js";
import type { SimilarityStrategy } from "./SimilarityStrategy.js";

// ============================================================
// Core Types
// ============================================================

/** Context available to merge strategies during evaluation. */
export interface MergeContext {
  readonly paramStr: string;
  readonly totalClusters: number;
  readonly totalMessages: number;
}

/** Result of a successful merge evaluation. */
export interface MergeAction {
  /** The merged template tokens */
  readonly mergedTokens: readonly string[];
  /** Confidence score [0.0, 1.0] */
  readonly confidence: number;
}

/**
 * Post-training cluster merge strategy.
 *
 * Each strategy defines its own criteria for when two clusters
 * should be merged. Strategies are applied iteratively until
 * no more merges are possible.
 */
export interface ClusterMergeStrategy {
  /** Unique name for identification and debugging */
  readonly name: string;

  /**
   * Evaluates whether two clusters should be merged.
   *
   * @param cluster1 - First cluster (will be kept if merge succeeds)
   * @param cluster2 - Second cluster (will be removed if merge succeeds)
   * @param context - Merge context with global statistics
   * @returns MergeAction if they should be merged, null otherwise
   */
  evaluate(
    cluster1: LogCluster,
    cluster2: LogCluster,
    context: MergeContext,
  ): MergeAction | null;
}

// ============================================================
// Strategy 1: Position-Diff Merge (AEL reconcile)
// ============================================================

/**
 * AEL-style position-difference merge.
 *
 * Merges same-length clusters where the number of differing
 * positions is below a configurable threshold.
 *
 * Algorithm (matching AEL's reconcile + merge_event):
 * 1. Require equal token counts
 * 2. Count positions where tokens differ (ignoring paramStr)
 * 3. If diff / tokenCount ≤ mergePercent → merge
 * 4. Merged template: diff positions → paramStr, same positions → keep
 *
 * Example:
 *   Cluster A: ["host1:<NUM>", "close", "sent"]
 *   Cluster B: ["host2:<NUM>", "close", "sent"]
 *   Diff: 1/3 = 0.33 ≤ 0.4 → merge
 *   Result:   ["<*>", "close", "sent"]
 */
export class PositionDiffMergeStrategy implements ClusterMergeStrategy {
  readonly name = "position-diff";

  /**
   * @param mergePercent - Maximum fraction of positions that may differ (default: 0.4)
   */
  constructor(private readonly mergePercent: number = 0.4) {}

  evaluate(
    cluster1: LogCluster,
    cluster2: LogCluster,
    context: MergeContext,
  ): MergeAction | null {
    const t1 = cluster1.logTemplateTokens;
    const t2 = cluster2.logTemplateTokens;

    if (t1.length !== t2.length) return null;
    if (t1.length === 0) return null;

    let diff = 0;
    const merged: string[] = [];

    for (let i = 0; i < t1.length; i++) {
      const token1 = t1[i]!;
      const token2 = t2[i]!;

      if (token1 === context.paramStr || token2 === context.paramStr) {
        // Either is already a param → keep as param
        merged.push(context.paramStr);
      } else if (token1 === token2) {
        // Same non-param → keep
        merged.push(token1);
      } else {
        // Different non-params → generalize to param
        diff++;
        merged.push(context.paramStr);
      }
    }

    // Require at least one difference (don't merge identical clusters)
    if (diff === 0) return null;

    // Check against threshold
    if (diff / t1.length > this.mergePercent) return null;

    return {
      mergedTokens: Object.freeze(merged),
      confidence: 1.0 - diff / t1.length,
    };
  }
}

// ============================================================
// Strategy 2: Similarity-Based Merge (Drain-native)
// ============================================================

/**
 * Drain-native similarity-based merge.
 *
 * Uses a SimilarityStrategy to compute the similarity between
 * two cluster templates. Merges if similarity exceeds threshold.
 *
 * Handles variable-length clusters naturally via the SimilarityStrategy.
 */
export class SimilarityMergeStrategy implements ClusterMergeStrategy {
  readonly name = "similarity";

  /**
   * @param similarityStrategy - Strategy for computing inter-cluster similarity
   * @param similarityThreshold - Minimum similarity to trigger merge (default: 0.7)
   * @param drain - DrainBase instance for createTemplate
   */
  constructor(
    private readonly similarityStrategy: SimilarityStrategy,
    private readonly similarityThreshold: number = 0.7,
    private readonly drain?: DrainBase,
  ) {}

  evaluate(
    cluster1: LogCluster,
    cluster2: LogCluster,
    context: MergeContext,
  ): MergeAction | null {
    const result = this.similarityStrategy.compute(
      cluster1.logTemplateTokens,
      cluster2.logTemplateTokens,
      context.paramStr,
      true, // include params for merge decision
    );

    if (result.similarity < this.similarityThreshold) return null;

    // Use Drain's createTemplate for proper merging if available
    let mergedTokens: readonly string[];
    if (this.drain) {
      try {
        mergedTokens = this.drain.createTemplate(
          cluster1.logTemplateTokens,
          cluster2.logTemplateTokens,
        );
      } catch {
        // Length mismatch in createTemplate — fall back to simple merge
        mergedTokens = this.simpleMerge(
          cluster1.logTemplateTokens,
          cluster2.logTemplateTokens,
          context.paramStr,
        );
      }
    } else {
      mergedTokens = this.simpleMerge(
        cluster1.logTemplateTokens,
        cluster2.logTemplateTokens,
        context.paramStr,
      );
    }

    return {
      mergedTokens,
      confidence: result.similarity,
    };
  }

  private simpleMerge(
    t1: readonly string[],
    t2: readonly string[],
    paramStr: string,
  ): readonly string[] {
    const base = t1.length >= t2.length ? [...t1] : [...t2];
    const minLen = Math.min(t1.length, t2.length);
    for (let i = 0; i < minLen; i++) {
      if (t1[i] !== t2[i]) base[i] = paramStr;
    }
    return Object.freeze(base);
  }
}

// ============================================================
// Strategy 3: Shared Affix Merge
// ============================================================

/**
 * Shared affix merge strategy.
 *
 * Detects clusters that share significant prefix and/or suffix
 * patterns, suggesting they represent the same template with
 * different parameter counts or intermediate tokens.
 *
 * Useful for datasets where the same event type produces messages
 * with slightly different structures (e.g., optional fields).
 */
export class SharedAffixMergeStrategy implements ClusterMergeStrategy {
  readonly name = "shared-affix";

  /**
   * @param minAffixMatch - Minimum number of matching token positions (default: 3)
   */
  constructor(private readonly minAffixMatch: number = 3) {}

  evaluate(
    cluster1: LogCluster,
    cluster2: LogCluster,
    context: MergeContext,
  ): MergeAction | null {
    const t1 = cluster1.logTemplateTokens;
    const t2 = cluster2.logTemplateTokens;

    let prefixMatches = 0;
    let suffixMatches = 0;

    // Count prefix matches
    const minLen = Math.min(t1.length, t2.length);
    for (let i = 0; i < minLen; i++) {
      if (t1[i] === context.paramStr || t2[i] === context.paramStr) {
        prefixMatches++;
        continue;
      }
      if (t1[i] === t2[i]) {
        prefixMatches++;
      } else {
        break;
      }
    }

    // Count suffix matches
    for (let i = 1; i <= minLen; i++) {
      const idx1 = t1.length - i;
      const idx2 = t2.length - i;
      if (t1[idx1!] === context.paramStr || t2[idx2!] === context.paramStr) {
        suffixMatches++;
        continue;
      }
      if (t1[idx1!] === t2[idx2!]) {
        suffixMatches++;
      } else {
        break;
      }
    }

    if (prefixMatches < this.minAffixMatch && suffixMatches < this.minAffixMatch) {
      return null;
    }

    // Merge: use longer sequence as base
    const base = t1.length >= t2.length ? [...t1] : [...t2];
    for (let i = 0; i < minLen; i++) {
      if (t1[i] !== context.paramStr && t2[i] !== context.paramStr && t1[i] !== t2[i]) {
        base[i] = context.paramStr;
      }
    }

    const totalMatches = prefixMatches + suffixMatches;
    const confidence = totalMatches / Math.max(t1.length, t2.length);

    return {
      mergedTokens: Object.freeze(base),
      confidence: Math.min(confidence, 0.95),
    };
  }
}

// ============================================================
// Cluster Merge Pipeline
// ============================================================

/**
 * Pipeline of cluster merge strategies, applied iteratively until convergence.
 *
 * The pipeline applies all registered strategies in order. For each pair
 * of clusters, the first strategy that accepts the merge is used.
 * This process repeats until no more merges occur (convergence) or
 * the iteration limit is reached.
 */
export class ClusterMergePipeline {
  private strategies: ClusterMergeStrategy[] = [];

  /**
   * Registers a merge strategy.
   */
  register(strategy: ClusterMergeStrategy): this {
    this.strategies.push(strategy);
    return this;
  }

  registerAll(strategies: readonly ClusterMergeStrategy[]): this {
    for (const s of strategies) this.register(s);
    return this;
  }

  /**
   * Applies all merge strategies iteratively until convergence.
   *
   * Algorithm:
   * 1. For each iteration:
   * 2.   For each pair of clusters (i, j):
   * 3.     For each strategy:
   * 4.       If strategy accepts → merge (update c_i, remove c_j)
   * 5.   If no merges this iteration → done
   * 6. Safety: max maxIterations (default: 10)
   *
   * @param drain - Drain engine instance (modified in-place)
   * @param maxIterations - Safety limit
   * @returns Total number of merges performed
   */
  merge(drain: DrainBase, maxIterations: number = 10): number {
    let totalMerged = 0;
    const context: MergeContext = {
      paramStr: drain.paramStr,
      totalClusters: drain.idToCluster.size,
      totalMessages: drain.getTotalClusterSize(),
    };

    for (let iter = 0; iter < maxIterations; iter++) {
      let mergedThisRound = 0;
      const ids = [...drain.idToCluster.keys()];

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const c1 = drain.idToCluster.get(ids[i]!);
          const c2 = drain.idToCluster.get(ids[j]!);
          if (!c1 || !c2) continue;

          for (const strategy of this.strategies) {
            const action = strategy.evaluate(c1, c2, context);
            if (action) {
              // Merge: update cluster 1, remove cluster 2
              c1.logTemplateTokens = action.mergedTokens;
              c1.size += c2.size;
              drain.idToCluster.delete(ids[j]!);
              mergedThisRound++;
              break; // Next pair
            }
          }
        }
      }

      if (mergedThisRound === 0) break;
      totalMerged += mergedThisRound;
    }

    return totalMerged;
  }

  get size(): number {
    return this.strategies.length;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Creates the default merge pipeline (AEL-style position-diff only).
 */
export function createDefaultMergePipeline(
  mergePercent: number = 0.4,
): ClusterMergePipeline {
  return new ClusterMergePipeline().register(
    new PositionDiffMergeStrategy(mergePercent),
  );
}
