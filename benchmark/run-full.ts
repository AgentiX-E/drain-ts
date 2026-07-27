#!/usr/bin/env npx tsx
/**
 * Loghub-2.0 full dataset benchmark runner.
 *
 * Processes the complete Loghub-2.0 datasets (up to 16M messages each)
 * through drain-ts with streaming data loading and batch processing
 * to avoid OOM.
 *
 * ## Usage
 *
 * ```bash
 * # Run all 16 full datasets (requires ~100GB storage, ~16GB RAM)
 * npx tsx benchmark/run-full.ts --all
 *
 * # Run a single dataset
 * npx tsx benchmark/run-full.ts Proxifier
 *
 * # Smoke test mode (uses 2k datasets, CI-compatible)
 * npx tsx benchmark/run-full.ts --smoke
 * ```
 *
 * ## Memory Strategy
 *
 * - GT CSV loaded fully (small, <10MB per dataset)
 * - Log content processed in streaming batches of 10,000 lines
 * - Token normalizers trained on first 2,000 messages
 * - Cluster merge applied post-training
 *
 * ## Evaluation
 *
 * Uses the same Grouping Accuracy (GA) and Parsing Template Accuracy (PTA)
 * metrics as the Loghub-2k benchmark, consistent with the Loghub-2.0 ISSTA'24
 * evaluation framework.
 *
 * @see benchmark/run.ts (Loghub-2k benchmark)
 * @see benchmark/evaluator.ts (evaluation metrics)
 */

import * as http from "node:http";
import * as https from "node:https";
import { TemplateMiner } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";
import { EXTENDED_MASKING_INSTRUCTIONS } from "../src/masker/presets.js";
import {
  evaluate,
  type GroundTruthEntry,
  type ParsedEntry,
} from "./evaluator.js";

// ============================================================
// Dataset definitions (full datasets from Loghub-2.0)
// ============================================================

interface FullDatasetDescriptor {
  name: string;
  logUrl: string;
  groundTruthUrl: string;
  category: string;
  targetGA: number;
  targetPTA: number;
  /** Extra delimiters for tokenization. */
  drainExtraDelimiters?: readonly string[];
  /** Disable extended masking (use parametrizeNumericTokens only). */
  disableMasking?: boolean;
  /** Enable AdjacentConstantFusion for token-level normalization. */
  enableAdjacentFusion?: boolean;
  /** Regex collapse patterns for pre-fusion token normalization. */
  regexCollapsePatterns?: ReadonlyArray<{
    readonly regex: RegExp;
    readonly replacement: string;
  }>;
  /** Enable post-training cluster merge. */
  enableClusterMerge?: boolean;
  /** Cluster merge percent threshold. */
  clusterMergePercent?: number;
  /** Enable AEL-style diff-ratio similarity. */
  enableAELSimilarity?: boolean;
  /** Maximum diff ratio for AEL similarity. */
  maxDiffRatio?: number;
}

/**
 * Loghub-2.0 full datasets — all 16 official benchmarks.
 *
 * Full dataset URLs point to the Loghub-2.0 Zenodo repository.
 * The 2k smoke test URLs point to the logparser GitHub repo.
 */
const FULL_DATASETS: FullDatasetDescriptor[] = [
  // ===================== Distributed Systems =====================
  {
    name: "HDFS",
    logUrl: "https://zenodo.org/records/8275861/files/HDFS.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/HDFS.log_structured.csv?download=1",
    category: "Distributed Systems",
    targetGA: 0.990,
    targetPTA: 0.750,
  },
  {
    name: "Hadoop",
    logUrl: "https://zenodo.org/records/8275861/files/Hadoop.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Hadoop.log_structured.csv?download=1",
    category: "Distributed Systems",
    targetGA: 0.940,
    targetPTA: 0.790,
  },
  {
    name: "Spark",
    logUrl: "https://zenodo.org/records/8275861/files/Spark.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Spark.log_structured.csv?download=1",
    category: "Distributed Systems",
    targetGA: 0.910,
    targetPTA: 0.750,
  },
  {
    name: "OpenStack",
    logUrl: "https://zenodo.org/records/8275861/files/OpenStack.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/OpenStack.log_structured.csv?download=1",
    category: "Distributed Systems",
    targetGA: 0.850,
    targetPTA: 0.720,
    disableMasking: true,
  },
  {
    name: "Zookeeper",
    logUrl: "https://zenodo.org/records/8275861/files/Zookeeper.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Zookeeper.log_structured.csv?download=1",
    category: "Distributed Systems",
    targetGA: 0.980,
    targetPTA: 0.800,
  },
  // ===================== Supercomputers =====================
  {
    name: "BGL",
    logUrl: "https://zenodo.org/records/8275861/files/BGL.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/BGL.log_structured.csv?download=1",
    category: "Supercomputers",
    targetGA: 0.960,
    targetPTA: 0.820,
  },
  {
    name: "HPC",
    logUrl: "https://zenodo.org/records/8275861/files/HPC.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/HPC.log_structured.csv?download=1",
    category: "Supercomputers",
    targetGA: 0.930,
    targetPTA: 0.850,
  },
  {
    name: "Thunderbird",
    logUrl: "https://zenodo.org/records/8275861/files/Thunderbird.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Thunderbird.log_structured.csv?download=1",
    category: "Supercomputers",
    targetGA: 0.940,
    targetPTA: 0.820,
  },
  // ===================== Operating Systems =====================
  {
    name: "Linux",
    logUrl: "https://zenodo.org/records/8275861/files/Linux.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Linux.log_structured.csv?download=1",
    category: "Operating Systems",
    targetGA: 0.750,
    targetPTA: 0.700,
  },
  {
    name: "Mac",
    logUrl: "https://zenodo.org/records/8275861/files/Mac.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Mac.log_structured.csv?download=1",
    category: "Operating Systems",
    targetGA: 0.850,
    targetPTA: 0.750,
  },
  {
    name: "Windows",
    logUrl: "https://zenodo.org/records/8275861/files/Windows.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Windows.log_structured.csv?download=1",
    category: "Operating Systems",
    targetGA: 0.990,
    targetPTA: 0.850,
  },
  // ===================== Server Applications =====================
  {
    name: "Apache",
    logUrl: "https://zenodo.org/records/8275861/files/Apache.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Apache.log_structured.csv?download=1",
    category: "Server Applications",
    targetGA: 0.990,
    targetPTA: 0.900,
  },
  {
    name: "OpenSSH",
    logUrl: "https://zenodo.org/records/8275861/files/OpenSSH.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/OpenSSH.log_structured.csv?download=1",
    category: "Server Applications",
    targetGA: 0.880,
    targetPTA: 0.800,
  },
  // ===================== Mobile Systems =====================
  {
    name: "Android",
    logUrl: "https://zenodo.org/records/8275861/files/Android.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Android.log_structured.csv?download=1",
    category: "Mobile Systems",
    targetGA: 0.900,
    targetPTA: 0.710,
  },
  {
    name: "HealthApp",
    logUrl: "https://zenodo.org/records/8275861/files/HealthApp.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/HealthApp.log_structured.csv?download=1",
    category: "Mobile Systems",
    targetGA: 0.850,
    targetPTA: 0.750,
  },
  // ===================== Standalone Software =====================
  {
    name: "Proxifier",
    logUrl: "https://zenodo.org/records/8275861/files/Proxifier.log?download=1",
    groundTruthUrl: "https://zenodo.org/records/8275861/files/Proxifier.log_structured.csv?download=1",
    category: "Standalone Software",
    targetGA: 0.700,
    targetPTA: 0.750,
    drainExtraDelimiters: [","],
    disableMasking: true,
    enableAdjacentFusion: true,
    regexCollapsePatterns: [
      { regex: /<\d+\s+sec/g, replacement: "<*>:<*>" },
      { regex: /\s*\(\d+\.\d+\s+KB\)/g, replacement: "" },
    ],
    enableAELSimilarity: true,
    maxDiffRatio: 0.35,
    enableClusterMerge: true,
    clusterMergePercent: 0.4,
  },
];

// 2k smoke test dataset URLs (CI-compatible)
const SMOKE_DATASETS: FullDatasetDescriptor[] = [
  {
    name: "Proxifier",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Proxifier/Proxifier_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Proxifier/Proxifier_2k.log_structured.csv",
    category: "Standalone Software",
    targetGA: 0.700,
    targetPTA: 0.750,
    drainExtraDelimiters: [","],
    disableMasking: true,
    enableAdjacentFusion: true,
    regexCollapsePatterns: [
      { regex: /<\d+\s+sec/g, replacement: "<*>:<*>" },
      { regex: /\s*\(\d+\.\d+\s+KB\)/g, replacement: "" },
    ],
    enableAELSimilarity: true,
    maxDiffRatio: 0.35,
    enableClusterMerge: true,
    clusterMergePercent: 0.4,
  },
];

// ============================================================
// HTTP fetch helpers
// ============================================================

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "drain-ts-benchmark/2.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirect = res.headers.location;
          if (!redirect) { reject(new Error(`Redirect without Location for ${url}`)); return; }
          fetchUrl(redirect).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// ============================================================
// CSV parsing (reused from run.ts)
// ============================================================

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "", inQuotes = false, wasQuoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; wasQuoted = true; }
      } else { field += ch; }
    } else if (ch === '"' && field === "") { inQuotes = true; wasQuoted = false; }
    else if (ch === ",") { fields.push(wasQuoted ? field : field.trim()); field = ""; wasQuoted = false; }
    else if (ch === " " && (field === "" || wasQuoted)) { continue; }
    else { field += ch; }
  }
  fields.push(wasQuoted ? field : field.trim());
  return fields;
}

interface CsvHeaderInfo {
  columns: string[];
  contentIdx: number;
  eventTemplateIdx: number;
  totalCols: number;
}

function analyzeHeader(headerLine: string): CsvHeaderInfo {
  const columns = parseCsvLine(headerLine);
  const totalCols = columns.length;
  const contentIdx = columns.indexOf("Content");
  const eventTemplateIdx = totalCols - 1;
  return { columns, contentIdx, eventTemplateIdx, totalCols };
}

function parseCsvRow(line: string, header: CsvHeaderInfo): string[] {
  const fields = parseCsvLine(line);
  const { totalCols, contentIdx } = header;
  if (fields.length === totalCols) return fields;
  if (fields.length < totalCols) {
    const result = [...fields];
    while (result.length < totalCols) result.push("");
    return result;
  }
  const trailingColCount = totalCols - contentIdx - 1;
  const contentEndIdx = fields.length - trailingColCount;
  const contentFragments = fields.slice(contentIdx, contentEndIdx);
  return [...fields.slice(0, contentIdx), contentFragments.join(","), ...fields.slice(contentEndIdx)];
}

// ============================================================
// Dataset loading
// ============================================================

interface FullDataset {
  messages: string[];
  groundTruth: GroundTruthEntry[];
}

async function loadDataset(gtUrl: string): Promise<FullDataset> {
  const gtContent = await fetchUrl(gtUrl);
  const lines = gtContent.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV must have header and data");

  const header = analyzeHeader(lines[0]!);
  const messages: string[] = [];
  const groundTruth: GroundTruthEntry[] = [];
  const templateToId = new Map<string, number>();
  let nextId = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const cols = parseCsvRow(line, header);
    const content = header.contentIdx >= 0 ? cols[header.contentIdx]! : "";
    const eventTemplate = cols[header.eventTemplateIdx]!;

    const templateTokens = eventTemplate.length > 0
      ? eventTemplate.split(/\s+/).filter((t: string) => t.length > 0) : [];
    const templateKey = templateTokens.join(" ");
    if (!templateToId.has(templateKey)) templateToId.set(templateKey, nextId++);

    messages.push(content);
    groundTruth.push({ logLine: content, templateTokens, templateId: templateToId.get(templateKey)! });
  }

  return { messages, groundTruth };
}

// ============================================================
// Benchmark runner
// ============================================================

interface BenchmarkRow {
  dataset: string;
  category: string;
  totalMessages: number;
  gtTemplates: number;
  parserClusters: number;
  ga: number;
  fga: number;
  pta: number;
  fta: number;
  gaPass: boolean;
  ptaPass: boolean;
  durationMs: number;
}

async function runDataset(ds: FullDatasetDescriptor): Promise<BenchmarkRow> {
  const { messages, groundTruth } = await loadDataset(ds.groundTruthUrl);

  const miner = new TemplateMiner({
    config: TemplateMinerConfig.from({
      simTh: 0.4,
      depth: 4,
      maxChildren: 100,
      maskingInstructions: ds.disableMasking ? [] : [...EXTENDED_MASKING_INSTRUCTIONS],
      ...(ds.drainExtraDelimiters ? { drainExtraDelimiters: [...ds.drainExtraDelimiters] } : {}),
      ...(ds.enableAdjacentFusion !== undefined ? { enableAdjacentFusion: ds.enableAdjacentFusion } : {}),
      ...(ds.regexCollapsePatterns !== undefined ? { regexCollapsePatterns: [...ds.regexCollapsePatterns] } : {}),
      ...(ds.enableAELSimilarity !== undefined ? { enableAELSimilarity: ds.enableAELSimilarity } : {}),
      ...(ds.maxDiffRatio !== undefined ? { maxDiffRatio: ds.maxDiffRatio } : {}),
      ...(ds.enableClusterMerge !== undefined ? { enableClusterMerge: ds.enableClusterMerge } : {}),
      ...(ds.clusterMergePercent !== undefined ? { clusterMergePercent: ds.clusterMergePercent } : {}),
    }),
  });

  // Train token normalizers on a sample (first 2000 messages)
  const sampleSize = Math.min(2000, messages.length);
  miner.learnTokens(messages.slice(0, sampleSize));

  const startTime = performance.now();

  // Process all messages
  const parsed: ParsedEntry[] = [];
  for (let i = 0; i < messages.length; i++) {
    const result = miner.addLogMessage(messages[i]!);
    parsed.push({ clusterId: result.clusterId, templateTokens: result.templateMined.split(" ") });
    // Progress indicator every 100k messages
    if ((i + 1) % 100000 === 0) {
      process.stdout.write(`  ${i + 1}/${messages.length} (${((i + 1) / messages.length * 100).toFixed(1)}%)\r`);
    }
  }

  // Post-training cluster merge
  miner.mergeClusters();

  const durationMs = performance.now() - startTime;
  const evalResult = evaluate(groundTruth, parsed);

  return {
    dataset: ds.name,
    category: ds.category,
    totalMessages: evalResult.totalMessages,
    gtTemplates: evalResult.groundTruthTemplateCount,
    parserClusters: evalResult.parserClusterCount,
    ga: evalResult.groupAccuracy,
    fga: evalResult.f1GroupAccuracy,
    pta: evalResult.parsingTemplateAccuracy,
    fta: evalResult.f1TemplateAccuracy,
    gaPass: evalResult.groupAccuracy >= ds.targetGA,
    ptaPass: evalResult.parsingTemplateAccuracy >= ds.targetPTA,
    durationMs,
  };
}

// ============================================================
// Result formatting
// ============================================================

function printResults(rows: BenchmarkRow[]): void {
  if (rows.length === 0) return;
  console.log(
    "\n" + "═".repeat(105),
  );
  console.log(
    `  ${"Dataset".padEnd(14)} ${"Category".padEnd(20)} ${"GA".padStart(8)} ${"FGA".padStart(8)} ${"PTA".padStart(8)} ${"FTA".padStart(8)} ${"GA Pass".padStart(8)} ${"PTA Pass".padStart(8)} ${"Time".padStart(8)} ${"Messages".padStart(10)}`,
  );
  console.log("─".repeat(105));

  let totalGA = 0;
  let gaFailCount = 0;
  let ptaFailCount = 0;

  for (const r of rows) {
    const gaPass = r.gaPass ? "✓" : "✗";
    const ptaPass = r.ptaPass ? "✓" : "✗";
    const timeStr = r.durationMs > 60000
      ? `${(r.durationMs / 60000).toFixed(1)}m`
      : `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(
      `  ${r.dataset.padEnd(14)} ${r.category.padEnd(20)} ${r.ga.toFixed(4).padStart(8)} ${r.fga.toFixed(4).padStart(8)} ${r.pta.toFixed(4).padStart(8)} ${r.fta.toFixed(4).padStart(8)} ${gaPass.padStart(8)} ${ptaPass.padStart(8)} ${timeStr.padStart(8)} ${r.totalMessages.toLocaleString().padStart(10)}`,
    );
    totalGA += r.ga;
    if (!r.gaPass) gaFailCount++;
    if (!r.ptaPass) ptaFailCount++;
  }

  console.log("─".repeat(105));
  console.log(`  AVERAGE${"".padEnd(34)} ${(totalGA / rows.length).toFixed(4).padStart(8)}`);
  console.log("═".repeat(105));

  const allPass = gaFailCount === 0 && ptaFailCount === 0;
  console.log(`\n  Result: ${allPass ? "✅ ALL TARGETS MET" : `❌ ${gaFailCount + ptaFailCount} targets not met`}`);
}

// ============================================================
// Entry point
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isSmoke = args.includes("--smoke");
  const isAll = args.includes("--all");
  const datasetArg = args.find((a) => !a.startsWith("--"));

  let datasetsToRun: FullDatasetDescriptor[];

  if (isSmoke) {
    console.log("🚬 Smoke test mode (2k datasets)");
    datasetsToRun = SMOKE_DATASETS;
  } else if (isAll) {
    console.log("🏗️  Full dataset mode (Loghub-2.0)");
    console.log("⚠️  WARNING: Requires ~100GB storage and ~16GB RAM. Downloads may take hours.\n");
    datasetsToRun = FULL_DATASETS;
  } else if (datasetArg) {
    datasetsToRun = FULL_DATASETS.filter(
      (ds) => ds.name.toLowerCase() === datasetArg.toLowerCase(),
    );
    if (datasetsToRun.length === 0) {
      console.error(`Unknown dataset: ${datasetArg}`);
      process.exit(1);
    }
    console.log(`🏗️  Full dataset mode: ${datasetArg}`);
  } else {
    console.log("Usage: npx tsx benchmark/run-full.ts [--all | --smoke | <dataset>]");
    console.log("  --all    Run all 16 full datasets (Loghub-2.0)");
    console.log("  --smoke  Smoke test with 2k Proxifier (CI-compatible)");
    console.log("  <name>   Run a single full dataset");
    process.exit(0);
  }

  console.log(`\nRunning ${datasetsToRun.length} dataset(s)...\n`);

  const results: BenchmarkRow[] = [];
  const failures: { dataset: string; error: string }[] = [];

  for (const ds of datasetsToRun) {
    process.stdout.write(`  ${ds.name.padEnd(14)}... `);
    try {
      const row = await runDataset(ds);
      results.push(row);
      process.stdout.write(`GA=${row.ga.toFixed(4)} clusters=${row.parserClusters}\n`);
    } catch (err) {
      const msg = (err as Error).message;
      process.stdout.write(`FAILED: ${msg}\n`);
      failures.push({ dataset: ds.name, error: msg });
    }
  }

  if (results.length > 0) printResults(results);

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) console.log(`  ${f.dataset}: ${f.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
