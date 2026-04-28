# 饮食决策 + AI 教练系统 V2.9 设计文档

> 版本：V2.9  
> 基线：V2.8  
> 日期：2026-04-17

---

## 一、升级目标（6 项）

围绕 分析 -> 决策 -> 教练 三层，V2.9 聚焦“可执行安全性 + 可维护性 + 国际化扩展”：

1. 引入分析完整度分（analysisCompletenessScore），补齐“准确度之外”的完整度刻画。
2. 引入复核级别（reviewLevel），区分 auto_review 与 manual_review。
3. 在决策摘要增加决策护栏（decisionGuardrails），将风险控制前置。
4. ShouldEat 行动建议接入决策护栏，提升落地执行一致性。
5. 教练上下文新增护栏/复核级别/决策置信度输出，增强“为什么这样做”。
6. 扩展三语 i18n 标签，保证新增上下文字段可国际化。

---

## 二、边界与约束（严格遵守）

- 不修改推荐系统（仅继续读取现有替代建议能力）
- 不修改用户画像系统（仅只读用户约束/目标）
- 不修改订阅/商业化逻辑
- 不新增数据库字段
- 不新增 NestJS 模块

---

## 三、现状缺口（V2.8 到 V2.9）

V2.8 已具备：

- 分析质量分层（high/medium/low）
- 动态决策提示
- 健康约束优先信号
- 教练上下文中动态/约束/质量说明

仍有缺口：

1. 仅有质量分层，不足以反映“信息完整度”。
2. 低质量或多不确定性场景下，缺少统一复核策略字段。
3. 决策侧缺少标准化护栏列表，前端与教练难复用。
4. 教练输出未显式给出复核级别与置信度数字化描述。

---

## 四、V2.9 方案设计

## Phase 1：分析与评分增强

### 目标 A：分析完整度分

在 `ConfidenceDiagnostics` 增加：

- `analysisCompletenessScore?: number` (0~1)

计算方式：

- 由 normalizationConfidence 与 nutritionEstimationConfidence 组合得到（可理解为“输入与营养信息完整度”）。

### 目标 B：复核级别

在 `ConfidenceDiagnostics` 增加：

- `reviewLevel?: 'auto_review' | 'manual_review'`

规则：

- analysisQualityBand = low，或 uncertaintyReasons 数量 >= 2 -> manual_review
- 其他 -> auto_review

---

## Phase 2：决策系统增强

### 目标 C：决策护栏结构化

在 `DecisionSummary` 增加：

- `decisionGuardrails?: string[]`

来源：

- 分析质量（low/medium）
- 健康约束提示
- 动态决策提示
- 预算状态（近上限/超限）

### 目标 D：Should Eat 行动合流

- `ShouldEatActionService` 将 `summary.decisionGuardrails` 并入 followUpActions。
- 在不改变既有 verdict 的前提下，强化“先做什么、先避开什么”。

---

## Phase 3：AI 教练与国际化增强

### 目标 E：教练上下文新增三项

在 summary/coach action context 输出：

- 决策护栏
- 复核级别
- 决策置信度（百分比）

### 目标 F：i18n 标签补齐

新增三语标签：

- `decisionGuardrailsLabel`
- `reviewLevelLabel`
- `decisionConfidenceLabel`
- `reviewAuto`
- `reviewManual`

---

## 五、数据流变化

```text
ConfidenceDiagnosticsService
  -> analysisQualityBand
  -> analysisCompletenessScore
  -> reviewLevel

AnalysisPipelineService
  -> summarize(...)
  -> diagnose(...)
  -> enrich summary: quality note + guardrails + reviewLevel

DecisionSummary
  -> dynamicDecisionHint + healthConstraintNote + decisionGuardrails

ShouldEatActionService
  -> followUpActions += decisionGuardrails

CoachPromptBuilder
  -> 输出 decisionGuardrails / reviewLevel / decisionConfidence
```

---

## 六、实施文件清单

1. `apps/api-server/src/modules/decision/types/analysis-result.types.ts`
2. `apps/api-server/src/modules/decision/analyze/confidence-diagnostics.service.ts`
3. `apps/api-server/src/modules/decision/analyze/analysis-pipeline.service.ts`
4. `apps/api-server/src/modules/decision/decision/should-eat-action.service.ts`
5. `apps/api-server/src/modules/coach/app/prompt/coach-prompt-builder.service.ts`
6. `apps/api-server/src/modules/decision/i18n/decision-labels.ts`
7. `apps/api-server/src/v2.9-integration.spec.ts`

---

## 七、验证标准

- TypeScript 检查无错误
- V2.9 集成测试覆盖：
  - 完整度分与复核级别
  - 决策护栏生成
  - followUpActions 合流
  - 教练上下文字段输出
  - i18n 新标签完整性

---

## 八、接下来方向

- 将 decisionGuardrails 输出到客户端卡片层，形成前端与教练一致的话术与行动顺序。
- 在不改 DB 前提下，逐步引入“护栏命中统计”到日志层用于后续优化。
