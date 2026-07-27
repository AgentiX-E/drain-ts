/**
 * Benchmark evaluation metrics for log parsing accuracy.
 *
 * Implements the metrics defined in the Loghub-2.0 benchmark framework
 * (Jiang et al., ISSTA 2024):
 *
 * - Grouping Accuracy (GA): proportion of messages correctly grouped by template.
 * - F1 of Grouping Accuracy (FGA): F1-score variant of GA.
 * - Parsing Template Accuracy (PTA): token-level accuracy of mined templates.
 * - F1 of Template Accuracy (FTA): F1-score variant of PTA.
 *
 * Reference: logpai/loghub-2.0 benchmark/evaluation/
 */

export interface EvaluationResult {
  /** Grouping Accuracy: correct groups / total messages. */
  groupAccuracy: number;
  /** F1-score of Grouping Accuracy. */
  f1GroupAccuracy: number;
  /** Parsing Template Accuracy: correct tokens / total tokens across all templates. */
  parsingTemplateAccuracy: number;
  /** F1-score of Parsing Template Accuracy. */
  f1TemplateAccuracy: number;
  /** Total number of log messages in the dataset. */
  totalMessages: number;
  /** Number of unique templates in ground truth. */
  groundTruthTemplateCount: number;
  /** Number of clusters produced by the parser. */
  parserClusterCount: number;
}

/**
 * Ground truth format: each log line maps to a template ID and the parsed template tokens.
 */
export interface GroundTruthEntry {
  /** The raw log line (after preprocessing — timestamps/metadata may be removed). */
  logLine: string;
  /** The ground-truth template tokens. */
  templateTokens: string[];
  /** The ground-truth template ID. */
  templateId: number;
}

/**
 * Parser output format: each log line produces a cluster ID and template tokens.
 */
export interface ParsedEntry {
  /** The cluster ID assigned by the parser. */
  clusterId: number;
  /** The template tokens mined by the parser. */
  templateTokens: string[];
}

// ============================================================
// Grouping Accuracy (GA)
// ============================================================

/**
 * Calculates Grouping Accuracy.
 *
 * Algorithm:
 * 1. For each ground-truth template group, find the majority parser cluster.
 * 2. Messages whose parser cluster matches the majority assignment are correct.
 * 3. GA = correct / total messages.
 *
 * This measures whether the parser groups the SAME messages together as
 * the ground truth does.
 */
export function calculateGroupAccuracy(
  groundTruth: GroundTruthEntry[],
  parsed: ParsedEntry[],
): { groupAccuracy: number; f1GroupAccuracy: number } {
  if (groundTruth.length === 0) {
    return { groupAccuracy: 1.0, f1GroupAccuracy: 1.0 };
  }

  // Build ground-truth groups: templateId → Set of message indices
  const gtGroups = new Map<number, Set<number>>();
  // Build parser groups: clusterId → Set of message indices
  const parsedGroups = new Map<number, Set<number>>();

  for (let i = 0; i < groundTruth.length; i++) {
    const gtId = groundTruth[i]!.templateId;
    const parsedId = parsed[i]!.clusterId;

    if (!gtGroups.has(gtId)) gtGroups.set(gtId, new Set());
    gtGroups.get(gtId)!.add(i);

    if (!parsedGroups.has(parsedId)) parsedGroups.set(parsedId, new Set());
    parsedGroups.get(parsedId)!.add(i);
  }

  // For each GT group, find the parser cluster with the maximum intersection
  let correctMessages = 0;
  let totalPrecisionN = 0;
  let totalRecallD = 0;
  let f1PrecisionSum = 0;
  let f1RecallSum = 0;

  for (const [, gtIndices] of gtGroups) {
    let bestMatchCount = 0;

    for (const [, parsedIndices] of parsedGroups) {
      let intersection = 0;
      for (const idx of gtIndices) {
        if (parsedIndices.has(idx)) intersection++;
      }
      if (intersection > bestMatchCount) {
        bestMatchCount = intersection;
      }
    }

    correctMessages += bestMatchCount;

    // For F1: precision = bestMatch / |parsedCluster|, recall = bestMatch / |gtGroup|
    // Using the matched cluster size for precision calculation
    // Since we track bestMatchCount per GT group, we approximate:
    totalPrecisionN += bestMatchCount;
    totalRecallD += gtIndices.size;
  }

  // GA = correct / total
  const ga = correctMessages / groundTruth.length;

  // FGA: compute per GT group, then macro-average
  for (const [, gtIndices] of gtGroups) {
    let bestMatchCount = 0;
    let bestParsedSize = 0;

    for (const [, parsedIndices] of parsedGroups) {
      let intersection = 0;
      for (const idx of gtIndices) {
        if (parsedIndices.has(idx)) intersection++;
      }
      if (intersection > bestMatchCount) {
        bestMatchCount = intersection;
        bestParsedSize = parsedIndices.size;
      }
    }

    const precision = bestParsedSize > 0 ? bestMatchCount / bestParsedSize : 0;
    const recall = gtIndices.size > 0 ? bestMatchCount / gtIndices.size : 0;
    f1PrecisionSum += precision;
    f1RecallSum += recall;
  }

  const avgPrecision = f1PrecisionSum / gtGroups.size;
  const avgRecall = f1RecallSum / gtGroups.size;
  const fga =
    avgPrecision + avgRecall > 0
      ? (2 * avgPrecision * avgRecall) / (avgPrecision + avgRecall)
      : 0;

  return { groupAccuracy: ga, f1GroupAccuracy: fga };
}

// ============================================================
// Parsing Template Accuracy (PTA)
// ============================================================

/**
 * Calculates Parsing Template Accuracy.
 *
 * Algorithm:
 * 1. For each parser cluster, find the best-matching ground-truth template.
 * 2. Compare matched template tokens position-by-position.
 * 3. PTA = correctly matching token positions / total token positions.
 *
 * This measures whether the parser extracts the CORRECT template structure
 * (i.e., correctly identifies which tokens are constants and which are variables).
 */
export function calculateParsingTemplateAccuracy(
  groundTruth: GroundTruthEntry[],
  parsed: ParsedEntry[],
): { parsingTemplateAccuracy: number; f1TemplateAccuracy: number } {
  if (groundTruth.length === 0) {
    return { parsingTemplateAccuracy: 1.0, f1TemplateAccuracy: 1.0 };
  }

  // Build GT template → set of indices
  const gtTemplateToIndices = new Map<number, { indices: Set<number>; tokens: string[] }>();

  for (let i = 0; i < groundTruth.length; i++) {
    const gtId = groundTruth[i]!.templateId;
    if (!gtTemplateToIndices.has(gtId)) {
      gtTemplateToIndices.set(gtId, {
        indices: new Set(),
        tokens: groundTruth[i]!.templateTokens,
      });
    }
    gtTemplateToIndices.get(gtId)!.indices.add(i);
  }

  // Build parser cluster → set of indices and template tokens
  const parsedClusterToInfo = new Map<
    number,
    { indices: Set<number>; tokens: string[] }
  >();

  for (let i = 0; i < parsed.length; i++) {
    const cId = parsed[i]!.clusterId;
    if (!parsedClusterToInfo.has(cId)) {
      parsedClusterToInfo.set(cId, {
        indices: new Set(),
        tokens: parsed[i]!.templateTokens,
      });
    }
    parsedClusterToInfo.get(cId)!.indices.add(i);
  }

  // For each GT template, find the best-matching parser cluster
  let totalCorrectTokens = 0;
  let totalTokens = 0;
  let f1PrecisionSum = 0;
  let f1RecallSum = 0;
  let matchedGtCount = 0;

  for (const [, gtInfo] of gtTemplateToIndices) {
    const gtTokens = gtInfo.tokens;
    let bestOverlap = 0;
    let bestParsedTokens: string[] | null = null;

    for (const [, parsedInfo] of parsedClusterToInfo) {
      const parsedTokens = parsedInfo.tokens;
      // Token-by-token comparison — only compare if same length
      if (gtTokens.length !== parsedTokens.length) continue;

      let overlap = 0;
      for (let j = 0; j < gtTokens.length; j++) {
        const gtTok = gtTokens[j]!;
        const parsedTok = parsedTokens[j]!;
        // Exact match, OR both tokens are masked parameters (<...>)
        if (gtTok === parsedTok || (isMaskedToken(gtTok) && isMaskedToken(parsedTok))) {
          overlap++;
        }
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestParsedTokens = parsedTokens;
      }
    }

    if (bestParsedTokens && gtTokens.length > 0) {
      totalCorrectTokens += bestOverlap;
      totalTokens += gtTokens.length;

      const precision = bestOverlap / bestParsedTokens.length;
      const recall = bestOverlap / gtTokens.length;
      f1PrecisionSum += precision;
      f1RecallSum += recall;
      matchedGtCount++;
    }
  }

  const pta = totalTokens > 0 ? totalCorrectTokens / totalTokens : 0;

  const fta =
    matchedGtCount > 0
      ? (() => {
          const avgP = f1PrecisionSum / matchedGtCount;
          const avgR = f1RecallSum / matchedGtCount;
          return avgP + avgR > 0
            ? (2 * avgP * avgR) / (avgP + avgR)
            : 0;
        })()
      : 0;

  return { parsingTemplateAccuracy: pta, f1TemplateAccuracy: fta };
}

// ============================================================
// Full evaluation
// ============================================================

/**
 * Returns true if a token is a masked parameter placeholder.
 * Matches tokens like `<*>`, `<IP>`, `<NUM>`, `<BLOCK_ID>`, etc.
 *
 * Used by PTA comparison to treat all masked parameter tokens
 * as equivalent — the standard Loghub benchmark normalization.
 */
function isMaskedToken(token: string): boolean {
  return token.startsWith("<") && token.endsWith(">") && token.length > 2;
}

/**
 * Runs the complete evaluation on a dataset.
 */
export function evaluate(
  groundTruth: GroundTruthEntry[],
  parsed: ParsedEntry[],
): EvaluationResult {
  const ga = calculateGroupAccuracy(groundTruth, parsed);
  const pa = calculateParsingTemplateAccuracy(groundTruth, parsed);

  const groundTruthTemplateCount = new Set(
    groundTruth.map((e) => e.templateId),
  ).size;
  const parserClusterCount = new Set(parsed.map((e) => e.clusterId)).size;

  return {
    groupAccuracy: ga.groupAccuracy,
    f1GroupAccuracy: ga.f1GroupAccuracy,
    parsingTemplateAccuracy: pa.parsingTemplateAccuracy,
    f1TemplateAccuracy: pa.f1TemplateAccuracy,
    totalMessages: groundTruth.length,
    groundTruthTemplateCount,
    parserClusterCount,
  };
}

// ============================================================
// Memory-efficient compact evaluation
// ============================================================

/**
 * Compact evaluation data — avoids building full GroundTruthEntry/ParsedEntry arrays.
 *
 * For 16M message datasets, the standard evaluate() requires ~2GB for
 * the full arrays. This compact version uses ~256MB by computing metrics
 * directly from pre-allocated integer arrays.
 */
export interface CompactEvalData {
  /** GT template ID per message index */
  gtTemplateIds: number[];
  /** Parser cluster ID per message index */
  clusterIds: number[];
  /** Template tokens per unique GT template ID */
  gtTemplateTokens: Map<number, string[]>;
  /** Template tokens per parser cluster ID */
  parsedTemplateTokens: Map<number, string[]>;
  totalMessages: number;
}

/**
 * Computes evaluation metrics from compact arrays without allocating
 * full GroundTruthEntry[] or ParsedEntry[] in memory.
 */
export function evaluateCompact(data: CompactEvalData): EvaluationResult {
  const { gtTemplateIds, clusterIds, gtTemplateTokens, parsedTemplateTokens, totalMessages } = data;

  if (!totalMessages || !gtTemplateIds || !clusterIds || !gtTemplateTokens || !parsedTemplateTokens) {
    return {
      groupAccuracy: 1.0, f1GroupAccuracy: 1.0,
      parsingTemplateAccuracy: 1.0, f1TemplateAccuracy: 1.0,
      totalMessages: totalMessages || 0, groundTruthTemplateCount: 0, parserClusterCount: 0,
    };
  }

  // ── GA / FGA ──────────────────────────────────────────────
  const gtGroups = new Map<number, Set<number>>();
  const parsedGroups = new Map<number, Set<number>>();

  for (let i = 0; i < totalMessages; i++) {
    const gtId = gtTemplateIds[i]!;
    const pId = clusterIds[i]!;
    if (!gtGroups.has(gtId)) gtGroups.set(gtId, new Set());
    gtGroups.get(gtId)!.add(i);
    if (!parsedGroups.has(pId)) parsedGroups.set(pId, new Set());
    parsedGroups.get(pId)!.add(i);
  }

  let correctMessages = 0;
  let f1PrecisionSum = 0;
  let f1RecallSum = 0;

  for (const [, gtSet] of gtGroups) {
    let bestOverlap = 0;
    for (const [, pSet] of parsedGroups) {
      let overlap = 0;
      for (const idx of gtSet) {
        if (pSet.has(idx)) overlap++;
      }
      if (overlap > bestOverlap) bestOverlap = overlap;
    }
    correctMessages += bestOverlap;
    f1PrecisionSum += bestOverlap / gtSet.size;
  }
  for (const [, pSet] of parsedGroups) {
    let bestOverlap = 0;
    for (const [, gtSet] of gtGroups) {
      let overlap = 0;
      for (const idx of pSet) {
        if (gtSet.has(idx)) overlap++;
      }
      if (overlap > bestOverlap) bestOverlap = overlap;
    }
    f1RecallSum += bestOverlap / pSet.size;
  }

  const groupAccuracy = correctMessages / totalMessages;
  const f1Precision = f1PrecisionSum / gtGroups.size;
  const f1Recall = f1RecallSum / parsedGroups.size;
  const f1GroupAccuracy = (2 * f1Precision * f1Recall) / (f1Precision + f1Recall) || 0;

  // ── PTA / FTA ─────────────────────────────────────────────
  let ptaMatches = 0;
  let ptaTotalTokens = 0;
  let ftaMatches = 0;
  let ftaParserTokens = 0;
  let ftaGtTokens = 0;

  for (let i = 0; i < totalMessages; i++) {
    const gtTok = gtTemplateTokens.get(gtTemplateIds[i]!) ?? [];
    const pTok = parsedTemplateTokens.get(clusterIds[i]!) ?? [];
    const maxLen = Math.max(gtTok.length, pTok.length);
    ptaTotalTokens += maxLen;

    let matchCount = 0;
    for (let j = 0; j < maxLen; j++) {
      if (j < gtTok.length && j < pTok.length && gtTok[j] === pTok[j]) {
        matchCount++;
        ftaMatches++;
      }
    }
    ptaMatches += matchCount;
    ftaParserTokens += pTok.length;
    ftaGtTokens += gtTok.length;
  }

  const parsingTemplateAccuracy = ptaTotalTokens > 0 ? ptaMatches / ptaTotalTokens : 1.0;
  const ftaPrecision = ftaParserTokens > 0 ? ftaMatches / ftaParserTokens : 0;
  const ftaRecall = ftaGtTokens > 0 ? ftaMatches / ftaGtTokens : 0;
  const f1TemplateAccuracy = (2 * ftaPrecision * ftaRecall) / (ftaPrecision + ftaRecall) || 0;

  return {
    groupAccuracy,
    f1GroupAccuracy,
    parsingTemplateAccuracy,
    f1TemplateAccuracy,
    totalMessages,
    groundTruthTemplateCount: gtGroups.size,
    parserClusterCount: parsedGroups.size,
  };
}
