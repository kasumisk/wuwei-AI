# 饮食决策 + AI 教练系统 V3.9 — 决策能力增强 + 架构解耦 + i18n 收尾

## 版本定位

V3.8 完成了决策层 i18n 清理。V3.9 聚焦**决策能力本身的增强**：

> 从"能分析"升级到"能决策 + 能指导 + 能解释"

---

## Step 1: 当前能力分析

### 已具备的能力

| 能力         | 现有实现                                                        | 成熟度    |
| ------------ | --------------------------------------------------------------- | --------- |
| 食物营养分析 | text/image-food-analysis + nutrition-aggregator                 | ✅ 成熟   |
| 7 维评分     | food-scoring.service + scoring.service                          | ✅ 成熟   |
| 决策引擎     | decision-engine + food-decision + structured-decision           | ✅ 成熟   |
| 用户上下文   | user-context-builder（画像 + 当日摄入 + 预算）                  | ✅ 成熟   |
| 替代方案     | alternative-suggestion（3 级 fallback：推荐引擎→替换→静态规则） | ⚠️ 可增强 |
| 问题识别     | issue-detector + nutrition-issue-detector（8+12 类检查）        | ✅ 成熟   |
| 决策摘要     | decision-summary（headline + topIssues + actionItems）          | ✅ 成熟   |
| AI 教练      | decision-coach + coach-action-plan + coach-prompt-builder       | ⚠️ 可增强 |
| 可解释性     | decision-chain + evidence-pack + signal-trace                   | ⚠️ 可增强 |

### V3.9 针对的 8 个优化目标

| #   | 目标                   | 当前缺失                                                                                                                         | V3.9 解决方案                                                         |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | 分析准确度反馈到决策   | accuracy=low 只降级 verdict，不影响评分权重                                                                                      | 评分维度按准确度加权衰减                                              |
| 2   | 返回结果按决策需求裁剪 | 所有模式返回相同结构                                                                                                             | 按 decisionMode 裁剪：pre_eat 侧重 should-eat，post_eat 侧重 recovery |
| 3   | 分析/评分/决策 解耦    | 耦合在 analysis-pipeline 700 行大方法中                                                                                          | 拆分 3 个独立阶段 service，pipeline 只做编排                          |
| 4   | Should Eat 决策增强    | 有 verdict 但缺乏结构化"为什么"和"动态时间因素"                                                                                  | 增强 decision-explainer 的 rationale 结构                             |
| 5   | AI Coach 个性化语气    | tone 已有但未细分用户目标                                                                                                        | coach-tone 按 goalType 细化策略                                       |
| 6   | 替代方案结合推荐引擎   | 已有 3 级 fallback 但推荐引擎调用缺乏场景传递                                                                                    | 传递 nutritionGap 给推荐引擎做约束召回                                |
| 7   | 可解释性增强           | decision-chain 只有 4 步                                                                                                         | 扩展 chain 到 6 步，每步附上关键数据                                  |
| 8   | i18n 收尾              | 6 个文件残余硬编码（post-meal-recovery/should-eat-action/decision-checks/food-scoring/pipeline disclaimer/coach-prompt-builder） | 全部迁移到 cl()/t()                                                   |

---

## Step 2: 饮食分析系统设计（Analyze 层）

### 当前数据流

```
Pipeline.execute(input)
  → Step 1: aggregateNutrition(foods) → totals
  → Step 2: userContextBuilder.build(userId) → UnifiedUserContext
  → Step 3: computeScore(foods, totals, ctx) → AnalysisScore
  → Step 4: analysisContext.build() → ContextualAnalysis
  → Step 5: foodDecision.computeFullDecision() → DecisionOutput
  → Step 6: decisionEngine.computeStructuredDecision() → StructuredDecision
  → Step 7: decisionSummary.summarize() → DecisionSummary
  → Step 8: confidence/evidence/shouldEat/recovery/accuracy
  → Step 9: resultAssembler.assemble() → FoodAnalysisResultV61
```

### V3.9 重构：3 阶段分离

**阶段 1 — Analyze（纯分析，无决策）**

- 输入：foods[], userId
- 输出：totals, userContext, score, contextualAnalysis
- 职责：营养聚合、用户上下文构建、7 维评分、上下文分析
- 文件：现有 nutrition-aggregator + user-context-builder + food-scoring + analysis-context

**阶段 2 — Decide（决策判断）**

- 输入：阶段 1 输出 + decisionMode
- 输出：decision, structuredDecision, issues, alternatives, summary
- 职责：Should Eat 判断、问题识别、替代方案、决策摘要
- 文件：现有 food-decision + decision-engine + issue-detector + alternative-suggestion + decision-summary

**阶段 3 — Coach（教练输出）**

- 输入：阶段 1+2 输出 + locale
- 输出：shouldEatAction, coaching, recoveryAction, evidencePack
- 职责：教练解释、行动计划、恢复建议、证据包
- 文件：现有 decision-coach + should-eat-action + post-meal-recovery + evidence-pack-builder

### 实现方式

在 `analysis-pipeline.service.ts` 中，将现有 `execute()` 的大方法拆分为 3 个私有编排方法：

- `private async runAnalyze(input): Promise<AnalyzeStageResult>`
- `private async runDecide(analyzeResult, input): Promise<DecideStageResult>`
- `private async runCoach(analyzeResult, decideResult, input): Promise<CoachStageResult>`

`execute()` 变为：

```typescript
async execute(input) {
  const analyze = await this.runAnalyze(input);
  const decide = await this.runDecide(analyze, input);
  const coach = await this.runCoach(analyze, decide, input);
  return this.resultAssembler.assemble({ ...analyze, ...decide, ...coach, input });
}
```

---

## Step 3: 决策系统增强（Should Eat）

### 3.1 准确度→评分联动

当前：accuracy=low 只在最后降级 verdict。
V3.9：在评分阶段，低准确度食物的各维度分数向目标值衰减。

位置：`food-scoring.service.ts` 的 `computeScoreCore()`

逻辑：

```
if (avgConfidence < 0.5) {
  // 低置信食物的评分向 60 分（中性值）衰减
  decay = 1 - (0.5 - avgConfidence) * 0.4  // 0.3 置信度 → decay=0.92
  每个维度 score = score * decay + 60 * (1 - decay)
}
```

### 3.2 决策结果按模式裁剪

在 `result-assembler.service.ts` 中，按 `decisionMode` 裁剪返回字段：

- `pre_eat`：突出 shouldEatAction + alternatives + structuredDecision
- `post_eat`：突出 recoveryAction + macroProgress + nextMealAdvice
- `default`：完整返回

### 3.3 动态时间决策

当前 `computeTimeliness()` 已考虑时间。V3.9 增强：

- decision-explainer 的 `timelinessNote` 增加具体时间段影响说明
- 同一食物在早/中/晚/夜宵的 verdict 差异需要在 rationale 中明确体现

位置：`decision-explainer.service.ts` 的 `buildDetailedRationale()`

---

## Step 4: AI 教练系统增强

### 4.1 个性化语气策略

在 `decision-tone-resolver.service.ts` 中，按 goalType 细化 tone：

| goalType    | tone      | 策略                             |
| ----------- | --------- | -------------------------------- |
| fat_loss    | control   | 强调控制、底线明确、少用"没关系" |
| muscle_gain | encourage | 鼓励高蛋白、正向激励、"加油"     |
| health      | balanced  | 平衡建议、不激进                 |
| habit       | gentle    | 温和引导、不施压                 |

### 4.2 Coach Action Plan 结构化

当前 `CoachActionPlan` 已有 conclusion/why/doNow/alternatives/nextMeal。
V3.9 确保每个字段都填充有意义的内容（当前部分场景返回空）。

增强位置：`coach/app/coaching/coach-action-plan.service.ts`

### 4.3 教育点增强

在 `decision-coach.service.ts` 的 `generateEducationPoints()` 中，基于 topIssue 生成更具体的营养知识点。

---

## Step 5: 决策链路设计

完整链路（6 步）：

```
用户输入（想吃什么 / 吃了什么）
  ↓
[Analyze] 营养分析 + 用户上下文 + 评分
  ↓ AnalyzeStageResult { totals, userContext, score, contextualAnalysis }
[Decide] 决策判断 + 问题识别 + 替代方案
  ↓ DecideStageResult { decision, structuredDecision, issues, alternatives, summary }
[Coach] 教练输出 + 行动计划 + 恢复建议
  ↓ CoachStageResult { shouldEatAction, coaching, recoveryAction, evidencePack }
[Assemble] 按 decisionMode 裁剪，组装最终结果
  ↓ FoodAnalysisResultV61
```

### Decision Chain 扩展（6 步）

| Step | Source                       | Input             | Output                       |
| ---- | ---------------------------- | ----------------- | ---------------------------- |
| 1    | nutrition-aggregator         | foods[]           | totals, avgConfidence        |
| 2    | user-context-builder         | userId            | goals, budgets, constraints  |
| 3    | food-scoring                 | totals + context  | 7-dimension breakdown        |
| 4    | decision-engine              | score + context   | verdict + structuredDecision |
| 5    | issue-detector + alternative | verdict + context | issues + alternatives        |
| 6    | decision-coach               | all above         | coaching + action plan       |

每步附上 `confidence` 和关键数据快照。

---

## Step 6: API 能力设计

### 可复用的现有能力

| 能力          | 现有 API                                | 备注             |
| ------------- | --------------------------------------- | ---------------- |
| 饮食分析      | POST /food/analyze (文字)               | 已包含完整决策链 |
| 图片分析      | POST /food/analyze-image                | 已包含完整决策链 |
| AI Coach 对话 | POST /coach/chat                        | LLM 对话式教练   |
| 配额检查      | QuotaGateService.checkAccess()          | 内部能力         |
| 用户画像      | PreferenceProfileService                | 只读消费         |
| 推荐引擎      | RecommendationEngineService.recommend() | 替代方案召回     |

### 需要增强的能力（不新增 API 端点）

| 能力             | 增强方式                             |
| ---------------- | ------------------------------------ |
| 决策模式裁剪     | 现有 `decisionMode` 参数增强返回裁剪 |
| 准确度联动评分   | 内部评分逻辑增强                     |
| 教练个性化语气   | 内部 tone resolver 增强              |
| 替代方案约束召回 | 传递 nutritionGap 给推荐引擎         |

---

## Step 7: 数据结构设计

### 新增阶段性中间类型（仅在 analysis-result.types.ts 中定义）

```typescript
/** 分析阶段输出 */
interface AnalyzeStageResult {
  analysisId: string;
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  userContext: UnifiedUserContext | null;
  score: AnalysisScore;
  contextualAnalysis: ContextualAnalysis | null;
  avgConfidence: number;
}

/** 决策阶段输出 */
interface DecideStageResult {
  decision: DecisionOutput;
  structuredDecision: StructuredDecision | null;
  summary: DecisionSummary;
}

/** 教练阶段输出 */
interface CoachStageResult {
  shouldEatAction: ShouldEatAction | null;
  recoveryAction: RecoveryAction | undefined;
  evidencePack: EvidencePack;
  confidenceDiagnostics: ConfidenceDiagnostics;
  analysisAccuracy: FoodAnalysisPackage;
}
```

---

## Step 8: 分阶段实施

### Phase 1: 分析/评分/决策 解耦 + 准确度联动 + 决策裁剪

| 任务                      | 文件                         | 改动                                                           |
| ------------------------- | ---------------------------- | -------------------------------------------------------------- |
| P1.1 定义 3 个阶段类型    | analysis-result.types.ts     | 新增 AnalyzeStageResult / DecideStageResult / CoachStageResult |
| P1.2 pipeline 拆分 3 阶段 | analysis-pipeline.service.ts | execute() 拆为 runAnalyze + runDecide + runCoach               |
| P1.3 准确度→评分衰减      | food-scoring.service.ts      | computeScoreCore 中低置信度分数衰减                            |
| P1.4 结果按模式裁剪       | result-assembler.service.ts  | assemble() 按 decisionMode 裁剪字段                            |

### Phase 2: 替代方案增强 + 可解释性 + 架构增强

| 任务                            | 文件                              | 改动                                                             |
| ------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| P2.1 替代方案传递 nutritionGap  | alternative-suggestion.service.ts | generateAlternatives 时将 macroProgress 转为约束条件传递推荐引擎 |
| P2.2 Decision Chain 扩展到 6 步 | decision-explainer.service.ts     | generateDecisionChain 增加 nutrition-aggregation 和 coach 步骤   |
| P2.3 时间决策 rationale 增强    | decision-explainer.service.ts     | buildDetailedRationale 的 timelinessNote 增加时间段影响说明      |
| P2.4 Decision Chain 数据快照    | decision-explainer.service.ts     | 每步 chain 附上 confidence 和关键数据                            |

### Phase 3: AI 教练增强 + i18n 收尾

| 任务                             | 文件                              | 改动                                                  |
| -------------------------------- | --------------------------------- | ----------------------------------------------------- |
| P3.1 Coach tone 按目标细化       | decision-tone-resolver.service.ts | 按 goalType 生成差异化 tone 策略                      |
| P3.2 post-meal-recovery i18n     | post-meal-recovery.service.ts     | 10 处中文→cl()                                        |
| P3.3 should-eat-action i18n      | should-eat-action.service.ts      | 6 处中文→cl()                                         |
| P3.4 decision-checks 标准化      | decision-checks.ts                | 健康条件匹配改用标准化 code，食物限制匹配加英文关键字 |
| P3.5 food-scoring 健康条件 i18n  | food-scoring.service.ts           | 健康条件警告字符串→cl()                               |
| P3.6 pipeline disclaimer→cl()    | analysis-pipeline.service.ts      | accuracy disclaimer→cl()                              |
| P3.7 decision-explainer 标点修复 | decision-explainer.service.ts     | `，`/`、` 改为 locale-aware 分隔符                    |

---

## 修改文件清单

### Phase 1（4 文件）

- `decision/types/analysis-result.types.ts`
- `decision/analyze/analysis-pipeline.service.ts`
- `decision/score/food-scoring.service.ts`
- `decision/analyze/result-assembler.service.ts`

### Phase 2（2 文件）

- `decision/decision/alternative-suggestion.service.ts`
- `decision/decision/decision-explainer.service.ts`

### Phase 3（7 文件）

- `decision/decision/decision-tone-resolver.service.ts`
- `decision/decision/post-meal-recovery.service.ts`
- `decision/decision/should-eat-action.service.ts`
- `decision/decision/decision-checks.ts`
- `decision/score/food-scoring.service.ts`
- `decision/analyze/analysis-pipeline.service.ts`
- `decision/decision/decision-explainer.service.ts`
- `decision/i18n/decision-labels.ts`

---

## 风险控制

- **每个 Phase 完成后跑 `npx tsc --noEmit`** 确保无新错误
- **不新增模块/数据库字段**：所有改动在 decision/ 模块内
- **推荐系统/用户画像只读**：仅调用 recommend() 和 getProfile()
- **向后兼容**：FoodAnalysisResultV61 结构不删字段，只增强内容
- **不修改 decision.module.ts 的 providers**：不新增 service
