import { Drain } from "./core/Drain.js";
import { JaccardDrain } from "./core/JaccardDrain.js";
import type { DrainBase } from "./core/DrainBase.js";
import { LogCluster } from "./core/LogCluster.js";
import { LogMasker } from "./masker/LogMasker.js";
import type { MaskingInstruction } from "./masker/MaskingInstruction.js";
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
import {
  AdjacentConstantFusion,
  RegexCollapseNormalizer,
  TokenNormalizerPipeline,
} from "./core/TokenNormalizer.js";
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

  /** The Drain clustering engine (Drain or JaccardDrain). */
  readonly drain: DrainBase;

  /** The log masking preprocessor. */
  readonly masker: LogMasker;

  /** Optional persistence handler for state save/load. */
  private readonly _persistence: PersistenceHandler | null;

  /** Pre-clustering token normalization pipeline. */
  private readonly _normalizerPipeline: TokenNormalizerPipeline;

  /** LRU cache for parameter extraction regexes: (template, exactMatching) → compiled RegExp. */
  private readonly _extractionCache: LRUCache<string, RegExp>;

  /** LRU cache for param-name-to-mask-name mappings. Keyed same as _extractionCache. */
  private readonly _extractionMappingCache: LRUCache<string, Record<string, string>>;

  /** Profiler instance (NullProfiler by default, SimpleProfiler when enabled). */
  readonly profiler: Profiler;

  /** Timestamp (seconds) of the last snapshot save. Initialized to now to prevent immediate periodic save. */
  private _lastSnapshotTimestamp: number = Date.now() / 1000;

  /**
   * Promise that resolves when async state loading completes.
   * `null` if no persistence handler or if loading was synchronous.
   *
   * When using an async PersistenceHandler, prefer `TemplateMiner.create()`
   * over the constructor to ensure the model is fully loaded before use.
   */
  readonly initPromise: Promise<void> | null = null;

  /**
   * Creates a TemplateMiner.
   *
   * **Important**: When using an async `PersistenceHandler` (e.g., Redis,
   * Kafka), prefer the static `TemplateMiner.create()` factory method instead
   * of the constructor. The constructor returns immediately before async
   * state loading completes, which can cause a race condition if you call
   * `addLogMessage()` right away.
   *
   * @param options.config - Configuration object (defaults used if omitted).
   * @param options.persistenceHandler - Optional persistence backend.
   *
   * @example
   * ```typescript
   * // For async persistence, use the factory:
   * const miner = await TemplateMiner.create({ persistenceHandler: myRedisHandler });
   * ```
   */
  constructor({
    config = new TemplateMinerConfig(),
    persistenceHandler = null,
  }: {
    config?: TemplateMinerConfig;
    persistenceHandler?: PersistenceHandler | null | undefined;
  } = {}) {
    this.config = config;
    this._persistence = persistenceHandler;

    // Build paramStr from mask prefix/suffix: "<*>" by default
    const paramStr = `${config.maskPrefix}*${config.maskSuffix}`;

    // Create the Drain engine (Drain or JaccardDrain based on config.engine)
    const DrainCtor = config.engine === "JaccardDrain" ? JaccardDrain : Drain;
    this.drain = new DrainCtor({
      depth: config.depth,
      simTh: config.simTh,
      maxChildren: config.maxChildren,
      maxClusters: config.maxClusters,
      extraDelimiters: config.drainExtraDelimiters,
      paramStr,
      parametrizeNumericTokens: config.parametrizeNumericTokens,
      // Pass strategy chain configuration (conditionally for exactOptionalPropertyTypes)
      ...(config.templatePatternStrategies !== undefined
        ? { templatePatternStrategies: config.templatePatternStrategies }
        : {}),
      enableAffixPreserving: config.enableAffixPreserving,
      minAffixLength: config.minAffixLength,
      customRegexPatterns: config.customRegexPatterns,
    });

    // Create the masker with the configured instructions
    this.masker = new LogMasker(
      config.maskingInstructions,
      config.maskPrefix,
      config.maskSuffix,
    );

    // Build the token normalizer pipeline
    this._normalizerPipeline = new TokenNormalizerPipeline();
    // Phase 1: Regex collapse (optional — runs first to simplify token structure)
    if (config.regexCollapsePatterns.length > 0) {
      this._normalizerPipeline.register(
        new RegexCollapseNormalizer(config.regexCollapsePatterns),
      );
    }
    // Phase 2: Adjacent constant fusion (auto-detects and fuses constant pairs)
    if (config.enableAdjacentFusion) {
      this._normalizerPipeline.register(
        new AdjacentConstantFusion(config.minFusionTokenLength),
      );
    }
    // Phase 3: User-defined normalizers (runs last)
    for (const normalizer of config.tokenNormalizers) {
      this._normalizerPipeline.register(normalizer);
    }

    // Initialize regex caches for parameter extraction
    const cacheCapacity = config.parameterExtractionCacheCapacity;
    this._extractionCache = new LRUCache(cacheCapacity);
    this._extractionMappingCache = new LRUCache(cacheCapacity);

    // Initialize profiler
    this.profiler = config.profilingEnabled
      ? new SimpleProfiler()
      : new NullProfiler();

    // Restore state from persistence if available.
    // If the handler is async, capture the loading promise so callers can await it.
    if (this._persistence) {
      const loadResult = this._persistence.loadState();
      if (loadResult instanceof Promise) {
        this.initPromise = loadResult.then(
          (buf) => { this._doLoad(buf); },
          (err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err));
            if (this.config.onError) {
              this.config.onError("loadState", error);
            } else {
              console.error("[drain-ts] Failed to load state:", error.message);
            }
          },
        );
      } else {
        this._doLoad(loadResult);
      }
    }
  }

  /**
   * Async factory — creates a fully-initialized TemplateMiner.
   *
   * Use this instead of the constructor when using an async
   * `PersistenceHandler` (e.g., Redis, Kafka, S3). This method
   * awaits state loading before returning, eliminating the race
   * condition between construction and `addLogMessage()` calls.
   *
   * For sync `PersistenceHandler` (FilePersistence, MemoryPersistence),
   * the constructor and `create()` behave identically.
   *
   * @example
   * ```typescript
   * const miner = await TemplateMiner.create({
   *   config: TemplateMinerConfig.from({ simTh: 0.5 }),
   *   persistenceHandler: new FilePersistence("/path/to/snapshot.json"),
   * });
   * // Model is fully loaded — safe to call addLogMessage() immediately.
   * miner.addLogMessage("first message");
   * ```
   */
  static async create(options: {
    config?: TemplateMinerConfig;
    persistenceHandler?: PersistenceHandler | null | undefined;
  } = {}): Promise<TemplateMiner> {
    const miner = new TemplateMiner(options);
    if (miner.initPromise) {
      await miner.initPromise;
    }
    return miner;
  }

  // ============================================================
  // learnTokens — batch learning for token normalizers
  // ============================================================

  /**
   * Learns token patterns from a batch of raw log messages.
   *
   * Must be called BEFORE processing any messages when using
   * normalizers that require a learning phase (e.g., AdjacentConstantFusion).
   *
   * This method tokenizes all messages, runs the normalizer's learn phase,
   * and resets the Drain engine. Messages are NOT added to clusters.
   *
   * Call this once, then call addLogMessage() for each message.
   *
   * @param messages - Raw log messages to learn from
   *
   * @example
   * ```typescript
   * const miner = new TemplateMiner({
   *   config: TemplateMinerConfig.from({
   *     enableAdjacentFusion: true,
   *   }),
   * });
   * miner.learnTokens(allLogMessages);
   * for (const msg of allLogMessages) {
   *   miner.addLogMessage(msg); // tokens are now normalized
   * }
   * ```
   */
  learnTokens(messages: readonly string[]): void {
    if (this._normalizerPipeline.isEmpty) return;

    // Tokenize all messages (with preprocessor + extra delimiters + masking)
    const tokenized: string[][] = [];
    for (const msg of messages) {
      const preprocessed = this.config.preprocessor
        ? this.config.preprocessor(msg)
        : msg;
      const masked = this.masker.mask(preprocessed);
      const tokens = this.drain.getContentAsTokens(masked);
      tokenized.push(tokens);
    }

    // Let normalizers learn from the batch
    this._normalizerPipeline.learn(tokenized);
  }

  // ============================================================
  // addLogMessage — maps to Python TemplateMiner.add_log_message()
  // ============================================================

  /**
   * Processes a log message (training mode).
   *
   * The message is first preprocessed and masked, then token-normalized,
   * then passed to the Drain engine for clustering.
   *
   * State may be persisted if a PersistenceHandler is configured and
   * a snapshot trigger condition is met.
   *
   * Python: TemplateMiner.add_log_message(log_message) → dict
   */
  addLogMessage(logMessage: string): AddLogResult {
    // Phase 0: Preprocess (dataset-specific normalization)
    const preprocessed = this.config.preprocessor
      ? this.config.preprocessor(logMessage)
      : logMessage;

    this.profiler.startSection("total");

    // Phase 1: Mask
    this.profiler.startSection("mask");
    const maskedContent = this.masker.mask(preprocessed);
    this.profiler.endSection("mask");

    // Phase 1.5: Token normalization (pre-clustering)
    let clusterInput = maskedContent;
    if (!this._normalizerPipeline.isEmpty) {
      const tokens = this.drain.getContentAsTokens(maskedContent);
      const normalized = this._normalizerPipeline.normalize(
        tokens,
        `${this.config.maskPrefix}*${this.config.maskSuffix}`,
      );
      clusterInput = normalized.tokens.join(" ");
    }

    // Phase 2: Cluster
    this.profiler.startSection("drain");
    const { cluster, changeType } = this.drain.addLogMessage(clusterInput);
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
    const preprocessed = this.config.preprocessor
      ? this.config.preprocessor(logMessage)
      : logMessage;
    const maskedContent = this.masker.mask(preprocessed);

    // Apply token normalization
    let matchInput = maskedContent;
    if (!this._normalizerPipeline.isEmpty) {
      const tokens = this.drain.getContentAsTokens(maskedContent);
      const normalized = this._normalizerPipeline.normalize(
        tokens,
        `${this.config.maskPrefix}*${this.config.maskSuffix}`,
      );
      matchInput = normalized.tokens.join(" ");
    }

    return this.drain.match(matchInput, fullSearchStrategy);
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
    // Phase 0: Preprocess
    const preprocessed = this.config.preprocessor
      ? this.config.preprocessor(logMessage)
      : logMessage;
    // Preprocess: replace extra delimiters with spaces
    // Python: for delimiter in self.config.drain_extra_delimiters: log_message = re.sub(delimiter, " ", log_message)
    let processedMessage = preprocessed;
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

  /**
   * Deprecated: use extractParameters() instead.
   *
   * Python: TemplateMiner.get_parameter_list(template, log_line)
   *
   * Extracts parameter VALUES only (no mask names) using inexact matching.
   * Provided for compatibility with Drain3 API.
   *
   * @deprecated Use `extractParameters()` for full ExtractedParameter[] results.
   */
  getParameterList(logTemplate: string, logMessage: string): string[] {
    const params = this.extractParameters(logTemplate, logMessage, false);
    return params.map((p) => p.value);
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
          const patterns = instructions
            .filter((inst): inst is MaskingInstruction => "regexPattern" in inst)
            .map((inst) => sanitizeRegexForCapture(inst.regexPattern));
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
        const error = err instanceof Error ? err : new Error(String(err));
        if (this.config.onError) {
          this.config.onError(`saveState(${snapshotReason})`, error);
        } else {
          console.error(
            `[drain-ts] Failed to save state (${snapshotReason}):`,
            error.message,
          );
        }
      });
    }
  }

  /**
   * Synchronous state loading — called from constructor (sync handler)
   * or from `create()` factory (after async handler resolves).
   *
   * Python: TemplateMiner.load_state()
   */
  private _doLoad(stateBuffer: Uint8Array | null): void {
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
