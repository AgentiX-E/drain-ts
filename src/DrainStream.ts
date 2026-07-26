/**
 * Streaming log template miner — Node.js Transform stream wrapper.
 *
 * Extends TemplateMiner with a `Transform` stream interface for processing
 * large log files, stdin, or HTTP response streams in real time.
 *
 * Features:
 * - Backpressure-aware: respects downstream consumer speed
 * - Line-delimited: splits input on newlines
 * - JSON output: each chunk is a JSON object with template + metadata
 * - Inherits all TemplateMiner capabilities (masking, persistence, profiling)
 *
 * Usage:
 * ```typescript
 * import { DrainStream } from "@agentix-e/drain-ts/stream";
 * import { createReadStream } from "node:fs";
 *
 * createReadStream("app.log")
 *   .pipe(new DrainStream())
 *   .on("data", (result) => console.log(result.templateMined));
 * ```
 *
 * @module
 */

import { Transform, type TransformCallback } from "node:stream";
import {
  TemplateMiner,
  type TemplateMinerConfig,
} from "./TemplateMiner.js";
import type { PersistenceHandler } from "./persistence/PersistenceHandler.js";
import type { AddLogResult } from "./core/types.js";

/**
 * Options for `DrainStream`.
 */
export interface DrainStreamOptions {
  /** TemplateMiner configuration (defaults used if omitted). */
  config?: TemplateMinerConfig;
  /** Optional persistence handler. */
  persistenceHandler?: PersistenceHandler | null;
  /** Whether to emit JSON objects (default) or strings. */
  objectMode?: boolean;
}

/**
 * A Node.js Transform stream that processes log lines through Drain
 * and outputs structured results.
 *
 * Each input chunk is treated as one or more log lines (split on `\n`).
 * Each output chunk is a JSON-serializable `AddLogResult` object
 * (in objectMode) or a JSON string.
 *
 * The stream handles backpressure naturally through Node.js stream
 * mechanics — it won't read more input until the consumer is ready.
 *
 * @example
 * ```typescript
 * // Pipe a log file through DrainStream
 * import { createReadStream, createWriteStream } from "node:fs";
 * import { DrainStream } from "@agentix-e/drain-ts/stream";
 *
 * const stream = new DrainStream({
 *   config: TemplateMinerConfig.from({ simTh: 0.5 }),
 * });
 *
 * createReadStream("huge.log")
 *   .pipe(new SplitStream()) // optional: chunk into lines
 *   .pipe(stream)
 *   .pipe(createWriteStream("templates.jsonl"));
 * ```
 */
export class DrainStream extends Transform {
  private readonly _miner: TemplateMiner;
  private _buffer: string = "";
  private _lineCount: number = 0;

  /**
   * Creates a DrainStream.
   *
   * @param options - Configuration for the underlying TemplateMiner.
   */
  constructor(options: DrainStreamOptions = {}) {
    super({
      readableObjectMode: options.objectMode !== false,
      writableObjectMode: false, // always accept Buffer/string input
    });

    this._miner = new TemplateMiner({
      config: options.config,
      persistenceHandler: options.persistenceHandler ?? null,
    });
  }

  /**
   * Access the underlying TemplateMiner for direct API calls
   * (e.g., `match()`, `extractParameters()`).
   */
  get miner(): TemplateMiner {
    return this._miner;
  }

  /**
   * Total log lines processed so far.
   */
  get lineCount(): number {
    return this._lineCount;
  }

  /**
   * Current cluster count in the model.
   */
  get clusterCount(): number {
    return this._miner.drain.idToCluster.size;
  }

  // ============================================================
  // Transform implementation
  // ============================================================

  _transform(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      this._buffer += data;

      // Process complete lines
      const lines = this._buffer.split("\n");
      // Last element may be incomplete — keep in buffer
      this._buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue; // skip empty lines

        const result = this._miner.addLogMessage(trimmed);
        this._lineCount++;
        this.push(result);
      }

      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  _flush(callback: TransformCallback): void {
    try {
      // Process any remaining partial line
      const trimmed = this._buffer.trim();
      if (trimmed) {
        const result = this._miner.addLogMessage(trimmed);
        this._lineCount++;
        this.push(result);
      }
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

/**
 * Convenience: creates a DrainStream from a config and optional persistence.
 *
 * Equivalent to `new DrainStream({ config, persistenceHandler })`.
 */
export function createDrainStream(
  config?: TemplateMinerConfig,
  persistenceHandler?: PersistenceHandler | null,
): DrainStream {
  return new DrainStream({ config, persistenceHandler });
}
