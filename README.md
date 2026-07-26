# @agentix-e/drain-ts

> TypeScript/Node.js streaming log template miner — 1:1 port of the official Python [Drain3](https://github.com/logpai/Drain3) v0.9.11, with zero runtime dependencies.

[![CI](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agentix-e/drain-ts?color=blue)](https://www.npmjs.com/package/@agentix-e/drain-ts)
[![Coverage](https://img.shields.io/badge/coverage-97%25-brightgreen)](https://agentix-e.github.io/drain-ts/coverage/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![npm downloads](https://img.shields.io/npm/dm/@agentix-e/drain-ts?color=blue)](https://www.npmjs.com/package/@agentix-e/drain-ts)

---

**What it does**: Turns raw logs like `"connection from 192.168.1.1 port 8080"` into structured templates like `"connection from <IP> port <NUM>"` — online, in a single pass, with no training required.

**Why it matters**: Log parsing is the critical first step in any observability, anomaly detection, or log analytics pipeline. drain-ts gives you the same algorithm that powers [LogPAI's benchmark-leading Drain3](https://github.com/logpai/logparser) — in pure TypeScript, with zero Python dependency.

```ts
import { TemplateMiner, TemplateMinerConfig, DEFAULT_MASKING_INSTRUCTIONS } from "@agentix-e/drain-ts";

const miner = new TemplateMiner({
  config: TemplateMinerConfig.from({ maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS }),
});

const r1 = miner.addLogMessage("connection from 192.168.1.1 port 8080");
console.log(r1.templateMined); // "connection from <IP> port <NUM>"

const r2 = miner.addLogMessage("connection from 10.0.0.1 port 443");
console.log(r2.templateMined); // "connection from <IP> port <NUM>"
console.log(r2.changeType);    // "none" — no template change needed
```

## Quick Install

```bash
npm install @agentix-e/drain-ts
# or
pnpm add @agentix-e/drain-ts
```

**Requirements**: Node.js ≥ 22

## Why drain-ts?

| | Drain3 (Python) | drain-ts (this project) |
|---|---|---|
| **Algorithm** | ✅ Fixed-depth prefix tree | ✅ 1:1 port, same tree structure |
| **match() inference** | ✅ | ✅ 3 search strategies |
| **extractParameters()** | ✅ | ✅ Exact + inexact matching |
| **LRU eviction** | ✅ | ✅ Same eviction policy |
| **Persistence** | ✅ File/Redis/Kafka | ✅ File/Memory + framework-agnostic interface |
| **Profiling** | ✅ | ✅ Same section names |
| **Zero deps** | ❌ Requires pip | ✅ No runtime dependencies |
| **Type safety** | ❌ Dynamic | ✅ Full TypeScript, strict mode |
| **Run anywhere** | Python only | Node, Deno, Bun, Browser |

## Key Features

- **Streaming**: Process logs one at a time — no batching, no training phase
- **Online learning**: Templates evolve automatically as new log patterns appear
- **Pre-built masks**: IP addresses, numbers, hex values, UUIDs, emails detected out of the box
- **Custom masks**: Add your own regex patterns for domain-specific variables
- **State persistence**: Save/restore the model to disk, Redis, S3 — or any custom backend
- **Inference mode**: Classify new logs without modifying the model
- **Parameter extraction**: Pull out the variable parts (IP, user ID, port) from matched logs

## 60-Second Tutorials

### Tutorial 1: Cluster Similar Logs

```ts
import { TemplateMiner } from "@agentix-e/drain-ts";

const miner = new TemplateMiner();

// Feed 3 similar messages — they'll be grouped together
miner.addLogMessage("user alice logged in");
miner.addLogMessage("user bob logged in");
miner.addLogMessage("user carol logged in");

// Template automatically generalized to: "user <*> logged in"
const result = miner.addLogMessage("user dave logged in");
console.log(result.templateMined); // "user <*> logged in"
```

### Tutorial 2: Mask IPs and Numbers

```ts
import { TemplateMiner, TemplateMinerConfig, DEFAULT_MASKING_INSTRUCTIONS } from "@agentix-e/drain-ts";

const config = TemplateMinerConfig.from({
  maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
});
const miner = new TemplateMiner({ config });

miner.addLogMessage("error code 42 at 192.168.1.1");
miner.addLogMessage("error code 500 at 10.0.0.1");
// Both map to: "error code <NUM> at <IP>"
```

### Tutorial 3: Classify Without Changing the Model

```ts
// After training, use match() for read-only classification
const cluster = miner.match("error code 99 at 172.16.0.1");
if (cluster) {
  console.log(cluster.getTemplate()); // "error code <NUM> at <IP>"
}
```

### Tutorial 4: Save and Restore State

```ts
import { TemplateMiner, FilePersistence } from "@agentix-e/drain-ts";

const handler = new FilePersistence("./snapshot.json");
const miner = new TemplateMiner({ persistenceHandler: handler });
// State auto-saves on template changes
// On restart: model loads from snapshot.json automatically
```

### Tutorial 5: Add Custom Masking Rules

```ts
import { MaskingInstruction, TemplateMinerConfig } from "@agentix-e/drain-ts";

const sha1Mask = new MaskingInstruction(
  String.raw`\b[a-f0-9]{40}\b`,
  "SHA1"
);
const config = TemplateMinerConfig.from({
  maskingInstructions: [sha1Mask],
});
```

## Configuration Reference

All parameters match Drain3 v0.9.11 defaults:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `simTh` | `number` | `0.4` | Similarity threshold (0 = merge everything, 1 = exact only) |
| `depth` | `number` | `4` | Parse tree depth (minimum 3) |
| `maxChildren` | `number` | `100` | Max child nodes per tree level |
| `maxClusters` | `number \| null` | `null` | Max clusters; oldest evicted via LRU when limit exceeded |
| `maskPrefix` / `maskSuffix` | `string` | `"<"` / `">"` | Delimiters for masked parameters in templates |
| `maskingInstructions` | `MaskingInstruction[]` | `[]` | Regex patterns to apply before clustering |
| `snapshotIntervalMinutes` | `number` | `1` | Minutes between periodic state snapshots |
| `profilingEnabled` | `boolean` | `false` | Enable per-stage timing reports |

## Architecture

```
TemplateMiner (public API)
├── Drain (fixed-depth prefix tree clustering)
│   ├── Node (tree nodes)
│   ├── LogCluster (template + hit count)
│   └── LogClusterCache (LRU eviction when maxClusters reached)
├── LogMasker (pre-processing: replace variables with <PLACEHOLDER>)
│   └── MaskingInstruction[] (IP, NUM, HEX, UUID, EMAIL presets)
├── PersistenceHandler (framework-agnostic save/load interface)
│   ├── FilePersistence (built-in, zero deps)
│   └── MemoryPersistence (built-in, zero deps)
├── Profiler (optional wall-clock instrumentation)
└── LRUCache<K,V> (generic cache for parameter extraction regex)
```

## Benchmark Results

Validated against all 15 [Loghub 2k](https://github.com/logpai/loghub) standard benchmark datasets
using the four official metrics: GA (Grouping Accuracy), FGA (F1-GA), PTA (Parsing Template Accuracy), FTA (F1-PTA).
Results obtained with default masking (IP + NUM). PTA can be improved significantly with dataset-specific masking.

| Dataset | Category | GA | FGA | PTA | FTA | Clusters |
|---|---|---|---|---|---|---|
| HDFS | Distributed Systems | 0.9985 | 0.9781 | 0.6436 | 0.6350 | 16 |
| Hadoop | Distributed Systems | 0.9975 | 0.9098 | 0.6444 | 0.6166 | 97 |
| Spark | Distributed Systems | 1.0000 | 0.9706 | 0.7557 | 0.7738 | 33 |
| OpenStack | Distributed Systems | 0.8750 | 0.8445 | 0.7149 | 0.7149 | 54 |
| Zookeeper | Distributed Systems | 0.9985 | 0.9643 | 0.6537 | 0.6034 | 46 |
| BGL | Supercomputers | 0.9995 | 0.9351 | 0.7794 | 0.7534 | 105 |
| HPC | Supercomputers | 0.9980 | 0.9328 | 0.7727 | 0.8233 | 45 |
| Linux | Operating Systems | 0.9975 | 0.9621 | 0.8343 | 0.8393 | 111 |
| Mac | Operating Systems | 0.9315 | 0.9171 | 0.7434 | 0.7532 | 297 |
| Apache | Server Applications | 1.0000 | 1.0000 | 0.7632 | 0.7468 | 6 |
| OpenSSH | Server Applications | 1.0000 | 0.9200 | 0.7412 | 0.7500 | 23 |
| Windows | Operating Systems | 0.9980 | 0.9352 | 0.8305 | 0.8391 | 49 |
| Android | Mobile Systems | 0.9245 | 0.9404 | 0.7304 | 0.7792 | 159 |
| HealthApp | Mobile Systems | 0.9995 | 0.9771 | 0.6915 | 0.7253 | 72 |
| Proxifier* | Standalone Software | 0.3660 | 0.7217 | 0.7429 | 0.7369 | 38 |
| **Average** | | **0.9389** | | **0.7361** | | |

\*Proxifier GA is limited by a known Loghub CSV quoting issue — see benchmark/run.ts for details.

**Throughput**: 70,000–410,000 logs/sec across datasets (single-threaded, Node.js 22, with default IP+NUM masking).

Run benchmarks yourself:
```bash
npx tsx benchmark/run.ts --all       # All 15 Loghub datasets
npx tsx benchmark/run.ts HDFS        # Single dataset
```

## API Quick Reference

| Method | Returns | Description |
|---|---|---|
| `new TemplateMiner(opts?)` | `TemplateMiner` | Create instance. Use `TemplateMiner.create()` for async persistence. |
| `.addLogMessage(line)` | `AddLogResult` | Train: cluster a log line, may update templates |
| `.match(line, strategy?)` | `LogCluster \| null` | Inference: classify without modifying state |
| `.extractParameters(tmpl, msg, exact?)` | `ExtractedParameter[]` | Get variable values from a log |
| `TemplateMinerConfig.from(opts)` | `TemplateMinerConfig` | Create config with defaults + overrides |

## Development

```bash
git clone https://github.com/AgentiX-E/drain-ts.git
cd drain-ts
pnpm install
pnpm test          # 197 tests
pnpm test:coverage # 98%+ coverage (enforced 95% thresholds)
pnpm typecheck     # Strict TypeScript check
pnpm build         # ESM + CJS output
pnpm benchmark     # Run Loghub 2k benchmark (all 15 datasets)
```

## License

MIT © [Lambertyan](https://github.com/Lambertyan) / [AgentiX-E](https://github.com/AgentiX-E)

## References

- He et al. **"Drain: An Online Log Parsing Approach with Fixed Depth Tree."** *IEEE ICWS 2017.*
- [logpai/Drain3](https://github.com/logpai/Drain3) — Official Python implementation by IBM Research
- [logpai/logparser](https://github.com/logpai/logparser) — Benchmark framework (ICSE 2019)
- [logpai/loghub](https://github.com/logpai/loghub) — Standard log datasets (ISSRE 2023)
