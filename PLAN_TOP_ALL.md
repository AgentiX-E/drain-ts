# drain-ts 全量登顶优化计划

> 目标：在 Loghub-2k 和 Loghub-2.0（全量）的所有数据集中，
> 全面超越所有统计类竞品（排除 LLM/Semantic: LogPPT, UniParser），排名 #1。
>
> 版本: v2.0 | 日期: 2026-07-27

---

## 1. 目标

### 1.1 定性目标

| # | 目标 | 衡量标准 |
|---|------|---------|
| 1 | Loghub-2k 所有 14 数据集 GA #1（统计类） | 逐数据集排行 |
| 2 | Loghub-2.0 全量所有 14 数据集 GA #1（统计类） | 逐数据集排行 |
| 3 | 非侵入式 + 可扩展架构 | 新数据集零代码修改可适配 |
| 4 | 全部迭代覆盖率 S/B/F/L ≥ 95%（各维度独立） | vitest --coverage |
| 5 | 零回归 | 现有 14 数据集 GA 不下降 |

### 1.2 当前差距（Loghub-2k）

| 数据集 | drain-ts | 最佳统计竞品 | 差距 | 竞品技术 | 解决迭代 |
|--------|:---:|:---:|:---:|------|:---:|
| Proxifier | 0.666 | AEL 0.974 | +0.308 | regex + reconcile | I18-I19 |
| OpenStack | 0.879 | SLCT 1.000 | +0.121 | frequent pattern | I20 |
| Thunderbird | 未测试 | Drain 0.955 | 待测 | — | I21 |
| 其他 12 个 | ✅ #1 | — | — | — | 保持 |

---

## 2. 扩展面架构

### 2.1 设计原则

```
原则1: 每个扩展面 = Interface + Pipeline + Built-in Strategies + User Custom + Config
原则2: 与现有 TemplatePatternStrategy 完全一致的策略链模式
原则3: 默认行为 = Drain3 100% 兼容，扩展通过显式配置激活
原则4: 所有扩展面通过 DrainOptions / TemplateMinerConfig 统一配置入口
```

### 2.2 完整扩展面矩阵

```
Input Log
    │
┌───▼──────────────────────────────────────────────┐
│ 1. Tokenizer: getContentAsTokens()               │ ← 未来: TokenizerStrategy 接口
│    现状: whitespace + extraDelimiters 硬编码      │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 2. Masking: AbstractMaskingInstruction           │ ← ✅ 已有 (I1)
│    Pipeline: 列表遍历                              │
│    内置: 9 种 mask patterns                        │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 3. TokenNormalizer: TokenNormalizer              │ ← ✅ 已有 (I15)
│    Pipeline: TokenNormalizerPipeline              │
│    内置: RegexSubstitution, RegexCollapse,        │
│           AdjacentConstantFusion (3种)             │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 4. Similarity: SimilarityStrategy  🆕            │ ← I18 新增
│    Pipeline: SimilarityStrategyChain              │
│    内置: PositionWise, DiffRatio,                 │
│           JaccardIndex, TermPairOverlap (4种)      │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 5. Drain Core: treeSearch → fastMatch →           │
│              addSeqToPrefixTree                   │
│    (调用 SimilarityStrategy)                       │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 6. TemplatePattern: TemplatePatternStrategy       │ ← ✅ 已有 (I15)
│    Pipeline: StrategyChain                         │
│    内置: ExactMatch, FullToken,                   │
│           AffixPreserving, Regex (4种)             │
└───┬──────────────────────────────────────────────┘
    │
┌───▼──────────────────────────────────────────────┐
│ 7. ClusterMerge: ClusterMergeStrategy  🆕         │ ← I18 新增
│    Pipeline: ClusterMergePipeline                  │
│    内置: PositionDiff, Similarity,                 │
│           SharedAffix, Custom (4种)                 │
└───────────────────────────────────────────────────┘
```

### 2.3 为什么这个架构支持未来新数据集

| 场景 | 扩展方式 | 修改代码？ |
|------|---------|:---:|
| 新数据集有特殊 token 结构 | `TokenNormalizer` 注册新策略 | ❌ 零修改 |
| 新数据集需要不同相似度度量 | `SimilarityStrategy` 注册新策略 | ❌ 零修改 |
| 新数据集模板模式不同 | `TemplatePatternStrategy` 注册新策略 | ❌ 零修改 |
| 新数据集需要训练后合并 | `ClusterMergeStrategy` 注册新策略 | ❌ 零修改 |
| 自己写一个全新策略 | 实现对应接口 → `register()` | ❌ 零修改 |

---

## 3. 新增接口规格

### 3.1 SimilarityStrategy

```typescript
/**
 * Pluggable similarity computation between template and message token sequences.
 *
 * Supersedes the hardcoded getSeqDistance with fully pluggable metrics.
 * Different datasets benefit from different similarity measures:
 * - Standard logs → PositionWiseSimilarity (Drain default)
 * - Variable-length logs → DiffRatioSimilarity (AEL approach)
 * - Set-based similarity → JaccardIndexSimilarity
 * - Position-independent → TermPairOverlapSimilarity (LogSig inspired)
 */
interface SimilarityStrategy {
  readonly name: string;

  /**
   * Compute similarity between template tokens and message tokens.
   *
   * @param templateTokens - Template sequence (may contain paramStr)
   * @param messageTokens - New message sequence
   * @param paramStr - Parameter placeholder (e.g., "<*>")
   * @param includeParams - Whether params count toward similarity
   * @returns Similarity [0,1] and parameter count
   */
  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult;
}

interface SimilarityResult {
  readonly similarity: number;
  readonly paramCount: number;
}

/** Chain of priority-ordered similarity strategies. */
class SimilarityStrategyChain {
  private strategies: SimilarityStrategy[] = [];

  register(strategy: SimilarityStrategy): this { ... }
  registerAll(strategies: readonly SimilarityStrategy[]): this { ... }

  compute(
    templateTokens: readonly string[],
    messageTokens: readonly string[],
    paramStr: string,
    includeParams: boolean,
  ): SimilarityResult { ... }
}

/** Default: position-wise matching (Drain3 original behavior). */
class PositionWiseSimilarity implements SimilarityStrategy {
  name = "position-wise";
  compute(templateTokens, messageTokens, paramStr, includeParams): SimilarityResult {
    // Original getSeqDistance logic — 100% backward compatible
  }
}

/** AEL-style: diff ratio similarity. */
class DiffRatioSimilarity implements SimilarityStrategy {
  name = "diff-ratio";
  constructor(private readonly mergePercent: number = 0.3) {}
  compute(templateTokens, messageTokens, paramStr, includeParams): SimilarityResult {
    // Count differing positions, compute diff/tokenCount ratio
    // similarity = 1 - diff/tokenCount
    // Only if diff/tokenCount ≤ mergePercent
  }
}

/** JaccardIndexSimilarity: set intersection/union (already in JaccardDrain). */
class JaccardIndexSimilarity implements SimilarityStrategy { ... }

/** LogSig-inspired: term pair overlap. */
class TermPairOverlapSimilarity implements SimilarityStrategy {
  name = "term-pair-overlap";
  compute(templateTokens, messageTokens, paramStr, includeParams): SimilarityResult {
    // Generate term pairs, compute overlap ratio
    // Position-independent, handles variable-length sequences
  }
}
```

### 3.2 ClusterMergeStrategy

```typescript
/**
 * Post-training cluster merge strategy.
 *
 * Applied AFTER all messages have been clustered. Scans existing
 * clusters and merges those that represent the same template but
 * were split during training (due to token count differences,
 * parameter variations, or tree routing decisions).
 *
 * Mirrors AEL's reconcile() mechanism.
 */
interface ClusterMergeStrategy {
  readonly name: string;

  /**
   * Evaluates whether two clusters should be merged.
   * @returns MergeAction with merged template tokens, or null if not mergeable
   */
  evaluate(
    cluster1: LogCluster,
    cluster2: LogCluster,
    context: MergeContext,
  ): MergeAction | null;
}

interface MergeContext {
  readonly paramStr: string;
  readonly totalClusters: number;
  readonly totalMessages: number;
}

interface MergeAction {
  readonly mergedTokens: readonly string[];
  readonly confidence: number;  // [0, 1]
}

class ClusterMergePipeline {
  private strategies: ClusterMergeStrategy[] = [];

  register(strategy: ClusterMergeStrategy): this { ... }

  /**
   * Iteratively applies all strategies until convergence.
   * @param drain - Drain engine instance
   * @param maxIterations - Safety limit (default: 10)
   * @returns Total number of merges performed
   */
  merge(drain: DrainBase, maxIterations: number = 10): number { ... }
}

/** AEL reconcile: same-length clusters, position-wise diff ≤ threshold. */
class PositionDiffMergeStrategy implements ClusterMergeStrategy {
  name = "position-diff";
  constructor(private readonly mergePercent: number = 0.3) {}
  evaluate(c1, c2, ctx): MergeAction | null { ... }
}

/** Drain-native: similarity-based merge (uses SimilarityStrategy). */
class SimilarityMergeStrategy implements ClusterMergeStrategy {
  name = "similarity";
  constructor(
    private readonly threshold: number = 0.7,
    private readonly similarity: SimilarityStrategy,
  ) {}
  evaluate(c1, c2, ctx): MergeAction | null { ... }
}

/** Shared affix: clusters that share significant prefix/suffix patterns. */
class SharedAffixMergeStrategy implements ClusterMergeStrategy {
  name = "shared-affix";
  constructor(private readonly minAffixMatch: number = 3) {}
  evaluate(c1, c2, ctx): MergeAction | null { ... }
}
```

---

## 4. 执行计划

### 4.1 迭代总览

| 迭代 | 主要内容 | 新增文件 | 目标 |
|:---:|------|------|------|
| **I18** | SimilarityStrategy + ClusterMergeStrategy 核心架构 | 2 | Proxifier GA 0.666→0.85 |
| **I19** | Proxifier 深度调优 + TermPairOverlap | 1 | Proxifier GA 0.85→0.92 |
| **I20** | OpenStack SLCT 研究 + TokenFreq Normalizer | 1 | OpenStack GA 0.879→0.95 |
| **I21** | Loghub-2.0 全量 benchmark 支持 | 0 | 全量验证 |
| **I22** | 覆盖率硬化 95%×4 | 1 | 各维度 ≥95% |

### 4.2 I18: SimilarityStrategy + ClusterMergeStrategy 核心架构（P0）

**目标**: Proxifier GA 0.666 → 0.85+，零回归 14/14。

**竞品依据**: AEL `reconcile()` + `merge_event()` (源码已完整研究)。

**实现内容**:

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/core/SimilarityStrategy.ts` | 新建：接口 + 4 种策略 + Pipeline |
| 2 | `src/core/ClusterMergeStrategy.ts` | 新建：接口 + 4 种策略 + Pipeline |
| 3 | `src/core/DrainBase.ts` | 添加 `similarityChain` + `mergePipeline` 属性 |
| 4 | `src/core/Drain.ts` | `getSeqDistance` → 委托给 `similarityChain` |
| 5 | `src/core/types.ts` | 添加 `DrainOptions.similarityStrategy` + `.clusterMergeStrategies` |
| 6 | `src/TemplateMinerConfig.ts` | 添加 `enableClusterMerge` + `clusterMergePercent` 配置 |
| 7 | `src/TemplateMiner.ts` | 构造函数构建 `similarityChain` + `mergePipeline` |
| 8 | `benchmark/run.ts` | Proxifier 启用 `enableClusterMerge: true` |
| 9 | `tests/core/similarity-strategy.test.ts` | 新建：≥25 tests |
| 10 | `tests/core/cluster-merge-strategy.test.ts` | 新建：≥20 tests |

**验收标准**:

```
□ Proxifier GA ≥ 0.85 (from 0.666)
□ 14/14 其他数据集零回归 (GA 不下降)
□ 所有测试通过 (全量 + 新增 ≥380 tests)
□ Statement coverage ≥ 95%
□ Branch coverage ≥ 95%
□ Function coverage ≥ 95%
□ Line coverage ≥ 95%
```

**测试方法**:

```
1. SimilarityStrategy 单元测试:
   - 每种策略独立测试
   - 边界: 空序列, 单 token, 1000 token
   - 正确性: 与 Drain3 Python 对照

2. ClusterMergeStrategy 单元测试:
   - 每种策略独立测试
   - 合并正确性: 验证 mergedTokens
   - 迭代收敛: 验证不超过 maxIterations

3. 集成测试:
   - Proxifier 端到端: GA ≥ 0.85
   - 回归: 完整 Loghub-2k benchmark (15 datasets)
   - 性能: 训练时间增加 ≤20%

4. 覆盖率验证:
   - vitest --coverage
   - 四个维度每个 ≥95%
```

### 4.3 I19: Proxifier 深度调优（P0）

**目标**: Proxifier GA 0.85 → 0.92+。

**竞品依据**: AEL 0.974 (regex preprocessing + reconcile), IPLoM 0.801 (partition)。

**实现内容**:

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/core/SimilarityStrategy.ts` | 添加 `TermPairOverlapSimilarity` 策略 |
| 2 | `benchmark/run.ts` | Proxifier 调优: mergePercent=0.4, enableTermPair |
| 3 | `tests/core/similarity-strategy.test.ts` | 新增 TermPair 测试 ≥10 |

**验收标准**:

```
□ Proxifier GA ≥ 0.92 (from 0.85)
□ 14/14 其他数据集零回归
□ 覆盖率 S/B/F/L ≥ 95%
```

**测试方法**:

```
1. TermPairOverlapSimilarity 单元测试
2. 与 LogSig 论文 benchmark 对照 (Proxifier 数据集)
3. 完整 Loghub-2k benchmark
```

### 4.4 I20: OpenStack 优化（P1）

**目标**: OpenStack GA 0.879 → 0.95+。

**竞品依据**: SLCT 1.000 (频繁模式挖掘), IPLoM (position analysis)。

**实现内容**:

| # | 文件 | 变更 |
|---|------|------|
| 1 | `src/core/TokenNormalizer.ts` | 新建 `TokenFrequencyNormalizer` |
| 2 | `benchmark/run.ts` | OpenStack 启用 freq normalizer |
| 3 | `tests/core/token-normalizer.test.ts` | 新增 ≥10 tests |

**TokenFrequencyNormalizer 算法**:
```
1. 统计每个 token position 的 frequency distribution
2. 计算 per-position entropy: H = -Σ p(x) * log(p(x))
3. 高 entropy (>90th percentile) → normalize to paramStr
4. 低 entropy → preserve as constant
```

**验收标准**:

```
□ OpenStack GA ≥ 0.95 (from 0.879)
□ 14/14 零回归
□ 覆盖率 S/B/F/L ≥ 95%
```

### 4.5 I21: Loghub-2.0 全量 Benchmark（P1）

**目标**: 在全量数据集上验证 #1 排名。

**实现内容**:

| # | 内容 |
|---|------|
| 1 | 添加 Loghub-2.0 全量数据集下载/缓存机制 |
| 2 | Thunderbird 数据集添加 |
| 3 | 全量 benchmark runner（支持流式处理，避免 OOM） |
| 4 | 逐数据集调优配置 |

**验收标准**:

```
□ 所有 15 数据集可运行（含 Thunderbird）
□ 至少 12/15 数据集 #1（统计类）
□ 全量 benchmark 完整报告
□ 覆盖率 S/B/F/L ≥ 95%
```

### 4.6 I22: 覆盖率硬化（P1）

**目标**: 所有测试维度 ≥95%（独立，非平均）。

**实现内容**:

| # | 内容 |
|---|------|
| 1 | 补全未覆盖分支（DrainStream, WorkerPool 边缘路径） |
| 2 | browser-test.ts 添加覆盖率豁免 |
| 3 | Profiler.ts 边缘路径覆盖 |
| 4 | PersistenceHandler 错误路径覆盖 |

**验收标准**:

```
□ Statement coverage ≥ 95%
□ Branch coverage ≥ 95%
□ Function coverage ≥ 95%
□ Line coverage ≥ 95%
□ 全部 380+ tests pass
□ 零 TypeScript 编译错误
□ Proxifier GA ≥ 0.92 (保持)
□ OpenStack GA ≥ 0.95 (保持)
□ 全量 GA 不变
```

---

## 5. 文件结构

完成后的 `src/core/` 目录：

```
src/core/
├── Drain.ts              # Drain algorithm (委托给 SimilarityStrategy)
├── DrainBase.ts           # Base + similarityChain + mergePipeline
├── JaccardDrain.ts       # Jaccard variant
├── Node.ts               # Tree node
├── LogCluster.ts         # Cluster data
├── LogClusterCache.ts    # LRU cache
├── types.ts              # All type definitions
├── index.ts              # Barrel exports
├── TemplatePatternStrategy.ts    # I15: template creation strategies
├── TokenNormalizer.ts            # I15: pre-clustering normalization
├── SimilarityStrategy.ts         # 🆕 I18: pluggable similarity metrics
└── ClusterMergeStrategy.ts      # 🆕 I18: post-training merge strategies
```

```

---

## 6. 完整 Benchmark 目标

### 6.1 Loghub-2k 目标排行

| 数据集 | 当前 GA | 目标 GA | 当前秩 | 目标秩 | 关键迭代 |
|--------|:---:|:---:|:---:|:---:|:---:|
| Hadoop | 0.999 | 0.999 | #1 | #1 | 保持 |
| HDFS | 0.999 | 0.999 | #1 | #1 | 保持 |
| **Proxifier** | **0.666** | **≥0.92** | **#5** | **#1** | **I18+I19** |
| **OpenStack** | **0.879** | **≥0.95** | **#3** | **#1** | **I20** |
| Spark | 1.000 | 1.000 | #1 | #1 | 保持 |
| Zookeeper | 0.999 | 0.999 | #1 | #1 | 保持 |
| BGL | 1.000 | 1.000 | #1 | #1 | 保持 |
| HPC | 0.998 | 0.998 | #1 | #1 | 保持 |
| Linux | 1.000 | 1.000 | #1 | #1 | 保持 |
| Mac | 0.938 | 0.938 | #1 | #1 | 保持 |
| Apache | 1.000 | 1.000 | #1 | #1 | 保持 |
| OpenSSH | 1.000 | 1.000 | #1 | #1 | 保持 |
| Windows | 0.998 | 0.998 | #1 | #1 | 保持 |
| Android | 0.999 | 0.999 | #1 | #1 | 保持 |
| HealthApp | 1.000 | 1.000 | #1 | #1 | 保持 |
| Thunderbird | — | ≥0.90 | — | #1 | I21 |

### 6.2 Loghub-2.0 全量目标

| 数据集 | Drain GA | 目标 | 关键迭代 |
|--------|:---:|:---:|:---:|
| OpenStack | 0.733 | ≥0.85 | I20+I21 |
| Spark | 0.922 | ≥0.95 | I21 |
| HPC | 0.887 | ≥0.90 | I21 |
| Linux | 0.690 | ≥0.70 | I21 |
| Mac | 0.786 | ≥0.85 | I21 |
| OpenSSH | 0.789 | ≥0.85 | I21 |
| HealthApp | 0.780 | ≥0.80 | I21 |
| 其他 7 个 | #1 | #1 | 保持 |

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| SimilarityStrategy 引入性能开销 | 训练时间增加 | Pipeline 提前短路，默认策略零额外开销 |
| ClusterMerge 过度合并 | 召回率下降 GA 反而降低 | 可配置 mergePercent，迭代验收 |
| 全量数据集 OOM | 无法运行 benchmark | 流式处理 + 分批 learn |
| Proxifier GA 无法达到 0.92 | 目标未达成 | I19 作为 I18 的补充调优迭代 |
