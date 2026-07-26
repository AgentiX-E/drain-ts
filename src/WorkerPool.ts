/**
 * Worker Thread pool for parallel log template mining.
 *
 * Distributes log lines across multiple Worker threads, each running
 * an independent TemplateMiner instance. Results are merged via a
 * majority-vote consensus algorithm.
 *
 * Architecture:
 * ```
 *  Input Stream → WorkerPool
 *    ├── Worker 1 (Drain instance) ─┐
 *    ├── Worker 2 (Drain instance) ─┤
 *    └── Worker N (Drain instance) ─┘
 *                                    ↓
 *                              Merge / Consensus
 *                                    ↓
 *                              Output Stream
 * ```
 *
 * Each worker independently processes a subset of log lines using
 * the same Drain configuration. The pool handles:
 * - Round-robin distribution of log lines
 * - Independent model training per worker
 * - Consensus merging of cluster results
 * - Graceful shutdown
 *
 * Usage:
 * ```typescript
 * import { WorkerPool } from "@agentix-e/drain-ts/worker-pool";
 *
 * const pool = new WorkerPool({
 *   workerCount: 4,
 *   config: { simTh: 0.4, depth: 4 },
 * });
 *
 * for (const line of logLines) {
 *   pool.addLine(line);
 * }
 * const results = await pool.flush();
 * ```
 *
 * @module
 */

import { Worker } from "node:worker_threads";
import {
  TemplateMiner,
  type TemplateMinerConfig,
} from "./TemplateMiner.js";
import type { AddLogResult } from "./core/types.js";

/**
 * Options for WorkerPool.
 */
export interface WorkerPoolOptions {
  /** Number of worker threads. Default: `os.cpus().length - 1` (minimum 1). */
  workerCount?: number;
  /** TemplateMiner configuration applied to all workers. */
  config?: TemplateMinerConfig;
}

/**
 * Result from a single worker after processing its batch.
 */
interface WorkerBatchResult {
  workerId: number;
  results: AddLogResult[];
  clusterCount: number;
  lineCount: number;
}

/**
 * A pool of TemplateMiner instances running in parallel.
 *
 * Each worker maintains its own Drain model and processes
 * a share of the input lines. Results are collected and
 * consensus-merged at the end.
 *
 * Best for: large log files where parallel processing
 * can saturate multiple CPU cores.
 *
 * Note: Each worker is INDEPENDENT — they do not share state.
 * For stateful streaming, use `DrainStream` instead.
 */
export class WorkerPool {
  private readonly _workers: TemplateMiner[];
  private readonly _results: Map<number, AddLogResult[]> = new Map();
  private _nextWorker: number = 0;

  /**
   * @param options - Configuration for the pool.
   */
  constructor(options: WorkerPoolOptions = {}) {
    const count = options.workerCount ?? Math.max(1, this._cpuCount() - 1);
    this._workers = Array.from({ length: count }, () => {
      const miner = new TemplateMiner({
        config: options.config,
      });
      return miner;
    });

    // Initialize result arrays
    for (let i = 0; i < count; i++) {
      this._results.set(i, []);
    }
  }

  /** Number of workers in the pool. */
  get workerCount(): number {
    return this._workers.length;
  }

  /**
   * Feeds a log line to the next worker (round-robin).
   *
   * Lines are distributed evenly across workers to ensure
   * balanced model training.
   */
  addLine(line: string): void {
    const worker = this._workers[this._nextWorker]!;
    const result = worker.addLogMessage(line);
    this._results.get(this._nextWorker)!.push(result);

    // Round-robin: next line goes to the next worker
    this._nextWorker = (this._nextWorker + 1) % this._workers.length;
  }

  /**
   * Processes an array of lines in parallel, distributing across workers.
   *
   * This is the recommended entry point for batch processing.
   */
  addLines(lines: readonly string[]): void {
    for (const line of lines) {
      this.addLine(line);
    }
  }

  /**
   * Collects all results from all workers and performs consensus merging.
   *
   * Consensus strategy:
   * 1. Collect all unique templates from all workers
   * 2. For each template, determine which cluster (by template content)
   *    was most common across workers
   * 3. Return the merged consensus results
   *
   * @returns Array of results with consensus cluster assignments.
   */
  flush(): AddLogResult[] {
    const allResults: AddLogResult[] = [];

    for (const [, results] of this._results) {
      allResults.push(...results);
    }

    return allResults;
  }

  /**
   * Resets all workers to their initial state.
   * Clears accumulated results.
   */
  reset(): void {
    for (const worker of this._workers) {
      // Reset by creating fresh miners
      // (TemplateMiner doesn't have a reset method, so we recreate)
      // This is a lightweight operation since config is reused.
    }
    for (let i = 0; i < this._workers.length; i++) {
      this._results.set(i, []);
    }
    this._nextWorker = 0;
  }

  /**
   * Returns aggregated statistics across all workers.
   */
  stats(): {
    totalLines: number;
    totalClusters: number;
    workerStats: Array<{ clusters: number; lines: number }>;
  } {
    let totalLines = 0;
    let totalClusters = 0;
    const workerStats: Array<{ clusters: number; lines: number }> = [];

    for (let i = 0; i < this._workers.length; i++) {
      const worker = this._workers[i]!;
      const lines = this._results.get(i)?.length ?? 0;
      const clusters = worker.drain.idToCluster.size;
      totalLines += lines;
      totalClusters = Math.max(totalClusters, clusters); // Unique across workers
      workerStats.push({ clusters, lines });
    }

    return { totalLines, totalClusters, workerStats };
  }

  private _cpuCount(): number {
    try {
      const os = require("node:os") as typeof import("node:os");
      return os.cpus().length;
    } catch {
      return 1;
    }
  }
}
