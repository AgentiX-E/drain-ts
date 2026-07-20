import type { MaskingInstruction } from "./MaskingInstruction.js";

/**
 * LogMasker — applies masking instructions to log messages before clustering.
 *
 * Maps 1:1 to Python `LogMasker` class (drain3/masking.py).
 *
 * The masker scans raw log messages for recognized patterns (IP addresses,
 * numbers, UUIDs, etc.) and replaces matched substrings with labeled
 * placeholders like `<IP>`, `<NUM>`, or `<*>`.
 *
 * Masking runs BEFORE the Drain algorithm so that variable parts of log
 * messages are normalized before tokenization and clustering. This
 * dramatically improves template quality.
 *
 * Key design decisions:
 * - Instructions are applied sequentially (not combined regex), matching
 *   Python behavior exactly. This ensures deterministic replacement order.
 * - Multiple instructions can share the same mask name. This allows, for
 *   example, two different IP regex patterns that both produce `<IP>`.
 * - The special mask name `"*"` indicates a catch-all parameter — any
 *   instruction with this name produces `<*>` in the output.
 */

export class LogMasker {
  /** All masking instructions in application order. */
  readonly instructions: readonly MaskingInstruction[];

  /** Prefix wrapper for masked parameters (e.g. `<` in `<IP>`). */
  readonly maskPrefix: string;

  /** Suffix wrapper for masked parameters (e.g. `>` in `<IP>`). */
  readonly maskSuffix: string;

  /** Distinct mask names across all instructions. */
  readonly maskNames: readonly string[];

  /** Pre-built map: maskName → MaskingInstruction[] for fast lookup. */
  private readonly _instructionsByName: ReadonlyMap<
    string,
    readonly MaskingInstruction[]
  >;

  /**
   * Creates a LogMasker.
   *
   * @param instructions - Ordered list of masking instructions (applied sequentially).
   * @param maskPrefix - Left delimiter for masked values. Default: `"<"`.
   * @param maskSuffix - Right delimiter for masked values. Default: `">"`.
   */
  constructor(
    instructions: readonly MaskingInstruction[],
    maskPrefix: string = "<",
    maskSuffix: string = ">",
  ) {
    this.instructions = instructions;
    this.maskPrefix = maskPrefix;
    this.maskSuffix = maskSuffix;

    // Build mask name → instructions map
    const byName = new Map<string, MaskingInstruction[]>();
    for (const inst of instructions) {
      const list = byName.get(inst.maskName);
      if (list) {
        list.push(inst);
      } else {
        byName.set(inst.maskName, [inst]);
      }
    }

    // Freeze each list for immutability
    const frozen = new Map<string, readonly MaskingInstruction[]>();
    for (const [name, list] of byName) {
      frozen.set(name, Object.freeze([...list]));
    }
    this._instructionsByName = frozen;
    this.maskNames = Object.freeze([...frozen.keys()]);
  }

  /**
   * Returns all instructions registered under the given mask name.
   *
   * Python: masker.instructions_by_mask_name(name)
   *
   * Useful for parameter extraction, where the engine needs to know
   * which regex patterns correspond to which mask name.
   *
   * @param name - The mask name to look up (e.g. "IP", "NUM").
   * @returns Frozen array of instructions, or empty array if none found.
   */
  instructionsByMaskName(name: string): readonly MaskingInstruction[] {
    return this._instructionsByName.get(name) ?? [];
  }

  /**
   * Applies all masking instructions to a log message.
   *
   * Python: LogMasker.mask(s) → str
   *
   * Instructions are applied sequentially in the order they were
   * registered. Each instruction's regex is matched globally, and all
   * matches are replaced with `<MASK_NAME>` (using the configured
   * prefix/suffix).
   *
   * Example:
   * ```
   * const masker = new LogMasker([NUM_MASK], "<", ">");
   * masker.mask("error code 42 occurred");
   * // → "error code <NUM> occurred"
   * ```
   *
   * @param content - The raw log message to mask.
   * @returns The masked log message with parameters replaced.
   */
  mask(content: string): string {
    let result = content;

    for (const instruction of this.instructions) {
      result = result.replace(
        instruction.compiledRegex,
        `${this.maskPrefix}${instruction.maskName}${this.maskSuffix}`,
      );
    }

    return result;
  }
}
