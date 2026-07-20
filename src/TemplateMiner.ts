import { Drain } from "./core/Drain.js";
import { LogCluster } from "./core/LogCluster.js";
import { LogMasker } from "./masker/LogMasker.js";
import { TemplateMinerConfig } from "./TemplateMinerConfig.js";
import { LRUCache } from "./LRUCache.js";
import { SimpleProfiler, NullProfiler, type Profiler } from "./Profiler.js";
import type { PersistenceHandler } from "./persistence/PersistenceHandler.js";
import {
  ChangeType,
  MatchStrategy,
  type AddLogResult,
  type MatchStrategy as IMatchStrategy,
  type ExtractedParameter,
} from "./core/types.js";
import type { LogCluster as ILogCluster } from "./core/LogCluster.js";
import * as zlib from "node:zlib";

// ============================================================
// Helpers
// ============================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Escapes special regex characters in a string.
 * Equivalent to Python's `re.escape()`.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitizes a regex pattern for use inside a larger capture group.
 *
 * Python: Drain3's `_get_template_parameter_extraction_regex`
 * handles this by:
 * - Converting named groups `(?P<name>...)` to non-capturing groups `(?:...)`
 * - Converting numeric backreferences `\1` to `(?:.+?)`
 */
function sanitizeRegexForCapture(pattern: string): string {
  // Replace Python-style named groups: (?P<name>...) → (?:...)
  let sanitized = pattern.replace(/\(\?P<[^>]*>/g, "(?:");
  // Replace numeric backreferences \1, \2, etc. (exclude \0)
  sanitized = sanitized.replace(/\\(?!0)\d{1,2}/g, "(?:.+?)");
  return sanitized;
}

// ============================================================
// TemplateMiner
// ============================================================

/**
 * Main user-facing facade for log template mining.
 *
 * Maps 1:1 to Python `TemplateMiner` class (drain3/template_miner.py).
 *
 * TemplateMiner integrates the Drain clustering engine with the masking
 * preprocessor, optional persistence, and parameter extraction. It is
 * the single entry point that users should instantiate.
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

  /** LRU cache for parameter extraction regexes: (template, exactMatching) → compiled RegExp. */
  private readonly _extractionCache: LRUCache<string, RegExp>;

  /** LRU cache for param-name-to-mask-name mappings. Keyed same as _extractionCache. */
  private readonly _extractionMappingCache: LRUCache<string, Record<string, string>>;

  /** Profiler instance (NullProfiler by default, SimpleProfiler when enabled). */
  readonly profiler: Profiler;

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

    // Initialize regex caches for parameter extraction
    const cacheCapacity = config.parameterExtractionCacheCapacity;
    this._extractionCache = new LRUCache(cacheCapacity);
    this._extractionMappingCache = new LRUCache(cacheCapacity);

    // Initialize profiler
    this.profiler = config.profilingEnabled
      ? new SimpleProfiler()
      : new NullProfiler();

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
   */
  addLogMessage(logMessage: string): AddLogResult {
    // Python: self.profiler.start_section("total")
    this.profiler.startSection("total");

    // Phase 1: Mask
    // Python: self.profiler.start_section("mask")
    this.profiler.startSection("mask");
    const maskedContent = this.masker.mask(logMessage);
    this.profiler.endSection("mask");

    // Phase 2: Cluster
    // Python: self.profiler.start_section("drain")
    this.profiler.startSection("drain");
    const { cluster, changeType } = this.drain.addLogMessage(maskedContent);
    this.profiler.endSection("drain");

    // Phase 3: Conditional persistence
    // Python: self.profiler.start_section("save_state")
    this.profiler.startSection("save_state");
    const snapshotReason = this._getSnapshotReason(
      changeType,
      cluster.clusterId,
    );
    if (snapshotReason !== null) {
      this._saveState(snapshotReason);
    }
    this.profiler.endSection("save_state");

    this.profiler.endSection("total");
    this.profiler.report(this.config.profilingReportSec);

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
   * templates.
   */
  match(
    logMessage: string,
    fullSearchStrategy: IMatchStrategy = MatchStrategy.Never,
  ): ILogCluster | null {
    const maskedContent = this.masker.mask(logMessage);
    return this.drain.match(maskedContent, fullSearchStrategy);
  }

  // ============================================================
  // extractParameters — maps to Python TemplateMiner.extract_parameters()
  // ============================================================

  /**
   * Extracts variable parameters from a log message based on its template.
   *
   * Python: TemplateMiner.extract_parameters(template, log_line, exact_matching)
   *
   * Given a mined template like `"user <*:> logged in from <:IP:>"` and the
   * original log message `"user alice logged in from 192.168.1.1"`, this
   * method returns the extracted parameter values with their mask names:
   *
   * ```
   * [
   *   { value: "alice", maskName: "*" },
   *   { value: "192.168.1.1", maskName: "IP" }
   * ]
   * ```
   *
   * @param logTemplate - The mined template string (from `addLogMessage` result).
   * @param logMessage - The original (unmasked) log message.
   * @param exactMatching - If true, uses the masking instruction regex patterns.
   *                        If false, uses non-whitespace matching `.+?` for all params.
   * @returns Ordered list of extracted parameters.
   */
  extractParameters(
    logTemplate: string,
    logMessage: string,
    exactMatching: boolean = true,
  ): ExtractedParameter[] {
    // Preprocess: replace extra delimiters with spaces
    // Python: for delimiter in self.config.drain_extra_delimiters: log_message = re.sub(delimiter, " ", log_message)
    let processedMessage = logMessage;
    for (const delimiter of this.config.drainExtraDelimiters) {
      // Use split+join instead of regex replace for plain string delimiters
      processedMessage = processedMessage.split(delimiter).join(" ");
    }

    const cacheKey = `${logTemplate}\x00${String(exactMatching)}`;

    let regex = this._extractionCache.get(cacheKey);
    let paramNameToMaskName = this._extractionMappingCache.get(cacheKey);

    if (!regex || !paramNameToMaskName) {
      const built = this._buildExtractionRegex(logTemplate, exactMatching);
      regex = built.regex;
      paramNameToMaskName = built.paramNameToMaskName;
      this._extractionCache.set(cacheKey, regex);
      this._extractionMappingCache.set(cacheKey, paramNameToMaskName);
    }

    const match = regex.exec(processedMessage);
    if (!match || !match.groups) return [];

    const result: ExtractedParameter[] = [];
    for (const paramName of Object.keys(paramNameToMaskName)) {
      const value = match.groups[paramName];
      if (value !== undefined) {
        result.push({
          value,
          maskName: paramNameToMaskName[paramName]!,
        });
      }
    }

    return result;
  }

  // ============================================================
  // Parameter extraction regex builder
  // ============================================================

  /**
   * Builds a compiled RegExp and param-name-to-mask-name mapping for
   * a given template.
   *
   * Python: TemplateMiner._get_template_parameter_extraction_regex()
   *
   * Algorithm:
   * 1. Escape the template for regex.
   * 2. For each known mask name, find `<MASK_NAME>` placeholders.
   * 3. Replace each placeholder with a named capture group:
   *    - Exact matching: use the MaskingInstruction's regex pattern(s).
   *    - Inexact matching or `*`: use `.+?`.
   * 4. Replace spaces with `\s+` to handle multiple spaces.
   * 5. Anchor with `^...$`.
   *
   * @returns Compiled regex and mapping from param group name to mask name.
   */
  private _buildExtractionRegex(
    template: string,
    exactMatching: boolean,
  ): {
    regex: RegExp;
    paramNameToMaskName: Record<string, string>;
  } {
    const paramNameToMaskName: Record<string, string> = {};
    let paramCounter = 0;

    const getNextParamName = (): string => {
      const name = `p_${paramCounter}`;
      paramCounter += 1;
      return name;
    };

    const prefix = this.config.maskPrefix;
    const suffix = this.config.maskSuffix;

    // Build the regex by splitting the template into parts:
    // literal text parts (escaped) and placeholder parts (replaced with capture groups).
    //
    // Strategy: tokenize the template at `<...>` boundaries, escape the literal
    // segments, and replace each placeholder with a named capture group.
    // This avoids the double-escaping problem that occurs when escaping the
    // entire template first and then trying to find placeholders within it.
    const parts: string[] = [];
    let remaining = template;

    while (remaining.length > 0) {
      const openIdx = remaining.indexOf(prefix);
      if (openIdx === -1) {
        // No more placeholders — escape the rest
        parts.push(escapeRegex(remaining));
        break;
      }

      // Literal text before placeholder
      if (openIdx > 0) {
        parts.push(escapeRegex(remaining.slice(0, openIdx)));
      }
      remaining = remaining.slice(openIdx + prefix.length);

      const closeIdx = remaining.indexOf(suffix);
      if (closeIdx === -1) {
        // No closing suffix — treat rest as literal
        parts.push(escapeRegex(prefix + remaining));
        remaining = "";
        break;
      }

      const maskName = remaining.slice(0, closeIdx);
      remaining = remaining.slice(closeIdx + suffix.length);

      const paramGroupName = getNextParamName();

      if (maskName === "*" || !exactMatching) {
        // Universal wildcard or inexact mode: match any characters
        paramNameToMaskName[paramGroupName] = maskName;
        parts.push(`(?<${paramGroupName}>.+?)`);
      } else if (this.masker.maskNames.includes(maskName)) {
        // Known mask name with exact matching
        paramNameToMaskName[paramGroupName] = maskName;
        const instructions = this.masker.instructionsByMaskName(maskName);
        if (instructions.length === 0) {
          parts.push(`(?<${paramGroupName}>.+?)`);
        } else {
          const patterns = instructions.map((inst) =>
            sanitizeRegexForCapture(inst.regexPattern),
          );
          parts.push(`(?<${paramGroupName}>${patterns.join("|")})`);
        }
      } else {
        // Unknown mask name — treat as generic wildcard
        paramNameToMaskName[paramGroupName] = maskName;
        parts.push(`(?<${paramGroupName}>.+?)`);
      }
    }

    // Join parts and replace spaces with \s+
    let templateRegex = parts.join("");
    templateRegex = templateRegex.replace(/ /g, "\\s+");

    // Anchor to start and end
    const finalRegex = new RegExp(`^${templateRegex}$`);

    return { regex: finalRegex, paramNameToMaskName };
  }

  // ============================================================
  // Persistence — maps to Python TemplateMiner.save_state/load_state
  // ============================================================

  private _saveState(snapshotReason: string): void {
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
    let state = encoder.encode(json);

    // Python: if config.snapshot_compress_state → zlib.compress + base64.b64encode
    if (this.config.snapshotCompressState) {
      const compressed = zlib.deflateSync(state);
      state = encoder.encode(
        Buffer.from(compressed).toString("base64"),
      );
    }

    const result = this._persistence.saveState(state);
    if (result instanceof Promise) {
      result.catch((err: unknown) => {
        console.error(
          `[drain-ts] Failed to save state (${snapshotReason}):`,
          err,
        );
      });
    }
  }

  private _loadState(): void {
    if (!this._persistence) return;

    const loadResult = this._persistence.loadState();

    const doLoad = (stateBuffer: Uint8Array | null): void => {
      if (!stateBuffer || stateBuffer.length === 0) return;

      let json: string;

      // Python: if compressed → zlib.decompress(base64.b64decode(state))
      if (this.config.snapshotCompressState) {
        const decoded = Buffer.from(decoder.decode(stateBuffer), "base64");
        json = decoder.decode(zlib.inflateSync(decoded));
      } else {
        json = decoder.decode(stateBuffer);
      }

      const snapshot = JSON.parse(json);

      if (!snapshot.clusters || !Array.isArray(snapshot.clusters)) return;

      this.drain.idToCluster.clear();
      let maxClusterId = 0;

      for (const c of snapshot.clusters) {
        const cluster = new LogCluster(c.log_template_tokens, c.cluster_id);
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
  // Snapshot trigger logic
  // ============================================================

  private _getSnapshotReason(
    changeType: typeof ChangeType[keyof typeof ChangeType],
    clusterId: number,
  ): string | null {
    if (changeType !== ChangeType.None) {
      return `${changeType} (${clusterId})`;
    }

    const now = Date.now() / 1000;
    const elapsed = now - this._lastSnapshotTimestamp;
    if (elapsed >= this.config.snapshotIntervalMinutes * 60) {
      this._lastSnapshotTimestamp = now;
      return "periodic";
    }

    return null;
  }
}
