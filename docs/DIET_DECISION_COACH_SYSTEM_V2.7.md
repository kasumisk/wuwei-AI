# 饮食决策 + AI 教练系统 V2.7 设计文档

> 版本：V2.7 | 基准：V2.6 | 日期：2026-04-17

---

## 一、V2.6 现状与缺口分析

### 已具备能力

| 层级 | 能力 |
|------|------|
| 分析层 | 文本/图片双链路识别、7维评分、BreakdownExplanation（含 suggestion） |
| 决策层 | 三档决策（recommend/caution/avoid）、动态阈值、ContextualModifier（暴食/累积/趋势）、contextSignals、budgetStatus、nutritionPriority |
| 教练层 | coachFocus（顺序 if-else）、followUpActions、FormattedCoachOutput（conclusion/reasons/suggestions/tone） |
| 替代方案 | AlternativeSuggestionService 已优先调用 RecommendationEngineService（只读） |

### V2.6 缺口（V2.7 要填补的）

| # | 问题 | 影响 |
|---|------|------|
| 1 | `breakdownExplanations` 不传入 `CoachActionPlanService`，coach 的 `why` 看不到评分维度失分点 | 教练解释不够精准 |
| 2 | `ConfidenceDiagnostics.decisionConfidence` 没有映射到 `FormattedCoachOutput`，前端/LLM 无法感知结论可信度 | 误导用户 |
| 3 | `resolveCoachFocus()` 是顺序 if-else，多信号冲突时优先级不稳定（如同时 `protein_gap` + `over_limit`） | 教练重点漂移 |
| 4 | `DecisionOutput.nextMealAdvice.suggestion` 没有传进 `CoachActionPlan` 和 prompt，教练无法主动提下一餐计划 | 前瞻引导缺失 |
| 5 | `formatSummaryContext()` / `formatCoachActionContext()` 中大量硬编码中文，i18n 覆盖不完整 | 多语言 coach 质量差 |
| 6 | `FormattedCoachOutput` 缺少从 breakdown 派生的 `scoreInsight` 和 `confidenceLabel`，结构化输出不完整 | API 消费方需自己推断 |

---

## 二、V2.7 升级目标（6个，分3个 Phase）

### Phase 1 — 评分洞察 + 置信标签注入

**目标 1：breakdownInsight 注入 CoachActionPlan**
- `CoachActionPlanService.build()` 新增 `breakdownExplanations?: BreakdownExplanation[]` 参数
- 从中提取最低分的 warning/critical 维度，将其 message 追加到 `why[]`（最多1条）
- 调用方：`CoachPromptBuilderService.formatAnalysisContext()` 已有 `breakdownExplanations` 字段，直接透传

**目标 2：`confidenceLabel` + `scoreInsight` 写入 `FormattedCoachOutput`**
- `CoachFormatOptions` 增加 `decisionConfidence?: number`、`breakdownExplanations?: BreakdownExplanation[]`
- `FormattedCoachOutput` 增加 `confidenceLabel?: 'low' | 'medium' | 'high'`、`scoreInsight?: string`
- 映射规则：`≥0.8 → high`、`0.6–0.79 → medium`、`<0.6 → low`
- `scoreInsight` = 最低分 critical/warning 维度的 `label + score + message`（一句话）

### Phase 2 — 多信号优先级 + 下一餐前瞻

**目标 3：信号优先级仲裁矩阵**
- 新建 `apps/api-server/src/modules/decision/config/signal-priority.config.ts`
- 定义 `SIGNAL_PRIORITY_MATRIX: Record<goalType, Record<signal, number>>`（数值越高优先级越高）
- `DecisionSummaryService.resolveCoachFocus()` 改为：遍历 contextSignals，查矩阵得分，取最高分信号对应的 coachFocus 字符串
- 消除"顺序 if-else"导致的优先级漂移

**目标 4：`nextMeal` 前瞻字段注入 Coach**
- `CoachActionPlan` 类型增加 `nextMeal?: string`
- `CoachActionPlanService` 接受 `nextMealAdvice?: { suggestion: string; emphasis: string }` 参数，将 suggestion 注入 `plan.nextMeal`
- `formatCoachActionContext()` 输出 `- 下一餐方向：{plan.nextMeal}` 行

### Phase 3 — i18n 覆盖 + 测试

**目标 5：`formatSummaryContext` / `formatCoachActionContext` 国际化**
- `COACH_LABELS` 新增 zh-CN/en-US/ja-JP 的标签：`summaryTitle`, `verdictLabel`, `topIssuesLabel`, `strengthsLabel`, `dataLabel`, `actionItemsLabel`, `contextSignalLabel`, `coachFocusLabel`, `alternativeLabel`, `coachPlanTitle`, `conclusionLabel`, `reasonLabel`, `doNowLabel`, `followUpLabel`, `ifAlreadyAteLabel`, `nextMealLabel`, `alternativesLabel`
- 替换两个方法中所有中文字面量为 `cl(key, locale)` 调用

**目标 6：`v2.7-integration.spec.ts`**
- 回归覆盖全部 6 个 V2.7 改动

---

## 三、核心数据流变化

```
DecisionOutput.breakdownExplanations
  └─→ CoachActionPlanService.build({ breakdownExplanations })
        └─→ CoachActionPlan.why[]: 追加最低分维度 message

ConfidenceDiagnostics.decisionConfidence
  └─→ CoachFormatOptions.decisionConfidence
        └─→ FormattedCoachOutput.confidenceLabel: 'low'|'medium'|'high'

DecisionOutput.nextMealAdvice.suggestion
  └─→ CoachActionPlanService.build({ nextMealAdvice })
        └─→ CoachActionPlan.nextMeal: "下一餐建议..."
              └─→ formatCoachActionContext(): 输出到 LLM prompt

contextSignals[] × goalType
  └─→ SIGNAL_PRIORITY_MATRIX 查找最高优先级信号
        └─→ resolveCoachFocus(): 返回确定性教练重点

FormattedCoachOutput (V2.7 新增字段)
  ├─ confidenceLabel: 'low'|'medium'|'high'
  └─ scoreInsight: string  ← 最低分维度一句话洞察
```

---

## 四、约束与边界

- ❌ 禁止修改：推荐系统、用户画像系统、订阅/商业化逻辑
- ❌ 不增加 DB 字段，不增加新 NestJS 模块
- ✅ `AlternativeSuggestionService` 已接入推荐引擎，本版不重复改动
- ✅ 所有新增字段为可选，向后兼容 V2.6

---

## 五、文件变更清单

| 文件 | 改动类型 | Phase |
|------|----------|-------|
| `decision/config/signal-priority.config.ts` | **新建** | 2 |
| `coach/app/formatting/coach-format.types.ts` | 字段增加 | 1 |
| `coach/app/formatting/coach-format.service.ts` | 逻辑增加 | 1 |
| `coach/app/coaching/coach-action-plan.service.ts` | 参数增加 | 1,2 |
| `decision/types/analysis-result.types.ts` | 字段增加 | 2 |
| `decision/decision/decision-summary.service.ts` | 逻辑替换 | 2 |
| `decision/i18n/decision-labels.ts` | 标签增加 | 3 |
| `coach/app/prompt/coach-prompt-builder.service.ts` | 字符串国际化 | 3 |
| `v2.7-integration.spec.ts` | **新建** | 3 |
