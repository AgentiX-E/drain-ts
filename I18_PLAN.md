# I18 竞品借鉴行动方案

## 研究总结

### AEL 三大支柱（Proxifier 0.974 GA）

| 支柱 | 机制 | drain-ts 对应 | 状态 |
|------|------|-------------|:---:|
| 1. RegEx 预处理 | `re.sub(pattern, "<*>", log)` | TokenNormalizer (RegexSubstitution) | ✅ I16 |
| 2. (tc, pc) Binning | `bins[(token_count, param_count)]` | enableParamBinning | ✅ I16 |
| **3. reconcile() 合并** | **post-training similarity merge** | **无** | 🔴 **缺失** |

### IPLoM 核心洞察

| 技术 | 机制 | 适用性 |
|------|------|:---:|
| Step1: token count partition | 同 Drain root key | ✅ 已有 |
| Step2: column position analysis | 找 min-unique-tokens 列 | 🔑 TokenNormalizer |
| Step3: mapping relations (1:1, 1:M) | 对列关系分析 | ❌ 过于复杂 |
| Step4: template generation | 常量保留, 变量→<*> | ✅ createTemplate |

---

## I18 实现计划

### P0: ClusterMerger — AEL reconcile 移植

```
算法:
1. 训练完成后扫描所有 cluster
2. 对于每对同 token count 的 cluster:
   a. 计算 position-wise diff ratio
   b. 如果 diff/token_count ≤ merge_percent → 合并
3. 递归直到没有更多合并
```

### P1: PositionEntropy Normalizer — IPLoM Step2 启示

```
算法:
1. 分析每个 token position 的 entropy:
   - entropy = |unique values at position| / total messages
   - 低 entropy → constant position
   - 高 entropy → variable position
2. 将高 entropy 位置的 token 归一化为 paramStr
```
