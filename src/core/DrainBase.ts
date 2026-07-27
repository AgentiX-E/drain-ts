import { Node } from "./Node.js";
import { LogCluster } from "./LogCluster.js";
import { LogClusterCache } from "./LogClusterCache.js";
import { ChangeType, type MatchStrategy } from "./types.js";
import type { DrainOptions } from "./types.js";
import type { TemplatePatternStrategyChain } from "./TemplatePatternStrategy.js";
import {
  AffixPreservingStrategy,
  ExactMatchStrategy,
  FullTokenParameterizationStrategy,
  RegexParameterizationStrategy,
  TemplatePatternStrategyChain as StrategyChain,
} from "./TemplatePatternStrategy.js";

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

  /** Strategy chain for template token parameterization. */
  readonly strategyChain: TemplatePatternStrategyChain;

  /** Whether to use (token_count, param_count) as compound root key. */
  readonly enableParamBinning: boolean;

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
    templatePatternStrategies,
    enableAffixPreserving = false,
    minAffixLength = 2,
    customRegexPatterns = [],
    enableParamBinning = false,
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
    this.enableParamBinning = enableParamBinning;

    // Build strategy chain for template parameterization
    this.strategyChain = this.buildStrategyChain({
      ...(templatePatternStrategies !== undefined
        ? { templatePatternStrategies }
        : {}),
      enableAffixPreserving,
      minAffixLength,
      customRegexPatterns,
    });

    // Python: {} if max_clusters is None else LogClusterCache(maxsize=max_clusters)
    this.idToCluster =
      maxClusters === null ? new Map() : new LogClusterCache(maxClusters);
  }

  /**
   * Builds the template pattern strategy chain from options.
   *
   * Priority order:
   * 1. Custom strategies (if provided) — use as-is
   * 2. Built from options: Exact → [Regex] → [AffixPreserving] → FullToken
   *
   * Subclasses can override to customize chain construction.
   */
  protected buildStrategyChain(options: {
    templatePatternStrategies?: readonly import("./TemplatePatternStrategy.js").TemplatePatternStrategy[];
    enableAffixPreserving: boolean;
    minAffixLength: number;
    customRegexPatterns: ReadonlyArray<{
      readonly regex: RegExp;
      readonly template: string;
      readonly confidence?: number;
    }>;
  }): TemplatePatternStrategyChain {
    // If custom strategies provided, use them directly
    if (options.templatePatternStrategies) {
      return new StrategyChain().registerAll(
        options.templatePatternStrategies,
      );
    }

    // Build from configuration options
    const chain = new StrategyChain();

    // Always register exact match (highest priority)
    chain.register(new ExactMatchStrategy());

    // Register regex patterns if provided
    if (options.customRegexPatterns.length > 0) {
      chain.register(
        new RegexParameterizationStrategy(options.customRegexPatterns),
      );
    }

    // Register affix-preserving if enabled
    if (options.enableAffixPreserving) {
      chain.register(new AffixPreservingStrategy(options.minAffixLength));
    }

    // Always register full-token fallback (lowest priority)
    chain.register(new FullTokenParameterizationStrategy());

    return chain;
  }

  // ============================================================
  // Properties
  // ============================================================

  /** All current clusters. Python: DrainBase.clusters property */
  get clusters(): LogCluster[] {
    return [...this.idToCluster.values()];
  }

  /**
   * Counts parameter tokens (masked values) in a token sequence.
   *
   * A param token matches the mask pattern: starts with "<" and
   * ends with ">" without being the paramStr placeholder itself.
   */
  protected countParamTokens(tokens: readonly string[]): number {
    let count = 0;
    for (const token of tokens) {
      if (token.startsWith("<") && token.endsWith(">")) {
        count++;
      }
    }
    return count;
  }

  /**
   * Computes the root-level tree key for a token sequence.
   *
   * When enableParamBinning is true, uses compound key
   * "{token_count}#{param_count}" for AEL-style binning.
   * Otherwise uses simple "{token_count}" (Drain3-compatible).
   */
  protected getRootKey(tokens: readonly string[]): string {
    const tc = tokens.length;
    if (!this.enableParamBinning) {
      return String(tc);
    }
    const pc = this.countParamTokens(tokens);
    return `${tc}#${pc}`;
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
    return this._getClustersIdsForRootKey(String(seqLen));
  }

  /**
   * Returns all cluster IDs for a given root-level tree key.
   *
   * Used by JaccardDrain which indexes by first token (string)
   * instead of token count (number).
   *
   * Recursively traverses the subtree rooted at the matching node.
   */
  getClustersIdsForFirstToken(firstToken: string): number[] {
    return this._getClustersIdsForRootKey(firstToken);
  }

  /**
   * Internal: collects cluster IDs from a subtree rooted at a given key.
   */
  protected _getClustersIdsForRootKey(key: string): number[] {
    const curNode = this.rootNode.keyToChildNode.get(key);
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
  // addLogMessage — concrete method shared by Drain and JaccardDrain
  // (maps to Python DrainBase.add_log_message, drain.py L136-L176)
  // ============================================================

  /**
   * Processes a single log message through the Drain algorithm.
   *
   * This is the primary entry point for training mode. Each call updates
   * the internal state — either by creating a new cluster, updating an
   * existing template, or incrementing a cluster's count.
   *
   * Python: DrainBase.add_log_message(content) → Tuple[LogCluster, str]
   *
   * Processing flow (identical to Python):
   * 1. Tokenize → getContentAsTokens
   * 2. Tree search → treeSearch(includeParams=false)
   * 3a. No match → create new cluster → changeType = "cluster_created"
   * 3b. Match found → merge templates → "cluster_template_changed" or "none"
   * 4. Return (cluster, changeType)
   *
   * @param content - The raw log message to process.
   * @returns The assigned cluster and the type of change that occurred.
   */
  addLogMessage(content: string): {
    cluster: LogCluster;
    changeType: typeof ChangeType[keyof typeof ChangeType];
  } {
    const contentTokens = this.getContentAsTokens(content);

    // Phase 1: Tree search
    let matchCluster = this.treeSearch(
      this.rootNode,
      contentTokens,
      this.simTh,
      false,
    );

    let changeType: typeof ChangeType[keyof typeof ChangeType];

    if (matchCluster === null) {
      // Phase 2: Create new cluster
      this.clustersCounter += 1;
      const clusterId = this.clustersCounter;

      matchCluster = new LogCluster(contentTokens, clusterId);
      this.idToCluster.set(clusterId, matchCluster);
      this.addSeqToPrefixTree(this.rootNode, matchCluster);

      changeType = ChangeType.ClusterCreated;
    } else {
      // Phase 3: Update existing cluster
      const newTemplateTokens = this.createTemplate(
        contentTokens,
        matchCluster.logTemplateTokens,
      );

      if (
        newTemplateTokens.length === matchCluster.logTemplateTokens.length &&
        newTemplateTokens.every(
          (t, i) => t === matchCluster!.logTemplateTokens[i],
        )
      ) {
        changeType = ChangeType.None;
      } else {
        matchCluster.logTemplateTokens = newTemplateTokens;
        changeType = ChangeType.ClusterTemplateChanged;
      }

      matchCluster.size += 1;

      // Trigger LRU access record update
      if (this.idToCluster instanceof LogClusterCache) {
        this.idToCluster.touch(matchCluster.clusterId);
      }
    }

    return { cluster: matchCluster, changeType };
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
