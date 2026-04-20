# 饮食决策 + AI 教练系统 V4.0 — 智能决策升级 + 架构优化 + i18n 统一

## 版本定位

V3.9 完成了三阶段管道拆分、决策链增强、i18n 收尾。V4.0 聚焦**决策智能化和架构可维护性**：

> 从"可分析、可决策、可解释"升级到"智能分析、精准决策、个性化教练"

核心理念：**深度利用推荐系统和用户画像系统的数据能力，增强决策层的上下文感知和个性化输出。**

---

## Step 1: 当前能力分析

### 已具备能力

| 能力         | 现有实现                                                       | 成熟度             |
| ------------ | -------------------------------------------------------------- | ------------------ |
| 食物营养分析 | text/image-food-analysis + nutrition-aggregator                | ✅ 成熟            |
| 7 维评分     | food-scoring.service + scoring.service + NutritionScoreService | ✅ 成熟            |
| 三阶段管道   | analysis-pipeline (V3.9: runAnalyze→runDecide→runCoach)        | ✅ 成熟            |
| 决策引擎     | decision-engine + food-decision + structured-decision          | ✅ 成熟            |
| 用户上下文   | user-context-builder（画像 + 当日摄入 + 预算）                 | ⚠️ 未利用 5 层画像 |
| 替代方案     | alternative-suggestion（3 级 fallback）                        | ⚠️ 推荐引擎集成弱  |
| 问题识别     | issue-detector + nutrition-issue-detector                      | ✅ 成熟            |
| 决策摘要     | decision-summary                                               | ✅ 成熟            |
| AI 教练      | decision-coach (V3.3) + coach-insight + tone-resolver          | ⚠️ 缺乏画像驱动    |
| 可解释性     | 6 步 decision-chain + evidence-pack + signal-trace             | ⚠️ 缺乏行为洞察    |
| i18n         | 三套共存（t/cl/ci），但代码内有残留硬编码                      | ⚠️ 需统一清理      |

### 可读取但未充分利用的外部能力

| 外部服务                    | 可读接口                                | 当前使用       | V4.0 利用         |
| --------------------------- | --------------------------------------- | -------------- | ----------------- |
| ProfileResolverService      | resolve() → 5 层画像                    | ❌ 未使用      | ✅ 增强用户上下文 |
| GoalTrackerService          | getProgress() → 执行率/连续天数         | ❌ 未使用      | ✅ 教练个性化     |
| GoalPhaseService            | getCurrentGoal() → 阶段/权重调整        | ❌ 未使用      | ✅ 评分权重动态化 |
| RealtimeProfileService      | getShortTermProfile() → 7 天行为        | ❌ 未使用      | ✅ 行为感知决策   |
| PreferenceProfileService    | getUserPreferenceProfile()              | ❌ 未使用      | ✅ 替代方案排序   |
| RecommendationEngineService | recommendMeal() / recommendByScenario() | 部分使用       | ✅ 深度集成       |
| BehaviorService             | getProfile() → 行为画像                 | 评分稳定性数据 | ✅ 暴食风险/偏好  |

### V4.0 针对的 8 个优化目标

| #   | 目标             | 当前缺失                                                                             | V4.0 解决方案                                        |
| --- | ---------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | 用户画像深度集成 | UserContextBuilder 只用 getProfile+getTodaySummary，5 层画像/目标进度/短期行为全未用 | 集成 ProfileResolver + GoalTracker + RealtimeProfile |
| 2   | 评分系统画像驱动 | 评分权重是静态的 goalType 映射                                                       | 融入 GoalPhase 阶段权重 + 行为稳定性数据             |
| 3   | 替代方案深度推荐 | 推荐引擎调用只传基础参数，不传偏好画像                                               | 传递 PreferenceProfile + nutritionGap + 排除列表     |
| 4   | AI 教练行为感知  | 教练不知道用户的执行率/连续天数/偏好变化                                             | 注入 GoalProgress + ShortTermProfile 到教练上下文    |
| 5   | 动态决策增强     | 同食物在不同用户状态下差异不够大                                                     | 整合暴食风险小时/7天趋势/阶段权重                    |
| 6   | 代码冗余优化     | food-decision.service 中 allergen 展开逻辑重复；多处 fallback 模式重复               | 提取共享工具函数                                     |
| 7   | i18n 统一清理    | 三套 i18n 共存，部分 service 直接用中文字符串                                        | 统一 cl() 入口，清理残留硬编码                       |
| 8   | 可维护性增强     | decision-explainer 的 CHAIN_LABELS 内联 700+ 行                                      | 提取到独立 i18n 文件                                 |

---

## Step 2: 饮食分析系统设计（Analyze 层）

### (1) 单次饮食分析（已有，V4.0 增强评分）

**当前**：`runAnalyze()` → 营养汇总 + 用户上下文 + 评分 + 上下文分析

**V4.0 增强**：

- 评分时注入 `GoalPhase.getPhaseWeightAdjustment()` 的阶段权重
- UserContextBuilder 增加 `GoalTracker.getProgress()` 的执行率数据
- UserContextBuilder 增加 `RealtimeProfileService.getShortTermProfile()` 的 7 天行为

### (2) 上下文分析（已有，V4.0 增强数据源）

**当前**：`AnalysisContextService.buildContextualAnalysis()` 从 UnifiedUserContext 推导

**V4.0 增强**：

- 注入短期画像的 `recentRejectionPatterns`（最近 7 天拒绝的食物类型）
- 注入 `intakeTrends`（摄入趋势：连续高/低热量）

### (3) 问题识别（已有，V4.0 增强行为维度）

**当前**：12 种营养问题类型

**V4.0 增强**：

- 新增行为问题识别：暴食风险小时窗口（从 BehaviorService.getProfile().bingeRiskHours）
- 连续多日超标趋势（从 RealtimeProfile.intakeTrends）

---

## Step 3: 决策系统设计（Should Eat）

### (1) 是否建议吃（已有，V4.0 增强画像权重）

**当前**：`DecisionEngineService.computeDecision()` 基于 nutritionScore + 上下文修正

**V4.0 增强**：

- 决策阈值从 GoalPhase 当前阶段动态调整
- 执行率低的用户适当放宽阈值（避免过于严格导致放弃）
- 连续天数高的用户可适当严格（用户已建立习惯）

### (2) 原因解释（已有，V4.0 增强行为维度）

**当前**：6 步 decision-chain + DetailedRationale

**V4.0 增强**：

- rationale 追加 `behaviorContext`：基于用户最近 7 天行为给出额外解释
- 例："你已连续 5 天控制在目标范围内，今天偶尔放松一次影响不大"

### (3) 替代方案（已有，V4.0 深度集成推荐引擎）

**当前**：3 级 fallback（推荐引擎→替换→静态规则）

**V4.0 增强**：

- 调用 `recommendByScenario()` 时传入完整 PreferenceProfile
- 传入 `nutritionGap`（从 ContextualAnalysis.macroProgress.remaining）
- 替代方案排序考虑用户偏好权重（PreferenceProfileService.computePreferenceSignal）

### (4) 动态决策（已有，V4.0 增强行为感知）

**当前**：时间感知 + 累积饱和度 + 多日趋势

**V4.0 增强**：

- 暴食风险小时窗口感知（BehaviorService.bingeRiskHours）
- 7 天摄入趋势（ShortTermProfile.intakeTrends）驱动决策宽松/严格

---

## Step 4: AI 教练系统设计（Coach 层）

### (1) 对话式引导

**当前**：教练输出是结构化文本（headline + issues + guidance + educationPoints）

**V4.0 增强**：

- 注入用户执行进度到教练上下文（"你本周执行率 85%，已连续打卡 12 天"）
- 教练根据执行率调整语气强度

### (2) 建议结构化（已有 CoachActionPlan）

**当前**：conclusion + why + doNow + alternatives

**V4.0 增强**：

- CoachActionPlan.behaviorInsight：基于 7 天行为的个性化洞察
- CoachActionPlan.streakContext：连续天数和执行率的激励/提醒

### (3) 个性化语气（已有 DecisionToneResolverService）

**当前**：goalType × verdict 矩阵 + GOAL_TONE_SUPPLEMENT

**V4.0 增强**：

- 语气强度根据 GoalProgress.executionRate 调整
- 执行率高（>80%）→ 偏鼓励，执行率低（<50%）→ 偏温和引导（避免打击）
- 新增 `streakBoost`：连续天数 > 7 天时追加"坚持得很好"类激励

---

## Step 5: 决策链路设计

### V4.0 完整数据流

```
用户输入（想吃什么）
  ↓
Stage 1: Analyze
  ├─ aggregateNutrition(foods)
  ├─ UserContextBuilder.build(userId)  ← V4.0: +GoalProgress +ShortTermProfile
  ├─ FoodScoringService.calculateScore()  ← V4.0: +GoalPhase 阶段权重
  └─ AnalysisContextService.buildContextualAnalysis()  ← V4.0: +行为趋势
  ↓
Stage 2: Decide
  ├─ FoodDecisionService.computeFullDecision()  ← V4.0: +executionRate 动态阈值
  ├─ DecisionEngineService.computeStructuredDecision()
  ├─ AlternativeSuggestionService  ← V4.0: +PreferenceProfile 深度排序
  └─ DecisionSummaryService.summarize()  ← V4.0: +behaviorInsight
  ↓
Stage 3: Coach
  ├─ DecisionCoachService.generateCoachingExplanation()  ← V4.0: +GoalProgress
  ├─ ShouldEatActionService.build()
  ├─ PostMealRecoveryService.build()
  └─ EvidencePackBuilder.build()  ← V4.0: +streakContext
```

---

## Step 6: API 能力设计

### 已有 API（无需新增接口）

| 能力     | 现有 API                                            | V4.0 变更              |
| -------- | --------------------------------------------------- | ---------------------- |
| 饮食分析 | AnalysisPipelineService.execute()                   | 内部增强，输出结构不变 |
| 决策判断 | FoodDecisionService.computeFullDecision()           | 内部增强，输出结构不变 |
| AI 教练  | DecisionCoachService.generateCoachingExplanation()  | 增强输入参数           |
| 替代方案 | AlternativeSuggestionService.generateAlternatives() | 增强输入参数           |

### V4.0 新增能力（不新增模块，在现有 service 中扩展）

| 能力           | 所在 Service                      | 说明                                         |
| -------------- | --------------------------------- | -------------------------------------------- |
| 画像增强上下文 | UserContextBuilderService         | build() 增加 goalProgress + shortTermProfile |
| 阶段权重评分   | FoodScoringService                | computeScoreCore() 消费 GoalPhase 权重       |
| 行为感知决策   | ContextualDecisionModifierService | 增加暴食风险 + 趋势修正                      |
| 偏好排序替代   | AlternativeSuggestionService      | 调用 PreferenceProfileService 排序           |

---

## Step 7: 数据结构设计

### 增强现有类型（不新增数据库字段）

```typescript
// UnifiedUserContext 增强（analysis-result.types.ts）
export interface UnifiedUserContext {
  // ... 现有字段 ...

  /** V4.0: 目标执行进度 */
  goalProgress?: {
    executionRate: number; // 0-1
    streakDays: number;
    calorieCompliance: number; // 0-1
    proteinCompliance: number; // 0-1
  };

  /** V4.0: 7天短期行为画像 */
  shortTermBehavior?: {
    recentRejectionPatterns: string[]; // 最近拒绝的食物类型
    intakeTrends: 'increasing' | 'stable' | 'decreasing';
    bingeRiskHours: number[]; // 暴食风险小时
    activeTimeSlots: string[]; // 活跃时段
  };

  /** V4.0: 目标阶段权重调整 */
  phaseWeightAdjustment?: Partial<Record<string, number>>;
}

// CoachActionPlan 增强（analysis-result.types.ts）
export interface CoachActionPlan {
  // ... 现有字段 ...

  /** V4.0: 行为洞察 */
  behaviorInsight?: string;

  /** V4.0: 连续打卡激励 */
  streakContext?: string;
}

// DecisionSummary 增强
export interface DecisionSummary {
  // ... 现有字段 ...

  /** V4.0: 行为上下文说明 */
  behaviorNote?: string;
}
```

---

## Step 8: 分阶段迭代

### Phase 1: 画像深度集成 + 评分增强

> 目标：让分析和评分"认识"用户，不再只看当餐数据

| 任务                                                                                   | 文件                                                              | 改动                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| P1.1 UnifiedUserContext 增加 goalProgress/shortTermBehavior/phaseWeightAdjustment 类型 | analysis-result.types.ts                                          | 增加可选字段                          |
| P1.2 UserContextBuilder.build() 集成 GoalTracker + RealtimeProfile + GoalPhase         | user-context-builder.service.ts                                   | 并发调用 3 个外部服务                 |
| P1.3 FoodScoringService.computeScoreCore() 消费 phaseWeightAdjustment                  | food-scoring.service.ts                                           | 评分权重动态化                        |
| P1.4 AnalysisContextService 增加行为趋势问题识别                                       | analysis-context.service.ts + nutrition-issue-detector.service.ts | 新增 binge_risk/trend_excess 问题类型 |
| P1.5 i18n: 新增 P1 相关标签                                                            | decision-labels.ts                                                | 三语                                  |
| P1.6 TypeScript 编译验证                                                               | -                                                                 | npx tsc --noEmit                      |

### Phase 2: 决策增强 + 替代方案深度集成

> 目标：让决策"理解"用户习惯，替代方案"投其所好"

| 任务                                                   | 文件                                          | 改动                          |
| ------------------------------------------------------ | --------------------------------------------- | ----------------------------- |
| P2.1 DecisionEngine 消费 goalProgress 动态调整阈值     | decision-engine.service.ts                    | 执行率/连续天数影响阈值宽松度 |
| P2.2 ContextualModifier 增加暴食风险小时 + 7天趋势修正 | contextual-modifier.service.ts                | 读取 shortTermBehavior        |
| P2.3 AlternativeSuggestion 深度集成 PreferenceProfile  | alternative-suggestion.service.ts             | 传 PreferenceProfile 排序     |
| P2.4 DecisionSummary 增加 behaviorNote                 | decision-summary.service.ts                   | 行为上下文摘要                |
| P2.5 FoodDecisionService 提取 allergen 展开为共享工具  | food-decision.service.ts + decision-checks.ts | 消除重复代码                  |
| P2.6 i18n: 新增 P2 相关标签                            | decision-labels.ts                            | 三语                          |
| P2.7 TypeScript 编译验证                               | -                                             | npx tsc --noEmit              |

### Phase 3: AI 教练增强 + i18n 统一

> 目标：教练"了解"用户进度，i18n 无残留

| 任务                                                      | 文件                                                     | 改动                                 |
| --------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ |
| P3.1 DecisionCoachService 注入 GoalProgress 增强教练输出  | decision-coach.service.ts                                | 生成 behaviorInsight + streakContext |
| P3.2 DecisionToneResolver 根据 executionRate 调整语气强度 | decision-tone-resolver.service.ts                        | 执行率驱动语气                       |
| P3.3 EvidencePackBuilder 增加 streakContext               | evidence-pack-builder.service.ts                         | 连续天数激励                         |
| P3.4 CoachActionPlan 增加 behaviorInsight + streakContext | analysis-result.types.ts                                 | 类型增强                             |
| P3.5 decision-explainer CHAIN_LABELS 提取到 i18n 文件     | decision-explainer.service.ts → i18n/explainer-labels.ts | 700行内联 i18n 提取                  |
| P3.6 全局残留中文硬编码扫描清理                           | 多文件                                                   | 统一用 cl()/ci()                     |
| P3.7 TypeScript 编译验证                                  | -                                                        | npx tsc --noEmit                     |

---

## 约束与规范

- **禁止修改**：推荐系统、用户画像系统、订阅逻辑 — 只读取
- **禁止增加**：数据库字段、新模块
- **i18n 规范**：所有面向用户的文案必须用 `cl(key, locale)` 或 `ci(key, locale, vars)`
- **类型安全**：每个 Phase 完成后必须通过 `npx tsc --noEmit --pretty`
- **向后兼容**：所有新增字段为可选（`?:`），不破坏现有 API 输出

---

## 文件影响范围

### Phase 1 改动文件

| 文件                                          | 改动类型   |
| --------------------------------------------- | ---------- |
| `types/analysis-result.types.ts`              | 类型增强   |
| `decision/user-context-builder.service.ts`    | 核心改动   |
| `score/food-scoring.service.ts`               | 权重增强   |
| `analyze/analysis-context.service.ts`         | 数据源增强 |
| `analyze/nutrition-issue-detector.service.ts` | 新问题类型 |
| `i18n/decision-labels.ts`                     | i18n 增加  |

### Phase 2 改动文件

| 文件                                         | 改动类型     |
| -------------------------------------------- | ------------ |
| `decision/decision-engine.service.ts`        | 阈值动态化   |
| `decision/contextual-modifier.service.ts`    | 行为感知     |
| `decision/alternative-suggestion.service.ts` | 偏好排序     |
| `decision/decision-summary.service.ts`       | behaviorNote |
| `decision/food-decision.service.ts`          | 代码提取     |
| `decision/decision-checks.ts`                | 共享工具     |
| `i18n/decision-labels.ts`                    | i18n 增加    |

### Phase 3 改动文件

| 文件                                         | 改动类型                    |
| -------------------------------------------- | --------------------------- |
| `coach/decision-coach.service.ts`            | 画像驱动教练                |
| `decision/decision-tone-resolver.service.ts` | 执行率语气                  |
| `analyze/evidence-pack-builder.service.ts`   | streak 激励                 |
| `types/analysis-result.types.ts`             | CoachActionPlan 增强        |
| `decision/decision-explainer.service.ts`     | i18n 提取                   |
| `i18n/explainer-labels.ts`                   | 新文件（从 explainer 提取） |
| `i18n/decision-labels.ts`                    | i18n 增加                   |
