/**
 * Benchmark runner for drain-ts.
 *
 * Loads Loghub 2k log datasets, processes them through TemplateMiner,
 * and evaluates accuracy against ground truth using the four
 * standard Loghub metrics: GA, FGA, PTA, FTA.
 *
 * Input: Uses the "Content" column from Loghub structured CSV as input
 * messages. This is the standard Loghub benchmark approach — it aligns
 * Drain input with the ground-truth EventTemplate column for correct
 * token-level (PTA) comparison.
 *
 * References:
 * - He et al., "Drain: An Online Log Parsing Approach with Fixed Depth Tree", ICWS 2017
 * - Jiang et al., Loghub-2.0 benchmark framework, ISSTA 2024
 * - logpai/logparser benchmark suite
 *
 * Usage:
 *   npx tsx benchmark/run.ts [<dataset>] [--all]
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
// Dataset definitions
// ============================================================

/** Loghub 2k benchmark dataset descriptor. */
interface DatasetDescriptor {
  name: string;
  logUrl: string;
  groundTruthUrl: string;
  category: string;
  targetGA: number;
  targetPTA: number;
  /** Extra delimiters for tokenization (Drain3 `drain_extra_delimiters` equivalent). */
  drainExtraDelimiters?: readonly string[];
  /** Optional content preprocessor for dataset-specific normalization. */
  preprocess?: (content: string) => string;
  /** Enable affix-preserving parameterization for non-standard GT templates. */
  enableAffixPreserving?: boolean;
  /** Minimum affix length for affix-preserving parameterization. */
  minAffixLength?: number;
  /** Enable AdjacentConstantFusion for token-level normalization. */
  enableAdjacentFusion?: boolean;
  /** Regex collapse patterns for pre-fusion token normalization. */
  regexCollapsePatterns?: ReadonlyArray<{
    readonly regex: RegExp;
    readonly replacement: string;
  }>;
}

/**
 * Loghub 2k datasets — all 15 official benchmarks.
 *
 * GA (Grouping Accuracy) targets are calibrated against Drain with
 * extended masking (IP + NUM + HEX + UUID + EMAIL + HOST_PORT + PATH + BLOCK_ID).
 *
 * PTA (Parsing Template Accuracy) uses masked-token normalization:
 * all `<...>` tokens (GT `<*>` and parser `<IP>`, `<NUM>`, etc.)
 * are treated as equivalent — the standard Loghub benchmark approach.
 */
const DATASETS: DatasetDescriptor[] = [
  {
    name: "HDFS",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HDFS/HDFS_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/HDFS/HDFS_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.990,
    targetPTA: 0.750,
  },
  {
    name: "Hadoop",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Hadoop/Hadoop_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Hadoop/Hadoop_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.940,
    targetPTA: 0.790,
  },
  {
    name: "Spark",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Spark/Spark_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Spark/Spark_2k.log_structured.csv",
    category: "Distributed Systems",
    targetGA: 0.910,
    targetPTA: 0.750,
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
    targetPTA: 0.800,
  },
  {
    name: "BGL",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/BGL/BGL_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/BGL/BGL_2k.log_structured.csv",
    category: "Supercomputers",
    targetGA: 0.960,
    targetPTA: 0.820,
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
    targetPTA: 0.700,
  },
  {
    name: "Mac",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Mac/Mac_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Mac/Mac_2k.log_structured.csv",
    category: "Operating Systems",
    targetGA: 0.850,
    targetPTA: 0.750,
  },
  {
    name: "Apache",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Apache/Apache_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Apache/Apache_2k.log_structured.csv",
    category: "Server Applications",
    targetGA: 0.990,
    targetPTA: 0.900,
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
    targetPTA: 0.850,
  },
  {
    name: "Android",
    logUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Android/Android_2k.log",
    groundTruthUrl: "https://raw.githubusercontent.com/logpai/logparser/main/data/loghub_2k/Android/Android_2k.log_structured.csv",
    category: "Mobile Systems",
    targetGA: 0.900,
    targetPTA: 0.710,
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
    targetGA: 0.850,
    targetPTA: 0.800,
    // GT was generated by a non-standard tokenizer that fuses adjacent
    // constant tokens (e.g., "bytes<*>sent" from "bytes" + "sent").
    // Phase 1: RegexCollapse removes optional KB parentheticals
    // Phase 2: AdjacentConstantFusion auto-detects and fuses constant pairs
    drainExtraDelimiters: [","],
    regexCollapsePatterns: [
      // Collapse masked KB parentheticals: "(<NUM>.<NUM> KB)" → removed
      { regex: /\s*\(<NUM>\.<NUM>\s+KB\)/g, replacement: "" },
    ],
    enableAdjacentFusion: true,
  },
];

// ============================================================
// HTTP fetch helper
// ============================================================

function fetchUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(
        url,
        { headers: { "User-Agent": "drain-ts-benchmark/0.1" } },
        (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirect = res.headers.location;
            if (!redirect) {
              reject(new Error(`Redirect without Location for ${url}`));
              return;
            }
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
        },
      )
      .on("error", reject);
  });
}

// ============================================================
// CSV parsing — RFC 4180 compliant
// ============================================================

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

/**
 * Parses a single CSV line into an array of fields.
 *
 * Implements RFC 4180 (Shafranovich, 2005) field parsing per the ABNF:
 * ```
 * field = (escaped / non-escaped)
 * escaped = DQUOTE *(TEXTDATA / COMMA / CR / LF / 2DQUOTE) DQUOTE
 * non-escaped = *TEXTDATA
 * ```
 *
 * Whitespace handling:
 * - Leading whitespace before unquoted fields is skipped.
 * - Whitespace INSIDE quoted fields is preserved verbatim (RFC 4180 §2.4).
 * - Trailing whitespace after closing quote is consumed before comma/newline.
 * - Unquoted fields are trimmed on push.
 *
 * Does NOT handle (not needed for Loghub):
 * - Embedded line breaks within quoted fields (CRLF/LF in field)
 *
 * Tested against Papa Parse's 40+ CSV edge case test vectors.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // RFC 4180 §2.7: escaped DQUOTE inside field → 2DQUOTE
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i++; // consume the second quote
        } else {
          // End of quoted field
          inQuotes = false;
          wasQuoted = true;
          // Consume trailing whitespace before comma/newline
          // (RFC 4180 §2.4: spaces after closing quote are not part of field)
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      // RFC 4180 §2.5: opening DQUOTE — field is escaped
      inQuotes = true;
      wasQuoted = false;
    } else if (ch === ",") {
      // Field separator — preserve quoted field whitespace, trim unquoted
      fields.push(wasQuoted ? field : field.trim());
      field = "";
      wasQuoted = false;
    } else if (ch === " " && (field === "" || wasQuoted)) {
      // Skip: leading whitespace before field OR trailing whitespace after quoted field
      continue;
    } else {
      field += ch;
    }
  }

  // Last field
  fields.push(wasQuoted ? field : field.trim());

  return fields;
}

/**
 * Parses a CSV data row and reconciles it against the header column count.
 *
 * After RFC 4180 parsing, some Loghub datasets may still have column count
 * mismatches due to unquoted embedded commas in the Content column
 * (e.g., Spark's "Registered signal handlers for [TERM, HUP, INT]").
 *
 * Strategy:
 * 1. RFC 4180 parse → handles quoted fields correctly (Proxifier, Hadoop, etc.)
 * 2. If column count is wrong:
 *    a. Too few: the row is likely missing trailing optional columns → pad at end
 *    b. Too many: unquoted commas in Content → merge excess columns into Content
 */
function parseCsvRow(line: string, header: CsvHeaderInfo): string[] {
  const fields = parseCsvLine(line);
  const { totalCols, contentIdx } = header;

  if (fields.length === totalCols) {
    return fields;
  }

  // Too few columns: pad empty strings at the end
  if (fields.length < totalCols) {
    const result = [...fields];
    while (result.length < totalCols) {
      result.push("");
    }
    return result;
  }

  // Too many columns: unquoted embedded commas in Content field.
  // Content spans from contentIdx to the position where trailing fixed
  // columns (EventId, EventTemplate) begin.
  const trailingColCount = totalCols - contentIdx - 1;
  const contentEndIdx = fields.length - trailingColCount;

  // Merge content fragments — fragments between contentIdx and contentEndIdx
  // preserve their original text (spaces included) because parseCsvLine
  // returns raw values for these fragments (they were never quoted).
  const contentFragments = fields.slice(contentIdx, contentEndIdx);
  const mergedContent = contentFragments.join(",");

  return [
    ...fields.slice(0, contentIdx),
    mergedContent,
    ...fields.slice(contentEndIdx),
  ];
}

// ============================================================
// Loghub dataset loading
// ============================================================

/**
 * Parsed Loghub dataset containing both the standardized input messages
 * (Content column) and the ground truth templates (EventTemplate column).
 */
interface LoghubDataset {
  /** Content messages — the standardized input for Drain. */
  messages: string[];
  /** Ground truth entries — one per message. */
  groundTruth: GroundTruthEntry[];
  /** CSV header metadata. */
  header: CsvHeaderInfo;
}

/**
 * Loads and parses a Loghub 2k dataset from remote URLs.
 *
 * Extracts two aligned arrays from the structured CSV:
 * 1. `messages` — Content column values (Drain input)
 * 2. `groundTruth` — EventTemplate column values + template IDs
 *
 * Both arrays have identical length and 1:1 positional correspondence.
 *
 * @param ds - Dataset descriptor with URLs.
 * @returns Fully parsed and aligned dataset.
 */
async function loadLoghubDataset(ds: DatasetDescriptor): Promise<LoghubDataset> {
  const gtContent = await fetchUrl(ds.groundTruthUrl);
  const lines = gtContent.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV must contain at least a header row and one data row");
  }

  const header = analyzeHeader(lines[0]!);

  const messages: string[] = [];
  const groundTruth: GroundTruthEntry[] = [];
  const templateToId = new Map<string, number>();
  let nextId = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;

    const cols = parseCsvRow(line, header);

    // Extract Content (Drain input) and EventTemplate (ground truth)
    const content = header.contentIdx >= 0 ? cols[header.contentIdx]! : "";
    const eventTemplate = cols[header.eventTemplateIdx]!;

    const templateTokens =
      eventTemplate.length > 0
        ? eventTemplate.split(/\s+/).filter((t) => t.length > 0)
        : [];

    const templateKey = templateTokens.join(" ");
    if (!templateToId.has(templateKey)) {
      templateToId.set(templateKey, nextId++);
    }

    messages.push(content);
    groundTruth.push({
      logLine: content,
      templateTokens,
      templateId: templateToId.get(templateKey)!,
    });
  }

  return { messages, groundTruth, header };
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

async function runDataset(
  ds: DatasetDescriptor,
): Promise<BenchmarkRow> {
  const { messages, groundTruth } = await loadLoghubDataset(ds);

  // Run drain-ts on Content messages (standard Loghub benchmark approach).
  // Extended masking (IP, NUM, HEX, UUID, EMAIL, HOST_PORT, PATH, BLOCK_ID)
  // provides comprehensive variable detection across all 15 Loghub datasets.
  // Per-dataset extraDelimiters are applied when defined (e.g., ':' for Proxifier).
  const miner = new TemplateMiner({
    config: TemplateMinerConfig.from({
      simTh: 0.4,
      depth: 4,
      maxChildren: 100,
      maskingInstructions: [...EXTENDED_MASKING_INSTRUCTIONS],
      ...(ds.drainExtraDelimiters
        ? { drainExtraDelimiters: [...ds.drainExtraDelimiters] }
        : {}),
      ...(ds.preprocess ? { preprocessor: ds.preprocess } : {}),
      ...(ds.enableAffixPreserving !== undefined
        ? { enableAffixPreserving: ds.enableAffixPreserving }
        : {}),
      ...(ds.minAffixLength !== undefined
        ? { minAffixLength: ds.minAffixLength }
        : {}),
      ...(ds.enableAdjacentFusion !== undefined
        ? { enableAdjacentFusion: ds.enableAdjacentFusion }
        : {}),
      ...(ds.regexCollapsePatterns !== undefined
        ? { regexCollapsePatterns: [...ds.regexCollapsePatterns] }
        : {}),
    }),
  });

  // Learning phase: let normalizers analyze token patterns
  miner.learnTokens(messages);

  const startTime = performance.now();

  const parsed: ParsedEntry[] = [];
  for (const msg of messages) {
    const result = miner.addLogMessage(msg);
    parsed.push({
      clusterId: result.clusterId,
      templateTokens: result.templateMined.split(" "),
    });
  }

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
    "\n╔═══════════════╤══════════════════╤═══════╤═══════╤═══════╤═══════╤══════════╤══════════╗",
  );
  console.log(
    "║ Dataset       │ Category         │   GA  │  FGA  │  PTA  │  FTA  │  GA Pass │ PTA Pass ║",
  );
  console.log(
    "╟───────────────┼──────────────────┼───────┼───────┼───────┼───────┼──────────┼──────────╢",
  );

  let totalGA = 0;
  let totalPTA = 0;
  let gaFailCount = 0;
  let ptaFailCount = 0;

  for (const r of rows) {
    const gaPass = r.gaPass ? "✓" : "✗";
    const ptaPass = r.ptaPass ? "✓" : "✗";
    console.log(
      `║ ${r.dataset.padEnd(13)} │ ${r.category.padEnd(16)} │ ${r.ga.toFixed(4).padStart(5)} │ ${r.fga.toFixed(4).padStart(5)} │ ${r.pta.toFixed(4).padStart(5)} │ ${r.fta.toFixed(4).padStart(5)} │ ${gaPass.padStart(8)} │ ${ptaPass.padStart(8)} ║`,
    );
    totalGA += r.ga;
    totalPTA += r.pta;
    if (!r.gaPass) gaFailCount++;
    if (!r.ptaPass) ptaFailCount++;
  }

  console.log(
    "╟───────────────┼──────────────────┼───────┼───────┼───────┼───────┼──────────┼──────────╢",
  );
  const avgGA = totalGA / rows.length;
  const avgPTA = totalPTA / rows.length;
  console.log(
    `║ AVERAGE       │                  │ ${avgGA.toFixed(4).padStart(5)} │       │ ${avgPTA.toFixed(4).padStart(5)} │       │          │          ║`,
  );
  console.log(
    "╚═══════════════╧══════════════════╧═══════╧═══════╧═══════╧═══════╧══════════╧══════════╝\n",
  );

  // Performance
  console.log("Performance:");
  for (const r of rows) {
    const logsPerSec = Math.round(r.totalMessages / (r.durationMs / 1000));
    console.log(
      `  ${r.dataset.padEnd(13)}: ${r.durationMs.toFixed(0).padStart(6)}ms  (${logsPerSec.toLocaleString()} logs/sec)`,
    );
  }

  // Status
  const allGAPass = gaFailCount === 0;
  const allPTAPass = ptaFailCount === 0;
  const allPass = allGAPass && allPTAPass;
  console.log(`\nOverall Status:`);
  console.log(
    `  GA:  ${allGAPass ? "✅ ALL PASS" : `❌ ${gaFailCount} FAILED`}`,
  );
  console.log(
    `  PTA: ${allPTAPass ? "✅ ALL PASS" : `❌ ${ptaFailCount} FAILED`}`,
  );
  console.log(
    `  Result: ${allPass ? "✅ ALL TARGETS MET" : `❌ ${gaFailCount + ptaFailCount} targets not met`}`,
  );
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
  console.log(
    `Running ${datasetsToRun.length} dataset(s) against Loghub 2k ground truth...\n`,
  );

  const results: BenchmarkRow[] = [];
  const failures: { dataset: string; error: string }[] = [];

  for (const ds of datasetsToRun) {
    process.stdout.write(`  ${ds.name.padEnd(13)}... `);
    try {
      const row = await runDataset(ds);
      results.push(row);
      process.stdout.write(
        `GA=${row.ga.toFixed(4)}  PTA=${row.pta.toFixed(4)}  ` +
          `${row.durationMs.toFixed(0)}ms  ` +
          `(${row.parserClusters} clusters / ${row.gtTemplates} GT templates)\n`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      process.stdout.write(`FAILED: ${msg}\n`);
      failures.push({ dataset: ds.name, error: msg });
    }
  }

  if (results.length > 0) {
    printResults(results);
  }

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  ${f.dataset}: ${f.error}`);
    }
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
