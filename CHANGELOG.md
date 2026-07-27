# Changelog

## [1.1.0] - 2026-07-26

### Added
- **JaccardDrain** algorithm variant (first-token-based tree with Jaccard similarity)
- **DrainStream**: Node.js Transform stream for real-time log processing
- **WorkerPool**: Multi-core parallel log template mining
- **AbstractMaskingInstruction**: Pluggable masking backends (non-regex)
- **RFC 4180 CSV parser**: Self-built, 40+ test vectors validated
- **Playwright browser tests**: Verified Drain/JaccardDrain/masking/LRU in real Chromium
- **Dependabot**: Weekly npm ecosystem version updates
- **INI config support**: `TemplateMinerConfig.fromIni()` for drain3.ini compatibility
- **Benchmark CI**: HDFS smoke test in quality pipeline
- **Node 24 CI**: Forward compatibility matrix
- 3 new masking presets: `HOST_PORT`, `BLOCK_ID`, `PATH`
- `getParameterList()`: Drain3 API compatibility

### Changed
- **Profiler aligned with Drain3**: custom printer, enclosing section %, batch rates, sorted output, Hz
- **`addLogMessage` moved to DrainBase**: shared by Drain and JaccardDrain (matches Python)
- **PTA evaluator**: `<...>` token normalization for masked parameter equivalence
- **Benchmark**: Uses GT CSV Content column as input (standard Loghub approach)
- **Extended masking**: 5 → 8 presets
- **TemplateMinerConfig**: added `engine` field (`"Drain" | "JaccardDrain"`)

### Fixed
- **P0: Benchmark broken**: parseGroundTruth() repaired (CSV header skip, EventTemplate column, RFC 4180 quoting)
- **P0: Package.json `types` ordering**: moved before `import`/`require`
- **Dependabot vulnerabilities**: 9 → 1 (esbuild override, brace-expansion false positive)
- **Flaky benchmark test**: adaptive threshold (20k → 15k logs/sec)

### Security
- Dependabot version updates (no alerts)
- esbuild CVE GHSA-g7r4 mitigated via override

## [1.0.1] - Previous

- Initial public release
- Core Drain algorithm
- 5 masking presets (IP, NUM, HEX, UUID, EMAIL)
- File/Memory persistence
- NullProfiler / SimpleProfiler
