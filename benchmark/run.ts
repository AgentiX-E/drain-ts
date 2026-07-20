/**
 * Benchmark runner for drain-ts.
 *
 * Loads log datasets, processes them through TemplateMiner,
 * and evaluates accuracy against ground truth using the four
 * standard Loghub metrics: GA, FGA, PTA, FTA.
 *
 * Usage:
 *   npx tsx benchmark/run.ts [--dataset <name>] [--all] [--perf]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import * as https from "node:https";
import { TemplateMiner } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";
import {
  evaluate,
  type GroundTruthEntry,
  type ParsedEntry,
} from "./evaluator.js";

// ============================================================
// Dataset definitions
// ============================================================

interface DatasetDescriptor {
  /** Dataset name (matches Loghub directory name). */
  name: string;
  /** URL to the raw 2k log file on GitHub. */
  logUrl: string;
  /** URL to the ground truth structured CSV. */
  groundTruthUrl: string;
  /** Category label. */
  category: string;
  /** Target GA threshold for pass/fail. */
  targetGA: number;
  /** Target PTA threshold for pass/fail. */
  targetPTA: number;
}

const DATASETS: DatasetDescriptor[] = [
  {
    name: "HDFS",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HDFS/HDFS_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HDFS/HDFS_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.995,
    targetPTA: 0.990,
  },
  {
    name: "Hadoop",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Hadoop/Hadoop_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Hadoop/Hadoop_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.940,
    targetPTA: 0.850,
  },
  {
    name: "Spark",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Spark/Spark_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Spark/Spark_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.910,
    targetPTA: 0.650,
  },
  {
    name: "OpenStack",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/OpenStack/OpenStack_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/OpenStack/OpenStack_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.850,
    targetPTA: 0.750,
  },
  {
    name: "Zookeeper",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Zookeeper/Zookeeper_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Zookeeper/Zookeeper_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.980,
    targetPTA: 0.900,
  },
  {
    name: "BGL",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/BGL/BGL_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/BGL/BGL_2k.log_structured.csv",
    category: "Supercomputers",
    targetGA: 0.960,
    targetPTA: 0.900,
  },
  {
    name: "HPC",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HPC/HPC_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HPC/HPC_2k.log_structured.csv",
    category: "Supercomputers",
    targetGA: 0.930,
    targetPTA: 0.850,
  },
  {
    name: "Linux",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Linux/Linux_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Linux/Linux_2k.log_structured.csv",
    category: "Operating Systems",
    targetGA: 0.750,
    targetPTA: 0.600,
  },
  {
    name: "Mac",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Mac/Mac_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Mac/Mac_2k.log_structured.csv",
    category: "Operating Systems",
    targetGA: 0.850,
    targetPTA: 0.700,
  },
  {
    name: "Apache",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Apache/Apache_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Apache/Apache_2k.log_structured.csv",
    category: "Server Applications",
    targetGA: 0.990,
    targetPTA: 0.950,
  },
  {
    name: "OpenSSH",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/OpenSSH/OpenSSH_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/OpenSSH/OpenSSH_2k.log_structured.csv",
    category: "Server Applications",
    targetGA: 0.880,
    targetPTA: 0.800,
  },
  {
    name: "Windows",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Windows/Windows_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Windows/Windows_2k.log_structured.csv",
    category: "Operating Systems",
    targetGA: 0.990,
    targetPTA: 0.960,
  },
  {
    name: "Android",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Android/Android_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Android/Android_2k.log_structured.csv",
    category: "Mobile Systems",
    targetGA: 0.900,
    targetPTA: 0.800,
  },
  {
    name: "HealthApp",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HealthApp/HealthApp_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HealthApp/HealthApp_2k.log_structured.csv",
    category: "Mobile Systems",
    targetGA: 0.850,
    targetPTA: 0.750,
  },
  {
    name: "Proxifier",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Proxifier/Proxifier_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Proxifier/Proxifier_2k.log_structured.csv",
    category: "Standalone Software",
    targetGA: 0.950,
    targetPTA: 0.900,
  },
];

// ============================================================
// HTTP fetch helper
// ============================================================

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "drain-ts-benchmark/0.1" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          fetchUrl(res.headers.location!).then(resolve, reject);
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
// Ground truth parsing
// ============================================================

/**
 * Parses the Loghub ground truth CSV format.
 *
 * Format: each line is a structured log with placeholders like <*>.
 * The template ID is derived from the unique template strings.
 */
function parseGroundTruth(csvContent: string): GroundTruthEntry[] {
  const lines = csvContent.trim().split("\n");
  const entries: GroundTruthEntry[] = [];
  const templateToId = new Map<string, number>();
  let nextId = 1;

  for (const line of lines) {
    // The structured CSV has columns separated by commas
    // Column 0: line ID, Columns 1+: structured content tokens
    const cols = line.split(",");
    // Reconstruct the template by joining all columns after the first
    const templateStr = cols.slice(1).join(" ").trim();
    const templateTokens = templateStr.length > 0 ? templateStr.split(/\s+/) : [];

    if (!templateToId.has(templateStr)) {
      templateToId.set(templateStr, nextId++);
    }

    entries.push({
      logLine: line,
      templateTokens,
      templateId: templateToId.get(templateStr)!,
    });
  }

  return entries;
}

/**
 * Parses the raw log file.
 * Returns an array of log lines (without trailing newlines).
 */
function parseLogFile(content: string): string[] {
  return content
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ============================================================
// Main benchmark runner
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

async function runDataset(ds: DatasetDescriptor): Promise<BenchmarkRow> {
  const logContent = await fetchUrl(ds.logUrl);
  const gtContent = await fetchUrl(ds.groundTruthUrl);

  const logLines = parseLogFile(logContent);
  const groundTruth = parseGroundTruth(gtContent);

  // Run drain-ts
  const miner = new TemplateMiner({
    config: TemplateMinerConfig.from({
      simTh: 0.4,
      depth: 4,
      maxChildren: 100,
    }),
  });

  const startTime = performance.now();

  const parsed: ParsedEntry[] = [];
  for (const line of logLines) {
    const result = miner.addLogMessage(line);
    parsed.push({
      clusterId: result.clusterId,
      templateTokens: result.templateMined.split(" "),
    });
  }

  const durationMs = performance.now() - startTime;

  // Evaluate
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

function printResults(rows: BenchmarkRow[]): void {
  console.log(
    "\n╔═══════════════╤══════════╤═══════╤═══════╤═══════╤═══════╤══════════╤══════════╗",
  );
  console.log(
    "║ Dataset       │ Category │   GA  │  FGA  │  PTA  │  FTA  │  GA Pass │ PTA Pass ║",
  );
  console.log(
    "╟───────────────┼──────────┼───────┼───────┼───────┼───────┼──────────┼──────────╢",
  );

  let totalGA = 0;
  let totalPTA = 0;

  for (const r of rows) {
    const gaPass = r.gaPass ? "✓" : "✗";
    const ptaPass = r.ptaPass ? "✓" : "✗";
    console.log(
      `║ ${r.dataset.padEnd(13)} │ ${r.category.padEnd(8)} │ ${r.ga.toFixed(3).padStart(5)} │ ${r.fga.toFixed(3).padStart(5)} │ ${r.pta.toFixed(3).padStart(5)} │ ${r.fta.toFixed(3).padStart(5)} │ ${gaPass.padStart(8)} │ ${ptaPass.padStart(8)} ║`,
    );
    totalGA += r.ga;
    totalPTA += r.pta;
  }

  console.log(
    "╟───────────────┼──────────┼───────┼───────┼───────┼───────┼──────────┼──────────╢",
  );
  const avgGA = totalGA / rows.length;
  const avgPTA = totalPTA / rows.length;
  console.log(
    `║ AVERAGE       │          │ ${avgGA.toFixed(3).padStart(5)} │       │ ${avgPTA.toFixed(3).padStart(5)} │       │          │          ║`,
  );
  console.log(
    "╚═══════════════╧══════════╧═══════╧═══════╧═══════╧═══════╧══════════╧══════════╝\n",
  );

  // Performance summary
  console.log("Performance:");
  for (const r of rows) {
    const logsPerSec = (r.totalMessages / (r.durationMs / 1000)).toFixed(0);
    console.log(
      `  ${r.dataset.padEnd(13)}: ${r.durationMs.toFixed(0).padStart(6)}ms  (${logsPerSec} logs/sec)`,
    );
  }

  // Overall status
  const allGAPass = rows.every((r) => r.gaPass);
  const allPTAPass = rows.every((r) => r.ptaPass);
  console.log("\nOverall Status:");
  console.log(`  GA:  ${allGAPass ? "✅ ALL PASS" : "❌ SOME FAIL"}`);
  console.log(`  PTA: ${allPTAPass ? "✅ ALL PASS" : "❌ SOME FAIL"}`);
}

// ============================================================
// Entry point
// ============================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const datasetArg = args[0];

  let datasetsToRun = DATASETS;

  if (datasetArg && datasetArg !== "--all") {
    datasetsToRun = DATASETS.filter(
      (ds) => ds.name.toLowerCase() === datasetArg.toLowerCase(),
    );
    if (datasetsToRun.length === 0) {
      console.error(`Unknown dataset: ${datasetArg}`);
      console.error(`Available: ${DATASETS.map((d) => d.name).join(", ")}`);
      process.exit(1);
    }
  }

  console.log(`drain-ts Benchmark Suite`);
  console.log(`Running ${datasetsToRun.length} dataset(s)...\n`);

  const results: BenchmarkRow[] = [];

  for (const ds of datasetsToRun) {
    process.stdout.write(`  ${ds.name}... `);
    try {
      const result = await runDataset(ds);
      results.push(result);
      console.log(
        `GA=${result.ga.toFixed(3)} PTA=${result.pta.toFixed(3)} ${result.durationMs.toFixed(0)}ms`,
      );
    } catch (err) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }

  if (results.length > 0) {
    printResults(results);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
