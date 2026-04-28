# 饮食决策 + AI 教练系统 V4.2 — 精度优化 + 因果可解释 + 教练个性化

## 版本定位

V4.1 完成了四层解耦、i18n 清理、可解释性基础。V4.2 聚焦**分析精度、决策可解释性、教练个性化**：

> 从"结构清晰"到"分析准确、解释清楚、教练有温度"

核心理念：**提升分析准确度对决策的驱动力，构建因果解释链，让教练输出个性化且可理解。**

---

## 现有系统缺口分析

### 1. 分析层缺口

| 缺口                        | 现象                                                            | 影响                               |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| 宏量槽位阈值不一致          | `AnalysisContextService` 用 10%，`UserContextBuilder` 用 12%    | 同一餐分析/决策阶段判定不同        |
| 时间归一化缺失              | 早上7点蛋白质不足判高严重度                                     | 早餐误报率高                       |
| Sugar/Sodium/Fiber 为代理值 | Issue detector 用 carb excess 代理 sugar，sodium/fiber metric=0 | 健康条件风险评估失准               |
| 静默部分失败                | UserContextBuilder 7个服务 `.catch(null)`，无完整度标记         | 上下文不完整时决策质量下降但无感知 |
| preferredScenarios 写死     | 永远 `['homeCook']`                                             | 替代方案场景单一                   |

### 2. 决策层缺口

| 缺口                       | 现象                                                          | 影响                       |
| -------------------------- | ------------------------------------------------------------- | -------------------------- |
| 因果叙事缺失               | 解释链有步骤但无"因为A+B→所以C"连接                           | 用户不理解决策逻辑         |
| 结构化决策权重固定         | nutrition 0.35/macro 0.25/health 0.25/time 0.15 不随目标变化  | 减脂用户和增肌用户权重相同 |
| 替换策略脆弱               | `resolveReplacementStrategy` 用中英文关键词匹配 reason 字符串 | locale 变更即失效          |
| Contextual modifier 硬编码 | V4.0 行为乘数 0.92/0.95/1.03 内联                             | 不可配置不可调试           |
| 静态替代无对比数据         | `buildComparison` 对 static 源返回 undefined                  | 降级路径用户体验差         |
| Explainer 时间边界硬编码   | 6-10/11-14/14-17 不用 DynamicThresholds                       | 与决策引擎阈值不一致       |

### 3. 教练层缺口

| 缺口                      | 现象                                          | 影响                 |
| ------------------------- | --------------------------------------------- | -------------------- |
| 无语气个性化              | CoachActionPlan.tone 字段存在但 Coach 不使用  | 所有用户收到相同语气 |
| userId 未使用             | DecisionCoachService 接收 userId 但不读取偏好 | 无法个性化           |
| DailyMacroSummary 未 i18n | 直接硬编码三语模板                            | 不走 ci()/cl() 系统  |
| toneModifier 未生成       | EvidencePack.toneModifier 字段无产出源        | 证据包语气永远默认   |

---

## V4.2 设计方案

### 约束

- 不新增 provider（32个上限）
- 不新增数据库字段
- 不修改推荐系统/用户画像系统/订阅逻辑
- 所有新增字段 `?:` 可选
- i18n 三套共存：`t()` / `cl()` / `ci()`

---

## Phase 1: 分析精度 + 决策权重动态化

### 1.1 统一宏量槽位阈值

**文件**: `analyze/analysis-context.service.ts`

将 `inferMacroSlotStatus` 的硬编码 90%/110% 改为与 `user-context-builder.service.ts` 一致的 12% 阈值：

- deficit: ratio < 0.88
- excess: ratio > 1.12
- ok: 其他

### 1.2 时间归一化问题检测

**文件**: `analyze/nutrition-issue-detector.service.ts`

新增 `localHour?: number` 参数，根据时间调整严重度：

- 早餐时段(6-10): protein_deficit/calorie_deficit 降一级（high→medium, medium→low）
- 午餐前(10-12): protein_deficit 降一级
- 规则：只降低宏量不足类 issue 的严重度，不影响过量类

### 1.3 用户上下文完整度标记

**文件**: `analyze/user-context-builder.service.ts`

在 `build()` 返回的 `UnifiedUserContext` 中增加可选字段：

```typescript
contextCompleteness?: {
  availableSignals: string[];   // 成功获取的信号源
  missingSignals: string[];     // 失败的信号源
  completenessRatio: number;    // 0-1
}
```

**类型文件**: `types/analysis-result.types.ts` — 在 `UnifiedUserContext` 中新增该字段

### 1.4 结构化决策权重目标自适应

**文件**: `decision/decision-engine.service.ts`

将固定权重替换为按 `goalType` 查表：

```typescript
const GOAL_FACTOR_WEIGHTS: Record<string, FactorWeights> = {
  fat_loss: { nutrition: 0.4, macroBalance: 0.25, healthConstraint: 0.2, timeliness: 0.15 },
  muscle_gain: { nutrition: 0.3, macroBalance: 0.35, healthConstraint: 0.2, timeliness: 0.15 },
  health: { nutrition: 0.25, macroBalance: 0.2, healthConstraint: 0.4, timeliness: 0.15 },
  maintain: { nutrition: 0.3, macroBalance: 0.3, healthConstraint: 0.2, timeliness: 0.2 },
};
```

### 1.5 Contextual modifier 参数提取

**文件**: `decision/contextual-modifier.service.ts`

将硬编码的 V4.0 行为乘数移入 `MODIFIER_PARAMS`：

```typescript
// 新增到 MODIFIER_PARAMS
bingeHourMultiplier: 0.92,
trendIncreasingMultiplier: 0.95,
trendDecreasingMultiplier: 1.03,
consecutiveExcessExtraDays: 3,
consecutiveExcessExtraPenalty: 0.95,
```

---

## Phase 2: 因果可解释性 + 替代方案增强

### 2.1 因果叙事生成

**文件**: `decision/decision-explainer.service.ts`

新增方法 `buildCausalNarrative(chain: DecisionChainStep[], decision, locale?) → string`：

- 从 chain 中提取关键 factors（score < 60 的维度）
- 组合为 "因为[factor1]和[factor2]，建议[verdict]" 格式
- 输出存入现有 `AnalysisExplanation` 的新可选字段 `causalNarrative?: string`

**类型文件**: `types/analysis-result.types.ts` — `AnalysisExplanation` 新增 `causalNarrative?: string`

**i18n**: `decision-labels.ts` 新增 `causal.*` keys

### 2.2 替换策略结构化

**文件**: `decision/should-eat-action.service.ts`

将 `resolveReplacementStrategy` 从关键词匹配改为基于结构化数据：

- 从 `FoodAlternative` 的 `comparison` 判断：有 calorieDiff 且 > 30% → `reduce_portion`
- 从 alternatives 数量判断：有 >= 2 个不同食物 → `replace_food`
- 从 issues 类型判断：含 `protein_deficit` + 有 alternatives → `change_pairing`
- 默认 → `replace_food`

### 2.3 静态替代对比数据补充

**文件**: `decision/alternative-suggestion.service.ts`

对 static alternatives 增加估算 comparison：

- 从 `alternative-food-rules.ts` 的规则 trigger 中推断目标热量范围
- 生成 `comparison: { caloriesDiff: 估算值, proteinDiff: null, scoreDiff: null }`

### 2.4 Explainer 时间边界统一

**文件**: `decision/decision-explainer.service.ts`

`buildDetailedRationale` 中的时间边界（6-10, 11-14, 14-17）改为从 `DynamicThresholdsService.compute()` 获取，与决策引擎保持一致。

### 2.5 preferredScenarios 动态化

**文件**: `analyze/analysis-context.service.ts`

从 `UnifiedUserContext` 中的 `localHour` 推断场景偏好：

- 早餐(6-10): `['homeCook', 'convenience']`
- 午餐(11-14): `['takeout', 'homeCook']`
- 晚餐(17-21): `['homeCook', 'takeout']`
- 其他: `['convenience', 'homeCook']`

---

## Phase 3: 教练个性化 + i18n 完善

### 3.1 教练语气动态解析

**文件**: `coach/decision-coach.service.ts`

利用现有 `DecisionToneResolverService` 生成 tone，应用到教练输出：

- strict: 更直接的措辞（"应该"/"必须"）
- encouraging: 更鼓励的措辞（"可以尝试"/"做得好"）
- neutral: 平衡措辞

通过 `ci()` 的 key 后缀区分语气：`coach.headline.balanced.encouraging` vs `coach.headline.balanced.strict`

### 3.2 toneModifier 生成

**文件**: `analyze/evidence-pack-builder.service.ts`

从 `DecisionToneResolverService` 获取 tone，填充 `EvidencePack.toneModifier`。

### 3.3 DailyMacroSummary i18n 迁移

**文件**: `coach/daily-macro-summary.service.ts`

将硬编码三语模板迁移到 `coach-i18n.ts` 的 `ci()` 系统。

### 3.4 教练 i18n 新增 keys

**文件**: `coach/coach-i18n.ts` + `i18n/decision-labels.ts`

新增所有 Phase 1-3 需要的 i18n keys：

- `causal.because` / `causal.therefore` / `causal.and`
- `coach.headline.balanced.strict` / `.encouraging` / `.neutral`
- `coach.headline.adjust.strict` / `.encouraging` / `.neutral`
- `macro.summary.*` (从 DailyMacroSummary 迁移)

---

## 实施检查清单

- [x] Phase 1 后 `npx tsc --noEmit --pretty` 通过
- [x] Phase 2 后 `npx tsc --noEmit --pretty` 通过
- [x] Phase 3 后 `npx tsc --noEmit --pretty` 通过（0 errors）
- [x] 所有新增字段为 `?:` 可选
- [x] 不新增 provider
- [x] 不修改推荐系统/画像/订阅
- [x] 面向用户文案走 `cl()` 或 `ci()`

---

## 文件变更范围

| 文件                                          | Phase | 变更类型              |
| --------------------------------------------- | ----- | --------------------- |
| `types/analysis-result.types.ts`              | 1,2   | 新增可选字段          |
| `analyze/analysis-context.service.ts`         | 1,2   | 阈值统一 + 场景动态化 |
| `analyze/nutrition-issue-detector.service.ts` | 1     | 时间归一化            |
| `analyze/user-context-builder.service.ts`     | 1     | 完整度标记            |
| `decision/decision-engine.service.ts`         | 1     | 权重目标自适应        |
| `decision/contextual-modifier.service.ts`     | 1     | 参数提取              |
| `decision/decision-explainer.service.ts`      | 2     | 因果叙事 + 时间边界   |
| `decision/should-eat-action.service.ts`       | 2     | 替换策略结构化        |
| `decision/alternative-suggestion.service.ts`  | 2     | 静态对比补充          |
| `coach/decision-coach.service.ts`             | 3     | 语气个性化            |
| `coach/daily-macro-summary.service.ts`        | 3     | i18n 迁移             |
| `coach/coach-i18n.ts`                         | 3     | 新增 keys             |
| `i18n/decision-labels.ts`                     | 2,3   | 新增 keys             |
| `analyze/evidence-pack-builder.service.ts`    | 3     | toneModifier 生成     |
