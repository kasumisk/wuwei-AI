# 饮食决策 + AI 教练系统 V3.6 设计文档

## 概述

V3.6 在 V3.5 的基础上，围绕**分析精准化 → 决策增强 → 教练升级**三个维度进行迭代。
核心目标：提升 AI 估算营养数据的可靠性、决策结果的健康感知度、教练 prompt 的可维护性与 token 效率。

**不修改范围**：推荐系统、用户画像系统、订阅/商业化逻辑。  
**不增加数据库字段**，禁止增加新 NestJS 模块。  
**推荐系统 / 用户画像系统只读**（不写入）。

---

## Phase 1 — 分析精准化

### P1.1：营养数据合理性校验器 `nutrition-sanity-validator.ts`

**文件**：`apps/api-server/src/modules/decision/analyze/nutrition-sanity-validator.ts`

**逻辑**：

- 规则：`protein×4 + fat×9 + carbs×4 ≈ calories`（±15% 容差）
- 计算偏差 `deviation = |computed - reported| / max(reported, 1)`
- `deviation > 0.15` → 异常
- 纠偏策略：用 `CATEGORY_DEFAULTS` 重算宏量（按 calories 推导 protein/fat/carbs 比例）
- 同时返回 `confidenceReduction`（建议降低置信度 0.1~0.2）
- 纯函数，无副作用，可独立单元测试

**输出接口**：

```typescript
interface SanityResult {
  isValid: boolean;
  deviation: number; // 偏差率 0~1
  corrected: { calories; protein; fat; carbs };
  wasAdjusted: boolean;
  confidenceReduction: number; // 0 | 0.1 | 0.2
}
```

### P1.2：文本分析服务应用校验器

**文件**：`apps/api-server/src/modules/food/app/services/text-food-analysis.service.ts`

- 在 `llmParseFoods` 返回的每个食物项上应用 `validateNutrition()`
- 若校验失败：替换 `calories/protein/fat/carbs` 为纠偏值，降低 `confidence`

### P1.3：图片分析服务应用校验器

**文件**：`apps/api-server/src/modules/food/app/services/image-food-analysis.service.ts`

- 在 `parseAnalysisResult` 的 foods 循环末尾调用 `validateNutrition()`
- 对每个食物项独立校验并纠偏

### P1.4/P1.5：`calculateImageScore()` 注入 `healthConditions`

**文件**：`apps/api-server/src/modules/decision/score/food-scoring.service.ts`

- `calculateImageScore` 新增可选参数 `healthConditions?: string[]`
- 当 `healthConditions` 存在时，调用已有的 `applyHealthConditionAdjustment()` 调整 `healthScore`
- **管道侧**（`analysis-pipeline.service.ts`）：`computeScore` 的图片链路传入 `userContext.healthConditions`

**影响**：图片分析链路与文本链路对齐，健康条件均能触发评分调整。

### P1.6：`NutritionIssueDetector` 增加 `sugar_excess` + 修复 `fiber_deficit`

**文件**：`apps/api-server/src/modules/decision/analyze/nutrition-issue-detector.service.ts`

**修复 `fiber_deficit`**：

- 原条件：`progress.goals.carbs > 0`（永远为真，噪声极大）
- 修复：当 `slot.carbs === 'deficit'` 且 `consumed.calories > goals.calories × 0.3` 时触发

**新增 `sugar_excess`**：

- 触发条件：`slot.carbs === 'excess'`（碳水超标作为糖分超标的代理信号）
- 严重程度：碳水超标率 > 30% → `high`，> 15% → `medium`，否则 `low`
- implication：`碳水超标，添加糖摄入可能偏高，建议减少精制食品和甜饮`

---

## Phase 2 — 决策增强

### P2.1：`getEngineAlternatives` 动态目标参数

**文件**：`apps/api-server/src/modules/decision/decision/alternative-suggestion.service.ts`

**问题**：`preferLowCarb` 写死 20g、`preferLowGlycemic` 写死 15g。

**修复**：

- `AlternativeInput` 新增 `contextualAnalysis?: ContextualAnalysis`
- `getEngineAlternatives` 接受 `macroRemaining`（来自 `contextualAnalysis.macroProgress.remaining`）
- 动态计算：
  - `preferLowCarb` → `Math.max(15, remaining.carbs × 0.3)`（剩余碳水的 30%）
  - `preferLowGlycemic` → `Math.max(10, remaining.carbs × 0.2)`（剩余碳水的 20%）
- 管道侧（`food-decision.service.ts`）：`computeFullDecision` 接受并传递 `contextualAnalysis`

### P2.2：多日趋势决策阈值收紧

**文件**：`apps/api-server/src/modules/decision/decision/contextual-modifier.service.ts`

**逻辑**：

- 当 `recentSummaries` 中连续 3 天热量超标（consumed > goal × 1.05）时
- `scoreMultiplier` 额外降低 0.05（在当前基础上再 ×0.95）
- 修改原因追加：`连续${n}天超标，当前建议更严格控制`

### P2.3：`coachFocus` 健康风险严格优先

**文件**：`apps/api-server/src/modules/decision/decision/decision-summary.service.ts`

**修改 `resolveCoachFocus`**：

- 在现有信号优先级逻辑**之前**，检查 `nutritionIssues` 中是否有 `glycemic_risk / cardiovascular_risk / sodium_risk`
- 若存在 high severity → 强制返回健康风险 coachFocus（覆盖普通信号）

### P2.4：`topIssues` 附带量化数据

**文件**：`apps/api-server/src/modules/decision/decision/decision-summary.service.ts`

**修改 `summarize`**：

- 在生成 `topIssues` 时，优先从 `nutritionIssues` 中提取高严重度问题的 `implication`（已包含量化数据）
- 合并到 `topIssues` 的前部（去重）

`SummaryInput` 已有 `nutritionIssues?: NutritionIssue[]`（V3.5 添加），直接利用。

---

## Phase 3 — 教练能力升级

### P3.1：`CoachPromptBuilderService` 模块化拆分

**文件**：`apps/api-server/src/modules/coach/app/prompt/coach-prompt-builder.service.ts`

将 `buildSystemPrompt`（单函数 1207 行）拆分为 4 个私有方法：

| 方法                     | 职责                                | token 占比 |
| ------------------------ | ----------------------------------- | ---------- |
| `buildBasePersona()`     | 角色定义 + 回复格式 + Few-shot      | ~150 token |
| `buildUserProfile()`     | 用户档案（BMI/目标/健康条件）       | ~100 token |
| `buildDailyContext()`    | 今日饮食 + 近 7 天趋势 + 时间信息   | ~150 token |
| `buildAnalysisContext()` | 最新分析上下文（CoachInsight 注入） | ~200 token |

`buildSystemPrompt` 按需组合（不传 analysisContext 时跳过第 4 段）。

### P3.2：`CoachInsightService` 深度利用 `nutritionIssues`

**文件**：`apps/api-server/src/modules/decision/coach/coach-insight.service.ts`

**修改 `buildPriorityInsight`**：

- 当前：仅查找 `identifiedIssues` 中 severity === 'high' 的第一条
- 升级：先检查健康风险类型（`glycemic_risk / cardiovascular_risk / sodium_risk / purine_risk / kidney_stress`），若存在则优先返回，附带 implication 中的量化数据

### P3.3：教练主动引导

**文件**：`apps/api-server/src/modules/coach/app/prompt/coach-prompt-builder.service.ts`

**在 `buildAnalysisContext`（或 `buildSystemPrompt` 末尾）**：

- 当存在 high severity 的 `nutritionIssues` 时，system prompt 末尾追加引导性问题
- 示例：`【主动引导】用户当前${issue.implication}，如果用户未主动提问，可主动询问："你今天的饮食安排是怎样的？有没有需要调整的地方？"`

---

## 文件变更清单

| 文件                                                   | 变更类型 | 说明                                           |
| ------------------------------------------------------ | -------- | ---------------------------------------------- |
| `decision/analyze/nutrition-sanity-validator.ts`       | **新建** | P1.1 纯函数校验器                              |
| `food/app/services/text-food-analysis.service.ts`      | 修改     | P1.2 LLM 结果后处理                            |
| `food/app/services/image-food-analysis.service.ts`     | 修改     | P1.3 AI 结果后处理 + P1.5 applyScoreEngine     |
| `decision/score/food-scoring.service.ts`               | 修改     | P1.4 calculateImageScore 注入 healthConditions |
| `decision/analyze/analysis-pipeline.service.ts`        | 修改     | P1.5 图片链路 computeScore 传 healthConditions |
| `decision/analyze/nutrition-issue-detector.service.ts` | 修改     | P1.6 sugar_excess + fiber_deficit 修复         |
| `decision/decision/alternative-suggestion.service.ts`  | 修改     | P2.1 动态目标参数                              |
| `decision/decision/food-decision.service.ts`           | 修改     | P2.1 透传 contextualAnalysis                   |
| `decision/decision/contextual-modifier.service.ts`     | 修改     | P2.2 多日趋势收紧                              |
| `decision/decision/decision-summary.service.ts`        | 修改     | P2.3 coachFocus 健康优先 / P2.4 topIssues 量化 |
| `coach/app/prompt/coach-prompt-builder.service.ts`     | 修改     | P3.1 模块化 / P3.3 主动引导                    |
| `decision/coach/coach-insight.service.ts`              | 修改     | P3.2 深度利用 nutritionIssues                  |

---

## 架构不变原则

- **不迁移** `text-food-analysis.service.ts` 和 `image-food-analysis.service.ts` 至 decision 模块
- **不修改** 推荐系统（SubstitutionService / RecommendationEngineService）
- **不修改** 用户画像系统（UserProfileService / BehaviorService）
- 数据流：食物识别（food 模块）→ 分析管道（decision/analyze）→ 决策（decision/decision）→ 教练（coach）

---

## V3.6 与 V3.5 区别

| 维度             | V3.5          | V3.6                                         |
| ---------------- | ------------- | -------------------------------------------- |
| 营养校验         | 无            | 宏量一致性校验 + 纠偏                        |
| 图片健康评分     | ❌ 不支持     | ✅ calculateImageScore 注入 healthConditions |
| fiber/sugar 检测 | 占位符        | 实际检测逻辑                                 |
| 替代方案目标     | 写死 20g/15g  | 动态剩余宏量计算                             |
| 多日趋势         | 无            | 连续超标收紧阈值                             |
| coachFocus       | 信号矩阵优先  | 健康风险强制优先                             |
| topIssues        | 纯文字        | 含量化数据                                   |
| coach prompt     | 1207 行单函数 | 4 段按需组合                                 |
| 主动引导         | 无            | 高风险时 system prompt 追加                  |
