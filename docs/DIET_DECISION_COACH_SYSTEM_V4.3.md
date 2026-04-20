# 饮食决策 + AI 教练系统 V4.3 — 遗留清理 + i18n 统一 + 可解释性深化

## 版本定位

V4.2 完成了分析精度、因果可解释性、教练个性化。V4.3 聚焦**技术债清理、i18n 体系统一、可解释性深化**：

> 从"功能完善"到"代码干净、翻译统一、解释精准"

核心理念：**清除双重评分遗留、统一 i18n 调用规范、消除 inline require()、提升替代方案和决策解释的国际化质量。**

---

## 现有系统缺口分析

### 1. 遗留代码（~420 行可废弃）

| 缺口                           | 现象                                                              | 影响                                      |
| ------------------------------ | ----------------------------------------------------------------- | ----------------------------------------- |
| 双重评分系统                   | `ScoringService`(232行) 仅被 `DecisionClassifierService` 使用     | 维护负担，概念混淆                        |
| 遗留分类器                     | `DecisionClassifierService`(188行) 用关键词匹配 i18n key 做决策   | 已被 `DecisionEngineService` 四维加权取代 |
| I18nManagementService 孤立引用 | 仅被 `DecisionClassifierService` 使用                             | 废弃分类器后可移除引用                    |
| inline require()               | `decision-summary.service.ts` 第762-776行动态 `require()` + `new` | 绕过 DI，不可测试                         |

### 2. i18n 混用（4 套系统）

| 文件                                | 问题                          | 行号                               |
| ----------------------------------- | ----------------------------- | ---------------------------------- |
| `decision-engine.service.ts`        | `t() \|\| cl()` fallback 模式 | 557-567, 593-600, 651-652, 670-694 |
| `decision-explainer.service.ts`     | 面向用户文案使用 `t()`        | 107-178, 447-561                   |
| `alternative-suggestion.service.ts` | `t()` 和 `cl()` 混用          | 388-432, 494-528, 768-788          |

### 3. 教练可解释性

| 缺口                   | 现象                                   | 影响                 |
| ---------------------- | -------------------------------------- | -------------------- |
| 冲突解释不够直观       | 健康条件冲突只给标签，无具体营养素数据 | 用户不理解为什么冲突 |
| 替代方案缺乏对比叙事   | 只说"推荐X替代Y"，无营养对比           | 用户不信服替代建议   |
| 教练回复缺乏上下文引用 | 不引用当天已摄入数据                   | 建议脱离实际         |

---

## 约束

- 不新增 provider（35个上限，可减少）
- 不新增数据库字段
- 不修改推荐系统/用户画像系统/订阅逻辑
- 所有新增字段 `?:` 可选
- i18n 三套共存：`t()` (推荐系统只读) / `cl()` (决策标签) / `ci()` (教练文案)
- 面向用户文案统一用 `cl()` 或 `ci()`，禁止在 decision 模块新增 `t()` 调用

---

## Phase 1: 遗留清理 + DecisionEngine i18n 统一 + require() 修复

### 1.1 废弃 ScoringService + DecisionClassifierService

**目标**：标记废弃，从 module providers/exports 移除。

**文件变更**：

1. `score/scoring.service.ts` — 类头部添加 `@deprecated` JSDoc
2. `decision/decision-classifier.service.ts` — 类头部添加 `@deprecated` JSDoc
3. `decision.module.ts` — 从 providers 数组移除 `ScoringService`、`DecisionClassifierService`、`I18nManagementService`；从 exports 移除对应项；从 imports 移除 `I18nManagementService` 的来源模块（如有）

**验证**：确保无其他文件 import 这三个 service。

### 1.2 decision-summary.service.ts inline require() → constructor 注入

**文件**: `decision/decision-summary.service.ts`

将第762-776行的：

```typescript
const { getSignalPriority } = require('../config/signal-priority.config');
const { DynamicSignalWeightService } = require('../config/dynamic-signal-weight.service');
const weightService = new DynamicSignalWeightService();
```

改为 constructor 注入 `DynamicSignalWeightService`，直接使用 `this.dynamicSignalWeightService`。`getSignalPriority` 改为顶部 import。

### 1.3 DecisionEngineService i18n 统一

**文件**: `decision/decision-engine.service.ts`

将 `t() || cl()` fallback 模式统一为纯 `cl()` 调用：

- `computeNutritionAlignment` (557-567): 移除 `t()` fallback
- `computeMacroBalance` (593-600): 移除 `t()` fallback
- `computeHealthConstraint` (651-652): 移除 `t()` fallback
- `computeTimeliness` (670-694): 移除 `t()` fallback

需在 `decision-labels.ts` 新增缺失的 key（如有）。

### 1.4 新增 decision-labels.ts keys（Phase 1 批次）

为 DecisionEngine 中迁移的 `t()` 调用补充对应的 `cl()` keys（三语）。

---

## Phase 2: alternative-suggestion + decision-explainer i18n 迁移

### 2.1 alternative-suggestion.service.ts t() → cl()

**目标区域**：

1. `explainEngineCandidate` (388-432): 推荐引擎候选解释文案
2. `getSubstitutionAlternatives` (494-528): 替换服务候选文案
3. `generateStaticAlternatives` (768-788): 静态规则候选文案

所有面向用户的 `t()` 调用迁移为 `cl()`，在 `decision-labels.ts` 新增对应 keys。

### 2.2 decision-explainer.service.ts t() → cl()

**目标区域**：

1. `generateDecisionAdvice` (107-178): 决策建议文案
2. `generateExplanation` (447-561): 解释生成（summary, verdict, goal, remaining 等）

所有面向用户的 `t()` 调用迁移为 `cl()`。

### 2.3 新增 decision-labels.ts keys（Phase 2 批次）

为 Phase 2 迁移的所有 `t()` 调用补充对应的 `cl()` keys（三语：zh, en, ja）。

---

## Phase 3: 教练增强 + 可解释性优化 + 国际化完善

### 3.1 冲突解释增强

**文件**: `decision/decision-explainer.service.ts`

在健康条件冲突解释中加入具体营养素数据：

- "高血压风险：该食物钠含量 {sodium}mg，超出建议摄入量 {percent}%"
- 使用 `ci()` 系统生成，确保三语支持

### 3.2 替代方案对比叙事

**文件**: `decision/alternative-suggestion.service.ts`

增强替代方案的 `comparison` 字段：

- 对推荐引擎和替换服务的候选都生成营养对比摘要
- 使用 `cl()` 生成对比文案

### 3.3 教练上下文引用增强

**文件**: `coach/decision-coach.service.ts`

在教练回复中引用当天摄入数据：

- 使用已有的 `dailyIntake` 数据构建上下文引用
- 新增 `ci()` keys 支持 "今天已摄入 {calories}kcal，{protein}g蛋白质" 等模板

### 3.4 coach-i18n.ts 新增 keys（Phase 3 批次）

为教练增强功能补充 `ci()` keys（三语）。

### 3.5 残留 i18n 扫描 + 清理

全局扫描 decision 模块，确保无遗漏的 `t()` 调用（排除 import 语句和注释）。

---

## 变更影响评估

| 变更                                          | 风险                 | 回滚策略          |
| --------------------------------------------- | -------------------- | ----------------- |
| 废弃 ScoringService/DecisionClassifierService | 低 — 已被取代        | 恢复 module 注册  |
| i18n t()→cl() 迁移                            | 中 — 需确保 key 完整 | 恢复 t() fallback |
| require() → DI                                | 低 — 纯重构          | 恢复 require()    |
| 教练增强                                      | 低 — 纯新增可选字段  | 移除新增逻辑      |

## 预期成果

1. **-420 行**遗留代码废弃（ScoringService + DecisionClassifierService）
2. **-3 个** module providers（减至 32 个）
3. **0 个** decision 模块内的 `t()` 调用（推荐系统 `t()` 不动）
4. **0 个** inline `require()`
5. **完整三语覆盖**所有面向用户的决策/教练文案
6. **增强可解释性**：冲突带数据、替代有对比、教练引用当天摄入
