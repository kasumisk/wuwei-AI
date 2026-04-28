# Daily Score + Daily Status 优化设计文档 V1

> 基于饮食决策 + AI 教练系统 V3.8，优化"每日评分 + 今日状态"生成。

## 1. 现状问题

### 1.1 评分数据质量问题（P0 Critical）

| 问题                                                                              | 位置                                                              | 影响                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| `foodQuality` fallback 为 3（默认值），当 `avgQuality=0` 时仍传入 3               | `daily-summary.service.ts:185`、`food-nutrition.controller.ts:93` | 无记录质量数据时评分虚高               |
| `satiety` 同上，fallback 为 3                                                     | 同上                                                              | 饱腹感维度失真                         |
| `stability` 维度始终为 80（默认值），因 `updateDailySummary` 不传 `stabilityData` | `daily-summary.service.ts:178-189`                                | 稳定性维度形同虚设                     |
| `glycemicImpact` 始终为 75（默认值），因不传 `glycemicIndex`                      | 同上                                                              | 血糖维度形同虚设                       |
| `healthScore` 仅在单餐链路存在（`food-scoring.service.ts`），每日汇总不计算       | —                                                                 | 前端 daily status 无法获取 healthScore |

### 1.2 个性化不足（P1）

- 7 维评分仅按 `goalType` 选权重，不考虑用户 `healthConditions`
- `BehaviorService` 的连胜/合规率/暴食时段数据未参与每日评分
- 偏好系统（`PreferenceProfileService`）完全独立于评分

### 1.3 解释性不足（P2）

- 前端状态只有 4 档文案（优秀/良好/一般/需改善），无具体解释
- `coach-insight.service.ts` 生成的 `CoachInsightPack` 未与 nutrition-score endpoint 关联
- 7 维 breakdown 有值但无前端可消费的自然语言解释

## 2. 设计方案

### 2.1 设计原则

1. **行为优先**：评分基于用户实际记录的食物和摄入
2. **个性化理解**：结合目标/身体情况调整权重，偏好仅用于解释
3. **决策系统辅助**：判断是否偏离建议，作为轻微加权
4. **不新增数据库字段**：所有增强数据实时计算
5. **不新增模块**：在现有 service 内增强

### 2.2 三阶段实施

---

## Phase 1: 修复评分数据质量（P0）

### P1.1 注入真实 stabilityData

**改动文件**: `daily-summary.service.ts`

在 `updateDailySummary` 中，从 `BehaviorService` 获取真实的 `stabilityData` 传给 `calculateScore`：

```typescript
// 从 BehaviorService 获取行为数据
const behaviorProfile = await this.behaviorService.getProfile(userId);
const stabilityData = {
  streakDays: behaviorProfile.streakDays || 0,
  avgMealsPerDay: records.length, // 当日餐数
  targetMeals: profile?.mealsPerDay || 3,
};

const scoreResult = this.nutritionScoreService.calculateScore(
  { ... },
  goalType,
  stabilityData, // 传入真实数据
);
```

**同步改动**: `food-nutrition.controller.ts` 的 `getNutritionScore` 也需要注入 `stabilityData`。

### P1.2 修复 foodQuality / satiety fallback 逻辑

**问题**: `avgQuality || 3` 在值为 0 时也会 fallback 为 3。

**方案**: 改为"有记录时用真实加权平均，无记录时用合理估算"。

```typescript
// daily-summary.service.ts — 已有加权平均逻辑是正确的
// 问题在于 calculateScore 调用时的 fallback
foodQuality: records.length > 0 ? (avgQuality > 0 ? avgQuality : 3) : 0,
satiety: records.length > 0 ? (avgSatiety > 0 ? avgSatiety : 3) : 0,
```

当 `records.length > 0` 但所有记录的 quality 都是 0 时，说明数据确实缺失，用 3 作为中性默认值是合理的。真正的问题是 controller 层的 fallback——当 summary 不存在（无记录）时仍然传入 3。

**修改 controller**:

```typescript
foodQuality: summary.mealCount > 0 ? (summary.avgQuality || 3) : 0,
satiety: summary.mealCount > 0 ? (summary.avgSatiety || 3) : 0,
```

并在 `NutritionScoreService.calculateScore` 中增加对 `foodQuality=0` 的处理：当值为 0 时，将该维度权重分摊给其他维度。

### P1.3 在 nutrition-score endpoint 注入 stabilityData

**改动文件**: `food-nutrition.controller.ts`

需要注入 `BehaviorService` 依赖，获取真实 stabilityData。

---

## Phase 2: 增强个性化评分（P1）

### P2.1 健康条件感知的评分调整

**改动文件**: `nutrition-score.service.ts`

在 `calculateScore` 中新增可选参数 `healthConditions?: string[]`，对特定维度做调整：

| 健康条件                   | 调整                                           |
| -------------------------- | ---------------------------------------------- |
| `diabetes` / `blood_sugar` | `glycemicImpact` 权重 ×1.5，`energy` 权重 ×1.2 |
| `hypertension`             | 新增钠摄入惩罚（如果有数据）                   |
| `kidney`                   | `proteinRatio` 上限更严格                      |
| `cholesterol`              | `macroBalance` 中脂肪比例惩罚加重              |

**实现方式**: 在加权求和前，根据 healthConditions 动态调整 `GOAL_WEIGHTS` 副本（不修改原始常量），然后归一化。

### P2.2 行为连胜加分机制

**改动文件**: `nutrition-score.service.ts` 的 `applyPenalties` → 重命名为 `applyAdjustments`

增加正向激励：

```typescript
// 连胜 >= 7 天，评分 +3（最高 +5）
if (stabilityData?.streakDays >= 7) {
  adjusted += Math.min(5, Math.floor(stabilityData.streakDays / 7) * 1.5);
}
```

### P2.3 合规率加权

在 `stabilityScore` 计算中融入 `avgComplianceRate`：

```typescript
private calcStabilityScore(
  streakDays: number,
  avgMealsPerDay: number,
  targetMeals: number,
  complianceRate?: number, // 新增
): number {
  // ... 现有逻辑 ...
  const complianceBonus = complianceRate
    ? this.clamp(complianceRate * 100 * 0.3)
    : 0;
  return Math.round((streakScore + mealRegularity + complianceBonus) / 3);
}
```

---

## Phase 3: 增强解释性 + 行为对比（P2）

### P3.1 enriched nutrition-score response

**改动文件**: `food-nutrition.controller.ts`

在现有 response 中增加字段（不改数据库，实时计算）：

```typescript
data: {
  totalScore: score.score,
  breakdown: score.breakdown,
  highlights: score.highlights,
  decision: score.decision,
  feedback,
  goals,
  intake: { ... },
  // ── 新增 ──
  statusLabel: getStatusLabel(score.score, locale),  // "良好" / "Good" / "良い"
  statusExplanation: buildStatusExplanation(score, goals, summary, locale),
  behaviorBonus: { streakDays, complianceRate, bonusPoints },
  topStrength: pickTopDimension(score.breakdown, 'best'),
  topWeakness: pickTopDimension(score.breakdown, 'worst'),
}
```

### P3.2 复用 CoachInsightService 生成状态解释

在 `food-nutrition.controller.ts` 中注入 `CoachInsightService`，调用 `generateInsights` 获取 `trendInsight` 和 `priorityInsight`，附加到 response。

这需要先构建 `ContextualAnalysis` 和 `UnifiedUserContext`——可以复用 `AnalysisContextService.buildContext()` 的部分逻辑，但为避免循环依赖，改为在 controller 层手动构建轻量级 context。

### P3.3 行为 vs 建议对比（可选增强）

在 response 中增加 `complianceInsight`：

```typescript
complianceInsight: {
  // 今日热量 vs 目标
  calorieAdherence: Math.round((summary.totalCalories / goals.calories) * 100),
  // 宏量达标情况
  proteinAdherence: Math.round((summary.totalProtein / goals.protein) * 100),
  fatAdherence: Math.round((summary.totalFat / goals.fat) * 100),
  carbsAdherence: Math.round((summary.totalCarbs / goals.carbs) * 100),
  // 与昨日对比
  trend: compareTrend(yesterdaySummary, todaySummary),
}
```

---

## 3. 数据流（优化后）

```
food_records
  ├── DailySummaryService.updateDailySummary()
  │     ├── reduce 求和 calories/protein/fat/carbs
  │     ├── 加权平均 avgQuality/avgSatiety
  │     ├── BehaviorService.getProfile() → stabilityData ← [NEW]
  │     ├── NutritionScoreService.calculateScore(input, goal, stabilityData, healthConditions)
  │     │     ├── 7维评分（含真实 stability）
  │     │     ├── 健康条件权重调整 ← [NEW]
  │     │     ├── 行为连胜加分 ← [NEW]
  │     │     └── 惩罚/调整机制
  │     └── Upsert daily_summaries
  │
  └── GET /nutrition-score (实时)
        ├── getTodaySummary() → intake 数据
        ├── getProfile() → goals + healthConditions
        ├── BehaviorService.getProfile() → stabilityData ← [NEW]
        ├── calculateScore(input, goal, stabilityData, healthConditions) ← [ENHANCED]
        ├── CoachInsightService.generateInsights() → statusExplanation ← [NEW]
        └── Response: score + breakdown + explanation + behaviorBonus + compliance
```

## 4. 影响范围

### 修改文件清单

| 文件                                                | Phase | 改动类型                                             |
| --------------------------------------------------- | ----- | ---------------------------------------------------- |
| `diet/app/services/daily-summary.service.ts`        | P1    | 注入 BehaviorService，传 stabilityData               |
| `diet/app/controllers/food-nutrition.controller.ts` | P1+P3 | 注入 BehaviorService，修复 fallback，增强 response   |
| `diet/app/services/nutrition-score.service.ts`      | P1+P2 | 零值维度权重分摊，健康条件调整，连胜加分，合规率融入 |
| `decision/coach/coach-insight.service.ts`           | P3    | 无改动（纯复用）                                     |
| `diet/app/services/behavior.service.ts`             | —     | 无改动（纯读取）                                     |

### 不修改

- 推荐系统
- 用户画像系统（只读）
- 数据库 schema
- 前端（前端可按需消费新字段，向后兼容）

## 5. 长期迭代方向

### V2 可选增强（后续版本）

1. **食物多样性评分**：基于近 7 天食物种类数，奖励多样化饮食
2. **微量营养素维度**：当食物库有维生素/矿物质数据时，新增维度
3. **时间维度评分**：用餐时间规律性（`mealTimingPatterns`）纳入 stability
4. **AI 个性化文案**：用 LLM 生成个性化状态描述（替代模板文案）
5. **周评分/月评分**：聚合多日数据，生成趋势评分
6. **社交对比**：同目标用户群体的百分位排名

### 评分公式可调性

所有权重和阈值均为常量配置（`GOAL_WEIGHTS`、惩罚阈值等），支持 A/B 测试和在线调参，无需改代码结构。
