import { describe, it, expect } from "vitest";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";

const SAMPLE_INI = [
  "[DRAIN]",
  "sim_th = 0.5",
  "depth = 5",
  "max_children = 200",
  "max_clusters = 1024",
  'extra_delimiters = ["_", ":"]',
  "parametrize_numeric_tokens = False",
  "",
  "[MASKING]",
  'masking = [{"regex_pattern": "\\\\d+", "mask_with": "NUM"}, {"regex_pattern": "\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}\\\\.\\\\d{1,3}", "mask_with": "IP"}]',
  "mask_prefix = <:",
  "mask_suffix = :>",
  "parameter_extraction_cache_capacity = 500",
  "",
  "[SNAPSHOT]",
  "snapshot_interval_minutes = 10",
  "compress_state = True",
  "",
  "[PROFILING]",
  "enabled = True",
  "report_sec = 30",
].join("\n");

describe("TemplateMinerConfig.fromIni", () => {
  it("should parse DRAIN section", () => {
    const c = TemplateMinerConfig.fromIni(SAMPLE_INI);
    expect(c.simTh).toBe(0.5);
    expect(c.depth).toBe(5);
    expect(c.maxChildren).toBe(200);
    expect(c.maxClusters).toBe(1024);
    expect(c.drainExtraDelimiters).toEqual(["_", ":"]);
    expect(c.parametrizeNumericTokens).toBe(false);
  });

  it("should parse MASKING section", () => {
    const c = TemplateMinerConfig.fromIni(SAMPLE_INI);
    expect(c.maskingInstructions).toHaveLength(2);
    expect(c.maskingInstructions[0]?.maskName).toBe("NUM");
    expect(c.maskingInstructions[1]?.maskName).toBe("IP");
    expect(c.maskPrefix).toBe("<:");
    expect(c.maskSuffix).toBe(":>");
    expect(c.parameterExtractionCacheCapacity).toBe(500);
  });

  it("should parse SNAPSHOT section", () => {
    const c = TemplateMinerConfig.fromIni(SAMPLE_INI);
    expect(c.snapshotIntervalMinutes).toBe(10);
    expect(c.snapshotCompressState).toBe(true);
  });

  it("should parse PROFILING section", () => {
    const c = TemplateMinerConfig.fromIni(SAMPLE_INI);
    expect(c.profilingEnabled).toBe(true);
    expect(c.profilingReportSec).toBe(30);
  });

  it("should use defaults for missing sections", () => {
    const c = TemplateMinerConfig.fromIni("[DRAIN]\nsim_th = 0.9\n");
    expect(c.simTh).toBe(0.9);
    expect(c.depth).toBe(4);
    expect(c.maskingInstructions).toHaveLength(0);
  });

  it("should handle engine selection", () => {
    const c = TemplateMinerConfig.fromIni("[DRAIN]\nengine = JaccardDrain\nsim_th = 0.6\n");
    expect(c.engine).toBe("JaccardDrain");
    expect(c.simTh).toBe(0.6);
  });

  it("should handle null max_clusters", () => {
    const c = TemplateMinerConfig.fromIni("[DRAIN]\nmax_clusters = None\n");
    expect(c.maxClusters).toBe(null);
  });

  it("should handle comments and empty lines", () => {
    const c = TemplateMinerConfig.fromIni("# Comment\n[DRAIN]\n; Comment\nsim_th = 0.3\n");
    expect(c.simTh).toBe(0.3);
  });

  it("should use defaults with empty content", () => {
    const c = TemplateMinerConfig.fromIni("");
    expect(c.simTh).toBe(0.4);
    expect(c.depth).toBe(4);
  });
});
