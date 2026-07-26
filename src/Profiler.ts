/**
 * Profiler — performance measurement instrumentation.
 *
 * Maps 1:1 to Python Drain3 profiling system (drain3/simple_profiler.py).
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
  startSection(name: string): void;
  endSection(name?: string): void;
  report(intervalSec: number): void;
}

// ============================================================
// NullProfiler
// ============================================================

export class NullProfiler implements Profiler {
  startSection(_name: string): void {}
  endSection(_name?: string): void {}
  report(_intervalSec: number): void {}
}

// ============================================================
// ProfiledSectionStats
// ============================================================

/**
 * Per-section cumulative timing statistics.
 *
 * Python: ProfiledSectionStats
 */
class ProfiledSectionStats {
  sectionName: string;
  startTimeSec: number = 0;
  sampleCount: number = 0;
  totalTimeSec: number = 0;
  sampleCountBatch: number = 0;
  totalTimeSecBatch: number = 0;

  constructor(sectionName: string) {
    this.sectionName = sectionName;
  }

  toString(
    enclosingTimeSec: number,
    includeBatchRates: boolean,
  ): string {
    let tookText = `${(this.totalTimeSec * 1000).toFixed(2)} ms`;
    if (enclosingTimeSec > 0) {
      const pct = (100 * this.totalTimeSec) / enclosingTimeSec;
      tookText += ` (${pct.toFixed(2)}%)`;
    }

    const msPerKSamples = (
      (1_000_000 * this.totalTimeSec) /
      this.sampleCount
    ).toFixed(2);

    let samplesPerSec: string;
    if (this.totalTimeSec > 0) {
      samplesPerSec = (this.sampleCount / this.totalTimeSec).toFixed(2);
    } else {
      samplesPerSec = "N/A";
    }

    if (includeBatchRates) {
      const batchMs = (
        (1_000_000 * this.totalTimeSecBatch) /
        this.sampleCountBatch
      ).toFixed(2);
      const batchHz =
        this.totalTimeSecBatch > 0
          ? (this.sampleCountBatch / this.totalTimeSecBatch).toFixed(2)
          : "N/A";
      return (
        `${this.sectionName.padEnd(15)}: took ${tookText}, ` +
        `${this.sampleCount.toLocaleString().padStart(10)} samples, ` +
        `${msPerKSamples} (${batchMs}) ms / 1000 samples, ` +
        `${samplesPerSec} (${batchHz}) hz`
      );
    }

    return (
      `${this.sectionName.padEnd(15)}: took ${tookText}, ` +
      `${this.sampleCount.toLocaleString().padStart(10)} samples, ` +
      `${msPerKSamples} ms / 1000 samples, ` +
      `${samplesPerSec} hz`
    );
  }
}

// ============================================================
// SimpleProfiler
// ============================================================

/**
 * Simple wall-clock profiler with batch rate support.
 *
 * Python: SimpleProfiler
 *
 * Features:
 * - Cumulative timing per section
 * - Batch rates (reset_after_sample_count)
 * - Enclosing section percentage calculation
 * - Custom printer function
 * - Sorted descending output by total time
 * - Hz calculation (samples/sec)
 *
 * Section nesting is NOT supported. Each startSection must be
 * followed by an endSection for the same or last section.
 */
export class SimpleProfiler implements Profiler {
  private readonly _sections = new Map<string, ProfiledSectionStats>();
  private _lastReportTimestamp: number;
  private _lastStartedSectionName: string = "";
  private readonly _printer: (msg: string) => void;
  private readonly _enclosingSectionName: string;
  private readonly _resetAfterSampleCount: number;

  /**
   * @param resetAfterSampleCount - After this many samples, reset batch counters.
   *   Batch rates are shown in parentheses. Default: 0 (no batch reset).
   * @param enclosingSectionName - Section name for percentage calculation (e.g. "total").
   *   Default: "total".
   * @param printer - Output function. Default: `console.log`.
   */
  constructor(
    resetAfterSampleCount: number = 0,
    enclosingSectionName: string = "total",
    printer: (msg: string) => void = console.log,
  ) {
    this._resetAfterSampleCount = resetAfterSampleCount;
    this._enclosingSectionName = enclosingSectionName;
    this._printer = printer;
    this._lastReportTimestamp = performance.now() / 1000;
  }

  /**
   * Begin timing a named section.
   *
   * Python: SimpleProfiler.start_section(section_name)
   */
  startSection(name: string): void {
    if (!name) {
      throw new Error("Section name is empty");
    }

    this._lastStartedSectionName = name;

    let section = this._sections.get(name);
    if (!section) {
      section = new ProfiledSectionStats(name);
      this._sections.set(name, section);
    }

    if (section.startTimeSec !== 0) {
      throw new Error(`Section "${name}" is already started`);
    }

    section.startTimeSec = performance.now() / 1000;
  }

  /**
   * End timing for a section.
   *
   * Python: SimpleProfiler.end_section(name)
   *
   * @param name - Section name. If omitted, ends the last started section.
   */
  endSection(name: string = ""): void {
    const now = performance.now() / 1000;
    const sectionName = name || this._lastStartedSectionName;

    if (!sectionName) {
      throw new Error(
        "Neither section name is specified nor a section is started",
      );
    }

    const section = this._sections.get(sectionName);
    if (!section) {
      throw new Error(`Section "${sectionName}" does not exist`);
    }

    if (section.startTimeSec === 0) {
      throw new Error(`Section "${sectionName}" was not started`);
    }

    const tookSec = now - section.startTimeSec;

    // Reset batch counters if threshold reached (before incrementing)
    if (
      this._resetAfterSampleCount > 0 &&
      section.sampleCount === this._resetAfterSampleCount
    ) {
      section.sampleCountBatch = 0;
      section.totalTimeSecBatch = 0;
    }

    section.sampleCount += 1;
    section.totalTimeSec += tookSec;
    section.sampleCountBatch += 1;
    section.totalTimeSecBatch += tookSec;
    section.startTimeSec = 0;
  }

  /**
   * Output a profiling report at the given interval.
   *
   * Python: SimpleProfiler.report(period_sec)
   *
   * @param periodSec - Minimum seconds between reports.
   */
  report(periodSec: number = 30): void {
    const now = performance.now() / 1000;
    if (now - this._lastReportTimestamp < periodSec) return;

    this._lastReportTimestamp = now;

    // Calculate enclosing time for percentage display
    let enclosingTimeSec = 0;
    if (this._enclosingSectionName) {
      const enclosing = this._sections.get(this._enclosingSectionName);
      if (enclosing) {
        enclosingTimeSec = enclosing.totalTimeSec;
      }
    }

    const includeBatchRates = this._resetAfterSampleCount > 0;
    const sections = [...this._sections.values()];

    // Sort descending by total time
    sections.sort((a, b) => b.totalTimeSec - a.totalTimeSec);

    const lines = sections.map((s) =>
      s.toString(enclosingTimeSec, includeBatchRates),
    );

    this._printer(lines.join("\n"));
  }
}
