/**
 * Profiler — performance measurement instrumentation.
 *
 * Maps 1:1 to Python Drain3 profiling system (drain3/profiler.py).
 *
 * The profiler tracks cumulative time and call counts for named sections
 * of the TemplateMiner processing pipeline. It is designed to have
 * negligible overhead when profiling is disabled (NullProfiler).
 */

/**
 * Profiler interface.
 *
 * Python: Profiler (abstract base class)
 */
export interface Profiler {
  /** Begin timing a named section. Nesting is NOT supported — each start must be matched by an end. */
  startSection(name: string): void;

  /** End timing the most recently started section, or a specific named section. */
  endSection(name?: string): void;

  /** Output a profiling report at the given interval (seconds). Called after each addLogMessage. */
  report(intervalSec: number): void;
}

// ============================================================
// NullProfiler
// ============================================================

/**
 * No-op profiler — used when profiling is disabled (default).
 *
 * Python: NullProfiler
 *
 * All methods are empty functions — zero runtime overhead beyond
 * a few no-op function calls that modern JS engines can inline away.
 */
export class NullProfiler implements Profiler {
  /** No-op. */
  startSection(_name: string): void {
    // intentionally empty
  }

  /** No-op. */
  endSection(_name?: string): void {
    // intentionally empty
  }

  /** No-op. */
  report(_intervalSec: number): void {
    // intentionally empty
  }
}

// ============================================================
// SimpleProfiler
// ============================================================

/**
 * Simple wall-clock profiler that tracks cumulative time per section.
 *
 * Python: SimpleProfiler
 *
 * Records start/end times for named sections and periodically outputs
 * a summary report with total time, call count, and average time.
 *
 * Note: Section nesting is NOT supported. Each startSection must be
 * followed by an endSection before the next startSection.
 */
export class SimpleProfiler implements Profiler {
  private readonly _sections = new Map<
    string,
    { totalTime: number; callCount: number }
  >();
  private readonly _startTimes = new Map<string, number>();
  private _lastReportTime: number = 0;

  /**
   * Begins timing a named section.
   *
   * @param name - Section identifier (e.g. "total", "mask", "drain", "save_state").
   */
  startSection(name: string): void {
    this._startTimes.set(name, performance.now());
  }

  /**
   * Ends timing for the most recently started section, or a named section.
   *
   * @param name - Optional section name. If omitted, ends the most recent section.
   */
  endSection(name?: string): void {
    const resolvedName = name ?? this._getActiveSectionName();
    const startTime = this._startTimes.get(resolvedName);
    if (startTime === undefined) return;

    const elapsed = performance.now() - startTime;
    const stats = this._sections.get(resolvedName) ?? {
      totalTime: 0,
      callCount: 0,
    };
    stats.totalTime += elapsed;
    stats.callCount += 1;
    this._sections.set(resolvedName, stats);
    this._startTimes.delete(resolvedName);
  }

  /**
   * Outputs a profiling report if the specified interval has elapsed.
   *
   * @param intervalSec - Minimum seconds between report outputs.
   */
  report(intervalSec: number): void {
    const now = performance.now();
    if (now - this._lastReportTime < intervalSec * 1000) return;
    this._lastReportTime = now;

    const lines: string[] = ["[drain-ts Profiler Report]"];
    for (const [name, stats] of this._sections) {
      const avgMs = (stats.totalTime / stats.callCount).toFixed(2);
      const totalMs = stats.totalTime.toFixed(0);
      lines.push(
        `  ${name}: ${totalMs}ms total, ${stats.callCount} calls, avg ${avgMs}ms`,
      );
    }
    console.log(lines.join("\n"));
  }

  /** Returns the name of the most recently started (un-ended) section. */
  private _getActiveSectionName(): string {
    const keys = [...this._startTimes.keys()];
    return keys[keys.length - 1] ?? "unknown";
  }
}
