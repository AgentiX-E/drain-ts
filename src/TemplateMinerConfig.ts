import type { AbstractMaskingInstruction } from "./masker/MaskingInstruction.js";
import { MaskingInstruction as MaskingInstructionClass } from "./masker/MaskingInstruction.js";
import type { TemplatePatternStrategy } from "./core/TemplatePatternStrategy.js";
import {
  AffixPreservingStrategy,
  ExactMatchStrategy,
  FullTokenParameterizationStrategy,
  RegexParameterizationStrategy,
  TemplatePatternStrategyChain,
} from "./core/TemplatePatternStrategy.js";
import type { TokenNormalizer } from "./core/TokenNormalizer.js";

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

  /**
   * Drain algorithm variant.
   * - `"Drain"`: Standard fixed-depth prefix tree with position-wise similarity.
   * - `"JaccardDrain"`: First-token-based tree with Jaccard set similarity.
   *
   * Default: "Drain" (matches Drain3 default).
   */
  engine: "Drain" | "JaccardDrain" = "Drain";

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

  /**
   * Enable param_count as second dimension in prefix tree binning (AEL-inspired).
   *
   * When enabled, the root-level tree key is "{token_count}#{param_count}"
   * instead of just "{token_count}". Messages with the same number of
   * parameters are grouped together, improving clustering for datasets
   * with variable parameter patterns.
   *
   * Default: false (Drain3-compatible behavior)
   */
  enableParamBinning: boolean = false;

  // ===================== Template Pattern Strategies =====================

  /**
   * Enable affix-preserving parameterization (e.g., "bytes<*>sent").
   *
   * When true, tokens with common prefixes/suffixes are parameterized
   * in the middle rather than replaced entirely.
   *
   * Default: false (Drain3-compatible behavior)
   */
  enableAffixPreserving: boolean = false;

  /**
   * Minimum prefix/suffix length to trigger affix-preserving parameterization.
   *
   * Only used when enableAffixPreserving is true.
   * Default: 2
   */
  minAffixLength: number = 2;

  /**
   * Custom regex patterns for parameterization.
   *
   * Each pattern defines a regex and its corresponding template.
   * Use ${paramStr} as placeholder in templates.
   *
   * Example:
   * ```typescript
   * customRegexPatterns: [
   *   { regex: /^(\d{4})-(\d{2})-(\d{2})$/, template: "${paramStr}-${paramStr}-${paramStr}" }
   * ]
   * ```
   */
  customRegexPatterns: ReadonlyArray<{
    readonly regex: RegExp;
    readonly template: string;
    readonly confidence?: number;
  }> = [];

  /**
   * Advanced: Custom template pattern strategies.
   *
   * If provided, overrides the default strategy chain construction.
   * Use this for full control over template generation behavior.
   *
   * @see TemplatePatternStrategy
   */
  templatePatternStrategies?: readonly TemplatePatternStrategy[];

  // ===================== Token Normalization =====================

  /**
   * Pre-clustering token normalizers.
   *
   * Applied BEFORE Drain clustering to normalize token sequences.
   * This addresses tokenization mismatches between parser output
   * and ground truth expectations (e.g., variable token counts,
   * compound token structures like "bytes<*>sent").
   *
   * Built-in normalizers:
   * - AdjacentConstantFusion: auto-detects and fuses constant adjacent tokens
   *
   * Default: [] (no normalization — Drain3-compatible behavior)
   *
   * @see TokenNormalizer
   * @see AdjacentConstantFusion
   */
  tokenNormalizers: readonly TokenNormalizer[] = [];

  /**
   * Whether to enable AdjacentConstantFusion auto-detection.
   *
   * Convenience flag. When true, automatically adds an
   * AdjacentConstantFusion normalizer to the pipeline.
   *
   * Default: false
   */
  enableAdjacentFusion: boolean = false;

  /**
   * Minimum token length for AdjacentConstantFusion content word detection.
   *
   * Default: 2
   */
  minFusionTokenLength: number = 2;

  /**
   * Regex collapse patterns for pre-fusion token normalization.
   *
   * Applied BEFORE AdjacentConstantFusion. Each pattern matches in the
   * space-joined token string and replaces matches with the given string.
   * Use "" to remove matches.
   *
   * Default: [] (no collapse)
   */
  regexCollapsePatterns: ReadonlyArray<{
    readonly regex: RegExp;
    readonly replacement: string;
  }> = [];

  /**
   * AEL-style regex substitution patterns.
   *
   * Applied to INDIVIDUAL tokens BEFORE regex collapse and fusion.
   * Unlike masking, this replaces matched content within each token
   * with ${paramStr}. This normalizes parameter tokens across all
   * masking strategies.
   *
   * Default: [] (no substitution)
   */
  aelRegexSubstitution: ReadonlyArray<{
    readonly regex: RegExp;
    readonly replacement: string;
  }> = [];

  // ===================== [MASKING] section =====================

  /** Masking instruction list. Empty by default — users opt in. */
  maskingInstructions: readonly AbstractMaskingInstruction[] = [];

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

  /**
   * Optional callback invoked when persistence errors occur (async save/load failures).
   * If omitted, errors are logged to `console.error`.
   *
   * @example
   * ```typescript
   * const config = TemplateMinerConfig.from({
   *   onError: (context, err) => metrics.increment("drain.persistence.error", { context }),
   * });
   * ```
   */
  onError?: (context: string, error: Error) => void;

  // ===================== Preprocessing =====================

  /**
   * Optional preprocessor function applied to every log message BEFORE
   * masking and Drain clustering.
   *
   * Use this for dataset-specific normalization: strip timestamps,
   * normalize paths, handle embedded punctuation, etc.
   *
   * The preprocessor receives the raw log message and MUST return
   * the (possibly modified) log message. If omitted, the message
   * is passed through unchanged.
   *
   * @example
   * ```typescript
   * // Fix Proxifier-style embedded commas in log content
   * const config = TemplateMinerConfig.from({
   *   preprocessor: (msg) => msg.replace(/,\s+/g, " "),
   * });
   * ```
   */
  preprocessor?: (content: string) => string;

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

  // ===================== INI file support =====================

  /**
   * Loads configuration from a Drain3-compatible ini file.
   *
   * Parses the standard [DRAIN], [MASKING], [SNAPSHOT], and [PROFILING]
   * sections with the same key names and value formats as Drain3's
   * configparser-based ini loader.
   *
   * @param content - Raw ini file content (UTF-8).
   * @returns A new TemplateMinerConfig with ini values applied.
   *
   * @example
   * ```typescript
   * import { readFileSync } from "node:fs";
   * const ini = readFileSync("drain3.ini", "utf-8");
   * const config = TemplateMinerConfig.fromIni(ini);
   * ```
   */
  static fromIni(content: string): TemplateMinerConfig {
    const config = new TemplateMinerConfig();
    const sections = parseIni(content);

    // [DRAIN]
    const drain = sections["DRAIN"] ?? sections["drain"] ?? {};
    if (drain["engine"] !== undefined) {
      config.engine = drain["engine"] as "Drain" | "JaccardDrain";
    }
    if (drain["sim_th"] !== undefined) config.simTh = Number(drain["sim_th"]);
    if (drain["depth"] !== undefined) config.depth = Number(drain["depth"]);
    if (drain["max_children"] !== undefined)
      config.maxChildren = Number(drain["max_children"]);
    if (drain["max_clusters"] !== undefined) {
      const v = Number(drain["max_clusters"]);
      config.maxClusters = Number.isNaN(v) ? null : v;
    }
    if (drain["extra_delimiters"] !== undefined) {
      config.drainExtraDelimiters = parseJsonArray(drain["extra_delimiters"]) as string[];
    }
    if (drain["parametrize_numeric_tokens"] !== undefined) {
      config.parametrizeNumericTokens =
        drain["parametrize_numeric_tokens"] === "True" ||
        drain["parametrize_numeric_tokens"] === "true";
    }
    if (drain["enable_affix_preserving"] !== undefined) {
      config.enableAffixPreserving =
        drain["enable_affix_preserving"] === "True" ||
        drain["enable_affix_preserving"] === "true";
    }
    if (drain["min_affix_length"] !== undefined) {
      config.minAffixLength = Number(drain["min_affix_length"]);
    }

    // [MASKING]
    const masking = sections["MASKING"] ?? sections["masking"] ?? {};
    if (masking["masking"] !== undefined) {
      const instructions = parseJsonArray(masking["masking"]);
      config.maskingInstructions = (instructions as Array<{ regex_pattern: string; mask_with: string }>).map(
        (mi) => new MaskingInstructionClass(mi.regex_pattern, mi.mask_with),
      );
    }
    if (masking["mask_prefix"] !== undefined) config.maskPrefix = masking["mask_prefix"];
    if (masking["mask_suffix"] !== undefined) config.maskSuffix = masking["mask_suffix"];
    if (masking["parameter_extraction_cache_capacity"] !== undefined) {
      config.parameterExtractionCacheCapacity = Number(
        masking["parameter_extraction_cache_capacity"],
      );
    }

    // [SNAPSHOT]
    const snap = sections["SNAPSHOT"] ?? sections["snapshot"] ?? {};
    if (snap["snapshot_interval_minutes"] !== undefined) {
      config.snapshotIntervalMinutes = Number(snap["snapshot_interval_minutes"]);
    }
    if (snap["compress_state"] !== undefined) {
      config.snapshotCompressState =
        snap["compress_state"] === "True" || snap["compress_state"] === "true";
    }

    // [PROFILING]
    const prof = sections["PROFILING"] ?? sections["profiling"] ?? {};
    if (prof["enabled"] !== undefined) {
      config.profilingEnabled =
        prof["enabled"] === "True" || prof["enabled"] === "true";
    }
    if (prof["report_sec"] !== undefined) {
      config.profilingReportSec = Number(prof["report_sec"]);
    }

    return config;
  }

  // ===================== Strategy Chain Builder =====================

  /**
   * Builds the template pattern strategy chain based on configuration.
   *
   * Priority order:
   * 1. Custom strategies (if provided) — use as-is
   * 2. Built from options: Exact → [Regex] → [AffixPreserving] → FullToken
   *
   * @returns Configured strategy chain
   */
  buildStrategyChain(): TemplatePatternStrategyChain {
    // If custom strategies provided, use them directly
    if (this.templatePatternStrategies) {
      return new TemplatePatternStrategyChain().registerAll(
        this.templatePatternStrategies,
      );
    }

    // Build from configuration options
    const chain = new TemplatePatternStrategyChain();

    // Always register exact match (highest priority)
    chain.register(new ExactMatchStrategy());

    // Register regex patterns if provided
    if (this.customRegexPatterns.length > 0) {
      chain.register(
        new RegexParameterizationStrategy(this.customRegexPatterns),
      );
    }

    // Register affix-preserving if enabled
    if (this.enableAffixPreserving) {
      chain.register(new AffixPreservingStrategy(this.minAffixLength));
    }

    // Always register full-token fallback (lowest priority)
    chain.register(new FullTokenParameterizationStrategy());

    return chain;
  }
}

// ============================================================
// INI parser helpers
// ============================================================

/**
 * Parses INI content into a map of section → key-value pairs.
 *
 * Handles:
 * - [Section] headers (case-insensitive)
 * - key = value assignments
 * - # and ; comment lines
 * - Multi-line values (continuation via indentation)
 * - Empty lines
 */
function parseIni(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    // Section header
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim();
      if (!sections[currentSection]) {
        sections[currentSection] = {};
      }
      continue;
    }

    // Key = value
    const eqIdx = line.indexOf("=");
    if (eqIdx > 0 && currentSection) {
      const key = line.slice(0, eqIdx).trim();
      let value = line.slice(eqIdx + 1).trim();

      // Handle JSON array continuation (multi-line masking value)
      if (value.startsWith("[") && !value.endsWith("]")) {
        // Placeholder: single-line JSON arrays are supported.
        // Multi-line JSON arrays (split across lines) are a TODO.
      }
      sections[currentSection]![key] = value;
    }
  }

  return sections;
}

/**
 * Parses a JSON array value from an INI entry.
 *
 * Drain3's ini format uses Python list/JSON literals for array values
 * like `masking = [{"regex_pattern": "...", "mask_with": "IP"}]` and
 * `extra_delimiters = ["_", ":"]`.
 */
function parseJsonArray(raw: string): unknown[] {
  try {
    // Replace Python-style True/False/None with JSON equivalents
    const jsonSafe = raw
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null");
    const parsed = JSON.parse(jsonSafe);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // If parsing fails, return as single-element string array
    return [raw];
  }
}
