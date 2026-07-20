/**
 * Core type definitions for drain-ts.
 *
 * Maps 1:1 to the Python Drain3 type system.
 * References: drain3/drain.py, drain3/template_miner.py
 *
 * @packageDocumentation
 */

// ============================================================
// Change Type — maps to Drain3 "cluster_created" / "cluster_template_changed" / "none"
// ============================================================

/** Event type emitted after processing a log message. */
export const ChangeType = {
  /** A new cluster was created for this log message. */
  ClusterCreated: "cluster_created",
  /** An existing cluster's template was updated to accommodate this log message. */
  ClusterTemplateChanged: "cluster_template_changed",
  /** The log message matched an existing cluster without any template changes. */
  None: "none",
} as const;

export type ChangeType = (typeof ChangeType)[keyof typeof ChangeType];

// ============================================================
// Match Strategy — maps to Drain3 full_search_strategy parameter
// ============================================================

/** Search strategy for inference-mode matching (`match()`). */
export const MatchStrategy = {
  /** Use tree search only. Fastest, but may miss matches (false negatives). */
  Never: "never",
  /** Tree search first, fall back to full linear search on miss. Balanced. */
  Fallback: "fallback",
  /** Always perform full linear search across all same-length clusters. Most accurate. */
  Always: "always",
} as const;

export type MatchStrategy = (typeof MatchStrategy)[keyof typeof MatchStrategy];

// ============================================================
// AddLogResult — maps to Drain3 add_log_message() return dict
// ============================================================

/** Result returned by `TemplateMiner.addLogMessage()`. */
export interface AddLogResult {
  /** What changed as a result of processing this message. */
  readonly changeType: ChangeType;
  /** The ID of the cluster this message was assigned to. */
  readonly clusterId: number;
  /** Number of messages in the assigned cluster after processing. */
  readonly clusterSize: number;
  /** The current template string of the assigned cluster. */
  readonly templateMined: string;
  /** Total number of clusters across the entire model. */
  readonly clusterCount: number;
}

// ============================================================
// ExtractedParameter — maps to Drain3 ExtractedParameter NamedTuple
// ============================================================

/** A single extracted parameter from a log message. */
export interface ExtractedParameter {
  /** The actual value extracted from the log message. */
  readonly value: string;
  /** The mask name this parameter corresponds to (e.g. "IP", "NUM", "*"). */
  readonly maskName: string;
}

// ============================================================
// DrainSnapshot — maps to Drain3 jsonpickle snapshot format
// ============================================================

/** A single cluster in a serialized snapshot. */
export interface DrainSnapshotCluster {
  readonly cluster_id: number;
  readonly log_template_tokens: readonly string[];
  readonly size: number;
}

/** The top-level snapshot format for state persistence. */
export interface DrainSnapshot {
  /** Version of drain-ts that produced this snapshot. Used for compatibility checks. */
  readonly version: string;
  /** If the snapshot originated from Python Drain3, records its version. */
  readonly drain3_version?: string;
  /** All clusters in the saved state. */
  readonly clusters: readonly DrainSnapshotCluster[];
}

// ============================================================
// DrainOptions — maps to Drain3 Drain/DrainBase constructor parameters
// ============================================================

/** Configuration options for the Drain engine constructor. */
export interface DrainOptions {
  /** Maximum depth of the parse tree (minimum: 3). Default: 4. */
  readonly depth?: number;
  /** Similarity threshold for creating new clusters. Default: 0.4. */
  readonly simTh?: number;
  /** Maximum child nodes per tree level. Default: 100. */
  readonly maxChildren?: number;
  /** Maximum number of clusters (LRU eviction). null = unlimited. Default: null. */
  readonly maxClusters?: number | null;
  /** Additional delimiters for tokenization beyond whitespace. */
  readonly extraDelimiters?: readonly string[];
  /** String used to replace parameters in templates. Default: "<*>". */
  readonly paramStr?: string;
  /** Whether tokens containing digits should be treated as parameters. Default: true. */
  readonly parametrizeNumericTokens?: boolean;
}
