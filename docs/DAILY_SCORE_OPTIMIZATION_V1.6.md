# Daily Score Optimization V1.6 — 验证增强 + 结构化状态 + Admin 文档

> 基于 V1.5（权重可配置化）的增量迭代，聚焦：Admin 权重验证、默认值可见性、结构化状态解释、决策偏离增强、Admin 配置使用文档。

---

## 1. 设计目标

| #   | 目标             | 描述                                                                 |
| --- | ---------------- | -------------------------------------------------------------------- |
| G1  | 评分真实反映行为 | 继承 V1.0-V1.5：以用户实际饮食记录为主，画像/决策仅辅助              |
| G2  | 评分个性化       | 通过可配置权重（V1.5）+ 健康条件倍数实现不同用户不同结果             |
| G3  | 状态具备解释性   | `buildStatusExplanation` 返回**结构化 segments**，前端可独立渲染各段 |
| G4  | 行为 vs 建议对比 | `DecisionAlignment` 增加 per-macro 偏离明细                          |
| G5  | 可配置权重       | Admin 配置流程完善：验证、默认值端点、使用文档                       |

---

## 2. Step 1 — 输入数据整合（无变化）

与 V1.5 一致，不新增数据源：

```
用户画像(profile) ─┐
行为服务(behavior) ─┤
今日摘要(summary) ──┤──→ NutritionScoreService.calculateScore()
今日记录(records) ──┤──→ aggregateMealSignals()
配置权重(config) ───┘──→ computePersonalizedWeights()
```

---

## 3. Step 2 — Daily Score 核心设计

### 3.1 评分结构 JSON（V1.6 完整）

```jsonc
{
  // 总分 0-100
  "totalScore": 72,
  // 8 维度分
  "breakdown": {
    "energy": 65,
    "proteinRatio": 80,
    "macroBalance": 70,
    "foodQuality": 55,
    "satiety": 60,
    "stability": 85,
    "glycemicImpact": 75,
    "mealQuality": 68
  },
  "highlights": ["蛋白质摄入充足", "食物质量可改进"],
  "decision": "OK",
  "feedback": "...",
  "goals": { "calories": 2000, "protein": 130, "fat": 49, "carbs": 250, "quality": 7, "satiety": 6 },
  "intake": { "calories": 1450, "protein": 95, "fat": 40, "carbs": 180 },

  // V1.6: 结构化状态解释（替代纯字符串）
  "statusExplanation": {
    "text": "进度正常，继续保持。 宏量状态：蛋白质不足 ✅ 符合营养建议。",
    "segments": [
      { "type": "energy", "text": "进度正常，继续保持。", "sentiment": "positive" },
      { "type": "macro", "text": "宏量状态：蛋白质不足", "sentiment": "warning" },
      { "type": "decision", "text": "✅ 符合营养建议。", "sentiment": "positive" }
    ]
  },

  "statusLabel": "good",
  "topStrength": { "dimension": "stability", "score": 85 },
  "topWeakness": { "dimension": "foodQuality", "score": 55 },

  "behaviorBonus": { "streakDays": 12, "complianceRate": 0.85, "bonusPoints": 1.5 },
  "complianceInsight": {
    "calorieAdherence": 73,
    "proteinAdherence": 73,
    "fatAdherence": 82,
    "carbsAdherence": 72
  },
  "macroSlotStatus": {
    "calories": "deficit", "protein": "deficit", "fat": "ok", "carbs": "deficit",
    "dominantDeficit": "calories"
  },
  "issueHighlights": [
    { "type": "protein_deficit", "severity": "high", "message": "蛋白质摄入不足，仅达目标的73%" }
  ],

  "mealSignals": {
    "totalMeals": 3, "healthyMeals": 2, "healthyRatio": 0.67,
    "avgMealScore": 65,
    "decisionDistribution": { "safe": 2, "warn": 1, "stop": 0 },
    "mealTypes": ["breakfast", "lunch", "dinner"],
    "mealDiversity": 1
  },

  // V1.6: 增强决策偏离（增加 macroDeviations）
  "decisionAlignment": {
    "alignmentScore": 67,
    "deviationCount": 1,
    "deviationMeals": [],
    "summary": "3餐中2餐符合建议",
    "macroDeviations": [
      { "macro": "protein", "direction": "deficit", "percent": 73, "message": "蛋白质仅达目标73%" },
      { "macro": "carbs", "direction": "deficit", "percent": 72, "message": "碳水仅达目标72%" }
    ]
  },

  "weights": { "energy": 0.25, "proteinRatio": 0.2, ... },
  "weightsSource": "default",

  "dailyProgress": {
    "localHour": 15,
    "expectedProgress": 0.63,
    "actualProgress": 0.73,
    "isOnTrack": true
  }
}
```

### 3.2 结构化 StatusExplanation

新增接口 `StatusSegment` 和 `StructuredStatusExplanation`：

```typescript
export interface StatusSegment {
  type:
    | 'energy'
    | 'satiety'
    | 'macro'
    | 'streak'
    | 'compliance'
    | 'decision'
    | 'meal_signal'
    | 'tip';
  text: string;
  sentiment: 'positive' | 'warning' | 'neutral' | 'negative';
}

export interface StructuredStatusExplanation {
  text: string; // 向后兼容：拼接的纯文本
  segments: StatusSegment[];
}
```

`buildStatusExplanation()` 返回类型从 `string` 改为 `StructuredStatusExplanation`。

### 3.3 DecisionAlignment 增强

新增 `macroDeviations` 字段：

```typescript
export interface MacroDeviation {
  macro: 'calories' | 'protein' | 'fat' | 'carbs';
  direction: 'deficit' | 'excess';
  percent: number; // 实际/目标 百分比
  message: string; // i18n 消息
}

export interface DecisionAlignment {
  alignmentScore: number;
  deviationCount: number;
  deviationMeals: string[];
  summary: string;
  macroDeviations?: MacroDeviation[]; // V1.6 新增
}
```

---

## 4. Admin 权重配置端点改进

### 4.1 PUT 验证规则

| 规则                              | 描述                                                    |
| --------------------------------- | ------------------------------------------------------- |
| version 必填                      | `version` 字符串不能为空                                |
| goalWeights 维度完整性            | 每个目标的权重必须包含全部 8 个维度                     |
| goalWeights 权重总和              | 每个目标的权重总和必须在 0.95-1.05 之间（允许浮点误差） |
| healthConditionMultipliers 值范围 | 每个倍数必须在 0.1-5.0 之间                             |

验证失败返回 400 + 具体错误信息。

### 4.2 GET defaults 端点

新增 `GET /api/admin/scoring-config/daily-score-weights/defaults`：

返回硬编码的默认 `GOAL_WEIGHTS` + `conditionMultipliers`，让 admin 能看到默认值是什么。

### 4.3 GET 端点增强

`GET /api/admin/scoring-config/daily-score-weights` 现在返回：

```json
{
  "current": { ... } | null,
  "defaults": { "goalWeights": { ... }, "healthConditionMultipliers": { ... } },
  "effectiveSource": "config" | "default"
}
```

---

## 5. Admin 权重配置使用文档

### 5.1 概述

每日评分系统使用 **8 个维度** 的加权平均计算总分。权重决定了每个维度对总分的贡献程度。

### 5.2 8 个评分维度说明

| 维度             | 含义                                 | 典型范围  |
| ---------------- | ------------------------------------ | --------- |
| `energy`         | 热量摄入与目标的接近程度             | 0.10-0.25 |
| `proteinRatio`   | 蛋白质占热量比例是否在目标范围       | 0.08-0.25 |
| `macroBalance`   | 碳水/脂肪比例均衡度                  | 0.08-0.15 |
| `foodQuality`    | 食物营养密度（1-10 对数映射）        | 0.05-0.20 |
| `satiety`        | 饱腹感评分                           | 0.03-0.15 |
| `stability`      | 饮食习惯稳定性（连胜天数、餐次规律） | 0.05-0.10 |
| `glycemicImpact` | 血糖负荷影响（GL Sigmoid）           | 0.05-0.12 |
| `mealQuality`    | 每餐决策质量综合分                   | 0.17-0.20 |

### 5.3 按目标类型配置权重

系统预定义了 4 种目标类型，每种有不同的默认权重：

| 目标                  | 侧重                  | 默认最高权重维度                     |
| --------------------- | --------------------- | ------------------------------------ |
| `fat_loss`（减脂）    | 热量控制 + 血糖管理   | energy(0.25), proteinRatio(0.20)     |
| `muscle_gain`（增肌） | 蛋白质充足 + 热量达标 | proteinRatio(0.25), energy(0.20)     |
| `health`（健康维护）  | 食物质量 + 均衡       | foodQuality(0.20), mealQuality(0.20) |
| `habit`（习惯养成）   | 饱腹感 + 质量         | foodQuality(0.18), mealQuality(0.18) |

### 5.4 配置权重的步骤

#### Step 1: 查看当前配置和默认值

```bash
# 查看当前配置（null 表示使用默认值）
GET /api/admin/scoring-config/daily-score-weights

# 查看默认值
GET /api/admin/scoring-config/daily-score-weights/defaults
```

#### Step 2: 修改权重

```bash
PUT /api/admin/scoring-config/daily-score-weights
Content-Type: application/json

{
  "version": "1.0.1",
  "updatedAt": "2026-04-17T00:00:00Z",
  "goalWeights": {
    "fat_loss": {
      "energy": 0.28,
      "proteinRatio": 0.18,
      "macroBalance": 0.10,
      "foodQuality": 0.05,
      "satiety": 0.05,
      "stability": 0.04,
      "glycemicImpact": 0.12,
      "mealQuality": 0.18
    }
    // ... 其他目标类型（必须全部提供）
  },
  "healthConditionMultipliers": {
    "diabetes": { "glycemicImpact": 1.5, "energy": 1.2 }
    // ... 其他健康条件
  }
}
```

#### Step 3: 验证生效

配置更新后有约 1 分钟缓存延迟。通过 GET 端点确认 `effectiveSource` 变为 `"config"`。

### 5.5 权重调整指南

1. **所有维度权重总和必须为 1.0**（允许 ±0.05 浮点误差）
2. **提高某维度 = 降低其他维度**（零和博弈）
3. **健康条件倍数** 是在基础权重上的乘法调整，会自动重新归一化
4. **建议小幅调整**：每次修改不超过 ±0.05，观察效果后再迭代
5. **回退方法**：删除 `feature_flag` 表中 `daily_score_weights` 记录即恢复默认值

---

## 6. 实施计划

### Phase 1: 类型定义 + buildStatusExplanation 结构化

- 新增 `StatusSegment`、`StructuredStatusExplanation` 接口
- `buildStatusExplanation()` 返回 `StructuredStatusExplanation`
- Controller 更新 response 中的 `statusExplanation`

### Phase 2: DecisionAlignment 增强

- 新增 `MacroDeviation` 接口
- `buildDecisionAlignment()` 增加 `intake`/`goals` 参数，计算 per-macro 偏离
- Controller 传入 intake/goals

### Phase 3: Admin 权重验证 + defaults 端点

- `ScoringConfigService` 新增 `validateDailyScoreWeights()` 方法
- `ScoringConfigService` 新增 `getDailyScoreWeightsDefaults()` 方法
- `updateDailyScoreWeights()` 调用验证
- Controller 新增 `GET daily-score-weights/defaults` 端点
- Controller `GET daily-score-weights` 返回增强结构

### Phase 4: 编译验证
