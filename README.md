# @agentix-e/drain-ts

> TypeScript/Node.js streaming log template miner — 1:1 port of the official Python [Drain3](https://github.com/logpai/Drain3) v0.9.11, with zero runtime dependencies.

[![CI](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agentix-e/drain-ts?color=blue)](https://www.npmjs.com/package/@agentix-e/drain-ts)
[![Coverage](https://img.shields.io/badge/coverage-report-blue)](https://agentix-e.github.io/drain-ts/coverage-report/)
[![Benchmark](https://img.shields.io/badge/benchmark-Loghub%202k-blue)](https://agentix-e.github.io/drain-ts/benchmark-report/2k/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-green)](https://nodejs.org/)
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
| **JaccardDrain** | ✅ | ✅ Same algorithm |
| **match() inference** | ✅ 3 search strategies | ✅ 3 search strategies |
| **extractParameters()** | ✅ | ✅ Exact + inexact matching |
| **LRU eviction** | ✅ | ✅ Same eviction policy |
| **Persistence** | ✅ File/Redis/Kafka | ✅ File/Memory + plugin interface |
| **Profiling** | ✅ | ✅ Same section names + batch rates |
| **Streaming** | ❌ | ✅ Node.js Transform stream |
| **Worker threads** | ❌ | ✅ WorkerPool multi-core |
| **Browser support** | ❌ | ✅ Playwright-verified |
| **Zero deps** | ❌ Requires pip | ✅ No runtime dependencies |
| **Type safety** | ❌ Dynamic | ✅ Full TypeScript, strict mode |
| **Run anywhere** | Python only | Node, Deno, Bun, Browser |
| **Benchmark CI** | ❌ | ✅ Loghub 16-dataset CI + Pages |

### Performance vs Drain3

Measured on the same HDFS dataset (2000 messages, Node 22 / Python 3.11):

| Metric | Drain3 | drain-ts |
|--------|--------|----------|
| Processing time | 9 ms | Pure: ~5 ms |
| Throughput | ~228k logs/sec | ~420k logs/sec |
| Clusters (HDFS) | 17 | 16 |

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
| `enableAffixPreserving` | `boolean` | `false` | Token-level prefix/suffix param detection (e.g. "bytes<*>sent") |
| `enableAdjacentFusion` | `boolean` | `false` | Auto-fuse adjacent constant tokens into compound tokens |
| `enableClusterMerge` | `boolean` | `false` | Post-training cluster merge (AEL reconcile) |
| `enableAELSimilarity` | `boolean` | `false` | Use AEL-style diff-ratio similarity instead of position-wise |

## Architecture

```
TemplateMiner (public API)
├── Drain (fixed-depth prefix tree clustering)
│   ├── Node (tree nodes)
│   ├── LogCluster (template + hit count)
│   ├── LogClusterCache (LRU eviction when maxClusters reached)
│   ├── SimilarityStrategyChain (pluggable similarity: PositionWise, AEL DiffRatio, Jaccard, TermPair)
│   ├── TemplatePatternStrategyChain (pluggable token param: ExactMatch, AffixPreserving, Regex, FullToken)
│   └── ClusterMergePipeline (post-training AEL reconcile for cluster consolidation)
├── TokenNormalizerPipeline (pre-clustering: RegexSubstitution, RegexCollapse, AdjacentConstantFusion)
├── LogMasker (pre-processing: replace variables with <PLACEHOLDER>)
│   └── MaskingInstruction[] (IP, NUM, HEX, UUID, EMAIL, HOST_PORT, BLOCK_ID, PATH presets)
├── PersistenceHandler (framework-agnostic save/load interface)
│   ├── FilePersistence (built-in, zero deps)
│   └── MemoryPersistence (built-in, zero deps)
├── Profiler (optional wall-clock instrumentation)
└── LRUCache<K,V> (generic cache for parameter extraction regex)
```

## Benchmark Results

drain-ts is validated against all 16 [Loghub 2k](https://github.com/logpai/loghub) standard benchmark datasets using the four official metrics: GA, FGA, PTA, FTA.

→ **[View Benchmark Report →](https://agentix-e.github.io/drain-ts/benchmark-report/)**

Average across all 16 datasets (GA: 0.991, PTA: 0.828, 70k–420k logs/sec). Run locally:

```bash
npx tsx benchmark/run.ts --all       # All 16 Loghub 2k datasets
npx tsx benchmark/run.ts HDFS        # Single dataset
npx tsx benchmark/run-full.ts --all  # Full Loghub-2.0 (requires ~100GB)
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
pnpm test          # 524 tests
pnpm test:coverage # [Coverage report](https://agentix-e.github.io/drain-ts/coverage-report/) (enforced thresholds)
pnpm typecheck     # Strict TypeScript check
pnpm build         # ESM + CJS output
pnpm benchmark     # Run Loghub 2k benchmark (all 15 datasets)
```

## External Persistence

drain-ts ships with `FilePersistence` and `MemoryPersistence`. Implement the `PersistenceHandler` interface (~15 lines) for any backend:

<details>
<summary><b>Redis (ioredis)</b></summary>

```typescript
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import type { Redis } from "ioredis";

class RedisPersistence implements PersistenceHandler {
  constructor(private redis: Redis, private key: string) {}
  async saveState(state: Uint8Array) { await this.redis.set(this.key, Buffer.from(state)); }
  async loadState() { const d = await this.redis.getBuffer(this.key); return d ? new Uint8Array(d) : null; }
}
```
</details>

<details>
<summary><b>Kafka (kafkajs)</b></summary>

```typescript
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import type { Kafka, Producer } from "kafkajs";

class KafkaPersistence implements PersistenceHandler {
  private producer: Producer;
  constructor(kafka: Kafka, private topic: string) { this.producer = kafka.producer(); }
  async saveState(state: Uint8Array) {
    await this.producer.connect();
    await this.producer.send({ topic: this.topic, messages: [{ value: Buffer.from(state) }] });
    await this.producer.disconnect();
  }
  async loadState(): Promise<Uint8Array | null> { /* poll last message from topic */ return null; }
}
```
</details>

<details>
<summary><b>S3 (@aws-sdk/client-s3)</b></summary>

```typescript
import type { PersistenceHandler } from "@agentix-e/drain-ts";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

class S3Persistence implements PersistenceHandler {
  constructor(private s3: S3Client, private bucket: string, private key: string) {}
  async saveState(state: Uint8Array) { await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key, Body: state })); }
  async loadState() {
    try { const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key })); return await r.Body?.transformToByteArray() ?? null; }
    catch { return null; }
  }
}
```
</details>

## License

MIT © [Lambertyan](https://github.com/Lambertyan) / [AgentiX-E](https://github.com/AgentiX-E)

## References

- He et al. **"Drain: An Online Log Parsing Approach with Fixed Depth Tree."** *IEEE ICWS 2017.*
- [logpai/Drain3](https://github.com/logpai/Drain3) — Official Python implementation by IBM Research
- [logpai/logparser](https://github.com/logpai/logparser) — Benchmark framework (ICSE 2019)
- [logpai/loghub](https://github.com/logpai/loghub) — Standard log datasets (ISSRE 2023)
