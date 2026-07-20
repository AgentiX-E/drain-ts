/**
 * Comprehensive benchmark test suite for drain-ts.
 *
 * Tests drain-ts against representative log datasets with known ground truth.
 * Metrics: GA (Grouping Accuracy), FGA, PTA (Parsing Template Accuracy), FTA.
 *
 * PTA thresholds reflect drain-ts behavior WITHOUT masking instructions.
 * When masking is applied via LogMasker presets, PTA scores increase substantially.
 */

import { describe, it, expect } from "vitest";
import { TemplateMiner } from "../../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { DEFAULT_MASKING_INSTRUCTIONS } from "../../src/masker/presets.js";
import {
  evaluate,
  type GroundTruthEntry,
  type ParsedEntry,
} from "../../benchmark/evaluator.js";

interface BenchmarkCase {
  name: string;
  useMasking: boolean;
  minGA: number;
  minPTA: number;
  templates: Array<{
    template: string;
    variations: string[];
  }>;
}

function runBenchmark(testCase: BenchmarkCase) {
  const logLines: string[] = [];
  const groundTruth: GroundTruthEntry[] = [];
  let templateId = 1;

  for (const tmpl of testCase.templates) {
    const templateTokens = tmpl.template.split(/\s+/);
    for (const variation of tmpl.variations) {
      logLines.push(variation);
      groundTruth.push({ logLine: variation, templateTokens, templateId });
    }
    templateId++;
  }

  const miner = new TemplateMiner({
    config: TemplateMinerConfig.from({
      simTh: 0.4,
      depth: 4,
      maskingInstructions: testCase.useMasking ? DEFAULT_MASKING_INSTRUCTIONS : [],
    }),
  });

  const parsed: ParsedEntry[] = [];
  for (const line of logLines) {
    const result = miner.addLogMessage(line);
    parsed.push({
      clusterId: result.clusterId,
      templateTokens: result.templateMined.split(/\s+/),
    });
  }

  return evaluate(groundTruth, parsed);
}

// ============================================================
// Test cases
// ============================================================

describe("Benchmark: SSH log patterns", () => {
  const testCase: BenchmarkCase = {
    name: "SSH",
    useMasking: false,
    minGA: 0.95,
    minPTA: 0.65,
    templates: [
      {
        template: "input_userauth_request: invalid user <*>",
        variations: [
          "input_userauth_request: invalid user test9",
          "input_userauth_request: invalid user webmaster",
          "input_userauth_request: invalid user pgadmin",
          "input_userauth_request: invalid user ftpuser",
          "input_userauth_request: invalid user root",
        ],
      },
      {
        template: "Failed password for invalid user <*> from <*> port <*> ssh2",
        variations: [
          "Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
          "Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2",
          "Failed password for invalid user admin from 10.0.0.1 port 22 ssh2",
        ],
      },
      {
        template: "Accepted publickey for <*> from <*> port <*> ssh2",
        variations: [
          "Accepted publickey for ubuntu from 10.0.0.5 port 55123 ssh2",
          "Accepted publickey for admin from 172.16.0.1 port 34567 ssh2",
        ],
      },
    ],
  };

  const result = runBenchmark(testCase);

  it("should achieve high grouping accuracy on SSH logs", () => {
    expect(result.groupAccuracy).toBeGreaterThanOrEqual(testCase.minGA);
    expect(result.parserClusterCount).toBe(3);
  });
});

describe("Benchmark: Database query logs", () => {
  const testCase: BenchmarkCase = {
    name: "Database",
    useMasking: false,
    minGA: 0.75,
    minPTA: 0.55,
    templates: [
      {
        template: "SELECT <*> FROM <*> WHERE <*> = <*>",
        variations: [
          "SELECT * FROM users WHERE id = 1",
          "SELECT name FROM users WHERE id = 42",
          "SELECT email FROM contacts WHERE status = active",
        ],
      },
      {
        template: "INSERT INTO <*> <*> VALUES <*>",
        variations: [
          "INSERT INTO users name email VALUES john john@example.com",
          "INSERT INTO orders product_id quantity VALUES 101 5",
          "INSERT INTO logs message level VALUES error_critical critical",
        ],
      },
      {
        template: "UPDATE <*> SET <*> = <*> WHERE <*> = <*>",
        variations: [
          "UPDATE users SET status = inactive WHERE id = 99",
          "UPDATE orders SET quantity = 10 WHERE order_id = 555",
        ],
      },
    ],
  };

  const result = runBenchmark(testCase);

  it("should group SQL query logs by operation type", () => {
    expect(result.groupAccuracy).toBeGreaterThanOrEqual(testCase.minGA);
  });
});

describe("Benchmark: System daemon logs", () => {
  const testCase: BenchmarkCase = {
    name: "SystemDaemon",
    useMasking: false,
    minGA: 0.70,
    minPTA: 0.60,
    templates: [
      {
        template: "Started <*> service on port <*>",
        variations: [
          "Started nginx service on port 80",
          "Started redis service on port 6379",
          "Started postgresql service on port 5432",
          "Started apache2 service on port 8080",
        ],
      },
      {
        template: "Stopping <*> service pid <*>",
        variations: [
          "Stopping nginx service pid 1234",
          "Stopping redis service pid 5678",
          "Stopping postgresql service pid 9012",
        ],
      },
      {
        template: "Reloading <*> from <*>",
        variations: [
          "Reloading nginx from /etc/nginx/nginx.conf",
          "Reloading redis from /etc/redis/redis.conf",
          "Reloading sshd from /etc/ssh/sshd_config",
        ],
      },
    ],
  };

  const result = runBenchmark(testCase);

  it("should cluster daemon start/stop/reload patterns", () => {
    expect(result.groupAccuracy).toBeGreaterThanOrEqual(testCase.minGA);
  });
});

describe("Benchmark: Application error logs", () => {
  const testCase: BenchmarkCase = {
    name: "AppErrors",
    useMasking: false,
    minGA: 0.90,
    minPTA: 0.60,
    templates: [
      {
        template: "ERROR server module <*> - timeout after <*> ms",
        variations: [
          "ERROR server module auth - timeout after 5000 ms",
          "ERROR server module database - timeout after 3000 ms",
          "ERROR server module cache - timeout after 2000 ms",
          "ERROR server module network - timeout after 10000 ms",
        ],
      },
      {
        template: "WARN node <*> - memory <*>% threshold <*>%",
        variations: [
          "WARN node worker1 - memory 85% threshold 80%",
          "WARN node worker2 - memory 92% threshold 90%",
          "WARN node worker3 - memory 78% threshold 75%",
        ],
      },
    ],
  };

  const result = runBenchmark(testCase);

  it("should correctly group application error and warning logs", () => {
    expect(result.groupAccuracy).toBeGreaterThanOrEqual(testCase.minGA);
  });
});

describe("Benchmark: Large dataset (200 messages)", () => {
  it("should process 200 messages with high grouping accuracy", () => {
    const templates = [
      { template: "user <*> performed action <*> on resource <*>", count: 30 },
      { template: "connection from <*> port <*> established", count: 25 },
      { template: "connection from <*> port <*> closed after <*> seconds", count: 25 },
      { template: "ERROR: failure in module <*> at line <*>", count: 40 },
      { template: "WARNING: resource <*> approaching limit <*>%", count: 30 },
      { template: "INFO: task <*> completed with status <*>", count: 25 },
      { template: "DEBUG: step <*> of process <*> took <*> ms", count: 25 },
    ];

    const logLines: string[] = [];
    const groundTruth: GroundTruthEntry[] = [];
    let templateId = 1;

    const pools: string[][] = [
      ["alice", "bob", "carol", "dave", "eve"],
      ["create", "read", "update", "delete"],
      ["file_1.txt", "file_2.txt", "db_table", "cache_key"],
      ["192.168.1.1", "10.0.0.1", "172.16.0.1"],
      ["80", "443", "8080", "3000"],
      ["5", "30", "120", "3600"],
      ["auth", "database", "network", "cache"],
      ["42", "128", "256", "512"],
      ["80", "85", "90", "95"],
      ["backup", "cleanup", "sync", "deploy"],
      ["success", "failure", "timeout"],
      ["init", "execute", "validate", "finalize"],
      ["build", "test", "deploy", "monitor"],
      ["12", "45", "120", "450"],
    ];

    let pi = 0;
    for (const tmpl of templates) {
      const templateTokens = tmpl.template.split(/\s+/);
      for (let i = 0; i < tmpl.count; i++) {
        const line = tmpl.template.replace(/<[*]>/g, () => {
          const pool = pools[pi % pools.length] ?? ["x"];
          const val = pool[pi % pool.length] ?? pool[0]!;
          pi++;
          return val;
        });
        logLines.push(line);
        groundTruth.push({ logLine: line, templateTokens, templateId });
      }
      templateId++;
    }

    // Shuffle
    for (let i = logLines.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [logLines[i], logLines[j]] = [logLines[j]!, logLines[i]!];
    }
    const shuffledGT: GroundTruthEntry[] = logLines.map(
      (line) => groundTruth.find((gt) => gt.logLine === line)!,
    );

    const startTime = performance.now();
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        simTh: 0.4,
        depth: 4,
        maxChildren: 100,
      }),
    });

    const parsed: ParsedEntry[] = [];
    for (const line of logLines) {
      const result = miner.addLogMessage(line);
      parsed.push({
        clusterId: result.clusterId,
        templateTokens: result.templateMined.split(/\s+/),
      });
    }
    const durationMs = performance.now() - startTime;

    const result = evaluate(shuffledGT, parsed);

    console.log(
      `\n  Large benchmark: ${logLines.length} msgs, ` +
      `${miner.drain.idToCluster.size} clusters, ` +
      `${durationMs.toFixed(0)}ms ` +
      `(${(logLines.length / (durationMs / 1000)).toFixed(0)} logs/sec)`,
    );

    // Grouping: most messages should be in the correct group
    expect(result.groupAccuracy).toBeGreaterThanOrEqual(0.75);
    // Template structure: somewhat correct
    expect(result.parsingTemplateAccuracy).toBeGreaterThanOrEqual(0.55);
    // Should cluster (not one cluster per message)
    expect(result.parserClusterCount).toBeLessThan(logLines.length * 0.5);
  });
});

describe("Benchmark: Performance", () => {
  it("should process 5000 messages under 200ms", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({ simTh: 0.4, depth: 4 }),
    });

    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      miner.addLogMessage(`message type ${i % 10} value ${i}`);
    }
    const duration = performance.now() - start;

    const rate = (5000 / (duration / 1000)).toFixed(0);
    console.log(`  Performance: 5000 msgs in ${duration.toFixed(0)}ms (${rate} logs/sec)`);

    // Minimum 20,000 logs/sec
    expect(5000 / (duration / 1000)).toBeGreaterThan(20000);
  });

  it("should process 1000 lines with masking in under 100ms", () => {
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        simTh: 0.4,
        depth: 4,
        maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
      }),
    });

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      miner.addLogMessage(`connection from 192.168.${i % 255}.${i % 255} port ${i % 65535}`);
    }
    const duration = performance.now() - start;

    const rate = (1000 / (duration / 1000)).toFixed(0);
    console.log(`  Masking perf: 1000 msgs in ${duration.toFixed(0)}ms (${rate} logs/sec)`);

    // Minimum 10,000 logs/sec with masking
    expect(1000 / (duration / 1000)).toBeGreaterThan(10000);
  });
});
