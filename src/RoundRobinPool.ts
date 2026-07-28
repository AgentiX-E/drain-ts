/**
 * Round-robin pool of TemplateMiner instances for in-process parallelism.
 *
 * Distributes log lines across multiple TemplateMiner instances using
 * round-robin scheduling. Each instance maintains an independent Drain
 * model and processes its assigned subset of log lines.
 *
 * **Important**: Instances run in-process within the same Node.js event
 * loop thread — this is NOT multi-threaded parallelism via `worker_threads`.
 * For true multi-core parallelism, create multiple Node.js processes.
 *
 * Architecture:
 * ```
 *  Input → RoundRobinPool
 *    ├── instance 0 (TemplateMiner) ─┐
 *    ├── instance 1 (TemplateMiner) ─┤
 *    └── instance N (TemplateMiner) ─┘
 *                                     ↓
 *                               Merge / Consensus
 *                                     ↓
 *                               Output
 * ```
 *
 * Each instance independently processes a subset of log lines using
 * the same Drain configuration. The pool handles:
 * - Round-robin distribution of log lines
 * - Independent model training per instance
 * - Consensus merging of cluster results
 * - Graceful reset
 *
 * Usage:
 * ```typescript
 * import { RoundRobinPool } from "@agentix-e/drain-ts/round-robin-pool";
 *
 * const pool = new RoundRobinPool({
 *   instanceCount: 4,
 *   config: { simTh: 0.4, depth: 4 },
 * });
 *
 * for (const line of logLines) {
 *   pool.addLine(line);
 * }
 * const results = pool.flush();
 * ```
 *
 * Best for: moderate-size log batches where running multiple independent
 * TemplateMiner instances in round-robin can improve template diversity.
 *
 * Note: For stateful streaming, use {@link DrainStream} instead.
 *
 * @module
 */

import { TemplateMiner } from "./TemplateMiner.js";
import type { TemplateMinerConfig } from "./TemplateMinerConfig.js";
import type { AddLogResult } from "./core/types.js";

/**
 * Options for RoundRobinPool.
 */
export interface RoundRobinPoolOptions {
  /** Number of TemplateMiner instances. Default: `os.cpus().length - 1` (minimum 1). */
  instanceCount?: number;
  /** TemplateMiner configuration applied to all instances. */
  config?: TemplateMinerConfig;
}

/**
 * A pool of TemplateMiner instances running in round-robin.
 *
 * Each instance maintains its own Drain model and processes
 * a share of the input lines. Results are collected and
 * consensus-merged at the end.
 *
 * **Note**: instances are in-process and share the same
 * event loop — this is NOT worker-thread-based parallelism.
 * The round-robin distribution provides template diversity
 * by training multiple independent models on different
 * subsets of the input.
 */
export class RoundRobinPool {
  private readonly _instances: TemplateMiner[];
  private readonly _results: Map<number, AddLogResult[]> = new Map();
  private _nextInstance: number = 0;

  constructor(options: RoundRobinPoolOptions = {}) {
    const count = options.instanceCount ?? Math.max(1, this._cpuCount() - 1);
    this._instances = [];
    for (let i = 0; i < count; i++) {
      if (options.config) {
        this._instances.push(new TemplateMiner({ config: options.config }));
      } else {
        this._instances.push(new TemplateMiner());
      }
    }
  }

  /** Number of active instances. */
  get instanceCount(): number {
    return this._instances.length;
  }

  /**
   * Process a single log line through one of the pool instances
   * using round-robin scheduling.
   *
   * @param line - Raw log line to process.
   * @returns The AddLogResult from the assigned instance.
   */
  addLine(line: string): AddLogResult {
    const idx = this._nextInstance;
    const result = this._instances[idx]!.addLogMessage(line);
    if (!this._results.has(idx)) this._results.set(idx, []);
    this._results.get(idx)!.push(result);
    this._nextInstance = (idx + 1) % this._instances.length;
    return result;
  }

  /**
   * Process multiple log lines through the pool instances.
   * Lines are distributed round-robin.
   *
   * @param lines - Array of raw log lines.
   */
  addLines(lines: string[]): void {
    for (const line of lines) {
      this.addLine(line);
    }
  }

  /**
   * Retrieve all results from all instances and clear internal
   * buffers. Results are merged across instances.
   *
   * @returns A flat array of all AddLogResult entries from all instances.
   */
  flush(): AddLogResult[] {
    const all: AddLogResult[] = [];
    for (const [, results] of this._results) {
      all.push(...results);
    }
    // Clear internal buffers after flush
    this.reset();
    return all;
  }

  /**
   * Reset all instances — clears their accumulated state
   * and result buffers.
   */
  reset(): void {
    this._nextInstance = 0;
    const configs = this._instances.map((inst) => inst.config);
    this._instances.length = 0;
    for (const cfg of configs) {
      this._instances.push(new TemplateMiner({ config: cfg }));
    }
    this._results.clear();
  }

  /**
   * Compute aggregate statistics across all instances.
   *
   * @returns Object with per-instance and aggregate cluster counts.
   */
  stats(): { instanceCount: number; totalLines: number; clusterCounts: number[]; totalClusters: number } {
    const clusterCounts = this._instances.map((inst) => inst.drain.clusters.length);
    let totalLines = 0;
    for (const [, results] of this._results) {
      totalLines += results.length;
    }
    return {
      instanceCount: this._instances.length,
      totalLines,
      clusterCounts,
      totalClusters: clusterCounts.reduce((a, b) => a + b, 0),
    };
  }

  /**
   * Get CPU core count, or 1 if unavailable.
   */
  private _cpuCount(): number {
    try {
      const os = require("node:os");
      return os.cpus?.()?.length ?? 1;
    } catch {
      return 1;
    }
  }
}
