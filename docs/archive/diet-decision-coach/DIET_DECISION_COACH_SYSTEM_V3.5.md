# 饮食决策 + AI 教练系统 V3.5 设计文档

> 版本：V3.5  
> 基于：V3.4（已完成 Phase 1–3 健康条件注入 + CoachInsight 接入）  
> 目标：健康感知评分 × 决策约束传播 × 教练上下文闭环

---

## 一、现状分析（V3.4 之后）

### 已具备能力

| 层   | 能力                                                                                                 | 状态                             |
| ---- | ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| 分析 | 12 维营养解析（text/image 双链路）                                                                   | ✅                               |
| 分析 | 上下文感知 Prompt（healthConditions/budgetStatus/nutritionPriority）                                 | ✅ V3.4                          |
| 分析 | 多信号准确度评估（assessFromFoods）                                                                  | ✅ V3.4                          |
| 评分 | 7 维 NutritionScore（energy/proteinRatio/macroBalance/foodQuality/satiety/stability/glycemicImpact） | ✅                               |
| 决策 | StructuredDecision（4 因素：nutritionAlignment/macroBalance/healthConstraint/timeliness）            | ✅ V3.3                          |
| 决策 | healthConditions → NutritionIssue 特异性检测（V3.4 5 类规则）                                        | ✅ V3.4                          |
| 替代 | 3 层替代（推荐引擎 / 替换库 / 静态规则）                                                             | ✅                               |
| 替代 | NutritionIssue → AlternativeConstraints 映射（部分）                                                 | ⚠️ 仅 4 类，V3.4 新增 5 类未映射 |
| 教练 | CoachInsightService（优先/趋势/目标/时机）                                                           | ✅ V3.3                          |
| 教练 | CoachInsightService → CoachPromptBuilder 接入                                                        | ✅ V3.4                          |

### V3.5 目标缺失点

| 层       | 缺失                                                                                | 影响                                           |
| -------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| **评分** | healthConditions 未影响评分权重                                                     | 糖尿病用户吃高 GI 食物得分不受影响，评分失真   |
| **评分** | `ScoringContext` 无 healthConditions 字段                                           | Pipeline 无法传递健康条件给评分引擎            |
| **决策** | `extractConstraintsFromNutritionIssues` 未处理 V3.4 新增 5 类 issue                 | 替代推荐不精准（`glycemic_risk` 不约束低碳水） |
| **决策** | `DecisionSummary.healthConstraintNote` 只列举条件，不利用已检测 issue               | 教练上下文没有具体风险描述                     |
| **决策** | `DecisionSummaryService.summarize()` 不接受 `nutritionIssues`                       | V3.4 检测的 issue 无法流入摘要                 |
| **决策** | `decisionMode` 未影响 `actionItems`（pre/post 行动建议相同）                        | 吃完后仍给"能不能吃"建议，时机错误             |
| **教练** | `CoachService` 未将 `contextualAnalysis` + `unifiedUserContext` 传给 Prompt Builder | V3.4 CoachInsight 注入点存在但数据未传达       |
| **教练** | `enrichSummaryWithConfidence` 模式无感知（post_eat 还给 pre_eat 建议）              | 后食教练建议错位                               |

---

## 二、V3.5 设计原则

```
用户输入（文字 / 图片）
    ↓
Step 1: 食物识别（food 模块保持不动）
    ↓
Step 2: 营养汇总
    ↓
Step 3: 用户上下文（healthConditions / goalType / macroSlotStatus）
    ↓
Step 4: 健康感知评分 ← V3.5 P1 新增：healthConditions 调整权重
    ↓
Step 4.1: 上下文分析 → NutritionIssue（含 V3.4 health issue）
    ↓
Step 5: 决策 → StructuredDecision
    ↓
Step 5.5: 结构化摘要 ← V3.5 P2 新增：nutritionIssues 流入，decisionMode 区分行动
    ↓
Step 5.7: 替代方案 ← V3.5 P2 新增：V3.4 issue 类型完整约束映射
    ↓
Step 6: 组装 FoodAnalysisResultV61
    ↓
AI 教练 ← V3.5 P3 新增：contextualAnalysis + unifiedUserContext 闭环传递
```

---

## 三、分阶段迭代计划

### Phase 1：健康感知评分（Scoring Enhancement）

#### P1.1 `food-scoring.service.ts` — ScoringContext 扩展 + 健康条件分数调整

**目标**：评分结果对健康条件敏感，防止高风险食物在特定用户下获得虚高分数。

**设计**：

- `ScoringContext` 新增 `healthConditions?: string[]`
- `calculateScore()` 在 `computeScoreCore()` 之后调用 `applyHealthConditionAdjustment()`
- 调整逻辑：
  - `diabetes` → `glycemicImpact < 60`：`healthScore × 0.85`，breakdownExplanations 追加糖尿病警告
  - `heart_disease/cardiovascular` → `macroBalance < 60`：`healthScore × 0.85`
  - `hypertension` → 若 foods 中 sodium > 800mg：`healthScore × 0.9`
- 不改动 `nutritionScore`（保留客观营养评分），只调整 `healthScore`（个性化健康分）

#### P1.2 `analysis-pipeline.service.ts` — 传递 healthConditions 给评分

**目标**：Pipeline Step 4 评分时携带用户健康条件。

**设计**：

- `computeScore()` 的 `ScoringContext` 补充 `healthConditions: userContext.healthConditions`
- 文本链路 `calculateScore()` 调用时注入

---

### Phase 2：决策增强（Decision Enhancement）

#### P2.1 `alternative-suggestion.service.ts` — V3.4 issue 类型完整映射

**目标**：V3.4 新增的健康条件 issue 类型能驱动替代方案约束。

**设计**：

- `AlternativeConstraints` 新增字段：
  - `preferLowGlycemic?: boolean` — 低 GI 偏好
  - `preferLowSodium?: boolean` — 低钠偏好
- `extractConstraintsFromNutritionIssues()` 补充：
  - `glycemic_risk` → `preferLowCarb: true` + `preferLowGlycemic: true`
  - `cardiovascular_risk` → `preferLowFat: true`
  - `sodium_risk` → `preferLowSodium: true`
  - `purine_risk` → `preferLowProtein`（暂映射到 `preferLowCalorie` 代理）
  - `kidney_stress` → `preferLowProtein`（同上）
- `getEngineAlternatives()` 当 `preferLowGlycemic` 时，降低 carbs 目标（max 15g）

#### P2.2 `decision-summary.service.ts` — nutritionIssues 流入 + decisionMode 行动分离

**目标**：

1. `healthConstraintNote` 利用已检测的具体 issue（而非仅列举条件名称）
2. `actionItems` 根据 `decisionMode` 给出 pre_eat / post_eat 不同行动建议

**设计**：

- `SummaryInput` 新增：
  - `nutritionIssues?: NutritionIssue[]` — 来自 `contextualAnalysis.identifiedIssues`
  - `decisionMode?: 'pre_eat' | 'post_eat'`
- `buildHealthConstraintNote()` 优先使用 `nutritionIssues` 中 health-condition 类型的 `implication`
- `buildActionItems()` 按 `decisionMode` 分支：
  - `pre_eat`：聚焦"能吃多少/如何搭配"
  - `post_eat`：聚焦"吃完了，接下来怎么补偿/调整"

#### P2.3 `analysis-pipeline.service.ts` — 关键数据传递

**目标**：确保 `nutritionIssues` 和 `decisionMode` 流入摘要服务。

**设计**：

- `decisionSummaryService.summarize()` 调用时追加 `nutritionIssues: contextualAnalysis?.identifiedIssues`，`decisionMode: mode`

---

### Phase 3：教练闭环（Coach Enhancement）

#### P3.1 `analysis-pipeline.service.ts` — mode-aware enrichSummaryWithConfidence

**目标**：post_eat 模式下的 guardrails 和 analysisQualityNote 聚焦恢复而非决策。

**设计**：

- `enrichSummaryWithConfidence()` 接受 `mode: 'pre_eat' | 'post_eat'` 参数
- `post_eat` 模式：`analysisQualityNote` 改为"已记录本餐，建议用于下餐调整参考。"
- `post_eat` 模式：guardrails 聚焦 recovery（`postMealRecovery`）

#### P3.2 `coach.service.ts` — CoachInsight 数据闭环

**目标**：将 `contextualAnalysis` 和 `unifiedUserContext` 传递给 `formatAnalysisContext()`，使 V3.4 的 CoachInsight 注入点生效。

**设计**：

- `CoachService` 中调用 `promptBuilder.formatAnalysisContext()` 时，从 `FoodAnalysisResultV61` 中提取并传入：
  - `contextualAnalysis`（需要从 result 中取，或通过 `AnalysisContextService` 重建）
  - `unifiedUserContext`（需要存入 result 或重建）
- 由于 `FoodAnalysisResultV61` 当前不存储 `contextualAnalysis`，采用懒重建策略：从 result 的 summary + macroProgress 信息推断

---

## 四、文件改动清单

### 新增字段（不新增数据库字段）

| 文件                                | 改动                                                         | 类型     |
| ----------------------------------- | ------------------------------------------------------------ | -------- |
| `food-scoring.service.ts`           | `ScoringContext.healthConditions`                            | 内存字段 |
| `alternative-suggestion.service.ts` | `AlternativeConstraints.preferLowGlycemic / preferLowSodium` | 内存字段 |
| `decision-summary.service.ts`       | `SummaryInput.nutritionIssues / decisionMode`                | 内存字段 |

### 修改文件

| 文件                                | 改动描述                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `food-scoring.service.ts`           | 健康条件分数调整 + breakdownExplanations 健康警告                                     |
| `analysis-pipeline.service.ts`      | 评分传 healthConditions / summarize 传 nutritionIssues+mode / enrichSummary 接受 mode |
| `alternative-suggestion.service.ts` | V3.4 issue 类型约束映射 + preferLowGlycemic carbs 约束                                |
| `decision-summary.service.ts`       | nutritionIssues → healthConstraintNote / decisionMode → actionItems                   |
| `coach.service.ts`                  | formatAnalysisContext 传 contextualAnalysis + unifiedUserContext                      |

### 禁止修改

- `recommendation/` 推荐系统（只读）
- `user/` 用户画像系统（只读）
- 所有 `*.module.ts` 之外的数据库 Entity/Schema
- 订阅/商业化相关服务

---

## 五、可验证指标

| 指标                                               | 方式                                                         |
| -------------------------------------------------- | ------------------------------------------------------------ |
| 糖尿病用户 + 高碳水餐 → healthScore 降低           | 单元测试 `FoodScoringService.applyHealthConditionAdjustment` |
| `glycemic_risk` issue → `preferLowCarb: true` 约束 | 单元测试 `extractConstraintsFromNutritionIssues`             |
| `post_eat` 模式 → actionItems 含"补偿"文案         | 单元测试 `DecisionSummaryService.buildActionItems`           |
| `CoachInsightPack` 在 prompt 中出现                | E2E 日志验证                                                 |
| TypeScript 编译 0 错误                             | `npx tsc --noEmit`                                           |
