/**
 * MaskingInstruction — a regex pattern paired with a symbolic mask name.
 *
 * Maps 1:1 to Python `MaskingInstruction` class (drain3/masking.py).
 *
 * Each instruction describes how to detect and replace a specific type of
 * variable content in log messages before clustering. For example, an
 * instruction might match IPv4 addresses and replace them with `<IP>`.
 *
 * Instructions are user-configurable; drain-ts provides presets for common
 * patterns (IP, NUM, HEX, UUID, EMAIL) but ships with an empty default set.
 */

export class MaskingInstruction {
  /** The raw regex pattern string (as passed to `new RegExp()`). */
  readonly regexPattern: string;

  /** Pre-compiled regex for efficient replacement during masking. */
  readonly compiledRegex: RegExp;

  /** Symbolic name used in masked output (e.g. "IP", "NUM", "UUID"). */
  readonly maskName: string;

  /**
   * Creates a masking instruction.
   *
   * The regex pattern must use the global flag (g) replacement semantics.
   * Capturing groups within the pattern determine which portion of the
   * match is replaced.
   *
   * @param regexPattern - Regex pattern string (without enclosing slashes or flags).
   * @param maskName - Symbolic name, used as `<NAME>` in masked output.
   */
  constructor(regexPattern: string, maskName: string) {
    if (!regexPattern || regexPattern.length === 0) {
      throw new Error("MaskingInstruction: regexPattern must be non-empty");
    }
    if (!maskName || maskName.length === 0) {
      throw new Error("MaskingInstruction: maskName must be non-empty");
    }

    this.regexPattern = regexPattern;
    this.maskName = maskName;
    this.compiledRegex = new RegExp(regexPattern, "g");
  }
}
