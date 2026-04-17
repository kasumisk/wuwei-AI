# Daily Score Optimization V1.4 — 多系统融合评分

## 版本信息

| 字段 | 值                   |
| ---- | -------------------- |
| 版本 | V1.4                 |
| 基于 | V1.3（时间感知评分） |
| 日期 | 2026-04-17           |
| 状态 | 实施中               |

## 1. 问题诊断（V1.3 遗留）

V1.3 解决了时间感知问题（早上不再因"全天目标未完成"而得 0 分）。但仍存在以下不合理：

### 1.1 评分仅依赖营养数值聚合，不感知每餐质量

当前系统将所有饮食记录的热量/宏量求和，然后与全天目标对比。这意味着：

- 用户吃了 3 餐垃圾食品（isHealthy=false, decision=STOP）但恰好凑够了热量目标 → 高分
- 用户吃了 2 餐高质量饮食但稍微不够热量 → 低分
- **数值达标 ≠ 吃得好**

### 1.2 已有的每餐决策信号未被利用

每条 `food_records` 都有：

- `decision`: SAFE/WARN/STOP（分析管道输出）
- `isHealthy`: boolean
- `nutritionScore`: 0-100（单餐评分）
- `avgQuality`: 1-10
- `avgSatiety`: 1-10

这些是 Analyze/Explain/Decide 管道的**实际输出**，完全可以聚合进每日评分。

### 1.3 缺乏"行为 vs 建议"对比

系统有 decision 结果（recommend/caution/avoid），但每日汇总不包含"今天有多少餐符合建议"的信息。

### 1.4 状态解释太机械

当前 `buildStatusExplanation` 仅基于数值阈值生成模板文案，不包含：

- 每餐的实际决策结果
- 用户目标的上下文化解释
- 餐食多样性信息

## 2. V1.4 设计方案

### 2.1 核心原则

```
评分 = 行为层（75%权重）+ 个性化理解层（20%权重）+ 决策辅助层（5%权重）
```

- **行为层**：基于实际记录的营养数值（现有 7 维评分）+ 每餐质量信号
- **个性化理解层**：基于用户目标的权重调整 + 健康条件调整（已有）
- **决策辅助层**：每餐 decision 结果的日聚合（新增）

### 2.2 新增：每餐决策信号聚合（MealSignalAggregation）

从今日所有 `food_records` 聚合：

```typescript
interface MealSignalAggregation {
  totalMeals: number; // 总餐数
  healthyMeals: number; // isHealthy=true 的餐数
  healthyRatio: number; // healthyMeals / totalMeals
  avgMealScore: number; // 所有餐的 nutritionScore 均值
  decisionDistribution: {
    safe: number; // decision=SAFE 的餐数
    warn: number; // decision=WARN 的餐数
    stop: number; // decision=STOP 的餐数
  };
  mealTypes: string[]; // 已记录的餐别（breakfast/lunch/dinner/snack）
  mealDiversity: number; // 已覆盖的餐别数 / 目标餐数
}
```

**数据来源**：`FoodRecordService.getTodayRecords()` → 遍历每条记录

### 2.3 新增第 8 维度：mealQuality（餐食质量综合分）

在原有 7 维基础上增加第 8 维 `mealQuality`，反映"每餐的分析管道判定质量"：

```
mealQuality = healthyRatio × 40 + avgMealScore × 0.4 + decisionBonus × 20
```

其中 `decisionBonus`：

- 全部 SAFE: 1.0
- 有 WARN: 0.7
- 有 STOP: 0.3

权重分配（从现有维度中分出）：

- `mealQuality` 权重 = 0.10（从 energy 和 foodQuality 各分 0.05）

### 2.4 惩罚机制增强（时间感知）

V1.3 的 `applyAdjustments` 中热量超标惩罚（`calories > target × 1.3 → ×0.7`）需要时间感知：

- 当 `localHour < 14` 时，不应该触发基于全天目标的超标惩罚
- 改为：`calories > adjustedTarget × 1.3` 其中 `adjustedTarget = target × expectedProgress`

### 2.5 决策偏离度（Decision Alignment Score）

轻量级辅助信号，不直接参与评分公式，但作为 response 字段：

```typescript
interface DecisionAlignment {
  alignmentScore: number; // 0-100, 建议符合度
  deviationCount: number; // 偏离建议的餐数
  deviationMeals: string[]; // 偏离的餐别名
  summary: string; // "3餐中2餐符合建议" 的三语文案
}
```

### 2.6 增强的状态解释

`buildStatusExplanation` 融合 `MealSignalAggregation`：

- 当 `healthyRatio >= 0.8`: "今日餐食质量优秀，{healthyMeals}/{totalMeals}餐为健康选择。"
- 当 `healthyRatio < 0.5`: "⚠️ 今日多数餐食不够健康，建议下一餐注意食材选择。"
- 融合 `decisionDistribution`: 有 STOP 时提醒

### 2.7 增强的 response 结构

新增字段（不修改已有字段，向后兼容）：

```json
{
  "mealSignals": {
    "totalMeals": 3,
    "healthyMeals": 2,
    "healthyRatio": 0.67,
    "avgMealScore": 72,
    "decisionDistribution": { "safe": 2, "warn": 1, "stop": 0 },
    "mealTypes": ["breakfast", "lunch", "snack"],
    "mealDiversity": 0.75
  },
  "decisionAlignment": {
    "alignmentScore": 80,
    "deviationCount": 1,
    "deviationMeals": ["snack"],
    "summary": "3餐中2餐符合建议"
  }
}
```

## 3. 完整评分结构 JSON（V1.4）

```json
{
  "success": true,
  "code": 200,
  "data": {
    "totalScore": 78,
    "breakdown": {
      "energy": 82,
      "proteinRatio": 75,
      "macroBalance": 90,
      "foodQuality": 81,
      "satiety": 75,
      "stability": 80,
      "glycemicImpact": 75,
      "mealQuality": 78
    },
    "highlights": ["..."],
    "decision": "SAFE",
    "feedback": "...",
    "goals": {
      "calories": 2000,
      "protein": 130,
      "fat": 49,
      "carbs": 250,
      "quality": 7,
      "satiety": 6
    },
    "intake": { "calories": 1200, "protein": 60, "fat": 30, "carbs": 150 },
    "statusLabel": "good",
    "statusExplanation": "进度正常，2/3餐为健康选择。蛋白质比例良好。连胜10天，继续保持！",
    "topStrength": { "dimension": "macroBalance", "score": 90 },
    "topWeakness": { "dimension": "satiety", "score": 75 },
    "behaviorBonus": { "streakDays": 10, "complianceRate": 0.85, "bonusPoints": 1.5 },
    "complianceInsight": {
      "calorieAdherence": 60,
      "proteinAdherence": 46,
      "fatAdherence": 61,
      "carbsAdherence": 60
    },
    "macroSlotStatus": { "calories": "ok", "protein": "ok", "fat": "ok", "carbs": "ok" },
    "issueHighlights": [],
    "dailyProgress": {
      "localHour": 14,
      "expectedProgress": 0.5,
      "actualProgress": 0.6,
      "isOnTrack": true
    },
    "mealSignals": {
      "totalMeals": 3,
      "healthyMeals": 2,
      "healthyRatio": 0.67,
      "avgMealScore": 72,
      "decisionDistribution": { "safe": 2, "warn": 1, "stop": 0 },
      "mealTypes": ["breakfast", "lunch", "snack"],
      "mealDiversity": 0.75
    },
    "decisionAlignment": {
      "alignmentScore": 80,
      "deviationCount": 1,
      "deviationMeals": ["snack"],
      "summary": "3餐中2餐符合建议"
    }
  }
}
```

## 4. 输入数据整合图（Step 1）

```
┌─────────────────────────────────────────────────────────────────┐
│                        Input Sources                             │
├───────────────────┬─────────────────────┬───────────────────────┤
│ 饮食记录           │ 用户画像             │ 行为数据               │
│ (food_records)    │ (user_profiles)     │ (behavior_profiles)   │
│                   │                     │                       │
│ • calories/macros │ • goal (fat_loss..) │ • streakDays          │
│ • decision        │ • healthConditions  │ • complianceRate      │
│ • isHealthy       │ • weightKg          │ • avgMealsPerDay      │
│ • nutritionScore  │ • dailyCalorieGoal  │ • mealTimingPatterns  │
│ • avgQuality      │ • mealsPerDay       │                       │
│ • avgSatiety      │ • regionCode/tz     │                       │
│ • mealType        │                     │                       │
└────────┬──────────┴──────────┬──────────┴───────────┬───────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌─────────────────┐  ┌──────────────────┐   ┌──────────────────┐
│ MealSignal      │  │ Personalized     │   │ Stability        │
│ Aggregation     │  │ Weights          │   │ Score            │
│ (新增 V1.4)     │  │ (V1.0)           │   │ (V1.0)           │
└────────┬────────┘  └────────┬─────────┘   └────────┬─────────┘
         │                     │                       │
         ▼                     ▼                       ▼
┌──────────────────────────────────────────────────────────────┐
│                  8-Dimension Weighted Score                    │
│  energy + proteinRatio + macroBalance + foodQuality           │
│  + satiety + stability + glycemicImpact + mealQuality(新增)  │
├──────────────────────────────────────────────────────────────┤
│  + Time-aware adjustments (V1.3)                              │
│  + Penalty/Reward (V1.0)                                      │
│  + Decision alignment (V1.4, 仅辅助展示)                      │
└──────────────────────────────────────────────────────────────┘
```

## 5. Daily Score 核心设计（Step 2）

### 5.1 评分公式

```
totalScore = Σ(dimension_score × personalized_weight) + adjustments
```

8 维度（V1.4 新增 mealQuality）:

| 维度            | 含义         | 数据来源                         | 评分方法      |
| --------------- | ------------ | -------------------------------- | ------------- |
| energy          | 热量达标度   | calories vs adjustedTarget       | 高斯+时间感知 |
| proteinRatio    | 蛋白质比例   | protein_cal / total_cal          | 分段函数      |
| macroBalance    | 宏量均衡     | carb/fat ratio                   | 区间评分      |
| foodQuality     | 食物营养密度 | avgQuality (1-10)                | 对数映射      |
| satiety         | 饱腹感       | avgSatiety (1-10)                | 对数映射      |
| stability       | 行为稳定性   | streak+regularity+compliance     | 三维加权      |
| glycemicImpact  | 血糖影响     | GI/GL 数据                       | Sigmoid       |
| **mealQuality** | **餐食质量** | **decision+isHealthy+mealScore** | **综合公式**  |

### 5.2 mealQuality 计算公式

```typescript
mealQuality = clamp(
  healthyRatio × 40          // 健康餐占比（0-40分）
  + avgMealScore × 0.4       // 平均单餐评分（0-40分）
  + decisionBonus × 20       // 决策信号加分（0-20分）
)
```

### 5.3 各目标的权重配置（V1.4）

| 维度            | fat_loss | muscle_gain | health   | habit    |
| --------------- | -------- | ----------- | -------- | -------- |
| energy          | 0.25     | 0.20        | 0.10     | 0.15     |
| proteinRatio    | 0.20     | 0.25        | 0.08     | 0.10     |
| macroBalance    | 0.10     | 0.15        | 0.15     | 0.08     |
| foodQuality     | 0.05     | 0.07        | 0.20     | 0.18     |
| satiety         | 0.05     | 0.03        | 0.10     | 0.15     |
| stability       | 0.05     | 0.08        | 0.07     | 0.08     |
| glycemicImpact  | 0.12     | 0.05        | 0.10     | 0.08     |
| **mealQuality** | **0.18** | **0.17**    | **0.20** | **0.18** |
| 合计            | 1.00     | 1.00        | 1.00     | 1.00     |

设计说明：

- `mealQuality` 占 17-20%，确保"吃得好不好"对评分有实质影响
- `energy` 从 fat_loss 的 0.30 降至 0.25，释放空间给 mealQuality
- `foodQuality` 在 fat_loss/muscle_gain 中降低（mealQuality 已包含质量信号）

## 6. 实施步骤

### Step 1: nutrition-score.service.ts

1. 新增 `MealSignalAggregation` 接口
2. 新增 `aggregateMealSignals(records)` 方法
3. 新增 `calcMealQualityScore(signals)` 方法
4. 更新 `GOAL_WEIGHTS` 增加 mealQuality 维度
5. 更新 `NutritionScoreBreakdown` 增加 mealQuality 字段
6. 更新 `calculateScore` 接收 `mealSignals` 参数
7. 更新 `buildStatusExplanation` 融合 mealSignals
8. 更新 `applyAdjustments` 时间感知惩罚
9. 新增 `buildDecisionAlignment(signals, locale)` 方法

### Step 2: food-nutrition.controller.ts

1. 注入 `FoodRecordService`（如未注入）
2. 获取今日原始记录 `getTodayRecords`
3. 调用 `aggregateMealSignals`
4. 传入 `calculateScore`
5. 返回 `mealSignals` + `decisionAlignment`

### Step 3: daily-summary.service.ts

1. 在 `updateDailySummary` 中已有 `records`，调用 `aggregateMealSignals`
2. 传入 `calculateScore`

## 7. 向后兼容性

- `NutritionScoreBreakdown` 新增 `mealQuality` 字段（可选 `?` 后缀）
- `calculateScore` 新增可选参数 `mealSignals`，不传时 mealQuality=75（中性默认）
- Response 新增字段，不修改已有字段
- 不修改数据库 schema
- 前端可按需消费新字段

## 8. 模拟场景验证

### 场景 A: fat_loss 用户，上午 10 点，1 餐健康早餐 500 卡

V1.3（无 mealQuality）: ~78
V1.4（mealQuality=95, isHealthy=1/1, decision=SAFE）: ~82

### 场景 B: fat_loss 用户，晚上 8 点，3 餐但 2 餐垃圾食品

V1.3: ~70（数值恰好达标就高分）
V1.4: ~58（mealQuality 低，healthyRatio=0.33, 有 STOP decision）

### 场景 C: muscle_gain 用户，下午 2 点，2 餐高蛋白健康饮食

V1.3: ~75
V1.4: ~80（mealQuality 加分，2/2 健康餐）

## 9. 迭代路线

- **V1.3**: 时间感知评分（已完成）
- **V1.4**（本版本）: 多系统融合 — 每餐决策信号聚合 + mealQuality 维度
- **V1.5**（未来）: 学习型进度曲线（基于用户实际用餐时间模式）
- **V1.6**（未来）: 餐间评分（单独评每一餐质量，不受全天进度影响）
