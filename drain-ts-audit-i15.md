# drain-ts 架构审计终版 v3 — I15 完成

**日期**: 2026-07-26  
**提交**: `b328d2b` feat(I15): TemplatePatternStrategy + TokenNormalizer 双插件架构

---

## 新增架构

### 1. TemplatePatternStrategy (`src/core/TemplatePatternStrategy.ts`)
- 策略模式接口: `TemplatePatternStrategy`
- 4 种内置策略: ExactMatch, FullTokenParameterization, AffixPreserving, RegexParameterization
- 策略链: `TemplatePatternStrategyChain` 按优先级竞争
- 完全向后兼容 Drain3
- 用户可注册自定义策略

### 2. TokenNormalizer (`src/core/TokenNormalizer.ts`)
- Pre-clustering 标准化接口: `TokenNormalizer`
- Pipeline: `TokenNormalizerPipeline` — 链式执行
- 内置 `AdjacentConstantFusion`: 数据驱动自动检测相邻常量 token 并融合
- 内置 `RegexCollapseNormalizer`: regex 模式 collapse
- 配置: `enableAdjacentFusion`, `regexCollapsePatterns`

### 3. 配置集成
- `TemplateMinerConfig`: enableAdjacentFusion, regexCollapsePatterns, tokenNormalizers
- `TemplateMiner`: learnTokens() 批量学习 + addLogMessage/match 自动 normalize
- `DrainOptions`: enableAffixPreserving, customRegexPatterns, templatePatternStrategies

---

## Benchmark 结果 (15/15 Loghub 2k)

| 数据集 | GA | PTA | GA Pass | PTA Pass |
|--------|-----|------|---------|----------|
| HDFS | 0.9985 | 0.7624 | ✓ | ✓ |
| Hadoop | 0.9990 | 0.7965 | ✓ | ✓ |
| Spark | 1.0000 | 0.8976 | ✓ | ✓ |
| OpenStack | 0.8790 | 0.7599 | ✓ | ✓ |
| Zookeeper | 0.9985 | 0.8883 | ✓ | ✓ |
| BGL | 1.0000 | 0.8308 | ✓ | ✓ |
| HPC | 0.9980 | 0.8554 | ✓ | ✓ |
| Linux | 1.0000 | 0.8545 | ✓ | ✓ |
| Mac | 0.9375 | 0.7937 | ✓ | ✓ |
| Apache | 1.0000 | 0.9211 | ✓ | ✓ |
| OpenSSH | 1.0000 | 0.8114 | ✓ | ✓ |
| Windows | 0.9980 | 0.8780 | ✓ | ✓ |
| Android | 0.9985 | 0.7174 | ✓ | ✓ |
| HealthApp | 1.0000 | 0.8794 | ✓ | ✓ |
| Proxifier | **0.4800** | 0.8500 | ✗ | ✓ |
| **平均** | **0.9525** | **0.8331** | **14/15** | **15/15** |

---

## Proxifier GA 进展

| 阶段 | GA | 改进 |
|------|-----|------|
| Baseline (I3) | 0.366 | — |
| I15 (双插件架构) | **0.480** | **+31.1%** |
| 目标 | 0.850 | 仍需 +77% |

### 根因分析

Proxifier GT 由非标准 parser 生成，使用 **term-pair 匹配**而非 position-dependent matching：
- LogSig: 0.967 (term pairs, 位置无关)
- LogCluster: 0.951 (频率聚类)
- Drain (logparser): 0.527 (position-dependent 上限)

我们的 0.480 距离 Drain 上限 0.527 仍有 10% 差距。核心瓶颈：
1. 可变 token count 消息无法进入同一 tree branch
2. `<1 sec` vs `00:01` 等 duration 格式变化
3. 完全克服需要 position-independent 匹配（超出 Drain 算法边界）

### 架构方向

`TokenNormalizer` 接口 + `AdjacentConstantFusion` 已提供可扩展基础。进一步改进需要：
- 更智能的 normalize（如 duration 格式统一）
- 或引入 term-pair 模式作为 `TokenNormalizer` 的新实现

---

## 测试覆盖

| 指标 | 值 | 阈值 |
|------|-----|------|
| Statements | 92.42% | 92% |
| Branches | 85.28% | 85% |
| Functions | 95.67% | 94% |
| Lines | 93.25% | 93% |
| **Total Tests** | **410** | — |

---

## 竞品分析

| Parser | Proxifier GA | 技术 |
|--------|-------------|------|
| LogSig | 0.967 | Term pair + 潜力函数 |
| LogCluster | 0.951 | 频率聚类 |
| **drain-ts (I15)** | **0.480** | Drain + TokenNormalizer + TemplatePatternStrategy |
| Drain (logparser) | 0.527 | Drain 原始 |
| Spell | 0.527 | LCS |
| SLCT | 0.518 | 签名 |
