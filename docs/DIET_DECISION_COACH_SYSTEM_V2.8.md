# 饮食决策 + AI 教练系统 V2.8 设计文档

> 版本：V2.8  
> 基线：V2.7  
> 日期：2026-04-17

---

## 1. 目标与边界

### 1.1 核心目标（本次 6 项）

围绕 分析 -> 决策 -> 教练 的完整链路，落地以下增强：

1. 引入分析准确度分层（高/中/低），避免低置信输入被过度确定化表达。
2. 将准确度信号写入摘要与证据块，提升可解释性。
3. 增强动态决策提示：同食物在不同时段/预算状态下给出不同结论提示。
4. 在决策链中显式纳入健康约束（过敏/饮食限制/健康状况）优先级。
5. 教练行动计划强化“为什么 + 现在怎么做 + 下一步”结构，加入动态与约束提示。
6. 扩展国际化标签覆盖新增上下文字段，保持 zh-CN / en-US / ja-JP 一致。

### 1.2 严格约束（必须遵守）

- 不修改推荐系统（只读使用现有替代建议能力）
- 不修改用户画像系统（只读使用 profile/context）
- 不改订阅/商业化逻辑
- 不新增数据库字段
- 不新增 NestJS 模块

---

## 2. V2.7 现状缺口

V2.7 已完成：

- breakdownInsight / scoreInsight / confidenceLabel
- 信号优先级矩阵
- nextMeal 注入
- summary/coach plan i18n 化

仍存在问题：

1. 置信度已存在，但缺少“质量分层语义”，前端与教练消费成本高。
2. 决策摘要缺少“动态结论提示”（时间窗 + 预算状态），同食物动态决策的可解释性不足。
3. 健康约束虽在 profile 可读，但未成为决策信号优先级中的一等公民。
4. 教练上下文缺少“准确度说明 + 动态提示 + 健康约束提示”三类关键桥接信息。

---

## 3. V2.8 升级方案

## Phase 1：分析与评分增强（Analyze + Score）

### 目标 A：置信度诊断增强为“分析质量分层”

在 `ConfidenceDiagnostics` 增加：

- `analysisQualityBand?: 'high' | 'medium' | 'low'`
- `qualitySignals?: string[]`

规则：

- decisionConfidence >= 0.8: high
- decisionConfidence >= 0.6 且 < 0.8: medium
- < 0.6: low

并补充质量信号：

- `recognition_low`
- `normalization_low`
- `nutrition_estimation_low`
- `audit_feedback_low`

### 目标 B：摘要携带准确度提示

在 `DecisionSummary` 增加：

- `analysisQualityBand?: 'high' | 'medium' | 'low'`
- `analysisQualityNote?: string`

由 pipeline 在拿到 `confidenceDiagnostics` 后回写 summary：

- high: 数据质量较高，可按当前建议执行
- medium: 结论可用，建议结合饥饿感/份量微调
- low: 建议保守执行，并优先补充更清晰输入复核

---

## Phase 2：决策增强（Should Eat）

### 目标 C：动态决策提示显式化

在 `DecisionSummary` 增加：

- `dynamicDecisionHint?: string`

生成逻辑：结合 `localHour + budgetStatus + recommendation`，输出“同食物不同时间/状态下结论不同”的可读提示。

### 目标 D：健康约束纳入优先信号

- `UserContextBuilderService.resolveContextSignals()` 在存在 `allergens / dietaryRestrictions / healthConditions` 时追加 `health_constraint`。
- `signal-priority.config.ts` 增加 `health_constraint` 优先级。
- `DecisionSummaryService.resolveCoachFocus()` 支持该信号并返回约束优先教练重点文案。

### 目标 E：行动建议增加约束护栏

`ShouldEatActionService` 增加对 userContext 的只读消费（不改画像服务）：

- 有健康约束时，immediateAction 优先提醒“先满足约束，再谈优化”。

---

## Phase 3：AI 教练与国际化增强（Coach + i18n）

### 目标 F：教练上下文新增 3 类关键信号

在 prompt context 增加：

- 分析质量提示（analysisQualityNote）
- 动态决策提示（dynamicDecisionHint）
- 健康约束提示（healthConstraintNote）

### 目标 G：i18n 标签扩展

新增标签（三语一致）：

- `analysisQualityLabel`
- `dynamicHintLabel`
- `healthConstraintLabel`

---

## 4. 关键数据流（V2.8）

```text
ConfidenceDiagnosticsService
  -> decisionConfidence
  -> analysisQualityBand + qualitySignals

analysis-pipeline
  -> summary = DecisionSummaryService.summarize(...)
  -> confidenceDiagnostics = diagnose(...)
  -> enrich(summary) with analysisQualityBand/analysisQualityNote

UserContextBuilder
  -> contextSignals += health_constraint (when constraints exist)

DecisionSummaryService
  -> dynamicDecisionHint
  -> healthConstraintNote
  -> resolveCoachFocus() respects health_constraint priority

ShouldEatActionService
  -> immediateAction prefers health-constraint-safe guidance

CoachPromptBuilder
  -> 输出 analysisQuality / dynamicHint / healthConstraint
```

---

## 5. 文件改动清单（计划）

1. `apps/api-server/src/modules/decision/types/analysis-result.types.ts`
2. `apps/api-server/src/modules/decision/analyze/confidence-diagnostics.service.ts`
3. `apps/api-server/src/modules/decision/analyze/analysis-pipeline.service.ts`
4. `apps/api-server/src/modules/decision/decision/user-context-builder.service.ts`
5. `apps/api-server/src/modules/decision/config/signal-priority.config.ts`
6. `apps/api-server/src/modules/decision/decision/decision-summary.service.ts`
7. `apps/api-server/src/modules/decision/decision/should-eat-action.service.ts`
8. `apps/api-server/src/modules/coach/app/coaching/coach-action-plan.service.ts`
9. `apps/api-server/src/modules/coach/app/prompt/coach-prompt-builder.service.ts`
10. `apps/api-server/src/modules/decision/i18n/decision-labels.ts`
11. `apps/api-server/src/v2.8-integration.spec.ts`

---

## 6. 验证策略

- TypeScript 无错误（文件级 + 全量）
- V2.8 集成测试覆盖：
  - 质量分层映射
  - 动态提示生成
  - health_constraint 信号优先级
  - ShouldEat 行动护栏
  - Coach context 新字段输出
  - i18n 新标签完整性

---

## 7. 预期收益

- 分析准确度表达更清晰，降低错误确定性输出风险
- 决策解释更贴近真实场景（时段与状态动态）
- 健康约束优先级明确，安全性更高
- 教练输出更可执行、更可解释，且更易国际化扩展
