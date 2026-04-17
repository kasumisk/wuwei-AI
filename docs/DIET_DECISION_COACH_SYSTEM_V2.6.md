# 饮食决策与 AI 教练系统 V2.6

> 日期：2026-04-17
> 基线版本：V2.5
> 升级目标：在 V2.5 已有“分析 → 决策 → 教练”链路基础上，继续提升上下文感知、教练聚焦、行动可执行性与结构化输出稳定性。

---

## 1. 边界与约束

严格不动：

- 推荐系统
- 用户画像系统
- 订阅 / 商业化逻辑
- 数据库字段
- 模块结构

只做：

- 现有决策链内部结构增强
- 运行时上下文结构增强
- 决策摘要与行动计划增强
- 教练格式化与提示上下文增强

---

## 2. V2.5 基线现状

V2.5 已经完成：

1. 单次分析、评分、Should Eat 基础链路打通
2. 替代建议优先绑定推荐引擎
3. 教练输出具备结构化基础
4. app/admin 两侧反馈与质量指标已接入现有 FoodModule

但仍存在 4 个可继续增强的缺口：

1. 决策上下文虽然完整，但对教练层来说仍偏“原始数据”，缺少上下文标签。
2. 决策摘要已有 headline / issues / actions，但缺少“当前最该强调什么”的聚焦信号。
3. ShouldEatAction 只有 immediateAction，缺少可连续执行的 follow-up 动作清单。
4. 教练格式化输出能生成文本，但对“结论 / 原因 / 建议 / tone”四段结构还不够稳定。

---

## 3. V2.6 本轮升级目标

本轮锁定 6 个目标：

1. 给用户上下文增加可直接消费的 context signals
2. 明确预算状态 under_target / near_limit / over_limit
3. 从剩余宏量中自动推导 nutrition priority
4. 给 DecisionSummary 增加 coachFocus 和 contextSignals
5. 给 ShouldEatAction 增加 followUpActions
6. 给 Coach 输出增加 conclusion / reasons / suggestions / tone

---

## 4. Analyze → Decision → Coach 新链路

### Analyze

在不改分析主流程的前提下，增强 UserContextBuilder 产物：

- budgetStatus
- nutritionPriority
- contextSignals

这些信号不新增字段入库，只在运行时流动。

### Decision

DecisionSummary 在 V2.6 中除了继续输出：

- headline
- topIssues
- topStrengths
- actionItems
- quantitativeHighlight

还新增：

- contextSignals
- coachFocus

让教练层知道“该优先强调什么”。

### Coach

ShouldEatAction 不再只给一个 immediateAction，而是新增：

- followUpActions

Coach 格式化输出新增稳定结构：

- conclusion
- reasons
- suggestions
- tone

---

## 5. 实施映射

### 5.1 用户上下文增强

文件：
- apps/api-server/src/modules/decision/decision/user-context-builder.service.ts
- apps/api-server/src/modules/decision/types/analysis-result.types.ts

新增能力：
- budgetStatus
- nutritionPriority
- contextSignals

### 5.2 决策摘要增强

文件：
- apps/api-server/src/modules/decision/decision/decision-summary.service.ts
- apps/api-server/src/modules/decision/types/analysis-result.types.ts

新增能力：
- contextSignals
- coachFocus
- headline 对 near_limit / over_limit 更敏感

### 5.3 行动决策增强

文件：
- apps/api-server/src/modules/decision/decision/should-eat-action.service.ts
- apps/api-server/src/modules/coach/app/coaching/coach-action-plan.service.ts

新增能力：
- followUpActions
- 教练行动计划优先吸收 follow-up actions

### 5.4 教练上下文与格式化增强

文件：
- apps/api-server/src/modules/coach/app/prompt/coach-prompt-builder.service.ts
- apps/api-server/src/modules/coach/app/formatting/coach-format.service.ts
- apps/api-server/src/modules/coach/app/formatting/coach-format.types.ts

新增能力：
- prompt 中显式注入 contextSignals / coachFocus / followUpActions
- 格式化输出中稳定提供 conclusion / reasons / suggestions / tone

---

## 6. API 能力层变化

本轮没有新增接口定义，但增强了 4 类能力：

1. Context-aware analyze capability
2. Focus-aware decision summary capability
3. Follow-up action planning capability
4. Structured coach formatting capability

---

## 7. 数据结构增强

全部为运行时结构增强，不新增数据库字段：

1. UnifiedUserContext
- budgetStatus
- nutritionPriority
- contextSignals

2. DecisionSummary
- contextSignals
- coachFocus

3. ShouldEatAction
- followUpActions

4. FormattedCoachOutput
- conclusion
- reasons
- suggestions
- tone

---

## 8. 本轮阶段划分

### Phase 1
- 强化上下文建模
- 明确预算状态与营养优先级
- 为决策层提供更稳定的 context signals

### Phase 2
- 强化 DecisionSummary
- 让摘要能指导教练“强调什么”
- 让 ShouldEatAction 具备 follow-up 能力

### Phase 3
- 强化教练上下文注入
- 强化格式化输出结构
- 让 AI Coach 更像真正的可执行教练，而不是只会给结论

---

## 9. 验收标准

V2.6 完成后应满足：

1. 用户上下文不仅有数值，还有状态和信号
2. 决策摘要不仅能描述问题，还能告诉教练重点
3. ShouldEatAction 不再只有一条动作，而是有连续动作清单
4. 教练输出具备更稳定的四段式结构
5. 整体不新增模块、不改数据库、不触碰推荐和画像系统
