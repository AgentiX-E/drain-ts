import type { MaskingInstruction } from "./masker/MaskingInstruction.js";

/**
 * Configuration object for TemplateMiner.
 *
 * Maps 1:1 to Python `TemplateMinerConfig` class (drain3/template_miner.py)
 * and the drain3.ini file's [DRAIN], [MASKING], and [SNAPSHOT] sections.
 *
 * All properties have sensible defaults matching Drain3 v0.9.11.
 * Use `TemplateMinerConfig.from({...})` to override selectively.
 *
 * @example
 * ```typescript
 * const config = TemplateMinerConfig.from({
 *   simTh: 0.5,
 *   depth: 5,
 *   maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
 * });
 * ```
 */
export class TemplateMinerConfig {
  // ===================== [DRAIN] section =====================

  /** Similarity threshold for creating new clusters. Default: 0.4 */
  simTh: number = 0.4;

  /** Max depth of parse tree (minimum: 3). Default: 4 */
  depth: number = 4;

  /** Max child nodes per tree level. Default: 100 */
  maxChildren: number = 100;

  /**
   * Max clusters before LRU eviction begins.
   * `null` means unlimited. Default: null
   */
  maxClusters: number | null = null;

  /** Additional tokenization delimiters (beyond whitespace). */
  drainExtraDelimiters: readonly string[] = [];

  /** Whether tokens containing digits are treated as parameters. Default: true */
  parametrizeNumericTokens: boolean = true;

  // ===================== [MASKING] section =====================

  /** Masking instruction list. Empty by default — users opt in. */
  maskingInstructions: readonly MaskingInstruction[] = [];

  /** Left wrapper for masked parameters. Default: "<" */
  maskPrefix: string = "<";

  /** Right wrapper for masked parameters. Default: ">" */
  maskSuffix: string = ">";

  /** Capacity of the parameter extraction regex cache. Default: 100 */
  parameterExtractionCacheCapacity: number = 100;

  // ===================== [SNAPSHOT] section =====================

  /** Minutes between periodic snapshots. Default: 1 */
  snapshotIntervalMinutes: number = 1;

  /** Whether to gzip-compress snapshot state. Default: false */
  snapshotCompressState: boolean = false;

  // ===================== Profiling =====================

  /** Enable time profiling. Default: false */
  profilingEnabled: boolean = false;

  /** Profiling report interval in seconds. Default: 60 */
  profilingReportSec: number = 60;

  // ===================== Factory =====================

  /**
   * Creates a config from a partial override object.
   *
   * This is the idiomatic way to configure TemplateMiner in TypeScript,
   * replacing Python's configparser.ini file approach.
   *
   * @param partial - Subset of properties to override.
   * @returns A new TemplateMinerConfig with defaults applied.
   */
  static from(partial: Partial<TemplateMinerConfig>): TemplateMinerConfig {
    const config = new TemplateMinerConfig();
    // Only assign own properties to avoid prototype pollution
    for (const key of Object.keys(partial) as (keyof TemplateMinerConfig)[]) {
      const value = partial[key];
      if (value !== undefined) {
        (config as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return config;
  }
}
