import { Drain } from "./core/Drain.js";
import { LogCluster } from "./core/LogCluster.js";
import { LogMasker } from "./masker/LogMasker.js";
import { TemplateMinerConfig } from "./TemplateMinerConfig.js";
import {
  ChangeType,
  type AddLogResult,
  type MatchStrategy,
} from "./core/types.js";
import type { LogCluster as ILogCluster } from "./core/LogCluster.js";

/**
 * Snapshot reason types — internal, not exported.
 * Maps to Python TemplateMiner's snapshot trigger logic.
 */
type SnapshotReasonPayload = string;

/**
 * Persistence handler interface.
 *
 * Framework-agnostic: drain-ts defines the contract, users provide the
 * implementation (file, Redis, Kafka, S3, etc.).
 *
 * Built-in zero-dependency implementations:
 * - FilePersistence (node:fs)
 * - MemoryPersistence (in-memory Buffer)
 *
 * All methods accept Uint8Array (Web standard) rather than Buffer
 * (Node-specific) for cross-runtime compatibility.
 *
 * @public
 */
export interface PersistenceHandler {
  /**
   * Persists the serialized state.
   * @param state - UTF-8 encoded JSON snapshot.
   * @returns void or Promise<void> for sync/async support.
   */
  saveState(state: Uint8Array): void | Promise<void>;

  /**
   * Loads previously persisted state.
   * @returns The state bytes, or null if nothing is stored.
   */
  loadState(): Uint8Array | null | Promise<Uint8Array | null>;
}

// ============================================================
// Helpers
// ============================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ============================================================
// TemplateMiner
// ============================================================

/**
 * Main user-facing facade for log template mining.
 *
 * Maps 1:1 to Python `TemplateMiner` class (drain3/template_miner.py).
 *
 * TemplateMiner integrates the Drain clustering engine with the masking
 * preprocessor and optional persistence. It is the single entry point
 * that users should instantiate.
 *
 * Usage:
 * ```typescript
 * const miner = new TemplateMiner({
 *   config: TemplateMinerConfig.from({ simTh: 0.5 }),
 * });
 *
 * const result = miner.addLogMessage("user alice logged in from 192.168.1.1");
 * console.log(result.templateMined); // "user alice logged in from <IP>"
 * ```
 */
export class TemplateMiner {
  /** Configuration snapshot. */
  readonly config: TemplateMinerConfig;

  /** The Drain clustering engine. */
  readonly drain: Drain;

  /** The log masking preprocessor. */
  readonly masker: LogMasker;

  /** Optional persistence handler for state save/load. */
  private readonly _persistence: PersistenceHandler | null;

  /** Timestamp (seconds) of the last snapshot save. Initialized to now to prevent immediate periodic save. */
  private _lastSnapshotTimestamp: number = Date.now() / 1000;

  /**
   * Creates a TemplateMiner.
   *
   * @param options.config - Configuration object (defaults used if omitted).
   * @param options.persistenceHandler - Optional persistence backend.
   */
  constructor({
    config = new TemplateMinerConfig(),
    persistenceHandler = null,
  }: {
    config?: TemplateMinerConfig;
    persistenceHandler?: PersistenceHandler | null;
  } = {}) {
    this.config = config;
    this._persistence = persistenceHandler;

    // Build paramStr from mask prefix/suffix: "<*>" by default
    const paramStr = `${config.maskPrefix}*${config.maskSuffix}`;

    // Create the Drain engine
    this.drain = new Drain({
      depth: config.depth,
      simTh: config.simTh,
      maxChildren: config.maxChildren,
      maxClusters: config.maxClusters,
      extraDelimiters: config.drainExtraDelimiters,
      paramStr,
      parametrizeNumericTokens: config.parametrizeNumericTokens,
    });

    // Create the masker with the configured instructions
    this.masker = new LogMasker(
      config.maskingInstructions,
      config.maskPrefix,
      config.maskSuffix,
    );

    // Restore state from persistence if available
    if (this._persistence) {
      this._loadState();
    }
  }

  // ============================================================
  // addLogMessage — maps to Python TemplateMiner.add_log_message()
  // ============================================================

  /**
   * Processes a log message (training mode).
   *
   * The message is first masked, then passed to the Drain engine for
   * clustering. State may be persisted if a PersistenceHandler is
   * configured and a snapshot trigger condition is met.
   *
   * Python: TemplateMiner.add_log_message(log_message) → dict
   *
   * @param logMessage - The raw log line to process.
   * @returns Result with change type, cluster info, and template.
   */
  addLogMessage(logMessage: string): AddLogResult {
    // Phase 1: Mask
    const maskedContent = this.masker.mask(logMessage);

    // Phase 2: Cluster
    const { cluster, changeType } = this.drain.addLogMessage(maskedContent);

    // Phase 3: Conditional persistence
    const snapshotReason = this._getSnapshotReason(
      changeType,
      cluster.clusterId,
    );
    if (snapshotReason !== null) {
      this._saveState(snapshotReason);
    }

    return {
      changeType,
      clusterId: cluster.clusterId,
      clusterSize: cluster.size,
      templateMined: cluster.getTemplate(),
      clusterCount: this.drain.idToCluster.size,
    };
  }

  // ============================================================
  // match — maps to Python TemplateMiner.match()
  // ============================================================

  /**
   * Matches a log message against existing clusters (inference mode).
   *
   * Unlike `addLogMessage`, this does NOT create new clusters or modify
   * templates. The message is masked first, then matched against the
   * existing cluster set.
   *
   * Python: TemplateMiner.match(log_message, full_search_strategy) → LogCluster | None
   *
   * @param logMessage - The raw log line to classify.
   * @param fullSearchStrategy - Search strategy ("never" | "fallback" | "always").
   * @returns The matching LogCluster, or null if no match.
   */
  match(
    logMessage: string,
    fullSearchStrategy: MatchStrategy = "never" as MatchStrategy,
  ): ILogCluster | null {
    const maskedContent = this.masker.mask(logMessage);
    return this.drain.match(maskedContent, fullSearchStrategy);
  }

  // ============================================================
  // Persistence — maps to Python TemplateMiner.save_state/load_state
  // ============================================================

  /**
   * Saves the current clustering state via the configured PersistenceHandler.
   *
   * Python: TemplateMiner.save_state(snapshot_reason)
   */
  private _saveState(snapshotReason: SnapshotReasonPayload): void {
    if (!this._persistence) return;

    const snapshot = {
      version: "0.1.0",
      clusters: [...this.drain.idToCluster.values()].map((c) => ({
        cluster_id: c.clusterId,
        log_template_tokens: c.logTemplateTokens,
        size: c.size,
      })),
    };

    const json = JSON.stringify(snapshot);
    const state = encoder.encode(json);

    const result = this._persistence.saveState(state);
    // Handle async persistence handlers
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        // Silently ignore persistence errors in sync flow —
        // the clustering result is still valid.
        console.error(
          `[drain-ts] Failed to save state (${snapshotReason}):`,
          err,
        );
      });
    }
  }

  /**
   * Loads state from the configured PersistenceHandler.
   *
   * Python: TemplateMiner.load_state()
   *
   * Restores clusters from a previously saved snapshot. The prefix tree
   * is rebuilt from the loaded clusters. Configuration parameters are NOT
   * restored (matching Drain3 v0.9.8 behavior).
   */
  private _loadState(): void {
    if (!this._persistence) return;

    const loadResult = this._persistence.loadState();

    const doLoad = (stateBuffer: Uint8Array | null): void => {
      if (!stateBuffer || stateBuffer.length === 0) return;

      const json = decoder.decode(stateBuffer);
      const snapshot = JSON.parse(json);

      if (!snapshot.clusters || !Array.isArray(snapshot.clusters)) return;

      // Clear existing state
      this.drain.idToCluster.clear();
      let maxClusterId = 0;

      for (const c of snapshot.clusters) {
        const cluster = new LogCluster(
          c.log_template_tokens,
          c.cluster_id,
        );
        cluster.size = c.size;
        this.drain.idToCluster.set(c.cluster_id, cluster);
        this.drain.addSeqToPrefixTree(this.drain.rootNode, cluster);

        if (c.cluster_id > maxClusterId) {
          maxClusterId = c.cluster_id;
        }
      }

      this.drain.clustersCounter = maxClusterId;
    };

    if (loadResult instanceof Promise) {
      loadResult
        .then(doLoad)
        .catch((err: unknown) => {
          console.error("[drain-ts] Failed to load state:", err);
        });
    } else {
      doLoad(loadResult);
    }
  }

  // ============================================================
  // Snapshot trigger logic — maps to Python get_snapshot_reason()
  // ============================================================

  /**
   * Determines whether a snapshot should be saved after processing a message.
   *
   * Python: TemplateMiner.get_snapshot_reason(change_type, cluster_id)
   *
   * Triggers:
   * - Any non-"none" change type — always saves
   * - Periodic save — if snapshot_interval_minutes have elapsed since last save
   *
   * @returns A reason string to pass to saveState, or null to skip.
   */
  private _getSnapshotReason(
    changeType: typeof ChangeType[keyof typeof ChangeType],
    _clusterId: number,
  ): SnapshotReasonPayload | null {
    // Python: if change_type != "none": return f"{change_type} ({cluster_id})"
    if (changeType !== ChangeType.None) {
      return `${changeType} (${_clusterId})`;
    }

    // Python: periodic save
    const now = Date.now() / 1000;
    const elapsed = now - this._lastSnapshotTimestamp;
    if (elapsed >= this.config.snapshotIntervalMinutes * 60) {
      this._lastSnapshotTimestamp = now;
      return "periodic";
    }

    return null;
  }
}
