import { Node } from "./Node.js";
import { LogCluster } from "./LogCluster.js";
import { LogClusterCache } from "./LogClusterCache.js";
import type { DrainOptions, MatchStrategy } from "./types.js";

/**
 * Abstract base class for Drain algorithm implementations.
 *
 * Maps 1:1 to Python `DrainBase` class (drain.py L37-L176 — abstract portions).
 *
 * Defines the shared state and interface that all Drain variants
 * (Drain, JaccardDrain) must implement. Subclasses provide the concrete
 * tree search, distance calculation, and template creation logic.
 *
 * Key invariants:
 * - maxNodeDepth = depth - 2 (derived from logClusterDepth)
 * - logClusterDepth >= 3 (enforced in constructor)
 * - clusterIds are monotonically increasing, starting from 1
 * - rootNode is always the entry point for all tree operations
 */
export abstract class DrainBase {
  // ============================================================
  // Configuration (maps to Python DrainBase.__init__ parameters)
  // ============================================================

  /** Maximum cluster depth including root and token count layers. Python: self.log_cluster_depth */
  readonly logClusterDepth: number;

  /** Maximum parse tree node depth = depth - 2. Python: self.max_node_depth */
  readonly maxNodeDepth: number;

  /** Similarity threshold for creating new clusters. Python: self.sim_th */
  readonly simTh: number;

  /** Maximum child nodes per tree level. Python: self.max_children */
  readonly maxChildren: number;

  /** Maximum clusters (null = unlimited). Python: self.max_clusters */
  readonly maxClusters: number | null;

  /** Additional tokenization delimiters. Python: self.extra_delimiters */
  readonly extraDelimiters: readonly string[];

  /** String used to replace parameters in templates. Python: self.param_str */
  readonly paramStr: string;

  /** Whether tokens containing digits are treated as parameters. Python: self.parametrize_numeric_tokens */
  readonly parametrizeNumericTokens: boolean;

  // ============================================================
  // State (maps to Python DrainBase.__init__ state initialization)
  // ============================================================

  /** Root node of the fixed-depth prefix tree. Python: self.root_node */
  readonly rootNode: Node = new Node();

  /**
   * Cluster ID → LogCluster mapping.
   * Uses LogClusterCache (LRU) when maxClusters is set, plain Map otherwise.
   *
   * Python: self.id_to_cluster = {} if max_clusters is None
   *                              else LogClusterCache(maxsize=max_clusters)
   */
  idToCluster: Map<number, LogCluster>;

  /**
   * Monotonically increasing counter for cluster IDs.
   * Incremented before each new cluster creation. Starts at 0.
   *
   * Python: self.clusters_counter = 0
   */
  clustersCounter: number = 0;

  // ============================================================
  // Constructor (maps to Python DrainBase.__init__)
  // ============================================================

  constructor({
    depth = 4,
    simTh = 0.4,
    maxChildren = 100,
    maxClusters = null,
    extraDelimiters = [],
    paramStr = "<*>",
    parametrizeNumericTokens = true,
  }: DrainOptions = {}) {
    if (depth < 3) {
      throw new Error(`depth must be at least 3, got ${depth}`);
    }
    if (simTh < 0 || simTh > 1) {
      throw new Error(`simTh must be between 0 and 1, got ${simTh}`);
    }

    this.logClusterDepth = depth;
    this.maxNodeDepth = depth - 2;
    this.simTh = simTh;
    this.maxChildren = maxChildren;
    this.maxClusters = maxClusters;
    this.extraDelimiters = Object.freeze([...extraDelimiters]);
    this.paramStr = paramStr;
    this.parametrizeNumericTokens = parametrizeNumericTokens;

    // Python: {} if max_clusters is None else LogClusterCache(maxsize=max_clusters)
    this.idToCluster =
      maxClusters === null ? new Map() : new LogClusterCache(maxClusters);
  }

  // ============================================================
  // Properties
  // ============================================================

  /** All current clusters. Python: DrainBase.clusters property */
  get clusters(): LogCluster[] {
    return [...this.idToCluster.values()];
  }

  // ============================================================
  // Utility methods (maps to Python DrainBase static/concrete methods)
  // ============================================================

  /**
   * Checks if a string contains any digit characters.
   *
   * Python: DrainBase.has_numbers(s) → any(char.isdigit() for char in s)
   *
   * Uses explicit character code comparison for performance (avoids regex).
   */
  static hasNumbers(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      // '0' = 48, '9' = 57
      if (code >= 48 && code <= 57) return true;
    }
    return false;
  }

  /**
   * Splits a log message into tokens.
   *
   * Python: DrainBase.get_content_as_tokens(content)
   *
   * Processing steps (identical to Python):
   * 1. strip leading/trailing whitespace
   * 2. replace extra delimiters with spaces
   * 3. split on whitespace, filtering empty tokens
   */
  getContentAsTokens(content: string): string[] {
    let processed = content.trim();
    for (const delimiter of this.extraDelimiters) {
      // Python: content.replace(delimiter, " ")
      // Using split+join to match Python's str.replace behavior for plain strings
      processed = processed.split(delimiter).join(" ");
    }
    return processed.split(/\s+/).filter((t) => t.length > 0);
  }

  /**
   * Returns all cluster IDs for a given token sequence length.
   *
   * Python: DrainBase.get_clusters_ids_for_seq_len(seq_fir)
   *
   * Recursively traverses the subtree rooted at the token-count node.
   */
  getClustersIdsForSeqLen(seqLen: number): number[] {
    const tokenCountStr = String(seqLen);
    const curNode = this.rootNode.keyToChildNode.get(tokenCountStr);
    if (!curNode) return [];

    const result: number[] = [];
    const collectRecursive = (node: Node): void => {
      result.push(...node.clusterIds);
      for (const child of node.keyToChildNode.values()) {
        collectRecursive(child);
      }
    };
    collectRecursive(curNode);
    return result;
  }

  /**
   * Total number of log messages across all clusters.
   *
   * Python: DrainBase.get_total_cluster_size()
   */
  getTotalClusterSize(): number {
    let size = 0;
    for (const c of this.idToCluster.values()) {
      size += c.size;
    }
    return size;
  }

  /**
   * Removes stale cluster IDs from all tree nodes.
   *
   * When clusters are evicted from the LRU cache (via maxClusters),
   * their IDs may remain in Node.clusterIds arrays throughout the
   * prefix tree. This method traverses the entire tree and removes
   * any cluster ID that is no longer present in idToCluster.
   *
   * Call this periodically in long-running applications with
   * maxClusters enabled, or after bulk LRU eviction.
   *
   * Complexity: O(n) where n is the number of nodes in the tree.
   */
  compactTree(): number {
    let removed = 0;
    const stack: Node[] = [this.rootNode];
    while (stack.length > 0) {
      const node = stack.pop()!;
      const before = node.clusterIds.length;
      node.clusterIds = node.clusterIds.filter((cid) =>
        this.idToCluster.has(cid),
      );
      removed += before - node.clusterIds.length;
      for (const child of node.keyToChildNode.values()) {
        stack.push(child);
      }
    }
    return removed;
  }

  // ============================================================
  // Fast match (maps to Python DrainBase.fast_match)
  // ============================================================

  /**
   * Finds the best-matching cluster from a candidate list.
   *
   * Python: DrainBase.fast_match(cluster_ids, tokens, sim_th, include_params)
   *
   * Key rules:
   * - Uses idToCluster.get() (bypasses LRU eviction) for lookups
   * - When two clusters have the same similarity score, prefers the one
   *   with more parameters (more generic template)
   * - Returns null if no cluster meets the similarity threshold
   *
   * Complexity: O(c) where c is the number of candidate clusters
   */
  protected fastMatch(
    clusterIds: readonly number[],
    tokens: readonly string[],
    simTh: number,
    includeParams: boolean,
  ): LogCluster | null {
    let maxSim = -1;
    let maxParamCount = -1;
    let bestCluster: LogCluster | null = null;

    for (const clusterId of clusterIds) {
      // Python: cluster = self.id_to_cluster.get(cluster_id) — bypasses LRU
      const cluster = this.idToCluster.get(clusterId);
      if (!cluster) continue;

      const { similarity, paramCount } = this.getSeqDistance(
        cluster.logTemplateTokens,
        tokens,
        includeParams,
      );

      // Python: cur_sim > max_sim or (cur_sim == max_sim and param_count > max_param_count)
      if (
        similarity > maxSim ||
        (similarity === maxSim && paramCount > maxParamCount)
      ) {
        maxSim = similarity;
        maxParamCount = paramCount;
        bestCluster = cluster;
      }
    }

    return maxSim >= simTh ? bestCluster : null;
  }

  // ============================================================
  // Abstract methods (subclasses MUST implement)
  // ============================================================

  /**
   * Searches the prefix tree for the best-matching cluster.
   *
   * Python: Drain.tree_search(root_node, tokens, sim_th, include_params)
   */
  abstract treeSearch(
    rootNode: Node,
    tokens: readonly string[],
    simTh: number,
    includeParams: boolean,
  ): LogCluster | null;

  /**
   * Inserts a cluster into the prefix tree.
   *
   * Python: Drain.add_seq_to_prefix_tree(root_node, cluster)
   */
  abstract addSeqToPrefixTree(rootNode: Node, cluster: LogCluster): void;

  /**
   * Calculates similarity and parameter count between two token sequences.
   *
   * Python: Drain.get_seq_distance(seq1, seq2, include_params)
   */
  abstract getSeqDistance(
    seq1: readonly string[],
    seq2: readonly string[],
    includeParams: boolean,
  ): { similarity: number; paramCount: number };

  /**
   * Creates a merged template from two token sequences.
   *
   * Python: Drain.create_template(seq1, seq2)
   */
  abstract createTemplate(
    seq1: readonly string[],
    seq2: readonly string[],
  ): readonly string[];

  /**
   * Matches a log message against existing clusters (inference mode).
   * Does NOT create new clusters or modify templates.
   *
   * Python: Drain.match(content, full_search_strategy)
   */
  abstract match(
    content: string,
    fullSearchStrategy?: MatchStrategy,
  ): LogCluster | null;
}
