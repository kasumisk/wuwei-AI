# 饮食决策 + AI 教练系统 V2.3

> 版本定位：在 V2.2 已完成的解耦、动态阈值、置信度加权、结构化摘要基础上，继续把系统从“能分析、能判断、能解释”升级为“能形成完整吃前/吃后闭环、能输出可执行行动、能持续校正”的决策与教练系统。

> 重要边界：
>
> - 推荐系统：只读依赖，不修改算法本体
> - 用户画像系统：只读依赖，不修改画像逻辑与字段
> - 订阅/商业化逻辑：不修改
> - 数据库字段：不新增

---

## 0. V2.3 设计原则

V2.3 不重复建设 V2.2 已经落地的能力，而是在现有模块基础上做三类增强：

1. 把“分析”从单次识别结果升级为带上下文状态的饮食诊断。
2. 把“决策”从单个 recommend/caution/avoid 升级为可执行的 Should Eat 行动决策。
3. 把“AI 教练”从解释结果升级为可持续跟进的行动教练。

V2.3 的核心不是让模型说更多，而是让系统在进入 LLM 前就把关键事实、问题、行动方案、替代建议组织好，让 AI 教练只负责表达、引导和持续追踪。

---

## 1. 当前系统能力分析

基于当前代码实现，系统已经不是空白状态，而是具备一套较完整的分析与决策骨架。

### 1.1 已具备能力

#### 分析层

- 文本分析与图片分析已经统一进入 `AnalysisPipelineService`。
- 统一结果结构 `FoodAnalysisResultV61` 已存在，支持 foods、totals、score、decision、alternatives、explanation、summary。
- `food_analysis_records` 已落库，可追踪文本/图片分析历史。
- `food_records`、`daily_summaries`、`daily_plans` 已存在，说明“吃了什么”和“当天摄入状态”具备数据基础。

#### 评分层

- 已有营养评分与健康评分。
- `confidence-weighting.ts` 已存在，说明低置信度分析对评分影响已开始被控制。
- 用户营养目标来自画像体系中的 `NutritionProfile`，具备 recommendedCalories 和 macroTargets。

#### 决策层

- `UnifiedUserContext` 已打通今日摄入、目标、过敏原、饮食限制、健康状况。
- `DynamicThresholdsService` 已实现动态阈值，不再完全依赖绝对硬编码。
- `IssueDetectorService` 和 `decision-checks.ts` 已完成结构化问题检测。
- `AlternativeSuggestionService` 已从决策逻辑中解耦。
- `DecisionSummaryService` 已存在，可为教练提供结构化摘要。

#### 教练层

- `CoachPromptBuilderService` 已接入 `DecisionSummary`。
- 教练已经能读取用户档案、今日饮食、近 7 天摘要、行为画像、分析结果。
- 系统已经具备个性化语气和多语言基础。

### 1.2 当前缺失点

V2.3 需要解决的不是“有没有能力”，而是“能力是否形成完整闭环”。当前主要还有 8 个缺口。

| 编号 | 缺口                                     | 当前现状                                                                                                 | 影响                                 |
| ---- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| G1   | 分析结果仍偏“单次餐视角”                 | 已有今日上下文，但缺少标准化的吃前状态、吃后状态、补偿状态对象                                           | 无法形成完整决策链                   |
| G2   | 分析准确度缺少分层可解释性               | 有总置信度，但没有识别置信度、标准化置信度、营养估算置信度、决策置信度分层输出                           | 用户和教练难以判断“不确定性来自哪里” |
| G3   | 替代方案尚未真正走推荐引擎主链路         | 当前主要依赖 `SubstitutionService` + 静态 fallback，而不是以当前问题为约束调用推荐引擎完整候选与排序能力 | 替代建议针对性不足                   |
| G4   | 决策结果缺少“行动计划对象”               | 当前有 summary、issues、advice，但缺少标准化 action plan                                                 | AI 教练输出稳定性不足                |
| G5   | 吃前 / 吃后是同一套决策口径              | 现在更多是“这顿能不能吃”，缺少“已经吃了怎么办”的补偿建议模式                                             | 决策闭环不完整                       |
| G6   | 管理端人工审核与线上决策没有形成反馈闭环 | `food_analysis_records.reviewStatus` 已存在，但没有系统化地反哺分析质量策略和教练提示                    | 准确率提升慢                         |
| G7   | 可解释性已经有摘要，但缺少统一证据块     | 当前 evidence 分散在 decisionChain、issues、macroProgress、summary                                       | 前端和教练难统一消费                 |
| G8   | 国际化和可维护性还不彻底                 | 一部分 actionable 和时间边界仍是固定逻辑，教练上下文与决策上下文仍有重复格式化                           | 后续迭代成本高                       |

---

## 2. V2.3 优化目标

本次只聚焦 8 个目标，且全部围绕“分析 → 决策 → 教练”的主链路。

| 目标 | 说明                                             | 对应缺口 |
| ---- | ------------------------------------------------ | -------- |
| O1   | 建立标准化吃前/吃后上下文状态模型                | G1, G5   |
| O2   | 建立分析准确度分层模型                           | G2       |
| O3   | 将 Should Eat 从结果升级为行动决策对象           | G4, G7   |
| O4   | 替代方案改为推荐引擎驱动的目标化候选             | G3       |
| O5   | 为 AI 教练提供稳定的结构化行动摘要               | G4, G7   |
| O6   | 建立分析审核到策略修正的反馈闭环                 | G6       |
| O7   | 统一分析/决策/教练的证据块输出                   | G7       |
| O8   | 进一步清理硬编码与上下文重复，增强 i18n 和维护性 | G8       |

---

## 3. V2.3 总体架构

V2.3 不重写现有模块，而是在当前结构上继续分层。

### 3.1 目标模块结构

```text
src/modules/decision/
  analyze/
    analysis-pipeline.service.ts
    analysis-state-builder.service.ts        # 新增：构建吃前/吃后状态
    confidence-diagnostics.service.ts        # 新增：分层置信度诊断
    evidence-pack-builder.service.ts         # 新增：统一证据块

  score/
    food-scoring.service.ts
    confidence-weighting.ts

  decision/
    food-decision.service.ts
    decision-engine.service.ts
    issue-detector.service.ts
    alternative-suggestion.service.ts
    should-eat-action.service.ts             # 新增：输出行动决策对象
    post-meal-recovery.service.ts            # 新增：已吃后的补偿建议
    decision-summary.service.ts

src/modules/coach/app/
  prompt/
    coach-prompt-builder.service.ts
  coaching/
    coach-action-plan.service.ts             # 新增：行动摘要到教练动作映射
```

### 3.2 与已有系统关系

- 推荐系统：V2.3 只读取推荐系统已有候选、过滤、排序、替代能力，不改策略。
- 用户画像系统：V2.3 只读取 `NutritionProfile`、过敏原、饮食限制、健康状况、行为画像。
- 分析记录：继续使用 `food_analysis_records`，不新增字段，只增强返回 DTO 与内部派生对象。
- 用户行为记录：继续使用 `food_records`、`daily_summaries`、`recommendation_feedbacks`、`ai_decision_logs`。

---

## 4. 分析系统设计（Analyze）

V2.3 的分析目标不是只给出“这顿饭多少热量”，而是输出一个可被决策层直接消费的上下文化分析状态。

### 4.1 单次饮食分析

输入：

- 用户
- 食物 / 餐
- 输入形式（text / image）

输出：

- 热量
- 宏量营养（蛋白 / 脂肪 / 碳水）
- 健康评分
- 分层准确度诊断

### 4.2 新增：分析状态对象

```ts
interface AnalysisState {
  meal: {
    foods: AnalyzedFoodItem[];
    totals: NutritionTotals;
    score: AnalysisScore;
  };
  preMealContext: {
    todayTotalsBeforeMeal: NutritionTotals;
    remainingBeforeMeal: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
    currentMealIndex: number;
    mealType: string;
  };
  projectedAfterMeal: {
    todayTotalsAfterMeal: NutritionTotals;
    completionRatio: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    };
  };
}
```

这个对象只作为内存态和 API 输出结构增强，不要求新增数据库字段。

### 4.3 新增：分析准确度分层

当前系统已经有总置信度，但 V2.3 需要拆成四层。

```ts
interface ConfidenceDiagnostics {
  recognitionConfidence: number;
  normalizationConfidence: number;
  nutritionEstimationConfidence: number;
  decisionConfidence: number;
  overallConfidence: number;
  uncertaintyReasons: string[];
}
```

设计目的：

- 前端知道为什么这次分析不稳
- 决策层知道是否应该降级为 caution
- 教练知道应该更强调“估算值”“建议复核”而不是强结论

### 4.4 问题识别升级

V2.3 保留已有 `IssueDetectorService`，但问题识别要从“静态问题列表”升级为“决策用途明确的问题集合”。

新增两类问题：

- `preMealRisk`: 吃之前就已接近上限，例如今日脂肪已接近目标
- `postMealConsequence`: 吃完后会触发什么后果，例如晚餐后碳水超标 22%

最终问题集要服务于两个动作：

- Should Eat 现在怎么判断
- 如果已经吃了，后面怎么补救

---

## 5. 决策系统设计（Should Eat）

### 5.1 决策输出不再只是一句话

V2.3 的 Should Eat 输出改成结构化行动决策对象。

```ts
interface ShouldEatAction {
  verdict: 'recommend' | 'caution' | 'avoid';
  shouldEat: boolean;
  mode: 'pre_eat' | 'post_eat';
  primaryReason: string;
  evidence: string[];
  immediateAction: string;
  portionAction?: {
    suggestedPercent: number;
    suggestedCalories: number;
  };
  replacementAction?: {
    strategy: 'replace_food' | 'reduce_portion' | 'change_pairing';
    candidates: FoodAlternative[];
  };
  recoveryAction?: {
    nextMealDirection: string;
    todayAdjustment: string;
  };
}
```

### 5.2 吃前 / 吃后双模式

#### 模式 A：吃前决策

输出重点：

- 能不能吃
- 为什么
- 怎么吃更合适
- 有什么替代方案

#### 模式 B：吃后决策

输出重点：

- 已经吃了后的影响
- 需要不需要补偿
- 下一餐怎么调
- 今天剩余预算怎么重算

这一步是 V2.3 的关键，因为它把系统从“审判式判断”变成“行动式教练”。

### 5.3 动态决策逻辑

同一个食物在 V2.3 中会受以下因素共同影响：

- 用户目标
- 当日剩余热量 / 宏量预算
- 健康限制
- 当前餐次
- 是否已经吃过类似食物
- 分析准确度

因此同一个鸡腿饭可能出现三种结论：

- 训练后午餐：recommend
- 深夜加餐：caution
- 今日已高脂超标情况下的晚餐：avoid

---

## 6. 替代方案设计

### 6.1 当前问题

现有 `AlternativeSuggestionService` 已独立，但核心仍偏“替代品搜索”，不是“为当前问题求解”。

V2.3 要求替代方案必须由当前问题驱动。

### 6.2 替代方案原则

替代方案不能写死，不直接在文档里定义固定食物列表，而是通过“问题约束 → 推荐引擎只读调用 → 返回更优候选”的方式生成。

#### 约束来源

- 热量超标 → 低热量
- 蛋白不足 → 高蛋白
- 脂肪过高 → 低脂
- 碳水过高 → 低碳或减主食
- 健康限制 → 排除敏感类别

#### 目标不是单纯换食物

替代动作必须覆盖三种策略：

- 换食物
- 改份量
- 改搭配

### 6.3 V2.3 替代方案输出

```ts
interface AlternativePlan {
  strategy: 'replace_food' | 'reduce_portion' | 'change_pairing';
  reason: string;
  candidates: Array<{
    name: string;
    expectedCalories: number;
    expectedProtein: number;
    whyBetter: string;
  }>;
}
```

---

## 7. AI 教练系统设计

### 7.1 教练不是重复决策，而是消费决策

V2.3 明确分工：

- 分析层：生成事实
- 决策层：生成判断与动作
- 教练层：负责表达、引导、持续跟进

这样可以避免每次都让 LLM 重新理解原始数据，减少教练输出漂移。

### 7.2 教练输出结构

教练层统一消费 `ShouldEatAction + DecisionSummary + ConfidenceDiagnostics + EvidencePack`。

输出必须包含：

- 结论
- 原因
- 建议
- 替代方案或补偿方案

### 7.3 新增：CoachActionPlan

```ts
interface CoachActionPlan {
  conclusion: string;
  why: string[];
  doNow: string[];
  ifAlreadyAte?: string[];
  alternatives?: string[];
  tone: 'strict' | 'encouraging' | 'neutral';
}
```

它的作用不是替代自然语言，而是让教练 prompt 先有稳定骨架，再决定怎么说。

### 7.4 个性化语气

V2.3 保留现有 persona 能力，但把表达逻辑与行动建议拆开。

- 减脂用户：更强调预算、控量、后果
- 增肌用户：更强调蛋白、训练恢复、补充建议
- 健康型用户：更强调稳定、长期习惯、风险规避
- 习惯养成用户：更强调简单、可执行、低负担

---

## 8. 决策链路设计

V2.3 的完整链路如下。

### 8.1 吃前链路

```text
用户输入（想吃什么）
→ 食物识别 / 标准化 / 营养估算
→ 构建 AnalysisState（吃前状态 + 吃后投影）
→ 问题识别
→ 生成 ShouldEatAction（pre_eat）
→ 生成 AlternativePlan
→ 生成 DecisionSummary / EvidencePack
→ AI 教练输出
```

### 8.2 吃后链路

```text
用户输入（已经吃了什么）
→ 食物识别 / 标准化 / 营养估算
→ 构建 AnalysisState（吃后状态）
→ 评估今日剩余预算和超标后果
→ 生成 ShouldEatAction（post_eat）
→ 生成 RecoveryAction
→ AI 教练输出“后续怎么调”
```

### 8.3 审核闭环链路

```text
分析记录进入 food_analysis_records
→ 管理端审核 accurate / inaccurate
→ 形成分析质量样本
→ 反馈到分析准确度诊断和教练保守度策略
```

这里不新增数据库字段，只利用已有 `reviewStatus`、`qualityScore`、`persistStatus` 等状态。

---

## 9. API 能力设计（能力级）

这里只描述能力，不展开接口细节。

### 9.1 可复用已有能力

- 文本 / 图片分析能力
- 用户画像读取能力
- 当日饮食汇总能力
- 推荐系统候选与替代能力
- AI 教练对话能力
- 分析记录持久化能力

### 9.2 V2.3 新增能力

- 分析状态构建能力
- 分层准确度诊断能力
- 吃前 / 吃后双模式决策能力
- 行动计划生成能力
- 补偿建议生成能力
- 统一证据块生成能力
- 分析审核反馈闭环能力

### 9.3 建议的能力边界

- `AnalyzeCapability`: 只负责事实层与状态层
- `DecisionCapability`: 只负责 Should Eat / RecoveryAction / AlternativePlan
- `CoachCapability`: 只负责把结构化结果转为对话输出

---

## 10. 数据结构设计（不新增数据库字段）

V2.3 允许增强的只是内存对象、DTO、事件载荷、缓存结构。

### 10.1 新增 DTO / 内存对象

- `AnalysisState`
- `ConfidenceDiagnostics`
- `ShouldEatAction`
- `AlternativePlan`
- `CoachActionPlan`
- `EvidencePack`

### 10.2 EvidencePack

```ts
interface EvidencePack {
  scoreEvidence: string[];
  contextEvidence: string[];
  issueEvidence: string[];
  decisionEvidence: string[];
}
```

目标：

- 前端统一展示依据
- 教练统一读取依据
- 管理端审核统一查看依据

### 10.3 复用已有持久化对象

- `food_analysis_records`: 保存分析结果与审核状态
- `food_records`: 保存真正吃了什么
- `daily_summaries`: 保存当天累计摄入
- `ai_decision_logs`: 保存关键决策链日志
- `recommendation_feedbacks`: 作为替代建议和教练效果的外部反馈来源

---

## 11. 分阶段迭代

## Phase 1：分析状态化 + 双模式决策基础

目标：先把分析和决策主链路打稳。

### Phase 1 要完成的 6 项

1. 新增 `analysis-state-builder.service.ts`，构建吃前状态和吃后投影。
2. 新增 `confidence-diagnostics.service.ts`，输出分层准确度诊断。
3. 新增 `should-eat-action.service.ts`，把当前 decision 输出重组为行动决策对象。
4. 在 `analysis-pipeline.service.ts` 中组装 `AnalysisState + ConfidenceDiagnostics + ShouldEatAction`。
5. 在 `food-decision.service.ts` 中拆分 `pre_eat` 与 `post_eat` 两类决策模式。
6. 统一把 `DecisionSummary`、`issues`、`macroProgress` 汇总成 `EvidencePack`。

### Phase 1 产出

- 单次饮食分析不仅有分数，还有状态对象
- “能不能吃”和“已经吃了怎么办”开始分离
- 分析准确度可解释

## Phase 2：推荐驱动替代方案 + 教练行动计划

目标：让建议真正可执行，而不是停留在解释层。

### Phase 2 要完成的 6 项

1. 改造 `AlternativeSuggestionService`，将问题约束转成推荐候选约束。
2. 增加替代策略类型：换食物、减份量、改搭配。
3. 新增 `post-meal-recovery.service.ts`，输出补偿建议。
4. 新增 `coach-action-plan.service.ts`，把决策结果稳定映射为教练动作骨架。
5. 改造 `CoachPromptBuilderService`，优先消费 `CoachActionPlan` 而不是拼接零散字段。
6. 统一前端与后端返回结构，保证分析、决策、教练链路字段稳定可消费。

### Phase 2 产出

- 替代建议和用户当前问题强相关
- AI 教练的输出结构明显更稳定
- 吃后补偿能力上线

## Phase 3：审核反馈闭环 + 国际化 + 可维护性收口

目标：让系统具备持续校正和长期维护能力。

### Phase 3 要完成的 5 项

1. 将 `food_analysis_records.reviewStatus` 反馈到 `ConfidenceDiagnostics` 的保守策略中。
2. 基于审核结果定义分析质量分层规则，不改表结构，只改派生逻辑。
3. 清理 `IssueDetectorService` 等模块中的静态 actionable 和重复文案。
4. 补齐 `EvidencePack`、`CoachActionPlan`、`ShouldEatAction` 的国际化标签与模板。
5. 为分析、决策、教练三层分别输出能力文档和模块边界说明，避免后续耦合回退。

### Phase 3 产出

- 管理端审核结果不再只是记录，而开始影响系统保守度
- 多语言一致性增强
- 文档、模块、能力边界固定下来

---

## 12. 最终落地结果

V2.3 完成后，系统会从当前的：

```text
识别食物
→ 算营养
→ 给结论
→ 教练解释
```

升级为：

```text
识别食物
→ 构建吃前/吃后状态
→ 判断问题与后果
→ 生成行动决策对象
→ 调用推荐系统提供更优替代
→ AI 教练输出个性化行动建议
→ 管理端审核反哺分析保守度
```

这才是“从可用系统 → 可进化智能系统”的真正升级。

---

## 13. 接下来方向

如果按照工程实施顺序，建议下一步直接进入 Phase 1，先落以下顺序：

1. `AnalysisState`
2. `ConfidenceDiagnostics`
3. `ShouldEatAction`
4. `EvidencePack`
5. `pre_eat / post_eat` 双模式决策

这样做的原因很简单：

- 不改推荐系统，也能先把分析与决策主链路做扎实。
- 不改数据库，也能先让教练输出明显更稳定。
- Phase 2 和 Phase 3 都会建立在这四个对象之上，先打底最稳。
