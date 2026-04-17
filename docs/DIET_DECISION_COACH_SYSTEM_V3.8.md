# 饮食决策 + AI 教练系统 V3.8 — 深度 i18n + 代码治理 + 可维护性升级

## 版本目标

从 V3.7 的架构解耦升级到**代码治理级优化**，围绕 8 个核心目标：

1. **i18n 深度清理** — 消除剩余 2000+ 行硬编码中文（V3.7 仅处理了 7 个文件，剩余 40+ 文件未覆盖）
2. **Pipeline 代码冗余消除** — 消除 analysis-pipeline 中的重复食物映射、重复逻辑
3. **决策摘要 i18n 化** — decision-summary.service.ts 有 60+ 处硬编码中文，是最大单点
4. **用户上下文 i18n 化** — user-context-builder 的 GOAL_CONTEXT、formatAsPromptString、healthConditionGuidance 全中文
5. **营养问题检测 i18n 化** — NutritionIssue.implication 始终为中文，教练层消费时无法多语言
6. **Pipeline 质量文案 i18n 化** — enrichSummaryWithConfidence 和 fallback 的硬编码中文
7. **Coach Prompt i18n 补全** — coach-prompt-builder 的 section headers 缺少多语言分支
8. **废弃代码清理** — 移除 deprecated UserContext 别名、统一 locale 格式

---

## Step 1: 当前能力分析（V3.7 → V3.8）

### V3.7 已完成

| 改进                                          | 涉及文件                             | 状态 |
| --------------------------------------------- | ------------------------------------ | ---- |
| i18n: decision-engine 硬编码→cl()             | decision-engine.service.ts           | ✅   |
| i18n: contextual-modifier 中文 fallback→ci()  | contextual-modifier.service.ts       | ✅   |
| i18n: coach-format 纯中文→ci()                | coach-format.service.ts              | ✅   |
| i18n: alternative-suggestion 比较文案→cl()    | alternative-suggestion.service.ts    | ✅   |
| i18n: decision-coach FACTOR_LABELS→cl()       | decision-coach.service.ts            | ✅   |
| 架构: buildDetailedRationale 提取到 explainer | decision-engine → decision-explainer | ✅   |
| 架构: generateDecisionAdvice 提取到 explainer | decision-engine → decision-explainer | ✅   |
| 联动: accuracy=low 时 verdict 自动降级        | analysis-pipeline.service.ts         | ✅   |
| Coach: scoreInsight 语言参数透传              | coach-format.service.ts              | ✅   |
| Coach: CoachActionPlan 结构化增强             | coach-action-plan.service.ts         | ✅   |

### V3.8 待解决的缺失点

| 层级         | 问题                                                     | 严重度 | 涉及文件                             |
| ------------ | -------------------------------------------------------- | ------ | ------------------------------------ |
| 决策摘要     | 60+ 处硬编码中文（headline、coachFocus、hint 等）        | 🔴 高  | decision-summary.service.ts          |
| 用户上下文   | GOAL_CONTEXT 全中文、formatAsPromptString 全中文         | 🔴 高  | user-context-builder.service.ts      |
| 营养问题检测 | 12 个 implication 字符串全中文                           | 🔴 高  | nutrition-issue-detector.service.ts  |
| Pipeline     | enrichSummaryWithConfidence 6 处中文 + fallback 2 处中文 | 🟡 中  | analysis-pipeline.service.ts         |
| Pipeline     | 重复食物映射（2 处 identical 16 行块）                   | 🟡 中  | analysis-pipeline.service.ts         |
| Coach Prompt | 6 处 section header 无多语言分支                         | 🟡 中  | coach-prompt-builder.service.ts      |
| 废弃代码     | 2 处 deprecated UserContext 别名                         | 🟢 低  | user-context-builder + food-decision |

---

## Step 2: i18n 策略

### 原则

- **不新增 i18n 系统** — 复用现有 3 个系统：`cl()`、`ci()`、`t()`
- **就近原则** — 用户面向文案用 `t()`/`cl()`，教练内部用 `ci()`
- **Prompt 文案保留三元** — LLM prompt 内的中文 section header 用 `isEn ? ... : isJa ? ... : ...` 三元即可
- **locale 透传** — 所有方法确保 locale 参数可用

### 各 i18n 系统职责

| 系统                                           | 覆盖范围                         | locale 格式                     |
| ---------------------------------------------- | -------------------------------- | ------------------------------- |
| `t(key, vars, locale)` from `i18n-messages.ts` | 评分、决策、上下文的用户面向文案 | `'zh-CN' \| 'en-US' \| 'ja-JP'` |
| `cl(key, locale)` from `decision-labels.ts`    | 决策因素标签、rationale、suffix  | `'zh-CN' \| 'en-US' \| 'ja-JP'` |
| `ci(key, locale, vars)` from `coach-i18n.ts`   | 教练格式化、修饰器、issue 文案   | `'zh' \| 'en' \| 'ja'`          |

---

## Step 3: 数据流（不变）

```
Pipeline Step 2 (nutrition-aggregator) → foods[], totals
Pipeline Step 3 (user-context-builder) → UnifiedUserContext
Pipeline Step 4 (food-scoring) → healthScore, nutritionScore, breakdown
Pipeline Step 4.1 (analysis-context) → ContextualAnalysis
Pipeline Step 4.5 (analysis-state-builder) → AnalysisState
Pipeline Step 5 (food-decision) → FoodDecision, DietIssue[]
Pipeline Step 5.45 (decision-engine) → StructuredDecision
Pipeline Step 5.5 (decision-summary) → DecisionSummary
Pipeline Step 5.6 (confidence-diagnostics) → ConfidenceDiagnostics
Pipeline Step 5.7 (recovery + evidence + shouldEat) → EvidencePack, ShouldEatAction
Pipeline Step 5.8 (analysis-accuracy) → FoodAnalysisPackage
Pipeline V3.7 (accuracy→decision linkage) → verdict downgrade if low
Pipeline Step 6 (result-assembler) → FoodAnalysisResultV61
```

---

## Step 4: 分阶段实施计划

### Phase 1: 决策摘要 + 营养问题检测 i18n（最大影响）

#### P1.1: decision-summary.service.ts i18n 化

**目标**: 消除 60+ 处硬编码中文

**方法**: 在 `decision-labels.ts` 的 `COACH_LABELS` 中扩展 `summary.*` namespace，新增约 40 个 keys

**新增 keys 规划**:

- `summary.headline.*` — 各种 headline 模板（recommend/caution/avoid × budget 状态）
- `summary.coachFocus.*` — 教练聚焦提示
- `summary.dynamicHint.*` — 动态决策提示
- `summary.healthConstraint.*` — 健康约束提示
- `summary.signal.*` — SIGNAL_DESC_MAP 的所有值
- `summary.quantitative.*` — 量化标签（热量/蛋白质/脂肪/碳水）
- `summary.status.*` — 状态标签（超标/严重不足/偏低/正常）
- `summary.alternative.*` — 替代方案摘要模板
- `summary.postEat` — 已进食后引导

**改动**:

1. `decision/i18n/decision-labels.ts` — 扩展 COACH_LABELS 新增 ~40 keys × 3 语言
2. `decision/decision/decision-summary.service.ts` — 所有中文 → `cl()` 调用，方法签名增加 `locale` 参数

#### P1.2: nutrition-issue-detector.service.ts implication i18n 化

**目标**: 12 个 implication 中文字符串全部走 i18n

**方法**: 在 `decision-labels.ts` 扩展 `issue.*` namespace

**新增 keys**:

- `issue.proteinDeficit` — `蛋白质还差 {amount}g，建议下餐补足`
- `issue.fatExcess` — `脂肪超标 {amount}g，建议减少油炸食物`
- `issue.carbExcess` — `碳水超标 {amount}g，建议减少主食`
- `issue.calorieExcess` — `热量超标 {amount} kcal，建议今日剩余餐控制`
- `issue.calorieDeficit` — `热量不足 {amount} kcal，建议适度增加摄入`
- `issue.fiberDeficit` — `建议增加高纤维食物（蔬菜、全谷物）`
- `issue.sugarExcess` — `碳水/糖分超标 {amount}g，注意控制甜食与精制主食`
- `issue.glycemicRisk` — 糖尿病碳水超标
- `issue.sodiumRisk` — 高血压钠风险
- `issue.cardiovascularRisk` — 心血管脂肪超标
- `issue.purineRisk` — 痛风高嘌呤
- `issue.kidneyStress` — 肾病蛋白质超标

**改动**:

1. `decision/i18n/decision-labels.ts` — 新增 12 keys × 3 语言
2. `decision/analyze/nutrition-issue-detector.service.ts` — implication → `cl()` 调用，方法签名增加 `locale`

#### P1.3: Pipeline 代码冗余消除

**目标**: 消除重复食物映射

**改动**:

1. `decision/analyze/analysis-pipeline.service.ts` — 提取 `toDecisionFoodItems(foods)` 私有方法，两处调用合并

### Phase 2: 用户上下文 + Pipeline 质量文案 i18n

#### P2.1: user-context-builder.service.ts i18n 化

**目标**: GOAL_CONTEXT、formatAsPromptString、buildHealthConditionGuidance 走 i18n

**方法**: 在 `decision-labels.ts` 扩展 `ctx.*` namespace

**新增 keys**:

- `ctx.goal.fatLoss` / `ctx.goal.muscleGain` / `ctx.goal.health` / `ctx.goal.habit` — 目标标签
- `ctx.focus.fatLoss` / `ctx.focus.muscleGain` / `ctx.focus.health` / `ctx.focus.habit` — 目标聚焦
- `ctx.meal.breakfast` / `ctx.meal.lunch` / `ctx.meal.snack` / `ctx.meal.dinner` — 餐次
- `ctx.prompt.goalHeader` / `ctx.prompt.budgetHeader` — section headers
- `ctx.prompt.caloriesRemaining` / `ctx.prompt.proteinRemaining` / ... — 模板
- `ctx.health.header` — 健康条件标题
- `ctx.health.diabetes` / `ctx.health.hypertension` / `ctx.health.heart` / `ctx.health.gout` / `ctx.health.kidney` — 健康指导

**改动**:

1. `decision/i18n/decision-labels.ts` — 新增 ~25 keys × 3 语言
2. `decision/decision/user-context-builder.service.ts` — GOAL_CONTEXT 改为函数 `getGoalContext(locale)`，formatAsPromptString 增加 locale 参数

#### P2.2: Pipeline enrichSummaryWithConfidence + fallback i18n 化

**目标**: 8 处硬编码中文 → i18n

**新增 keys**:

- `pipeline.quality.high` / `pipeline.quality.medium` / `pipeline.quality.low` — 质量说明
- `pipeline.guardrail.lowQuality` / `pipeline.guardrail.avoidVerdict` / `pipeline.guardrail.postEat` — guardrails
- `pipeline.fallback.reason` / `pipeline.fallback.summary` — fallback 文案

**改动**:

1. `decision/i18n/decision-labels.ts` — 新增 8 keys × 3 语言
2. `decision/analyze/analysis-pipeline.service.ts` — enrichSummaryWithConfidence 增加 locale 参数

### Phase 3: Coach Prompt + 废弃代码清理

#### P3.1: coach-prompt-builder.service.ts section headers i18n

**目标**: 6 处 section header 加多语言分支

**改动**: `coach/app/prompt/coach-prompt-builder.service.ts` — 在已有的 `isEn`/`isJa` 模式下补全 section headers

#### P3.2: 废弃 UserContext 别名清理

**目标**: 移除 deprecated 别名，确保所有消费方使用 UnifiedUserContext

**改动**:

1. 检查所有 `import { UserContext }` 引用
2. 替换为 `UnifiedUserContext`
3. 移除 `user-context-builder.service.ts:31` 和 `food-decision.service.ts:71` 的别名

---

## Step 5: 修改文件清单

### Phase 1 修改

| 文件                                                   | 操作 | 说明                                         |
| ------------------------------------------------------ | ---- | -------------------------------------------- |
| `decision/i18n/decision-labels.ts`                     | 扩展 | 新增 ~52 keys（summary._ + issue._）× 3 语言 |
| `decision/decision/decision-summary.service.ts`        | 重构 | 60+ 处中文→cl()，增加 locale 参数            |
| `decision/analyze/nutrition-issue-detector.service.ts` | 重构 | 12 处 implication→cl()，增加 locale 参数     |
| `decision/analyze/analysis-pipeline.service.ts`        | 精简 | 提取 toDecisionFoodItems()，消除 16 行重复   |

### Phase 2 修改

| 文件                                                | 操作 | 说明                                        |
| --------------------------------------------------- | ---- | ------------------------------------------- |
| `decision/i18n/decision-labels.ts`                  | 扩展 | 新增 ~33 keys（ctx._ + pipeline._）× 3 语言 |
| `decision/decision/user-context-builder.service.ts` | 重构 | GOAL_CONTEXT→函数 + prompt/health 走 cl()   |
| `decision/analyze/analysis-pipeline.service.ts`     | 重构 | enrichSummary + fallback 走 cl()            |

### Phase 3 修改

| 文件                                                | 操作 | 说明                             |
| --------------------------------------------------- | ---- | -------------------------------- |
| `coach/app/prompt/coach-prompt-builder.service.ts`  | 补全 | 6 处 section header 三元         |
| `decision/decision/user-context-builder.service.ts` | 清理 | 移除 deprecated alias            |
| `decision/decision/food-decision.service.ts`        | 清理 | 移除 deprecated alias            |
| 所有 import UserContext 的文件                      | 迁移 | UserContext → UnifiedUserContext |

---

## Step 6: 风险控制

- **编译检查**: 每个 Phase 完成后执行 `npx tsc --noEmit --project apps/api-server/tsconfig.json`
- **不新增模块/数据库字段**: 所有改动在现有文件内
- **推荐系统/用户画像只读**: 仅 import `t()`/`Locale` 类型
- **向后兼容**: `cl()` 对不存在的 key 返回 key 本身，不会 break
