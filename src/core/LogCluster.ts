/**
 * LogCluster — represents a cluster of similar log messages and their template.
 *
 * Maps 1:1 to Python `LogCluster` class (drain.py L14-L26).
 * Uses `__slots__` equivalent via readonly properties.
 *
 * Key invariants:
 * - logTemplateTokens is immutable; updates replace the entire tuple
 * - clusterId is monotonically increasing, starting from 1
 * - size tracks the total number of messages assigned to this cluster
 */

export class LogCluster {
  /**
   * The template tokens for this cluster.
   * Stored as a frozen array to enforce immutability — modifications
   * replace the entire value, mirroring Python tuple semantics.
   *
   * Python: self.log_template_tokens = tuple(log_template_tokens)
   */
  private _logTemplateTokens: readonly string[];

  /** Unique sequential identifier for this cluster. Python: self.cluster_id */
  readonly clusterId: number;

  /** Number of log messages that have matched this cluster. Python: self.size */
  size: number;

  /**
   * Creates a new LogCluster.
   *
   * @param logTemplateTokens - Initial template tokens (typically from the first matching log).
   * @param clusterId - Unique cluster identifier assigned by the engine.
   */
  constructor(logTemplateTokens: readonly string[], clusterId: number) {
    this._logTemplateTokens = Object.freeze([...logTemplateTokens]);
    this.clusterId = clusterId;
    this.size = 1;
  }

  /** Immutable template tokens. Python: self.log_template_tokens */
  get logTemplateTokens(): readonly string[] {
    return this._logTemplateTokens;
  }

  /**
   * Replace template tokens. Uses whole-value assignment (not mutation)
   * to maintain immutability — mirrors Python tuple semantics.
   *
   * Python: match_cluster.log_template_tokens = tuple(new_template_tokens)
   */
  set logTemplateTokens(tokens: readonly string[]) {
    this._logTemplateTokens = Object.freeze([...tokens]);
  }

  /**
   * Returns the template as a space-joined string.
   *
   * Python: LogCluster.get_template() → ' '.join(self.log_template_tokens)
   */
  getTemplate(): string {
    return this._logTemplateTokens.join(" ");
  }

  /**
   * Human-readable representation for debugging.
   *
   * Python: LogCluster.__str__()
   */
  toString(): string {
    return `ID=${String(this.clusterId).padEnd(5)} : size=${String(this.size).padEnd(10)}: ${this.getTemplate()}`;
  }
}
