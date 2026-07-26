/**
 * Masking instructions — patterns for detecting and replacing variable
 * content in log messages before clustering.
 *
 * Maps 1:1 to Python drain3/masking.py:
 * - AbstractMaskingInstruction → AbstractMaskingInstruction (ABC)
 * - MaskingInstruction          → RegexMaskingInstruction / MaskingInstruction
 *
 * Drain3 supports pluggable masking backends via the abstract base class.
 * drain-ts matches this: `AbstractMaskingInstruction` allows custom
 * non-regex masking strategies (e.g., LLM-based semantic masking).
 */

/**
 * Abstract base for masking instructions.
 *
 * Python: `AbstractMaskingInstruction` (drain3/masking.py L9-L22)
 *
 * Subclasses implement `mask()` to replace variable content with
 * placeholder tokens. Built-in: `MaskingInstruction` (regex-based).
 * Custom implementations can use any strategy.
 *
 * @example
 * ```typescript
 * class SemanticMasker extends AbstractMaskingInstruction {
 *   mask(content: string, prefix: string, suffix: string): string {
 *     // Call LLM to identify PII, replace with <PII>
 *     return content.replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, "<PERSON_NAME>");
 *   }
 * }
 * ```
 */
export abstract class AbstractMaskingInstruction {
  /** Symbolic name used in masked output (e.g. "IP", "NUM", "PERSON_NAME"). */
  readonly maskName: string;

  constructor(maskName: string) {
    if (!maskName || maskName.length === 0) {
      throw new Error("AbstractMaskingInstruction: maskName must be non-empty");
    }
    this.maskName = maskName;
  }

  /**
   * Apply the masking strategy to the given content.
   *
   * @param content - Raw log message content.
   * @param maskPrefix - Left delimiter for masked parameters (e.g. "<").
   * @param maskSuffix - Right delimiter for masked parameters (e.g. ">").
   * @returns Content with variable parts replaced by `<maskPrefix><maskName><maskSuffix>`.
   */
  abstract mask(content: string, maskPrefix: string, maskSuffix: string): string;
}

/**
 * Regex-based masking instruction.
 *
 * Python: `MaskingInstruction` / `RegexMaskingInstruction` (drain3/masking.py L25-L38)
 *
 * Uses a compiled regex to find and replace variable patterns.
 * The regex must use capturing groups to identify the portion to replace.
 */
export class MaskingInstruction extends AbstractMaskingInstruction {
  /** The raw regex pattern string. */
  readonly regexPattern: string;

  /** Pre-compiled regex for efficient replacement. */
  readonly compiledRegex: RegExp;

  /**
   * @param regexPattern - Regex pattern (without enclosing slashes or flags).
   * @param maskName - Symbolic name, used as `<maskName>` in masked output.
   */
  constructor(regexPattern: string, maskName: string) {
    super(maskName);
    if (!regexPattern || regexPattern.length === 0) {
      throw new Error("MaskingInstruction: regexPattern must be non-empty");
    }
    this.regexPattern = regexPattern;
    this.compiledRegex = new RegExp(regexPattern, "g");
  }

  mask(content: string, maskPrefix: string, maskSuffix: string): string {
    const replacement = maskPrefix + this.maskName + maskSuffix;
    return content.replace(this.compiledRegex, replacement);
  }
}
