# 饮食决策 + AI教练系统 V4.7 升级设计文档

> 版本：V4.7 | 基线：V4.6 | 不兼容旧代码

---

## 一、当前系统能力分析（Step 1）

### 1.1 已具备能力

| 层级     | 能力                             | 状态    | 缺陷                                                         |
| -------- | -------------------------------- | ------- | ------------------------------------------------------------ |
| **分析** | 文本/图片食物识别 + 营养估算     | ✅ 完整 | 提示词冗余（文本/图片各维护一份），prompt 内有大量中文硬编码 |
| **分析** | 食物库匹配 + AI 估算融合         | ✅ 完整 | 匹配后的营养数据优先食物库，合理                             |
| **评分** | 7维营养评分 + 健康状况调整       | ✅ 完整 | `ScoringFoodItem` 与 `AnalyzedFoodItem` 字段重复映射         |
| **决策** | Should Eat 三级判定 + 结构化决策 | ✅ 完整 | `decision-checks.ts` 1218行，职责过多需拆分                  |
| **决策** | 冲突检测（过敏/限制/健康）       | ✅ 完整 | `buildConflictReport` 内联在 checks 文件中                   |
| **决策** | 替代方案（推荐引擎 + 静态规则）  | ✅ 完整 | 静态规则仍有硬编码品类逻辑                                   |
| **教练** | 三段式行动计划 + 行为洞察        | ✅ 完整 | 教育内容仅覆盖 6 种健康风险                                  |
| **教练** | 解释链 6 步骤 + 因果叙事         | ✅ 完整 | explainer 内仍有零散的硬编码多语言字符串                     |
| **i18n** | 三套系统共存 (t/cl/ci)           | ✅ 完整 | 部分文件仍有内联中文字符串                                   |

### 1.2 缺失点分析

| 层级     | 缺失                                                                                                        | 影响                        | V4.7 优先级 |
| -------- | ----------------------------------------------------------------------------------------------------------- | --------------------------- | ----------- |
| **分析** | 提示词 prompt 本身是中文硬编码，不支持多语言 prompt                                                         | 非中文 LLM 效果下降         | P1          |
| **分析** | 文本/图片 prompt 各自维护，schema 虽统一但规则描述重复                                                      | 维护成本高，改一处忘另一处  | P1          |
| **评分** | `food-scoring.service.ts` 的 `applyHealthConditionAdjustment` 与 `decision-checks.ts` 的健康检查逻辑重复    | 痛风/IBS/肾病等检查存在两处 | P1          |
| **决策** | `decision-checks.ts` 1218行，混合了：过敏/限制/健康/预算/时段 五类检查 + ConflictReport 构建                | 难以单独增强某类检查        | P2          |
| **决策** | `decision-explainer.service.ts` Step 4 snapshot 用 `conditionsText` 硬编码三语                              | i18n 不彻底                 | P2          |
| **教练** | `decision-coach.service.ts` 的 `enrichWithStructuredFactors` 中 factor label 用 `cl()` 但 type 映射是硬编码 | 可维护性差                  | P3          |
| **全局** | `explainer-labels.ts` 中 `chainLabel` 函数内有硬编码 fallback 中文                                          | i18n 不彻底                 | P3          |

---

## 二、V4.7 优化目标

### 核心原则

- **不兼容旧代码**，以最优标准迭代
- **不增加新模块**，只在现有 decision 模块内重构
- **不增加数据库字段**
- 推荐系统/用户画像系统**只读**

### 优化目标（4-8 个/批次）

**Phase 1（分析 + 评分 + i18n 基础）**

1. **P1.1** 提取共享 prompt schema 常量，消除文本/图片 prompt 重复
2. **P1.2** Prompt 多语言支持：按 locale 切换 prompt 语言（中/英/日）
3. **P1.3** `ScoringFoodItem` 简化：直接从 `AnalyzedFoodItem` 派生，消除重复映射
4. **P1.4** 评分健康调整去重：`applyHealthConditionAdjustment` 委托给 `decision-checks` 已有逻辑
5. **P1.5** `decision-explainer.service.ts` 内联硬编码多语言字符串迁移到 `cl()` / `ci()`
6. **P1.6** tsc 验证

**Phase 2（决策系统解耦 + 替代建议 + 上下文）**

1. **P2.1** `decision-checks.ts` 拆分：按职责拆为 `allergen-checks.ts` / `restriction-checks.ts` / `health-condition-checks.ts` / `budget-timing-checks.ts`，保留 `decision-checks.ts` 作为聚合入口
2. **P2.2** `alternative-suggestion.service.ts` 优化：消除静态规则中的品类硬编码，全面基于 `substitutionConstraints` schema
3. **P2.3** Pipeline `toDecisionFoodItems` 优化：减少手动字段映射，用 spread + pick 模式
4. **P2.4** `buildConflictReport` 提取为独立纯函数文件 `conflict-report-builder.ts`
5. **P2.5** tsc 验证

**Phase 3（AI 教练 + 可解释性 + 全局审计）**

1. **P3.1** `decision-coach.service.ts` 的 `enrichWithStructuredFactors` 优化：factor-type 映射提取为配置常量
2. **P3.2** `explainer-labels.ts` 内硬编码 fallback 中文迁移到 `cl()`
3. **P3.3** 全局 i18n 审计：decision 模块内所有内联中文字符串（非注释）→ `cl()` / `ci()`
4. **P3.4** 代码冗余清理：移除 `alternative-food-rules.ts` 中未使用的导出和死代码
5. **P3.5** tsc 验证

---

## 三、决策链路设计（Step 5）

```
用户输入（文本/图片）
  ↓
[食物识别] text-food-analysis / image-food-analysis
  ↓ AnalyzedFoodItem[]
[共享 Prompt Schema] ← V4.7 P1.1 提取
  ↓
[营养汇总] nutrition-aggregator → NutritionTotals
  ↓
[用户上下文] user-context-builder → UnifiedUserContext
  ↓
[评分] food-scoring.service → AnalysisScore
  ↓ V4.7 P1.3: ScoringFoodItem 简化
[上下文分析] analysis-context.service → ContextualAnalysis
  ↓
[决策判断] food-decision.service → DecisionOutput
  ├── decision-engine.service (核心决策)
  ├── decision-checks/ ← V4.7 P2.1 拆分
  │   ├── allergen-checks.ts
  │   ├── restriction-checks.ts
  │   ├── health-condition-checks.ts
  │   └── budget-timing-checks.ts
  ├── conflict-report-builder.ts ← V4.7 P2.4 提取
  ├── alternative-suggestion.service (替代方案)
  └── decision-explainer.service (解释链)
  ↓
[AI教练] coach/
  ├── decision-coach.service (教练说明)
  ├── coach-insight.service (洞察包)
  └── coach-i18n.ts (三语文案)
  ↓
FoodAnalysisResultV61（最终输出）
```

---

## 四、API 能力设计（Step 6）

### 已有能力（可复用）

- 文本饮食分析：`TextFoodAnalysisService.analyze()`
- 图片饮食分析：`ImageFoodAnalysisService.executeAnalysis()`
- 统一分析管道：`AnalysisPipelineService.runAnalyze/runDecide/runCoaching`
- 替代方案推荐：`SubstitutionService.findSubstitutes()` (只读)
- 推荐引擎：`RecommendationEngineService.recommendMeal()` (只读)

### V4.7 增强的能力（非新增，是现有能力的优化）

- Prompt Schema 共享 → 降低维护成本
- 评分系统简化 → 减少类型映射冗余
- 决策检查模块化 → 支持独立增强
- 解释链 i18n 完善 → 全语言一致体验

---

## 五、数据结构增强（Step 7，允许范围内）

### 5.1 不增加数据库字段

### 5.2 代码层类型优化

- `ScoringFoodItem` 改为 `AnalyzedFoodItem` 的 `Pick` 子集 + 评分专属字段
- `decision-checks.ts` 的 `CheckableFoodItem` 保持不变（已对齐 V4.6）

---

## 六、分阶段实施计划（Step 8）

### Phase 1：分析 + 评分 + i18n 基础（6 个目标）

| 编号 | 文件                                               | 改动                                                                          |
| ---- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1.1 | 新建 `food/app/services/analysis-prompt-schema.ts` | 提取 JSON schema 和通用规则为共享常量                                         |
| P1.1 | `text-food-analysis.service.ts`                    | `TEXT_ANALYSIS_PROMPT` 改为消费共享 schema                                    |
| P1.1 | `image-food-analysis.service.ts`                   | `BASE_PROMPT` 改为消费共享 schema                                             |
| P1.2 | `analysis-prompt-schema.ts`                        | 添加 `buildPrompt(locale)` 按语言生成 prompt                                  |
| P1.3 | `score/food-scoring.service.ts`                    | `ScoringFoodItem` 改为 `Pick<AnalyzedFoodItem, ...> & { libraryMatch?: ... }` |
| P1.4 | `score/food-scoring.service.ts`                    | `applyHealthConditionAdjustment` 简化，委托给 checks 逻辑                     |
| P1.5 | `decision/decision-explainer.service.ts`           | 内联三语字符串 → `cl()`                                                       |
| P1.6 | —                                                  | tsc 0 errors                                                                  |

### Phase 2：决策解耦 + 替代 + 上下文（5 个目标）

| 编号 | 文件                                                | 改动                                   |
| ---- | --------------------------------------------------- | -------------------------------------- |
| P2.1 | 新建 `config/checks/allergen-checks.ts` 等 4 个文件 | 从 `decision-checks.ts` 拆分           |
| P2.1 | `config/decision-checks.ts`                         | 保留为聚合入口，re-export 拆分后的函数 |
| P2.2 | `decision/alternative-suggestion.service.ts`        | 消除品类硬编码                         |
| P2.3 | `analyze/analysis-pipeline.service.ts`              | `toDecisionFoodItems` 简化             |
| P2.4 | 新建 `config/conflict-report-builder.ts`            | 从 decision-checks 提取                |
| P2.5 | —                                                   | tsc 0 errors                           |

### Phase 3：教练 + 可解释性 + 审计（5 个目标）

| 编号 | 文件                               | 改动                       |
| ---- | ---------------------------------- | -------------------------- |
| P3.1 | `coach/decision-coach.service.ts`  | factor-type 映射提取为常量 |
| P3.2 | `i18n/explainer-labels.ts`         | 硬编码 fallback → `cl()`   |
| P3.3 | decision 模块全局                  | 内联中文字符串 → i18n      |
| P3.4 | `config/alternative-food-rules.ts` | 清理死代码                 |
| P3.5 | —                                  | tsc 0 errors               |

---

## 七、禁止修改范围确认

- ❌ 推荐系统：只读 `SubstitutionService` / `RecommendationEngineService`
- ❌ 用户画像系统：只读 `UnifiedUserContext`
- ❌ 订阅/商业化逻辑
- ❌ 不增加数据库字段
- ❌ 不增加新模块（`analysis-prompt-schema.ts` 是 food 模块内新文件，非新模块）
- ❌ decision-checks 拆分为子文件仍在 `config/` 目录下，非新模块

---

## 八、i18n 系统约束

- `t(key,vars,locale)` — 推荐系统只读，decision 模块禁止新增 `t()` 调用
- `cl(key,locale)` — decision 模块主用，labels-zh/en/ja
- `ci(key,locale,vars)` — coach 专用，coach-i18n.ts
