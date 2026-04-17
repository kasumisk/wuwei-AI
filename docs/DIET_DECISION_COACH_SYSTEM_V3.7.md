# 饮食决策 + AI 教练系统 V3.7 — 架构升级

## 版本目标

从 V3.6 的功能增强升级到**架构级优化**，围绕 6 个核心目标：

1. **i18n 统一化** — 消除散布在业务逻辑中的硬编码文案，统一到 i18n 层
2. **分析/评分/决策 解耦** — 建立清晰的层次边界（Analyze → Score → Decision → Coach）
3. **替代方案推荐引擎深度融合** — 替代方案完全基于推荐引擎，消除硬编码目标
4. **决策可解释性增强** — 结构化决策链路，每步可追溯
5. **教练个性化增强** — 结合用户画像的语气/内容适配
6. **可维护性提升** — 减少跨层耦合，统一数据流向

---

## Step 1: 当前能力分析

### 已具备能力

| 层级 | 能力                                                               | 状态        |
| ---- | ------------------------------------------------------------------ | ----------- |
| 分析 | 单次食物营养解析（文本/图片）                                      | ✅ 成熟     |
| 分析 | 上下文分析（当日摄入、宏量槽位）                                   | ✅ V3.5     |
| 分析 | 营养问题识别（NutritionIssue）                                     | ✅ V3.5     |
| 分析 | 营养合理性校验                                                     | ✅ V3.6     |
| 评分 | 7维评分（energy/protein/macro/quality/satiety/stability/glycemic） | ✅ 成熟     |
| 评分 | 置信度加权                                                         | ✅ V2.4     |
| 评分 | 健康状况调整                                                       | ✅ V3.6     |
| 决策 | 三档建议（recommend/caution/avoid）                                | ✅ 成熟     |
| 决策 | 结构化四维决策（StructuredDecision）                               | ✅ V3.3     |
| 决策 | 上下文修正（累积/多日/暴食）                                       | ✅ V1.9     |
| 决策 | 替代方案（引擎+替换+静态）                                         | ✅ 但耦合重 |
| 决策 | ShouldEatAction                                                    | ✅ V2.3     |
| 教练 | CoachActionPlan                                                    | ✅ V2.3     |
| 教练 | DecisionCoach 解释                                                 | ✅ V3.3     |
| 教练 | Prompt Builder（系统/用户/上下文）                                 | ✅ V3.6     |

### 关键缺失点

| 层级 | 问题                                                             | 影响                       |
| ---- | ---------------------------------------------------------------- | -------------------------- |
| 全局 | **i18n 散布在业务逻辑** — 6+ 个服务文件中有硬编码中文/英文字符串 | 无法国际化，维护困难       |
| 分析 | 分析准确度没有反馈到决策链路                                     | 低准确度分析的决策信心过高 |
| 决策 | `decision-engine.service.ts` 700+ 行包含决策+文案+i18n           | 职责不清，难以独立迭代     |
| 决策 | `alternative-suggestion.service.ts` 有硬编码文案和写死比较文本   | 无法国际化                 |
| 决策 | `contextual-modifier.service.ts` 有 6 处中文 fallback            | 无法国际化                 |
| 教练 | `coach-format.service.ts` 有 10+ 处纯中文字符串                  | 英文/日文用户看到中文      |
| 教练 | `decision-coach.service.ts` FACTOR_LABELS 硬编码                 | 应统一到 i18n 层           |
| 架构 | analyze/score/decision 在同一 module 内紧耦合                    | 无法独立测试和迭代         |

---

## Step 2: 分层架构设计

```
用户输入（文本/图片）
    ↓
┌─────────────────────────────────┐
│ Analyze Layer (分析层)           │
│ - 食物识别 + 营养解析            │
│ - 上下文分析 (ContextualAnalysis)│
│ - 问题识别 (NutritionIssue)      │
│ - 准确度评估                    │
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│ Score Layer (评分层)             │
│ - 7维评分 + 置信度加权           │
│ - 健康状况调整                  │
│ - 评分解释                      │
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│ Decision Layer (决策层)          │
│ - 结构化决策 (StructuredDecision)│
│ - 上下文修正                    │
│ - 替代方案 (推荐引擎优先)        │
│ - ShouldEatAction               │
│ - 决策解释链                    │
└─────────────┬───────────────────┘
              ↓
┌─────────────────────────────────┐
│ Coach Layer (教练层)             │
│ - CoachActionPlan               │
│ - 个性化语气                    │
│ - 结构化输出                    │
│ - 对话式引导                    │
└─────────────────────────────────┘
```

---

## Step 3: 实施计划

### Phase 1: i18n 统一化 + 文案解耦

**目标**: 消除所有业务逻辑中的硬编码文案，统一到 i18n 查找表

#### P1.1: 扩展 `decision-labels.ts` — 新增决策引擎文案键

将 `decision-engine.service.ts` 中 20+ 处硬编码文案迁移到 `COACH_LABELS`:

- `decision.factor.*` 系列（nutritionOk, nutritionOver, noBreakdown, macroBalanced, etc.）
- `decision.rationale.*` 系列（contextual, goalAlignment, timelinessNote）
- 量化后缀模板（excessSuffix, proteinQuantSuffix）

#### P1.2: 扩展 `coach-i18n.ts` — 新增修正器/格式化文案键

将 `contextual-modifier.service.ts` 和 `coach-format.service.ts` 中硬编码文案迁移:

- `modifier.cumulativeSaturation`, `modifier.lateNightRisk`, etc.
- `format.reason.*`, `format.suggestion.*`, `format.encouragement.*`

#### P1.3: 迁移 `decision-engine.service.ts` — 用 `cl()` 替换硬编码

- `buildDetailedRationale()` 中的 inline 字符串 → `cl()` 查找
- `computeNutritionAlignment()` 中的 fallback → `cl()` 查找
- `computeTimeliness()` 中的 fallback → `cl()` 查找
- 保持量化参数通过模板插值传递

#### P1.4: 迁移 `contextual-modifier.service.ts` — 消除中文 fallback

- 6 处 `|| '中文fallback'` 模式 → 统一用 `t()` 并确保 key 在 i18n-messages 中存在

#### P1.5: 迁移 `coach-format.service.ts` — 三语支持

- `resolveReasons()` 中的纯中文字符串 → 三语 i18n
- `resolveSuggestions()` 中的纯中文字符串 → 三语 i18n
- `resolveEncouragement()` 中的纯中文字符串 → 三语 i18n
- `resolveScoreInsight()` 中的 `分` → 国际化

#### P1.6: 迁移 `alternative-suggestion.service.ts` — 比较文案三语化

- `explainEngineCandidate()` fallback → i18n
- `attachRankScores()` 中的中文比较描述 → i18n

#### P1.7: 迁移 `decision-coach.service.ts` — FACTOR_LABELS 统一

- `FACTOR_LABELS` 合并到 `decision-labels.ts` 的 `COACH_LABELS`

---

### Phase 2: 架构解耦 + 可解释性增强

**目标**: 清晰的层次边界，决策链路每步可追溯

#### P2.1: 分析层接口标准化

在 `analysis-pipeline.service.ts` 中，确保每层输出标准化：

- Analyze 输出: `AnalysisLayerOutput { foods, totals, contextualAnalysis, issues, accuracy }`
- Score 输出: `ScoreLayerOutput { healthScore, nutritionScore, breakdown, breakdownExplanations }`
- Decision 输出: `DecisionLayerOutput { structuredDecision, shouldEatAction, alternatives, summary }`

#### P2.2: 决策引擎精简

将 `decision-engine.service.ts` 中的文案生成逻辑提取到 `decision-explainer.service.ts`:

- `buildDetailedRationale()` → 移到 `DecisionExplainerService`
- `generateAdvice()` → 移到 `DecisionExplainerService`
- `DecisionEngineService` 只负责纯计算：评分→三档映射→因素评分

#### P2.3: 决策链路追踪增强

在 `StructuredDecision` 中增加 `decisionTrace`:

- 每个决策步骤记录: `{ step, input, output, confidence }`
- 供教练层消费，生成可解释的决策推理

#### P2.4: 准确度→决策联动

当 `accuracyLevel === 'low'` 时：

- 决策 verdict 自动降级（avoid → caution + disclaimer）
- `DecisionSummary.analysisQualityNote` 更明确
- 教练输出增加 confidence disclaimer

---

### Phase 3: 替代方案 + 教练升级

**目标**: 替代方案深度融合推荐引擎，教练个性化增强

#### P3.1: 替代方案动态约束传递

`AlternativeSuggestionService.generateAlternatives()` 改进:

- 从 `ContextualAnalysis.recommendationContext` 直接读取动态目标（已有字段）
- 消除 `getEngineAlternatives()` 中的硬编码 carbs 20g/15g fallback（V3.6 已部分完成）
- 将 `preferenceProfile` 深度传递给推荐引擎

#### P3.2: 教练格式化三语完善

`CoachFormatService` 全部方法使用 i18n:

- `generateFormattedOutput()` 的 reasons/suggestions/encouragement 全部走 i18n
- 消除 `resolveScoreInsight()` 中的 `分`

#### P3.3: 教练语气个性化增强

基于用户画像 `goalType` + `profile.persona` 动态调整:

- fat_loss 用户: 控制型语气（严格，量化导向）
- muscle_gain 用户: 鼓励型语气（正面，目标导向）
- health 用户: 温和型语气（建议，教育导向）
- 在 `coach-tone.config.ts` 中扩展语气矩阵

#### P3.4: 教练结构化输出优化

`CoachActionPlan` 增强:

- `conclusion` 包含量化数据（不只是文字）
- `why[]` 每条关联到具体的 `DecisionFactorDetail`
- `doNow[]` 关联到 `ShouldEatAction.followUpActions`
- 新增 `educationPoint?` — 关联到 `coach-i18n.ts` 的教育内容

---

## Step 4: 数据流设计

```
Pipeline Step 2 (nutrition-aggregator)
  → foods[], totals

Pipeline Step 3 (user-context-builder)
  → UnifiedUserContext (读取用户画像系统)

Pipeline Step 4 (food-scoring.service)
  → healthScore, nutritionScore, breakdown, breakdownExplanations

Pipeline Step 4.1 (analysis-context.service)
  → ContextualAnalysis { macroSlotStatus, macroProgress, identifiedIssues, recommendationContext }

Pipeline Step 4.5 (analysis-state-builder)
  → AnalysisState

Pipeline Step 5 (food-decision.service)
  → FoodDecision, DietIssue[]

Pipeline Step 5.45 (decision-engine.service)
  → StructuredDecision { verdict, factors, finalScore, rationale }

Pipeline Step 5.5 (decision-summary.service)
  → DecisionSummary { headline, verdict, topIssues, actionItems, coachFocus }

Pipeline Step 5.6 (confidence-diagnostics)
  → ConfidenceDiagnostics

Pipeline Step 5.7 (alternative-suggestion.service)
  → FoodAlternative[] (推荐引擎优先)

Pipeline Step 5.8 (analysis-accuracy.service)
  → FoodAnalysisPackage { accuracyLevel, accuracyScore }

Pipeline Step 6 (result-assembler)
  → FoodAnalysisResultV61 (完整结果)
```

---

## Step 5: 修改文件清单

### Phase 1 修改

| 文件                                                  | 操作 | 说明                       |
| ----------------------------------------------------- | ---- | -------------------------- |
| `decision/i18n/decision-labels.ts`                    | 扩展 | 新增 30+ i18n keys         |
| `decision/coach/coach-i18n.ts`                        | 扩展 | 新增格式化/修正器文案 keys |
| `decision/decision/decision-engine.service.ts`        | 重构 | 硬编码→ cl() 查找          |
| `decision/decision/contextual-modifier.service.ts`    | 重构 | 消除中文 fallback          |
| `coach/app/formatting/coach-format.service.ts`        | 重构 | 纯中文→三语 i18n           |
| `decision/decision/alternative-suggestion.service.ts` | 重构 | 比较文案三语化             |
| `decision/coach/decision-coach.service.ts`            | 重构 | FACTOR_LABELS → cl()       |

### Phase 2 修改

| 文件                                              | 操作 | 说明                    |
| ------------------------------------------------- | ---- | ----------------------- |
| `decision/decision/decision-engine.service.ts`    | 精简 | 文案逻辑→ explainer     |
| `decision/decision/decision-explainer.service.ts` | 扩展 | 接收 rationale 生成职责 |
| `decision/analyze/analysis-pipeline.service.ts`   | 增强 | 准确度→决策联动         |

### Phase 3 修改

| 文件                                                  | 操作 | 说明             |
| ----------------------------------------------------- | ---- | ---------------- |
| `decision/decision/alternative-suggestion.service.ts` | 增强 | 深度推荐引擎融合 |
| `coach/app/formatting/coach-format.service.ts`        | 增强 | 三语完善         |
| `coach/app/config/coach-tone.config.ts`               | 扩展 | 语气矩阵增强     |
| `coach/app/coaching/coach-action-plan.service.ts`     | 增强 | 结构化输出       |

---

## 约束

- **禁止修改**: 推荐系统、用户画像系统、订阅/商业化逻辑
- **不增加数据库字段**
- **不增加新模块**（在现有 decision/coach 模块内重构）
- 推荐系统和用户画像系统只允许**读取**
