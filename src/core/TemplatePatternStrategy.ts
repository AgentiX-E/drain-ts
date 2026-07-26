/**
 * Template Pattern Strategy — Pluggable architecture for template token parameterization.
 *
 * This module implements the Strategy pattern for Drain's template creation,
 * enabling support for non-standard Ground Truth template structures while
 * maintaining full backward compatibility with Drain3.
 *
 * Design principles:
 * 1. Open/Closed: New pattern strategies can be registered without modifying core code
 * 2. Chain of Responsibility: Strategies are tried in priority order until one succeeds
 * 3. Validation: Every strategy can verify its generated templates
 * 4. Confidence-based selection: When multiple strategies match, highest confidence wins
 *
 * @module TemplatePatternStrategy
 */

// ============================================================
// Core Types
// ============================================================

/**
 * Result of a successful token parameterization attempt.
 */
export interface ParameterizationResult {
  /** The generated template token (e.g., "bytes<*>sent") */
  readonly templateToken: string;
  /** Extracted parameter values from both tokens */
  readonly extractedParams: readonly string[];
  /** Confidence score [0.0, 1.0] — higher is better */
  readonly confidence: number;
  /** Strategy that produced this result (for debugging/logging) */
  readonly strategyName: string;
}

/**
 * Strategy for parameterizing template tokens.
 *
 * Implementations define how to detect and generate specific template
 * structures (e.g., "bytes<*>sent", "<*>-<*>", etc.)
 */
export interface TemplatePatternStrategy {
  /** Unique strategy name (used for configuration and debugging) */
  readonly name: string;

  /**
   * Attempts to parameterize two tokens into a template token.
   *
   * @param token1 - First token (from new log message)
   * @param token2 - Second token (from existing template)
   * @param paramStr - Parameter placeholder string (e.g., "<*>")
   * @returns Parameterization result if this strategy can handle the tokens, null otherwise
   */
  tryParameterize(
    token1: string,
    token2: string,
    paramStr: string,
  ): ParameterizationResult | null;

  /**
   * Validates that a generated template token correctly matches an original token.
   *
   * Used for regression testing and debugging.
   *
   * @param templateToken - The generated template token
   * @param originalToken - The original log token
   * @param paramStr - Parameter placeholder string
   * @returns true if the template would match the original
   */
  validate(
    templateToken: string,
    originalToken: string,
    paramStr: string,
  ): boolean;
}

// ============================================================
// Strategy Chain
// ============================================================

/**
 * Chain of template pattern strategies, tried in priority order.
 *
 * The chain implements the Chain of Responsibility pattern: each strategy
 * is tried in order until one successfully parameterizes the tokens.
 * If no strategy succeeds, a fallback result is returned.
 */
export class TemplatePatternStrategyChain {
  private strategies: TemplatePatternStrategy[] = [];

  /**
   * Registers a strategy in the chain.
   *
   * Strategies are automatically sorted by priority (higher first).
   * Built-in priorities: exact(100) > regex(80) > affix-preserving(60) > full-token(40)
   *
   * @param strategy - The strategy to register
   * @returns this (for fluent chaining)
   */
  register(strategy: TemplatePatternStrategy): this {
    this.strategies.push(strategy);
    this.sortByPriority();
    return this;
  }

  /**
   * Registers multiple strategies at once.
   *
   * @param strategies - Strategies to register
   * @returns this (for fluent chaining)
   */
  registerAll(strategies: readonly TemplatePatternStrategy[]): this {
    for (const strategy of strategies) {
      this.register(strategy);
    }
    return this;
  }

  /**
   * Attempts to parameterize two tokens using the strategy chain.
   *
   * Tries each strategy in priority order. Returns the first successful
   * result, or a fallback full-token parameterization if none succeed.
   *
   * @param token1 - First token
   * @param token2 - Second token
   * @param paramStr - Parameter placeholder string
   * @returns The best parameterization result
   */
  parameterize(
    token1: string,
    token2: string,
    paramStr: string,
  ): ParameterizationResult {
    for (const strategy of this.strategies) {
      const result = strategy.tryParameterize(token1, token2, paramStr);
      if (result !== null) {
        return result;
      }
    }

    // Fallback: full token parameterization (Drain3 default behavior)
    return {
      templateToken: paramStr,
      extractedParams: [token1, token2],
      confidence: 0.1,
      strategyName: "fallback",
    };
  }

  /**
   * Validates a template token against an original token.
   *
   * Tries each strategy until one validates successfully.
   *
   * @param templateToken - The template token to validate
   * @param originalToken - The original token
   * @param paramStr - Parameter placeholder string
   * @returns true if any strategy validates the template
   */
  validate(
    templateToken: string,
    originalToken: string,
    paramStr: string,
  ): boolean {
    for (const strategy of this.strategies) {
      if (strategy.validate(templateToken, originalToken, paramStr)) {
        return true;
      }
    }
    // Fallback: full token parameterization always validates
    return templateToken === paramStr;
  }

  /**
   * Returns the number of registered strategies.
   */
  get size(): number {
    return this.strategies.length;
  }

  /**
   * Returns a copy of the registered strategies (for inspection).
   */
  getStrategies(): readonly TemplatePatternStrategy[] {
    return [...this.strategies];
  }

  /**
   * Sorts strategies by built-in priority.
   */
  private sortByPriority(): void {
    const priority: Record<string, number> = {
      exact: 100,
      regex: 80,
      "affix-preserving": 60,
      "full-token": 40,
    };

    this.strategies.sort((a, b) => {
      const priorityA = priority[a.name] ?? 50;
      const priorityB = priority[b.name] ?? 50;
      return priorityB - priorityA;
    });
  }
}

// ============================================================
// Built-in Strategies
// ============================================================

/**
 * Strategy 1: Exact Match (Drain3 default behavior for identical tokens)
 *
 * When two tokens are identical, keeps the token as-is (no parameterization).
 * This is the highest priority strategy.
 */
export class ExactMatchStrategy implements TemplatePatternStrategy {
  readonly name = "exact";

  tryParameterize(
    token1: string,
    token2: string,
    _paramStr: string,
  ): ParameterizationResult | null {
    if (token1 === token2) {
      return {
        templateToken: token1,
        extractedParams: [],
        confidence: 1.0,
        strategyName: this.name,
      };
    }
    return null;
  }

  validate(
    templateToken: string,
    originalToken: string,
    _paramStr: string,
  ): boolean {
    return templateToken === originalToken;
  }
}

/**
 * Strategy 2: Full Token Parameterization (Drain3 default behavior)
 *
 * When two tokens differ, replaces the entire token with paramStr.
 * This is the fallback strategy with lowest priority.
 */
export class FullTokenParameterizationStrategy
  implements TemplatePatternStrategy
{
  readonly name = "full-token";

  tryParameterize(
    token1: string,
    token2: string,
    paramStr: string,
  ): ParameterizationResult | null {
    if (token1 !== token2) {
      return {
        templateToken: paramStr,
        extractedParams: [token1, token2],
        confidence: 0.5,
        strategyName: this.name,
      };
    }
    return null;
  }

  validate(
    templateToken: string,
    _originalToken: string,
    paramStr: string,
  ): boolean {
    return templateToken === paramStr;
  }
}

/**
 * Strategy 3: Affix-Preserving Parameterization
 *
 * Handles cases where tokens share a common prefix and/or suffix,
 * but differ in the middle. Generates templates like "bytes<*>sent".
 *
 * Example:
 * - Input: "bytes0sent", "bytes403sent"
 * - Output: "bytes<*>sent"
 *
 * This pattern appears in Proxifier GT templates and similar datasets
 * where structured values are embedded in fixed text.
 */
export class AffixPreservingStrategy implements TemplatePatternStrategy {
  readonly name = "affix-preserving";

  /**
   * @param minAffixLength - Minimum prefix/suffix length to trigger this strategy (default: 2)
   * @param minConfidence - Minimum confidence threshold (default: 0.6)
   */
  constructor(
    private readonly minAffixLength: number = 2,
    private readonly minConfidence: number = 0.6,
  ) {}

  tryParameterize(
    token1: string,
    token2: string,
    paramStr: string,
  ): ParameterizationResult | null {
    if (token1 === token2) {
      return null; // Let ExactMatchStrategy handle this
    }

    // Find longest common prefix
    let prefixLen = 0;
    const maxPrefixLen = Math.min(token1.length, token2.length);
    while (
      prefixLen < maxPrefixLen &&
      token1[prefixLen] === token2[prefixLen]
    ) {
      prefixLen++;
    }

    // Find longest common suffix (not overlapping with prefix)
    let suffixLen = 0;
    const maxSuffixLen = Math.min(
      token1.length - prefixLen,
      token2.length - prefixLen,
    );
    while (
      suffixLen < maxSuffixLen &&
      token1[token1.length - 1 - suffixLen] ===
        token2[token2.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    // Check if affixes meet minimum length requirement
    const hasSignificantPrefix = prefixLen >= this.minAffixLength;
    const hasSignificantSuffix = suffixLen >= this.minAffixLength;

    if (!hasSignificantPrefix && !hasSignificantSuffix) {
      return null;
    }

    // Extract middle parts
    const prefix = token1.slice(0, prefixLen);
    const suffix = suffixLen > 0 ? token1.slice(-suffixLen) : "";
    const middle1 = token1.slice(prefixLen, token1.length - suffixLen);
    const middle2 = token2.slice(prefixLen, token2.length - suffixLen);

    // Verify middles are actually different
    if (middle1 === middle2) {
      return null;
    }

    // Calculate confidence based on affix coverage
    const totalAffixLen = prefixLen + suffixLen;
    const avgTokenLen = (token1.length + token2.length) / 2;
    const affixCoverage = totalAffixLen / avgTokenLen;
    const confidence = Math.min(
      0.6 + affixCoverage * 0.3,
      0.95,
    );

    if (confidence < this.minConfidence) {
      return null;
    }

    return {
      templateToken: `${prefix}${paramStr}${suffix}`,
      extractedParams: [middle1, middle2],
      confidence,
      strategyName: this.name,
    };
  }

  validate(
    templateToken: string,
    originalToken: string,
    paramStr: string,
  ): boolean {
    // Convert template to regex: escape special chars, replace paramStr with .+?
    // Note: paramStr may contain special regex chars, so we escape it first
    const escapedParamStr = escapeRegex(paramStr);
    // Use split/join instead of regex replace to avoid issues with special chars
    const parts = escapeRegex(templateToken).split(escapedParamStr);
    const regexStr = parts.join(".+?");
    try {
      return new RegExp(`^${regexStr}$`).test(originalToken);
    } catch {
      return false;
    }
  }
}

/**
 * Strategy 4: Regex-Based Parameterization
 *
 * Handles complex patterns using user-defined regular expressions.
 * Useful for structured formats like timestamps, UUIDs, custom IDs, etc.
 *
 * Example:
 * - Pattern: /^(\d{4})-(\d{2})-(\d{2})$/ (date)
 * - Template: "<*>-<*>-<*>"
 */
export class RegexParameterizationStrategy
  implements TemplatePatternStrategy
{
  readonly name = "regex";

  /**
   * @param patterns - Array of regex patterns and their template mappings
   */
  constructor(
    private readonly patterns: ReadonlyArray<{
      readonly regex: RegExp;
      readonly template: string;
      readonly confidence?: number;
    }>,
  ) {}

  tryParameterize(
    token1: string,
    token2: string,
    paramStr: string,
  ): ParameterizationResult | null {
    for (const { regex, template, confidence = 0.9 } of this.patterns) {
      const match1 = token1.match(regex);
      const match2 = token2.match(regex);

      if (match1 && match2) {
        // Both tokens match the pattern — extract captured groups
        const groups1 = match1.slice(1);
        const groups2 = match2.slice(1);

        // Check if any group differs
        const hasDifference = groups1.some((g, i) => g !== groups2[i]);
        if (!hasDifference) {
          continue; // Same values, try next pattern
        }

        // Build template by replacing ${paramStr} placeholders
        const templateToken = template.replace(
          /\$\{paramStr\}/g,
          paramStr,
        );

        return {
          templateToken,
          extractedParams: [...groups1, ...groups2],
          confidence,
          strategyName: this.name,
        };
      }
    }
    return null;
  }

  validate(
    _templateToken: string,
    originalToken: string,
    _paramStr: string,
  ): boolean {
    // Check if original matches any of our patterns
    return this.patterns.some(({ regex }) => regex.test(originalToken));
  }
}

// ============================================================
// Factory Functions
// ============================================================

/**
 * Creates the default strategy chain (Drain3-compatible behavior).
 *
 * Chain: ExactMatch → FullToken
 * This matches Drain3's original createTemplate behavior exactly.
 */
export function createDefaultStrategyChain(): TemplatePatternStrategyChain {
  return new TemplatePatternStrategyChain()
    .register(new ExactMatchStrategy())
    .register(new FullTokenParameterizationStrategy());
}

/**
 * Creates an extended strategy chain with affix-preserving support.
 *
 * Chain: ExactMatch → AffixPreserving → FullToken
 * Recommended for datasets like Proxifier with embedded structured values.
 *
 * @param minAffixLength - Minimum prefix/suffix length (default: 2)
 */
export function createExtendedStrategyChain(
  minAffixLength: number = 2,
): TemplatePatternStrategyChain {
  return new TemplatePatternStrategyChain()
    .register(new ExactMatchStrategy())
    .register(new AffixPreservingStrategy(minAffixLength))
    .register(new FullTokenParameterizationStrategy());
}

/**
 * Creates a fully custom strategy chain.
 *
 * @param strategies - Strategies to include (in registration order)
 */
export function createCustomStrategyChain(
  strategies: readonly TemplatePatternStrategy[],
): TemplatePatternStrategyChain {
  return new TemplatePatternStrategyChain().registerAll(strategies);
}

// ============================================================
// Utilities
// ============================================================

/**
 * Escapes special regex characters in a string.
 * Equivalent to Python's re.escape().
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
