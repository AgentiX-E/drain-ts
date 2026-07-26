import { DrainBase } from "./DrainBase.js";
import { LogCluster } from "./LogCluster.js";
import { Node } from "./Node.js";
import { MatchStrategy } from "./types.js";
import type { DrainOptions } from "./types.js";

/**
 * Concrete Drain algorithm implementation.
 *
 * Maps 1:1 to Python `Drain` class (drain.py L278-end).
 *
 * Implements the fixed-depth prefix tree search, similarity-based clustering,
 * template merging, and LRU eviction logic exactly as specified by the
 * original algorithm (He et al., ICWS 2017) and the official Drain3
 * Python implementation.
 *
 * Algorithm complexity: O((d + cm)n) where:
 * - d = tree depth
 * - c = average candidate clusters per leaf
 * - m = average tokens per message
 * - n = total messages
 *
 * @example
 * ```typescript
 * const drain = new Drain({ depth: 4, simTh: 0.4 });
 * const { cluster, changeType } = drain.addLogMessage("user alice logged in");
 * console.log(cluster.getTemplate()); // "user alice logged in"
 *
 * const { cluster: c2 } = drain.addLogMessage("user bob logged in");
 * console.log(c2.getTemplate()); // "user <*> logged in"
 * ```
 */
export class Drain extends DrainBase {
  /**
   * @param options - Configuration options forwarded to DrainBase.
   */
  constructor(options: DrainOptions = {}) {
    super(options);
  }


  /**
   * Searches the prefix tree for the best-matching cluster.
   *
   * Python: Drain.tree_search(root_node, tokens, sim_th, include_params)
   *
   * Search strategy (identical to Python):
   * 1. Look up the token count node at root level
   * 2. For empty tokens, return the first (only) cluster directly
   * 3. Walk down the tree for up to maxNodeDepth levels:
   *    - Exact token match → follow that path
   *    - No exact match but `<*>` wildcard exists → follow wildcard
   *    - Neither → return null (no candidates)
   * 4. At leaf node, run fastMatch over the candidate cluster list
   *
   * @param rootNode - Root of the prefix tree.
   * @param tokens - Tokenized log message.
   * @param simTh - Similarity threshold (0.4 for training, 1.0 for inference).
   * @param includeParams - Whether to count parameter tokens as matches.
   * @returns The best-matching cluster or null.
   */
  treeSearch(
    rootNode: Node,
    tokens: readonly string[],
    simTh: number,
    includeParams: boolean,
  ): LogCluster | null {
    // Step 1: Locate the token count node
    const tokenCount = tokens.length;
    const tokenCountStr = String(tokenCount);

    // Python: cur_node = root_node.key_to_child_node.get(str(token_count))
    let curNode = rootNode.keyToChildNode.get(tokenCountStr);
    if (!curNode) return null;

    // Step 2: Empty tokens → return the first cluster directly
    if (tokenCount === 0) {
      const firstId = curNode.clusterIds[0];
      if (firstId === undefined) return null;
      return this.idToCluster.get(firstId) ?? null;
    }

    // Step 3: Walk down the prefix tree
    let curNodeDepth = 1;
    for (const token of tokens) {
      // Python: if cur_node_depth >= self.max_node_depth: break
      if (curNodeDepth >= this.maxNodeDepth) break;
      // Python: if cur_node_depth == token_count: break
      if (curNodeDepth === tokenCount) break;

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

    // At this point curNode is guaranteed to be a Node (not undefined),
    // because the null check above and the loop both ensure valid assignments.
    // However, TypeScript can't track this through the loop body
    // with the early breaks. We assert the type here.
    const leafNode: Node = curNode;

    // Step 4: Fast match over candidate clusters
    return this.fastMatch(leafNode.clusterIds, tokens, simTh, includeParams);
  }

  // ============================================================
  // addSeqToPrefixTree (maps to Python Drain.add_seq_to_prefix_tree, drain.py L324-L388)
  // ============================================================

  /**
   * Inserts a cluster into the prefix tree.
   *
   * Python: Drain.add_seq_to_prefix_tree(root_node, cluster)
   *
   * This is the most complex method in the implementation. The logic for
   * handling `maxChildren` and `parametrizeNumericTokens` follows the
   * exact branching structure of the Python code.
   *
   * Insertion strategy:
   * 1. First level: token count node
   * 2. For each token in the template:
   *    a. Already at max depth or last token → append to leaf node's clusterIds
   *    b. Token exists in current node → follow existing path
   *    c. Token doesn't exist:
   *       - Contains digits + parametrizeNumericTokens → use `<*>` node
   *       - No digits → decide based on maxChildren and `<*>` presence
   *
   * @param rootNode - Root of the prefix tree.
   * @param cluster - The cluster to insert.
   */
  addSeqToPrefixTree(rootNode: Node, cluster: LogCluster): void {
    const tokenCount = cluster.logTemplateTokens.length;
    const tokenCountStr = String(tokenCount);

    // Level 1: Token count node
    let firstLayerNode = rootNode.keyToChildNode.get(tokenCountStr);
    if (!firstLayerNode) {
      firstLayerNode = new Node();
      rootNode.keyToChildNode.set(tokenCountStr, firstLayerNode);
    }

    let curNode = firstLayerNode;

    // Empty log message
    if (tokenCount === 0) {
      curNode.clusterIds = [cluster.clusterId];
      return;
    }

    let currentDepth = 1;

    for (let i = 0; i < tokenCount; i++) {
      // tokenCount === logTemplateTokens.length by construction;
      // array access by bounded index is always defined.
      const token = cluster.logTemplateTokens[i]!;

      // At maximum depth or last token → add to leaf node's clusterIds
      // Python: if current_depth >= self.max_node_depth or current_depth >= token_count
      if (currentDepth >= this.maxNodeDepth || currentDepth >= tokenCount) {
        // Filter out clusters that have been evicted, then append the new one
        const newClusterIds = curNode.clusterIds.filter((cid) =>
          this.idToCluster.has(cid),
        );
        newClusterIds.push(cluster.clusterId);
        curNode.clusterIds = newClusterIds;
        break;
      }

      // Token doesn't exist at this level
      if (!curNode.keyToChildNode.has(token)) {
        if (this.parametrizeNumericTokens && Drain.hasNumbers(token)) {
          // Numeric token → route through <*> wildcard node
          let paramNode = curNode.keyToChildNode.get(this.paramStr);
          if (!paramNode) {
            paramNode = new Node();
            curNode.keyToChildNode.set(this.paramStr, paramNode);
          }
          curNode = paramNode;
        } else {
          // Non-numeric token
          if (curNode.keyToChildNode.has(this.paramStr)) {
            // <*> node already exists
            if (curNode.keyToChildNode.size < this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(token, newNode);
              curNode = newNode;
            } else {
              curNode = curNode.keyToChildNode.get(this.paramStr)!;
            }
          } else {
            // <*> node does not exist
            if (curNode.keyToChildNode.size + 1 < this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(token, newNode);
              curNode = newNode;
            } else if (curNode.keyToChildNode.size + 1 === this.maxChildren) {
              const newNode = new Node();
              curNode.keyToChildNode.set(this.paramStr, newNode);
              curNode = newNode;
            }
            // size + 1 > maxChildren is unreachable: the `=== maxChildren`
            // branch above creates the <*> node before size can exceed maxChildren.
            // Once <*> exists, the outer `has(this.paramStr)` branch handles routing.
          }
        }
      } else {
        // Token already exists → follow the existing path
        curNode = curNode.keyToChildNode.get(token)!;
      }

      currentDepth++;
    }
  }

  // ============================================================
  // getSeqDistance (maps to Python Drain.get_seq_distance, drain.py L391-L413)
  // ============================================================

  /**
   * Calculates the similarity score and parameter count between two
   * token sequences.
   *
   * Python: Drain.get_seq_distance(seq1, seq2, include_params)
   *
   * Formula:
   * ```
   * similarity = (simTokens + (paramCount if includeParams else 0)) / len(seq1)
   * ```
   *
   * Where:
   * - seq1 is the template sequence (may contain `<*>` placeholders)
   * - seq2 is the log message sequence
   * - Tokens matching `<*>` in seq1 are skipped (counted as params)
   * - Matching non-parameter tokens increment simTokens
   *
   * @param seq1 - Template tokens (may contain paramStr placeholders).
   * @param seq2 - Log message tokens to compare against.
   * @param includeParams - Whether to count parameter tokens toward similarity.
   * @returns Similarity score [0.0, 1.0] and parameter count.
   */
  getSeqDistance(
    seq1: readonly string[],
    seq2: readonly string[],
    includeParams: boolean,
  ): { similarity: number; paramCount: number } {
    const len = seq1.length;

    // Python: if len(seq1) == 0: return 1.0, 0
    if (len === 0) return { similarity: 1.0, paramCount: 0 };

    let simTokens = 0;
    let paramCount = 0;

    for (let i = 0; i < len; i++) {
      const token1 = seq1[i]!;
      const token2 = seq2[i]!;

      if (token1 === this.paramStr) {
        // Parameter placeholder → skip comparison, count as param
        paramCount++;
        continue;
      }
      if (token1 === token2) {
        simTokens++;
      }
    }

    const totalSim = includeParams ? simTokens + paramCount : simTokens;
    return { similarity: totalSim / len, paramCount };
  }

  // ============================================================
  // createTemplate (maps to Python Drain.create_template, drain.py L415-L425)
  // ============================================================

  /**
   * Creates a merged template from two token sequences.
   *
   * Python: Drain.create_template(seq1, seq2)
   *
   * Comparison strategy:
   * - seq1[ i ] == seq2[ i ] → keep the token (it's a constant)
   * - seq1[ i ] != seq2[ i ] → replace with paramStr (it's a variable)
   *
   * This is how Drain gradually generalizes templates — each time a new
   * message matches a cluster, positions that differ are replaced with
   * the parameter placeholder.
   *
   * @param seq1 - New log message tokens.
   * @param seq2 - Existing template tokens.
   * @returns The merged template tokens (frozen array).
   */
  createTemplate(
    seq1: readonly string[],
    seq2: readonly string[],
  ): readonly string[] {
    if (seq1.length !== seq2.length) {
      throw new Error(
        `createTemplate: sequence length mismatch (${seq1.length} vs ${seq2.length})`,
      );
    }

    const result: string[] = [];
    for (let i = 0; i < seq1.length; i++) {
      result.push(seq1[i] === seq2[i] ? seq2[i]! : this.paramStr);
    }
    return Object.freeze(result);
  }

  // ============================================================
  // match — Inference mode (maps to Python Drain.match, drain.py L427-L472)
  // ============================================================

  /**
   * Matches a log message against existing clusters WITHOUT modifying state.
   *
   * Python: Drain.match(content, full_search_strategy)
   *
   * This is the inference/classification mode. Key differences from training:
   * - simTh is fixed at 1.0 (requires perfect match)
   * - includeParams is always true (parameters count as matches)
   * - No new clusters are created
   * - No existing templates are modified
   *
   * Three search strategies:
   * - "never": Tree search only. Fastest, may miss matches.
   * - "fallback": Tree search first, then full search if no match.
   * - "always": Full linear search over all same-length clusters.
   *
   * @param content - The log message to classify.
   * @param fullSearchStrategy - Which search strategy to use. Default: "never".
   * @returns The matching cluster, or null if no perfect match exists.
   */
  match(
    content: string,
    fullSearchStrategy: MatchStrategy = MatchStrategy.Never,
  ): LogCluster | null {
    const REQUIRED_SIM_TH = 1.0;
    const contentTokens = this.getContentAsTokens(content);

    // Python: def full_search() → return self.fast_match(all_ids, content_tokens, required_sim_th, include_params=True)
    const fullSearch = (): LogCluster | null => {
      const allIds = this.getClustersIdsForSeqLen(contentTokens.length);
      return this.fastMatch(allIds, contentTokens, REQUIRED_SIM_TH, true);
    };

    // Python: if full_search_strategy == "always": return full_search()
    if (fullSearchStrategy === MatchStrategy.Always) {
      return fullSearch();
    }

    // Python: match_cluster = self.tree_search(...)
    const matchCluster = this.treeSearch(
      this.rootNode,
      contentTokens,
      REQUIRED_SIM_TH,
      true,
    );

    if (matchCluster !== null) return matchCluster;

    // Python: if full_search_strategy == "never": return None
    if (fullSearchStrategy === MatchStrategy.Never) return null;

    // Python: return full_search() (fallback)
    return fullSearch();
  }

  // ============================================================
  // printTree (maps to Python Drain.print_tree/print_node, drain.py L474-end)
  // ============================================================

  /**
   * Prints the prefix tree structure for debugging.
   *
   * Python: Drain.print_tree(file, max_clusters) + Drain.print_node(...)
   *
   * @param stream - Output stream (default: process.stdout).
   * @param maxClusters - Max clusters to show per node (default: 5).
   */
  printTree(stream?: NodeJS.WritableStream, maxClusters: number = 5): void {
    const out = stream ?? process.stdout;

    const printNode = (token: string, node: Node, depth: number): void => {
      const indent = "\t".repeat(depth);
      let line: string;

      if (depth === 0) {
        line = `<${token}>`;
      } else if (depth === 1) {
        // Token count layer: wrap with L= prefix if numeric
        line = /^\d+$/.test(token) ? `<L=${token}>` : `<${token}>`;
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
