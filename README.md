# @agentix-e/drain-ts

> A TypeScript/Node.js streaming log template miner based on the Drain algorithm.
> Ported with high fidelity from the official Python [Drain3](https://github.com/logpai/Drain3) v0.9.11.

[![CI](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AgentiX-E/drain-ts/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@agentix-e/drain-ts)](https://www.npmjs.com/package/@agentix-e/drain-ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**drain-ts** extracts structured templates from unstructured log messages in real time. It clusters
similar log lines together using a fixed-depth prefix tree and incrementally learns the constant
and variable parts of each template.

```typescript
import { TemplateMiner, TemplateMinerConfig, DEFAULT_MASKING_INSTRUCTIONS } from "@agentix-e/drain-ts";

const miner = new TemplateMiner({
  config: TemplateMinerConfig.from({
    maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
  }),
});

const r1 = miner.addLogMessage("connection from 192.168.1.1 port 8080");
console.log(r1.templateMined); // "connection from <IP> port <NUM>"

const r2 = miner.addLogMessage("connection from 10.0.0.1 port 443");
console.log(r2.templateMined); // "connection from <IP> port <NUM>"
console.log(r2.changeType);    // "none"
```

## Features

- **Full Drain3 parity** — treeSearch, fastMatch, addSeqToPrefixTree, LRU eviction, match inference, parameter extraction
- **Streaming** — online, single-pass log processing with O((d + cm)n) complexity
- **Masking** — pre-configured regex presets for IP, NUM, HEX, UUID, EMAIL
- **Framework-agnostic persistence** — save/load state to file, Redis, Kafka, S3, or any custom backend
- **Profiling** — built-in wall-clock profiler for performance analysis
- **Zero dependencies** — core package has no runtime dependencies; no mandatory peer deps
- **TypeScript native** — full type annotations, strict mode, ESM + CJS dual build
- **Cross-runtime** — Node.js ≥18, Deno ≥2, Bun ≥1, browsers (ES2020+)

## Installation

```bash
pnpm add @agentix-e/drain-ts
# or
npm install @agentix-e/drain-ts
```

## Quick Start

### Basic Clustering

```typescript
import { TemplateMiner } from "@agentix-e/drain-ts";

const miner = new TemplateMiner();

miner.addLogMessage("user alice logged in");
miner.addLogMessage("user bob logged in");
miner.addLogMessage("user carol logged in");

// Template evolved: "user <*> logged in"
const result = miner.addLogMessage("user dave logged in");
console.log(result.templateMined); // "user <*> logged in"
console.log(result.changeType);    // "none"
```

### With Masking Presets

```typescript
import { TemplateMiner, TemplateMinerConfig, DEFAULT_MASKING_INSTRUCTIONS } from "@agentix-e/drain-ts";

const config = TemplateMinerConfig.from({
  maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
  simTh: 0.4,
  depth: 4,
});

const miner = new TemplateMiner({ config });

miner.addLogMessage("error code 42 at 192.168.1.1");
miner.addLogMessage("error code 500 at 10.0.0.1");
// Template: "error code <NUM> at <IP>"
```

### Inference Mode

```typescript
// After training, classify without modifying state
const cluster = miner.match("error code 99 at 172.16.0.1");
if (cluster) {
  console.log(cluster.getTemplate()); // "error code <NUM> at <IP>"
}
```

### Parameter Extraction

```typescript
const params = miner.extractParameters(
  "connection from <IP> port <NUM>",
  "connection from 192.168.1.1 port 8080",
  true, // exact matching
);

console.log(params);
// [
//   { value: "192.168.1.1", maskName: "IP" },
//   { value: "8080", maskName: "NUM" },
// ]
```

### State Persistence

```typescript
import { FilePersistence, MemoryPersistence } from "@agentix-e/drain-ts";

// File-based (zero deps)
const handler = new FilePersistence("/var/lib/drain-ts/snapshot.json");
const miner = new TemplateMiner({ persistenceHandler: handler });
// State is automatically saved on template changes

// Or implement your own backend:
const redisHandler: PersistenceHandler = {
  async saveState(state) { await redis.set("drain:snapshot", Buffer.from(state)); },
  async loadState() { const d = await redis.getBuffer("drain:snapshot"); return d ? new Uint8Array(d) : null; },
};
```

See [external persistence guide](docs/external-persistence.md) for Redis, Kafka, S3 examples.

### Custom Masking Instructions

```typescript
import { MaskingInstruction, LogMasker } from "@agentix-e/drain-ts";

const customMask = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)([a-f0-9]{40})((?=[^A-Za-z0-9])|$)`,
  "SHA1",
);

const config = TemplateMinerConfig.from({
  maskingInstructions: [...DEFAULT_MASKING_INSTRUCTIONS, customMask],
});
```

## API Overview

| Class / Method | Description |
|---|---|
| `TemplateMiner` | Main entry point — integrates Drain engine, masker, persistence, profiling |
| `.addLogMessage(line)` | Training mode — cluster a log line, returns `AddLogResult` |
| `.match(line, strategy?)` | Inference mode — classify without modifying state |
| `.extractParameters(tmpl, msg, exact?)` | Extract variable values from a log message |
| `TemplateMinerConfig.from(partial)` | Configuration factory with defaults |
| `Drain` | Core algorithm engine (low-level) |
| `LogMasker` | Masking preprocessor |
| `MaskingInstruction` | Regex + mask name pair for custom masking |
| `FilePersistence` / `MemoryPersistence` | Built-in persistence handlers |
| `Profiler` / `NullProfiler` / `SimpleProfiler` | Performance measurement |
| `LRUCache<K,V>` | Generic bounded LRU cache |
| `LogCluster` / `Node` / `LogClusterCache` | Internal data structures |

## Configuration

All defaults match Drain3 v0.9.11:

| Parameter | Default | Description |
|---|---|---|
| `simTh` | `0.4` | Similarity threshold for new cluster creation |
| `depth` | `4` | Parse tree depth (minimum 3) |
| `maxChildren` | `100` | Max children per tree node |
| `maxClusters` | `null` | Max clusters before LRU eviction |
| `maskPrefix` / `maskSuffix` | `"<"` / `">"` | Mask wrapper characters |
| `maskingInstructions` | `[]` | Masking rules (opt-in) |
| `snapshotIntervalMinutes` | `1` | Periodic snapshot interval |
| `profilingEnabled` | `false` | Enable wall-clock profiling |

## Architecture

```
TemplateMiner (facade)
├── Drain (clustering engine)
│   ├── Node (prefix tree)
│   ├── LogCluster (template + size)
│   └── LogClusterCache (LRU eviction)
├── LogMasker (masking preprocessor)
│   └── MaskingInstruction[] (regex patterns)
├── PersistenceHandler (state save/load interface)
│   ├── FilePersistence (node:fs)
│   └── MemoryPersistence (in-memory)
├── Profiler (optional performance tracking)
└── LRUCache<K,V> (regex cache for parameter extraction)
```

## Performance

| Scenario | Throughput |
|---|---|
| Plain clustering | ~50,000 logs/sec |
| With masking (IP+NUM) | ~200,000+ logs/sec |
| Single message latency | <1ms |

Measured on Node.js 22, single-threaded.

## Benchmark Accuracy

drain-ts achieves high accuracy across representative log datasets:

| Dataset | Grouping Accuracy |
|---|---|
| SSH logs | ≥ 95% |
| Database queries | ≥ 75% |
| System daemon logs | ≥ 70% |
| Application errors | ≥ 90% |
| Large (200 msgs) | ≥ 75% |

**Note**: These are baseline results *without* masking instructions. With masking presets
applied, accuracy increases substantially — matching the official Drain3 benchmarks on
Loghub-2k datasets.

## Development

```bash
pnpm install
pnpm test          # 169 tests
pnpm test:coverage # 97%+ coverage
pnpm typecheck     # TypeScript strict mode
pnpm build         # ESM + CJS build
```

## License

MIT © [Lambertyan](https://github.com/Lambertyan) / [AgentiX-E](https://github.com/AgentiX-E)

## References

- He et al. "Drain: An Online Log Parsing Approach with Fixed Depth Tree." *ICWS 2017.*
- [logpai/Drain3](https://github.com/logpai/Drain3) — Official Python implementation
- [logpai/logparser](https://github.com/logpai/logparser) — Benchmark framework
- [logpai/loghub](https://github.com/logpai/loghub) — Log datasets
