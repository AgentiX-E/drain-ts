import { DrainBase } from "./DrainBase.js";
import { LogCluster } from "./LogCluster.js";
import { Node } from "./Node.js";
import { MatchStrategy } from "./types.js";
import type { DrainOptions } from "./types.js";

/**
 * JaccardDrain — Drain variant using Jaccard set similarity.
 *
 * Maps 1:1 to Python `JaccardDrain` class (drain3/jaccard_drain.py).
 *
 * Key differences from standard Drain:
 *
 * | Feature | Standard Drain | JaccardDrain |
 * |---------|---------------|-------------|
 * | Tree root key | Token count | First token |
 * | Similarity | Position-wise ratio | Jaccard (intersection / union) |
 * | Template merge | Position-wise param replacement | Set intersection + position-wise |
 * | Match threshold | 1.0 (exact) | 0.8 (Jaccard is inherently lower) |
 * | Variable-length | ✗ must be same | ✓ supports different lengths |
 *
 * JaccardDrain is particularly useful when messages with the same
 * template can have varying token counts (e.g., "session opened for
 * user alice by (uid=0)" vs "session closed for user alice").
 *
 * The Jaccard coefficient is multiplied by 1.3 (gain factor, capped
 * at 1.0) to compensate for Jaccard's naturally lower scores.
 *
 * @example
 * ```typescript
 * const drain = new JaccardDrain({ depth: 4, simTh: 0.4 });
 * drain.addLogMessage("session opened for user alice by (uid=0)");
 * drain.addLogMessage("session closed for user alice");
 * // Both grouped together via Jaccard similarity
 * ```
 */
export class JaccardDrain extends DrainBase {
  /**
   * @param options - Configuration options forwarded to DrainBase.
   */
  constructor(options: DrainOptions = {}) {
    super(options);
  }

  // ============================================================
  // treeSearch (maps to Python JaccardDrain.tree_search)
  // ============================================================

  /**
   * Tree search using first token as the root-level key.
   *
   * Python: JaccardDrain.tree_search(root_node, tokens, sim_th, include_params)
   *
   * Search strategy:
   * 1. First level: lookup by first token (NOT token count)
   * 2. Empty tokens: return first cluster directly
   * 3. Walk tree for up to maxNodeDepth levels, starting from tokens[1]
   * 4. Max depth or "last token" (token_count - 1) → break
   * 5. At leaf, run fastMatch
   */
  treeSearch(
    rootNode: Node,
    tokens: readonly string[],
    simTh: number,
    includeParams: boolean,
  ): LogCluster | null {
    // Step 1: First-level key is the first token
    const tokenCount = tokens.length;
    const tokenFirst = tokenCount === 0 ? "" : (tokens[0] ?? "");
    let curNode = rootNode.keyToChildNode.get(tokenFirst);
    if (!curNode) return null;

    // Step 2: Empty tokens → return first cluster
    if (tokenCount === 0) {
      const firstId = curNode.clusterIds[0];
      if (firstId === undefined) return null;
      return this.idToCluster.get(firstId) ?? null;
    }

    // Step 3: Walk from tokens[1] onward (skip first token)
    let curNodeDepth = 1;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i]!;

      // At max depth → break
      if (curNodeDepth >= this.maxNodeDepth) break;
      // At "last token" (relative to non-first tokens) → break
      if (curNodeDepth === tokenCount - 1) break;

      const children: Map<string, Node> = curNode.keyToChildNode;
      const exactNode: Node | undefined = children.get(token);

      if (exactNode) {
        curNode = exactNode;
      } else {
        const paramNode = children.get(this.paramStr);
        if (paramNode) {
          curNode = paramNode;
        } else {
          return null;
        }
      }
      curNodeDepth++;
    }

    return this.fastMatch(curNode!.clusterIds, tokens, simTh, includeParams);
  }

  // ============================================================
  // addSeqToPrefixTree (maps to Python JaccardDrain.add_seq_to_prefix_tree)
  // ============================================================

  /**
   * Inserts a cluster into the prefix tree using first token as root key.
   *
   * Python: JaccardDrain.add_seq_to_prefix_tree(root_node, cluster)
   *
   * Structure:
   * 1. Root key = first template token (not token count)
   * 2. Single-token messages: append directly to first-level node
   * 3. Multi-token messages: walk from tokens[1], similar to standard Drain
   * 4. Max depth and "last token" bounds use token_count - 1
   */
  addSeqToPrefixTree(rootNode: Node, cluster: LogCluster): void {
    const tokenCount = cluster.logTemplateTokens.length;

    // Step 1: First token as root key
    const tokenFirst =
      tokenCount === 0 ? "" : (cluster.logTemplateTokens[0] ?? "");

    let firstLayerNode = rootNode.keyToChildNode.get(tokenFirst);
    if (!firstLayerNode) {
      firstLayerNode = new Node();
      rootNode.keyToChildNode.set(tokenFirst, firstLayerNode);
    }

    let curNode = firstLayerNode;

    // Step 2: Empty message → assign directly
    if (tokenCount === 0) {
      curNode.clusterIds = [cluster.clusterId];
      return;
    }

    // Step 3: Single-token message → add to first-level node's clusterIds
    if (tokenCount === 1) {
      const newClusterIds = curNode.clusterIds.filter((cid) =>
        this.idToCluster.has(cid),
      );
      newClusterIds.push(cluster.clusterId);
      curNode.clusterIds = newClusterIds;
      return;
    }

    // Step 4: Walk from tokens[1] (skip first token)
    let currentDepth = 1;
    for (let i = 1; i < tokenCount; i++) {
      const token = cluster.logTemplateTokens[i]!;

      // At max depth OR "last token" → add to leaf
      if (
        currentDepth >= this.maxNodeDepth ||
        currentDepth >= tokenCount - 1
      ) {
        const newClusterIds = curNode.clusterIds.filter((cid) =>
          this.idToCluster.has(cid),
        );
        newClusterIds.push(cluster.clusterId);
        curNode.clusterIds = newClusterIds;
        break;
      }

      // Token doesn't exist at this level
      if (!curNode.keyToChildNode.has(token)) {
        if (this.parametrizeNumericTokens && DrainBase.hasNumbers(token)) {
          // Numeric token → route through <*> wildcard
          let paramNode = curNode.keyToChildNode.get(this.paramStr);
          if (!paramNode) {
            paramNode = new Node();
            curNode.keyToChildNode.set(this.paramStr, paramNode);
          }
          curNode = paramNode;
        } else {
          // Non-numeric token → decide based on maxChildren and <*> presence
          if (curNode.keyToChildNode.has(this.paramStr)) {
            if (curNode.keyToChildNode.size < this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(token, newNode);
              curNode = newNode;
            } else {
              curNode = curNode.keyToChildNode.get(this.paramStr)!;
            }
          } else {
            if (curNode.keyToChildNode.size + 1 < this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(token, newNode);
              curNode = newNode;
            } else if (curNode.keyToChildNode.size + 1 === this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(this.paramStr, newNode);
              curNode = newNode;
            } else {
              curNode = curNode.keyToChildNode.get(this.paramStr)!;
            }
          }
        }
      } else {
        // Token exists → follow the path
        curNode = curNode.keyToChildNode.get(token)!;
      }

      currentDepth++;
    }
  }

  // ============================================================
  // getSeqDistance (maps to Python JaccardDrain.get_seq_distance)
  // ============================================================

  /**
   * Calculates similarity using the Jaccard index.
   *
   * Python: JaccardDrain.get_seq_distance(seq1, seq2, include_params)
   *
   * Jaccard index: `|intersection| / |union|`
   *
   * Steps:
   * 1. Count param tokens in seq1 (template)
   * 2. If same length and has params: remove param positions from seq2
   * 3. If includeParams: remove param positions from seq1
   * 4. Jaccard on remaining sets
   * 5. Apply 1.3× gain factor (capped at 1.0)
   *
   * seq1 is the template (may contain paramStr), seq2 is the log message.
   */
  getSeqDistance(
    seq1: readonly string[],
    seq2: readonly string[],
    includeParams: boolean,
  ): { similarity: number; paramCount: number } {
    // Empty sequences → full match
    if (seq1.length === 0) {
      return { similarity: 1.0, paramCount: 0 };
    }

    // Count params in template
    let paramCount = 0;
    for (const token of seq1) {
      if (token === this.paramStr) paramCount++;
    }

    // Build filtered seq2: remove positions where template has paramStr
    let filteredSeq2: string[];
    if (seq1.length === seq2.length && paramCount > 0) {
      filteredSeq2 = seq2.filter((_, i) => seq1[i] !== this.paramStr);
    } else {
      filteredSeq2 = [...seq2];
    }

    // Build filtered seq1: remove paramStr if includeParams
    let filteredSeq1: string[];
    if (includeParams) {
      filteredSeq1 = seq1.filter((t) => t !== this.paramStr);
    } else {
      filteredSeq1 = [...seq1];
    }

    const set1 = new Set(filteredSeq1);
    const set2 = new Set(filteredSeq2);

    // Jaccard: intersection / union
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    let jaccard = 0;
    if (union.size > 0) {
      jaccard = intersection.size / union.size;
    }

    // Gain factor: Jaccard naturally produces lower scores
    // Multiply by 1.3, capped at 1.0
    jaccard = jaccard * 1.3 < 1 ? jaccard * 1.3 : 1;

    return { similarity: jaccard, paramCount };
  }

  // ============================================================
  // createTemplate (maps to Python JaccardDrain.create_template)
  // ============================================================

  /**
   * Creates a merged template using set intersection.
   *
   * Python: JaccardDrain.create_template(seq1, seq2)
   *
   * Same-length sequences: position-wise comparison with strategy chain.
   * Different-length sequences: keep tokens in the intersection set,
   * replace all others with paramStr. Uses the LONGER sequence as base.
   *
   * The strategy chain enables advanced parameterization patterns
   * for same-length sequences (affix-preserving, regex-based, etc.)
   *
   * seq1 = log message tokens, seq2 = template tokens.
   */
  createTemplate(
    seq1: readonly string[],
    seq2: readonly string[],
  ): readonly string[] {
    const interSet = new Set([...seq1].filter((x) => seq2.includes(x)));

    if (seq1.length === seq2.length) {
      // Same length: use strategy chain for parameterization
      const result: string[] = [];
      for (let i = 0; i < seq1.length; i++) {
        const token1 = seq1[i]!;
        const token2 = seq2[i]!;

        if (this.enableMaskParamGeneralization && this.isMaskedParam(token1)) {
          result.push(this.paramStr);
        } else if (token1 === token2) {
          result.push(token2);
        } else {
          const paramResult = this.strategyChain.parameterize(
            token1,
            token2,
            this.paramStr,
          );
          result.push(paramResult.templateToken);
        }
      }
      return Object.freeze(result);
    }

    // Different lengths: use longer sequence as base, keep intersection tokens
    const base = seq1.length > seq2.length ? [...seq1] : [...seq2];
    for (let i = 0; i < base.length; i++) {
      if (!interSet.has(base[i]!)) {
        base[i] = this.paramStr;
      }
    }
    return Object.freeze(base);
  }

  // ============================================================
  // match (maps to Python JaccardDrain.match)
  // ============================================================

  /**
   * Matches a log message against existing clusters (inference mode).
   *
   * Python: JaccardDrain.match(content, full_search_strategy)
   *
   * Uses simTh = 0.8 (not 1.0) because Jaccard similarity is
   * inherently lower than position-wise matching.
   *
   * Full search: looks up clusters by first token key.
   */
  match(
    content: string,
    fullSearchStrategy: MatchStrategy = MatchStrategy.Never,
  ): LogCluster | null {
    const REQUIRED_SIM_TH = 0.8;
    const contentTokens = this.getContentAsTokens(content);

    const fullSearch = (): LogCluster | null => {
      const firstToken =
        contentTokens.length === 0 ? "" : (contentTokens[0] ?? "");
      const allIds = this.getClustersIdsForFirstToken(firstToken);
      return this.fastMatch(
        allIds,
        contentTokens,
        REQUIRED_SIM_TH,
        true,
      );
    };

    if (fullSearchStrategy === MatchStrategy.Always) {
      return fullSearch();
    }

    const matchCluster = this.treeSearch(
      this.rootNode,
      contentTokens,
      REQUIRED_SIM_TH,
      true,
    );

    if (matchCluster !== null) return matchCluster;

    if (fullSearchStrategy === MatchStrategy.Never) return null;

    return fullSearch();
  }

  // ============================================================
  // Print tree (debug utility)
  // ============================================================

  /**
   * Prints the prefix tree for debugging.
   */
  printTree(stream?: NodeJS.WritableStream, maxClusters: number = 5): void {
    const out = stream ?? process.stdout;

    const printNode = (token: string, node: Node, depth: number): void => {
      const indent = "\t".repeat(depth);
      let line: string;

      if (depth === 0) {
        line = `<${token}>`;
      } else if (depth === 1) {
        line = `"${token}"`;
      } else {
        line = `"${token}"`;
      }

      if (node.clusterIds.length > 0) {
        line += ` (cluster_count=${node.clusterIds.length})`;
      }

      out.write(indent + line + "\n");

      for (const [childToken, childNode] of node.keyToChildNode) {
        printNode(childToken, childNode, depth + 1);
      }

      for (const cid of node.clusterIds.slice(0, maxClusters)) {
        const cluster = this.idToCluster.get(cid);
        if (cluster) {
          out.write("\t".repeat(depth + 1) + cluster.toString() + "\n");
        }
      }
    };

    printNode("root", this.rootNode, 0);
  }
}
