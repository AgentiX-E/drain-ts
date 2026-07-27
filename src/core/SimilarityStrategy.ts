/**
 * Similarity Strategy — Pluggable similarity computation between template
 * and message token sequences.
 *
 * ## Purpose
 *
 * Supersedes the hardcoded `getSeqDistance` with a fully pluggable strategy
 * pattern. Different datasets benefit from fundamentally different similarity
 * measures:
 *
 * - **Standard logs** → PositionWiseSimilarity (Drain3 default: position-by-position)
 * - **Variable-length logs** → DiffRatioSimilarity (AEL approach: tolerate differences)
 * - **Set-oriented matching** → JaccardIndexSimilarity (JaccardDrain)
 * - **Position-independent** → TermPairOverlapSimilarity (LogSig inspired: term pairs)
 *
 * ## Architecture
 *
 * Mirrors `TemplatePatternStrategy` for architectural consistency:
 * - Interface: `SimilarityStrategy`
 * - Pipeline: `SimilarityStrategyChain` (priority-ordered)
 * - 4 built-in strategies + user-customizable
 * - Non-invasive: replaces `getSeqDistance` via delegation, not inheritance
 *
 * ## Why This Is the Key to Proxifier
 *
 * Drain's position-wise similarity (0.666 GA on Proxifier) cannot handle
 * variable-length sequences or position shifts. AEL achieves 0.974 GA on
 * Proxifier by using diff-ratio similarity that tolerates minor differences.
 * This module brings that capability to drain-ts as a pluggable strategy.
 *
 * @module SimilarityStrategy
 */

// ============================================================
// Core Types
// ============================================================

/** Result of a similarity computation between two token sequences. */
export interface SimilarityResult {
  /** Similarity score in [0.0, 1.0] */
  readonly similarity: number;
  /** Number of parameter positions found */
  readonly paramCount: number;
  /** Strategy name that produced this result */
  readonly strategyName: string;
}

/**
 * Pluggable similarity strategy for comparing template and message token sequences.
 *
 * Implementations define fundamentally different ways to measure similarity:
 * position-wise, diff-ratio, Jaccard index, term-pair overlap, etc.
 */
export interface SimilarityStrategy {
  /** Unique name for identification and debugging */
  readonly name: string;

  /**
   * Compute similarity between template tokens and message tokens.
   *
   * @param templateTokens - Template sequence (may contain paramStr placeholders)
   * @param messageTokens - New message token sequence
   * @param paramStr - Parameter placeholder string (e.g., "<*>")
   * @param includeParams - Whether parameter positions contribute to similarity
   * @returns Similarity [0.0, 1.0] and parameter count
   */
  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult;
}

// ============================================================
// Strategy Chain
// ============================================================

/**
 * Priority-ordered chain of similarity strategies.
 *
 * Strategies are tried in order until one succeeds. The chain always
 * ends with PositionWiseSimilarity as the fallback (guaranteed to
 * produce a valid result for any input).
 */
export class SimilarityStrategyChain {
  private strategies: SimilarityStrategy[] = [];

  /**
   * Registers a strategy. Higher priority strategies should be
   * registered first (they are tried in registration order).
   */
  register(strategy: SimilarityStrategy): this {
    this.strategies.push(strategy);
    return this;
  }

  registerAll(strategies: readonly SimilarityStrategy[]): this {
    for (const s of strategies) this.register(s);
    return this;
  }

  /**
   * Computes similarity using the first strategy in the chain
   * that can handle the input sequences.
   *
   * If no strategy explicitly handles the input, falls back to
   * the last registered strategy (which should be a general-purpose
   * implementation like PositionWiseSimilarity).
   */
  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult {
    for (const strategy of this.strategies) {
      const result = strategy.compute(
        templateTokens,
        messageTokens,
        paramStr,
        includeParams,
      );
      // Only return if the strategy produced a meaningful result
      // (similarity > 0 or explicitly handled)
      if (result.similarity > 0 || result.paramCount > 0) {
        return result;
      }
    }

    // Absolute fallback (should never reach here if chain is properly set up)
    return {
      similarity: 0,
      paramCount: 0,
      strategyName: "none",
    };
  }

  get size(): number {
    return this.strategies.length;
  }
}

// ============================================================
// Strategy 1: Position-Wise Similarity (Drain3 Default)
// ============================================================

/**
 * Standard Drain3 position-wise similarity.
 *
 * Algorithm:
 * - For each position i in [0, len):
 *   - If template[i] === paramStr → skip, count as param
 *   - If template[i] === message[i] → count as match (simToken)
 * - similarity = (simTokens + (params if includeParams)) / len
 *
 * This is the baseline strategy, matching Drain3's original getSeqDistance
 * behavior exactly. It requires equal-length sequences and position-dependent
 * matching.
 *
 * Complexity: O(n) where n = sequence length
 */
export class PositionWiseSimilarity implements SimilarityStrategy {
  readonly name = "position-wise";

  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult {
    const len = templateTokens.length;

    // Empty sequences → perfect match
    if (len === 0) {
      return { similarity: 1.0, paramCount: 0, strategyName: this.name };
    }

    // Different lengths → cannot compare position-wise
    if (len !== messageTokens.length) {
      return { similarity: 0, paramCount: 0, strategyName: this.name };
    }

    let simTokens = 0;
    let paramCount = 0;

    for (let i = 0; i < len; i++) {
      const token1 = templateTokens[i]!;
      const token2 = messageTokens[i]!;

      if (token1 === paramStr) {
        // Parameter placeholder → skip, count as param
        paramCount++;
        continue;
      }
      if (token1 === token2) {
        simTokens++;
      }
    }

    const totalSim = includeParams ? simTokens + paramCount : simTokens;
    return {
      similarity: totalSim / len,
      paramCount,
      strategyName: this.name,
    };
  }
}

// ============================================================
// Strategy 2: Diff-Ratio Similarity (AEL-style)
// ============================================================

/**
 * AEL-style diff-ratio similarity.
 *
 * Algorithm:
 * - Count positions where tokens differ (ignoring paramStr positions)
 * - similarity = 1 - (differing positions / total non-param positions)
 * - Requires equal-length sequences
 *
 * Key insight from AEL: tolerates minor differences between clusters,
 * enabling merging of near-identical templates. This is the mechanism
 * that gives AEL 0.974 GA on Proxifier.
 *
 * Complexity: O(n) where n = sequence length
 */
export class DiffRatioSimilarity implements SimilarityStrategy {
  readonly name = "diff-ratio";

  /**
   * @param maxDiffRatio - Maximum acceptable diff ratio (default: 0.3, matches AEL merge_percent)
   */
  constructor(private readonly maxDiffRatio: number = 0.3) {}

  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult {
    const len = templateTokens.length;
    if (len === 0) {
      return { similarity: 1.0, paramCount: 0, strategyName: this.name };
    }

    let diff = 0;
    let paramCount = 0;
    let nonParamTokens = 0;

    for (let i = 0; i < len; i++) {
      const token1 = templateTokens[i]!;
      const token2 = messageTokens[i]!;

      if (token1 === paramStr) {
        paramCount++;
        continue;
      }
      nonParamTokens++;

      if (token1 !== token2) {
        diff++;
      }
    }

    if (nonParamTokens === 0) {
      return {
        similarity: 1.0,
        paramCount,
        strategyName: this.name,
      };
    }

    const diffRatio = diff / nonParamTokens;

    // If diff ratio is too high, this strategy considers the sequences
    // fundamentally different (returns low similarity)
    const similarity =
      diffRatio <= this.maxDiffRatio
        ? 1.0 - diffRatio
        : 0.0;

    // If includeParams is true, params boost the similarity
    const adjustedSimilarity = includeParams
      ? (similarity * nonParamTokens + paramCount) / len
      : similarity;

    return {
      similarity: adjustedSimilarity,
      paramCount,
      strategyName: this.name,
    };
  }
}

// ============================================================
// Strategy 3: Jaccard Index Similarity
// ============================================================

/**
 * Set-based Jaccard similarity.
 *
 * Algorithm:
 * - Remove paramStr positions from both sequences
 * - Compute Jaccard index: |intersection| / |union|
 * - Apply 1.3× gain factor (capped at 1.0)
 *
 * Used by JaccardDrain for variable-length sequences. Handles
 * different-length inputs gracefully via set operations.
 *
 * Complexity: O(n + m) where n, m = sequence lengths
 */
export class JaccardIndexSimilarity implements SimilarityStrategy {
  readonly name = "jaccard-index";

  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult {
    let paramCount = 0;

    // Filter out paramStr positions from template
    const filteredTemplate: string[] = [];
    for (const token of templateTokens) {
      if (token === paramStr) {
        paramCount++;
      } else if (includeParams) {
        filteredTemplate.push(token);
      } else {
        filteredTemplate.push(token);
      }
    }

    // Filter out paramStr positions from message (matching positions with template params)
    const filteredMessage: string[] = [];
    for (let i = 0; i < Math.min(templateTokens.length, messageTokens.length); i++) {
      if (templateTokens[i] === paramStr) continue;
      filteredMessage.push(messageTokens[i]!);
    }
    // Add remaining message tokens (if message is longer)
    for (let i = templateTokens.length; i < messageTokens.length; i++) {
      filteredMessage.push(messageTokens[i]!);
    }

    const set1 = new Set(filteredTemplate);
    const set2 = new Set(filteredMessage);

    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    let jaccard = 0;
    if (union.size > 0) {
      jaccard = intersection.size / union.size;
    }

    // Gain factor compensates for Jaccard's naturally lower scores
    jaccard = Math.min(jaccard * 1.3, 1.0);

    return { similarity: jaccard, paramCount, strategyName: this.name };
  }
}

// ============================================================
// Strategy 4: Term-Pair Overlap Similarity (LogSig inspired)
// ============================================================

/**
 * Position-independent term-pair overlap similarity.
 *
 * Inspired by LogSig's term-pair approach which achieves 0.967 GA
 * on Proxifier (Loghub-2.0 full dataset).
 *
 * Algorithm:
 * 1. Filter out paramStr tokens from both sequences
 * 2. Generate all unordered token pairs (position-independent)
 * 3. Compute overlap: |pairs1 ∩ pairs2| / max(|pairs1|, |pairs2|)
 *
 * Key advantage: completely position-independent. Handles variable-length
 * sequences and token reordering naturally. LogSig uses this approach to
 * group messages by shared content rather than shared structure.
 *
 * Complexity: O(n² + m²) where n, m = sequence lengths
 */
export class TermPairOverlapSimilarity implements SimilarityStrategy {
  readonly name = "term-pair-overlap";

  /**
   * @param minOverlapRatio - Minimum overlap ratio for meaningful similarity (default: 0.5)
   */
  constructor(private readonly minOverlapRatio: number = 0.5) {}

  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    _includeParams: boolean,
  ): SimilarityResult {
    // Filter out paramStr tokens
    const seq1 = templateTokens.filter((t) => t !== paramStr);
    const seq2 = messageTokens.filter((t) => t !== paramStr);

    if (seq1.length === 0 && seq2.length === 0) {
      return { similarity: 1.0, paramCount: templateTokens.length, strategyName: this.name };
    }
    if (seq1.length === 0 || seq2.length === 0) {
      return { similarity: 0, paramCount: templateTokens.length, strategyName: this.name };
    }

    // Generate term pairs for both sequences
    const pairs1 = this.generatePairs(seq1);
    const pairs2 = this.generatePairs(seq2);

    // Compute overlap
    let overlap = 0;
    for (const pair of pairs1) {
      if (pairs2.has(pair)) overlap++;
    }

    const maxPairs = Math.max(pairs1.size, pairs2.size);
    const similarity = maxPairs > 0 ? overlap / maxPairs : 0;

    return {
      similarity: similarity >= this.minOverlapRatio ? similarity : 0,
      paramCount: templateTokens.filter((t) => t === paramStr).length,
      strategyName: this.name,
    };
  }

  /** Generates all unordered token pair strings for Jaccard-like comparison. */
  private generatePairs(tokens: readonly string[]): Set<string> {
    const pairs = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        // Sort to make pairs unordered
        const a = tokens[i]!;
        const b = tokens[j]!;
        pairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
      }
    }
    return pairs;
  }
}

// ============================================================
// Factory
// ============================================================

/**
 * Creates the default similarity chain (Drain3-compatible).
 *
 * Chain: PositionWiseSimilarity only
 */
export function createDefaultSimilarityChain(): SimilarityStrategyChain {
  return new SimilarityStrategyChain().register(
    new PositionWiseSimilarity(),
  );
}

/**
 * Creates a chain with AEL-style diff-ratio similarity.
 *
 * Chain: DiffRatioSimilarity → PositionWiseSimilarity (fallback)
 */
export function createAELSimilarityChain(
  maxDiffRatio: number = 0.3,
): SimilarityStrategyChain {
  return new SimilarityStrategyChain()
    .register(new DiffRatioSimilarity(maxDiffRatio))
    .register(new PositionWiseSimilarity());
}
