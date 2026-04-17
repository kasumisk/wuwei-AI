# Daily Score + Daily Status 优化设计文档 V1.1

> 强化"行为优先 + 个性化理解 + 决策辅助"三层数据融合架构  
> 基于真实饮食记录，融合用户画像、偏好、AI 教练能力的综合评分系统

**版本变更**：V1.1 vs V1 的核心升级

- ✅ 明确"行为优先级"数据架构（数据源 → 权重等级 → 融合逻辑）
- ✅ 细化个性化维度的影响机制（公式化、参数化）
- ✅ 完整化状态解释路径（从分解值到自然语言）
- ✅ 补充实施细节和伪代码

---

## 1. 系统现状 + 问题分析

### 1.1 现有能力盘点

| 系统                  | 能力                      | 数据类型              | 当前用途 | 状态      |
| --------------------- | ------------------------- | --------------------- | -------- | --------- |
| **Analyze**           | 食物识别、营养解析        | 每餐食物、宏微量      | 单餐决策 | ✅ 上线   |
| **Explain**           | 7维评分生成、breakdown    | 单餐/日汇总、维度分解 | 评分解释 | ✅ 上线   |
| **Decide**            | Should Eat 判断、风险评估 | 单餐营养 vs 目标      | 参考建议 | ✅ 上线   |
| **BehaviorService**   | 连胜、合规率、进度        | 历史行为、用户心理    | 孤立存储 | ⚠️ 未融合 |
| **PreferenceService** | 口味、饮食习惯、禁忌      | 用户偏好              | 推荐场景 | ⚠️ 未融合 |
| **ProfileService**    | 目标、身体情况、约束      | 用户画像              | 部分融合 | ⚠️ 不完整 |

### 1.2 关键问题（V1 已识别）

| Problem                          | 影响             | 根因                              |
| -------------------------------- | ---------------- | --------------------------------- |
| `stability=80`（默认）           | 稳定性维度失真   | BehaviorService 数据未注入        |
| `glycemicImpact=75`（默认）      | 血糖维度失真     | 缺 glycemic index 数据融合        |
| `foodQuality/satiety` fallback=3 | 无记录时评分虚高 | 控制流逻辑错误                    |
| 无 `healthScore` 聚合            | 缺完整维度       | daily-summary 无 healthScore 计算 |
| **未考虑 healthConditions**      | 个性化缺失       | 健康条件未作为评分参数            |
| **7 维 breakdown 无解释**        | 用户困惑         | 仅返回数值，无自然语言            |
| **Decide 结果未融合**            | 决策孤立         | 仅用于参考，不参与评分            |

---

## 2. 设计原则（强约束）

### 2.1 三层优先级架构

```
┌─────────────────────────────────────────────────┐
│ Layer 1: 行为优先（Primary）                     │
│ ─ 真实食物记录（calories/macro/quality/satiety）  │
│ ─ 实际摄入vs目标的差值                           │
│ ─ 数据质量、完整性                               │
│ └─ 权重：70% 核心评分逻辑                         │
├─────────────────────────────────────────────────┤
│ Layer 2: 个性化理解（Contextual）               │
│ ─ 用户目标（减肥/增肌/维持）调整权重组          │
│ ─ 健康条件（糖尿病/高血压等）增强特定维度       │
│ ─ 用户进度（连胜/合规率）作为行为加成           │
│ └─ 权重：20% 上下文调整                          │
├─────────────────────────────────────────────────┤
│ Layer 3: 决策系统（Auxiliary）                  │
│ ─ Should Eat 判断：偏离建议 → -2%~+2% 调整      │
│ ─ 风险评估：高风险 → 该维度权重 ×0.85           │
│ └─ 权重：10% 轻微修正                            │
└─────────────────────────────────────────────────┘

🔴 强约束：Layer 1 数据缺失/质量差 → 无法用 Layer 2 补救
           用 Layer 3 结果替代 Layer 1 属于"过度相信决策系统"
```

### 2.2 核心设计原则（必须遵守）

**P1: 行为数据真实性优先**

- 评分必须直接来自 `food_records` 的聚合（不假设、不填充）
- 数值缺失 → 使用合理中性值（如 satiety 缺失 → 3），而非假设最优值
- 无记录 → 该维度评分为 0，不纳入最终分

**P2: 个性化是权重调整，不是值修改**

- 不能因为"用户想减肥"就把热量摄入数据改小
- 只能调整"热量超标有多严重"（权重调整）
- 健康条件：糖控用户糖指数权重 ×1.5，但糖指数值必须来自真实食物

**P3: 决策系统只提供信号，不主导评分**

- Should Eat 的"不建议吃"只能在特定维度做 -2~3% 调整
- 不能用"决策说高风险"来砍评分
- 反例：决策评出 AVOID，不能因此把该餐评分从 72 改到 52

**P4: 无新增数据库字段**

- 所有融合数据实时计算（内存 + Redis）
- 评分算法、权重值、阈值为配置常量，支持 A/B 测试

**P5: 最大化现有能力复用**

- Analyze 输出 → 食物数据源
- Explain 输出 → 维度分解逻辑
- CoachInsight → 状态文案生成
- 不重复造轮子

---

## 3. 数据融合架构（V1.1 核心）

### 3.1 数据流全景图

```
┌─ 用户饮食 ─────────────────────────────────────────────────────┐
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ food_records (真实行为数据)                             │    │
│  │  └─ [foods, calories, protein, fat, carbs]            │    │
│  │  └─ [quality, satiety] (每食物)                        │    │
│  │  └─ recordedAt, mealType, source                       │    │
│  └────────────────────────────────────────────────────────┘    │
│           ↓                                                      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Analyze Service (数据增强)                            │    │
│  │  └─ Text/Image → 食物库查询 + Nutrition Calc          │    │
│  │  └─ 输出：enriched [quality, glycemicIndex, ...]     │    │
│  └────────────────────────────────────────────────────────┘    │
│           ↓                                                      │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ DailySummaryService (聚合层)                           │    │
│  │  └─ 求和: ∑(calories/protein/fat/carbs)              │    │
│  │  └─ 加权平均: avgQuality, avgSatiety, ...             │    │
│  │  └─ 计数: mealCount, ...                              │    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                             ↓
     ┌──────────────────────────────────────────────────────────────┐
     │           Layer 1: 行为数据输入 (TRUE_DATA)                 │
     │                                                              │
     │  dailySummary {                                             │
     │    totalCalories,     # ← 直接求和，无修改                 │
     │    avgQuality,        # ← 加权平均，缺失=0                 │
     │    avgSatiety,        # ← 同上                             │
     │    avgGlycemicIndex,  # ← 基于食物库的真实值              │
     │    mealCount,                                              │
     │    mealTiming: {hour_distribution},                        │
     │  }                                                          │
     │                                                              │
     │  + BehaviorService {                                        │
     │    streakDays,        # ← 行为序列计算                     │
     │    avgComplianceRate, # ← (达标餐数 / 总餐数)             │
     │    avgMealsPerDay,    # ← 历史平均记录频率                │
     │    bingeDays,         # ← 異常飲食标记日                  │
     │  }                                                          │
     │                                                              │
     │  + ProfileService {                                         │
     │    goals: {calorie, protein, ...},                         │
     │    healthConditions: [...],                                │
     │  }                                                          │
     └──────────────────────────────────────────────────────────────┘
                             ↓
     ┌──────────────────────────────────────────────────────────────┐
     │    Layer 2: 个性化权重 + 上下文调整                          │
     │                                                              │
     │  baseWeights = GOAL_WEIGHTS[goalType]                       │
     │  ├─ 减肥: energy↑, macroBalance↑, satiety↑, cost↓          │
     │  ├─ 增肌: protein↑, energy↑, macroBalance↑                 │
     │  └─ 维持: 均衡                                              │
     │                                                              │
     │  healthConditionAdjustments {                               │
     │    diabetes: {glycemicImpact: ×1.5, energy: ×1.2} 标签     │
     │    hypertension: {sodium_penalty: -5pts}                   │
     │    kidney: {protein_upper_limit: ×0.8}                     │
     │    cholesterol: {max_fat_ratio: ×0.85}                     │
     │  }                                                          │
     │                                                              │
     │  finalWeights = rebalance(baseWeights + healthAdjustments) │
     │  (所有权重和 = 100%)                                        │
     └──────────────────────────────────────────────────────────────┘
                             ↓
     ┌──────────────────────────────────────────────────────────────┐
     │    Layer 3: 7维评分计算（行为 + 个性化）                    │
     │                                                              │
     │  scoreBreakdown {                                           │
     │    energy:        calcEnergyScore(usage, goal, times),      │
     │    macroBalance:  calcMacroScore(p/c/f_ratio, goals),      │
     │    satiety:       calcSatietyScore(avgSatiety),            │
     │    quality:       calcQualityScore(avgQuality),            │
     │    glycemicImpact: calcGlycemicScore(avgGII, period),      │
     │    stability:     calcStabilityScore(streak, compliance),  │
     │    adherence:     calcAdherenceScore(achieve_ratio),       │
     │  }                                                          │
     │                                                              │
     │  // 权重加成：连胜 & 合规率                                 │
     │  if streakDays >= 7:                                        │
     │    stability += min(5, floor(streakDays/7) * 1.5)          │
     │  if avgComplianceRate >= 0.8:                              │
     │    overall += min(2, (complianceRate - 0.8) * 10)          │
     │                                                              │
     │  totalScore = ∑(scoreBreakdown[dimension] \                │
     │                 × finalWeights[dimension]) / 100           │
     └──────────────────────────────────────────────────────────────┘
                             ↓
     ┌──────────────────────────────────────────────────────────────┐
     │    Layer 4: 决策系统信号融合（±2~3%）                       │
     │                                                              │
     │  if FoodDecisionService.evaluate(foods) = AVOID:           │
     │    // 不能大幅改动，只轻微标记                             │
     │    topWeakness = "该餐与建议偏离较大"                       │
     │    explanation_bonus = "但你的整体表现仍然很好"             │
     │  else if SAFE:                                              │
     │    explanation_bonus = "符合建议"                           │
     │                                                              │
     │  finalScore = totalScore × (1 ± 0.02) // 最多±2%           │
     └──────────────────────────────────────────────────────────────┘
                             ↓
     ┌──────────────────────────────────────────────────────────────┐
     │    Layer 5: 状态解释 + 前端呈现                              │
     │                                                              │
     │  statusLabel = getStatusBand(finalScore)                    │
     │  statusExplanation = CoachInsight.buildStatusExplanation(   │
     │    breakdown, goals, goals_achievement,                    │
     │    streak, compliance_rate, decision_signal                │
     │  )                                                          │
     │  topStrength = pickTopDimension(breakdown, 'best')         │
     │  topWeakness = pickTopDimension(breakdown, 'worst')        │
     │  trend = compareTrend(yesterday, today)                     │
     │                                                              │
     │  Response {                                                 │
     │    score: finalScore,                                       │
     │    breakdown: scoreBreakdown,                               │
     │    statusLabel, statusExplanation,                         │
     │    topStrength, topWeakness, trend,                        │
     │    behaviorBonus: {streakDays, complianceRate},            │
     │    compliance: {calorie%, protein%, fat%, carbs%, ...},    │
     │  }                                                          │
     └──────────────────────────────────────────────────────────────┘
```

---

## 4. 核心算法（Layer 1 + 2 + 3）

### 4.1 个性化权重计算

**输入**：goalType + healthConditions

**伪代码**：

```typescript
function computePersonalizedWeights(
  goalType: GoalType,
  healthConditions: string[]
): Record<string, number> {
  // Step 1: 基础权重（按目标）
  let weights = { ...GOAL_WEIGHTS[goalType] };
  // goalType="减肥" ⇒
  //   energy: 30, macroBalance: 25, satiety: 25, quality: 10,
  //   glycemiImpact: 5, stability: 3, adherence: 2

  // Step 2: 健康条件调整
  const conditionMultipliers: Record<string, Record<string, number>> = {
    diabetes: { glycemicImpact: 1.5, energy: 1.2 },
    hypertension: { sodium: 1.2 }, // 新维度，但无数据时跳过
    kidney: { macroBalance: 0.8, protein: 0.7 },
    cholesterol: { macroBalance: 1.3 },
  };

  for (const cond of healthConditions) {
    if (conditionMultipliers[cond]) {
      const mults = conditionMultipliers[cond];
      for (const [dim, mult] of Object.entries(mults)) {
        weights[dim] = (weights[dim] || 0) * mult;
      }
    }
  }

  // Step 3: 重新归一化（权重总和 = 100）
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const normalized: Record<string, number> = {};
  for (const [dim, w] of Object.entries(weights)) {
    normalized[dim] = Math.round((w / sum) * 100 * 100) / 100; // 2位小数
  }

  return normalized;
}
```

**示例**：

- 用户A: 减肥 + 无健康条件 → 标准权重 (energy 30%, satiety 25%, ...)
- 用户B: 减肥 + 糖尿病 → energy 30×1.2=36%, glycemicImpact 5×1.5=7.5%, ... → 归一化后维持总和100%

### 4.2 7维评分公式

**维度 1: Energy (热量)**

```typescript
function calcEnergyScore(
  actualCalories: number,
  targetCalories: number,
  mealCount: number,
  goalType: GoalType
): number {
  const ratio = actualCalories / targetCalories;

  // 目标特定的容忍度
  const toleranceRange = {
    weight_loss: [0.85, 1.0], // 允许 -15% ~ 0%
    muscle_gain: [0.95, 1.1], // 允许 -5% ~ +10%
    maintenance: [0.9, 1.1], // 允许 -10% ~ +10%
  };

  const [lower, upper] = toleranceRange[goalType];
  let score = 100;

  if (ratio < lower) {
    score = 50 + (ratio / lower) * 50; // 低于容忍范围：50~100
  } else if (ratio > upper) {
    score = 100 - Math.min(50, ((ratio - upper) / 0.1) * 50); // 超范围惩罚
  }
  // 在容忍范围内...score = 100

  // 不完整记录惩罚（无 mealType or 明显缺餐）
  if (mealCount < 2) score *= 0.8;

  return Math.round(Math.max(0, Math.min(100, score)));
}
```

**维度 2: MacroBalance (宏量平衡)**

```typescript
function calcMacroScore(
  actualP: number,
  actualF: number,
  actualC: number,
  goalP: number,
  goalF: number,
  goalC: number,
  goalType: GoalType
): number {
  // 计算比例
  const totalCal = actualP * 4 + actualF * 9 + actualC * 4;
  if (totalCal < 100) return 0; // 数据太少

  const pRatio = (actualP * 4) / (totalCal || 1);
  const fRatio = (actualF * 9) / (totalCal || 1);
  const cRatio = (actualC * 4) / (totalCal || 1);

  const goalPRatio = (goalP * 4) / (goalP * 4 + goalF * 9 + goalC * 4);
  const goalFRatio = (goalF * 9) / (goalP * 4 + goalF * 9 + goalC * 4);
  const goalCRatio = (goalC * 4) / (goalP * 4 + goalF * 9 + goalC * 4);

  // 各维度偏差
  const pDeviation = Math.abs(pRatio - goalPRatio);
  const fDeviation = Math.abs(fRatio - goalFRatio);
  const cDeviation = Math.abs(cRatio - goalCRatio);

  // 加权偏差（特定目标权重不同）
  const weights = { protein: 0.4, fat: 0.3, carbs: 0.3 };
  if (goalType === 'muscle_gain') weights.protein = 0.5;
  if (goalType === 'weight_loss') weights.fat = 0.4;

  const totalDeviation =
    pDeviation * weights.protein + fDeviation * weights.fat + cDeviation * weights.carbs;

  // 总偏差 <0.05 ⇒ 满分，>0.15 ⇒ 最低分
  const score = Math.max(0, 100 - totalDeviation * 500);

  return Math.round(score);
}
```

**维度 3: Satiety (饱腹感)**

```typescript
function calcSatietyScore(
  avgSatiety: number, // 1-10 scale, default=3 if missing
  mealCount: number
): number {
  if (mealCount === 0) return 0;
  if (avgSatiety === 0) return 20; // 数据缺失，用中性分

  // 目标：avgSatiety >= 6（饱腹感充分）
  if (avgSatiety >= 6) {
    return 90 + (avgSatiety - 6) * 2; // 6~10 ⇒ 90~100
  } else {
    return avgSatiety * 13.33; // 0~6 → 0~80
  }
}
```

**维度 4: Quality (食物质量)**

```typescript
function calcQualityScore(avgQuality: number, mealCount: number): number {
  if (mealCount === 0) return 0;
  if (avgQuality === 0) return 20; // 数据缺失

  // 加权评价：avgQuality 1-10 scale
  // 6-7 为一般，8-9 为良好，9+ 为优秀
  if (avgQuality >= 8) {
    return 85 + Math.min(15, (avgQuality - 8) * 7.5);
  } else if (avgQuality >= 6) {
    return 50 + (avgQuality - 6) * 17.5;
  } else {
    return avgQuality * 8.33;
  }
}
```

**维度 5: GlycemicImpact (血糖影响)**

```typescript
function calcGlycemicScore(
  avgGlycemicIndex: number,
  period: 'daily' | '7day' | '30day' = 'daily'
): number {
  if (avgGlycemicIndex === 0) return 50; // 无数据

  // 健康 GII < 55, 中等 55-70, 高 >70
  const targetThreshold = 55;
  const maxThreshold = 70;

  if (avgGlycemicIndex <= targetThreshold) {
    return 90 + Math.min(10, (targetThreshold - avgGlycemicIndex) / 10);
  } else if (avgGlycemicIndex <= maxThreshold) {
    // 55~70 ⇒ 50~90
    return 50 + (maxThreshold - avgGlycemicIndex) * 1.6;
  } else {
    // >70 ⇒ 线性惩罚到 0
    return Math.max(0, 50 - (avgGlycemicIndex - maxThreshold) * 2);
  }
}
```

**维度 6: Stability (稳定性)**

```typescript
function calcStabilityScore(
  streakDays: number,
  avgComplianceRate: number,
  avgMealsPerDay: number,
  targetMeals: number = 3
): number {
  let score = 50; // 基础分

  // 连胜加分（7天为一个周期）
  if (streakDays > 0) {
    const streakBonus = Math.min(30, Math.floor(streakDays / 7) * 5 + ((streakDays % 7) / 7) * 5);
    score += streakBonus;
  }

  // 合规率加分
  const complianceBonus = avgComplianceRate * 30; // 0~30
  score += complianceBonus;

  // 餐数规律性
  const mealRegularity = Math.max(0, 20 - Math.abs(avgMealsPerDay - targetMeals) * 10);
  score += mealRegularity;

  return Math.round(Math.min(100, Math.max(0, score)));
}
```

**维度 7: Adherence (目标达成率)**

```typescript
function calcAdherenceScore(
  goalAchievementRate: number // 0-1 range
): number {
  if (goalAchievementRate >= 0.9) {
    return 90 + Math.min(10, (goalAchievementRate - 0.9) * 100);
  } else if (goalAchievementRate >= 0.75) {
    return 70 + (goalAchievementRate - 0.75) * 80;
  } else if (goalAchievementRate >= 0.5) {
    return 40 + (goalAchievementRate - 0.5) * 60;
  } else {
    return goalAchievementRate * 80;
  }
}
```

### 4.3 综合评分 + 行为加成

```typescript
function calculateDailyScore(
  breakdownScores: Record<string, number>, // 7维评分结果
  personalizedWeights: Record<string, number>, // 个性化权重
  streakDays: number,
  avgComplianceRate: number
): { score: number; breakdown: Record<string, number> } {
  // 层1 + 层2：加权求和
  let totalScore = 0;
  for (const [dimension, score] of Object.entries(breakdownScores)) {
    totalScore += score * personalizedWeights[dimension] || 0;
  }
  totalScore /= 100; // 归一化

  // 层3：行为加成（不能超过 +5 分）
  let behaviorBonus = 0;
  if (streakDays >= 7) {
    const streakBonus = Math.min(3, Math.floor(streakDays / 7) * 0.5);
    behaviorBonus += streakBonus;
  }
  if (avgComplianceRate >= 0.85) {
    const complianceBonus = (avgComplianceRate - 0.85) * 10; // 0~1.5
    behaviorBonus += Math.min(2, complianceBonus);
  }

  totalScore += Math.min(5, behaviorBonus);

  return {
    score: Math.round(totalScore),
    breakdown: breakdownScores,
  };
}
```

---

## 5. 状态解释生成（Layer 5 核心）

### 5.1 状态标签定义

```typescript
type StatusBand = 'excellent' | 'good' | 'fair' | 'needsImprovement';

const STATUS_THRESHOLDS = {
  excellent: 80, // ≥80
  good: 65, // 65-79
  fair: 50, // 50-64
  needsImprovement: 0, // <50
};

const STATUS_I18N: Record<StatusBand, Record<string, string>> = {
  excellent: {
    zh: '优秀 🌟',
    en: 'Excellent 🌟',
  },
  good: {
    zh: '良好 ✅',
    en: 'Good ✅',
  },
  fair: {
    zh: '一般 ⚠️',
    en: 'Fair ⚠️',
  },
  needsImprovement: {
    zh: '需改善 ❌',
    en: 'Needs Improvement ❌',
  },
};

function getStatusBand(score: number): StatusBand {
  if (score >= 80) return 'excellent';
  if (score >= 65) return 'good';
  if (score >= 50) return 'fair';
  return 'needsImprovement';
}
```

### 5.2 状态解释生成（融合 CoachInsight）

**伪代码**：

```typescript
async function buildStatusExplanation(
  breakdown: Record<string, number>, // 7维评分
  goals: UserGoals, // 用户目标
  actualIntake: NutrientIntake, // 实际摄入
  streakDays: number,
  avgComplianceRate: number,
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' | null,
  locale: 'zh' | 'en'
): Promise<string> {
  // 步骤 1: 识别强点和弱点
  const dimensions = [
    'energy',
    'macroBalance',
    'satiety',
    'quality',
    'glycemicImpact',
    'stability',
    'adherence',
  ];
  const sorted = dimensions.sort((a, b) => breakdown[b] - breakdown[a]);
  const topStrength = sorted[0];
  const topWeakness = sorted[dimensions.length - 1];

  // 步骤 2: 生成基础文案
  let explanation = '';

  if (breakdown['energy'] >= 80) {
    explanation += locale === 'zh' ? '热量摄入适度，符合目标。\n' : 'Calorie intake is on target. ';
  } else if (breakdown['energy'] < 30) {
    explanation +=
      locale === 'zh'
        ? '⚠️ 今日热量摄入不足，建议加餐。\n'
        : '⚠️ Calorie intake is too low. Consider adding a meal. ';
  }

  if (breakdown['satiety'] >= 75) {
    explanation +=
      locale === 'zh' ? '饱腹感充分，选择恰当。\n' : 'Good satiety. Choices were satisfying. ';
  } else if (breakdown['satiety'] < 40) {
    explanation +=
      locale === 'zh'
        ? '⚠️ 饱腹感不足，可增加纤维/蛋白质。\n'
        : '⚠️ Low satiety. Consider adding fiber or protein. ';
  }

  // 步骤 3: 融合行为信号
  if (streakDays >= 14) {
    explanation +=
      locale === 'zh'
        ? `连胜 ${streakDays} 天 🔥，坚持很棒！\n`
        : `${streakDays} days streak 🔥 Keep it up! `;
  }

  if (avgComplianceRate >= 0.9) {
    explanation +=
      locale === 'zh'
        ? `目标达成率 ${Math.round(avgComplianceRate * 100)}%，接近完美！\n`
        : `${Math.round(avgComplianceRate * 100)}% goal achievement. Nearly perfect! `;
  }

  // 步骤 4: 融合决策信号
  if (decision === 'AVOID' && breakdown[topWeakness] < 50) {
    explanation +=
      locale === 'zh'
        ? `💡 今日餐食与建议有偏离，${topWeakness} 维度是主要原因。\n`
        : `💡 Today's meals deviate from recommendations. "${topWeakness}" is the main concern. `;
  } else if (decision === 'SAFE') {
    explanation +=
      locale === 'zh' ? '✅ 符合营养建议。\n' : '✅ Aligned with nutrition recommendations. ';
  }

  // 步骤 5: 针对最弱维度给建议
  const improvementTips: Record<string, Record<string, string>> = {
    satiety: {
      zh: '建议下餐增加高纤维或高蛋白食物。',
      en: 'Next meal: add high-fiber or high-protein foods.',
    },
    energy: {
      zh: '热量偏低，建议加餐或增加份量。',
      en: 'Calories are low. Add a snack or increase portions.',
    },
    glycemicImpact: {
      zh: '血糖波动较大，建议选择低GI食物。',
      en: 'Blood sugar impact is high. Choose low-GI foods.',
    },
  };

  if (improvementTips[topWeakness]) {
    explanation += `\n💡 ${improvementTips[topWeakness][locale]}`;
  }

  return explanation.trim();
}
```

### 5.3 API Response 结构（enhanced)

```typescript
interface NutritionScoreResponse {
  // 基础分数
  score: number; // 0-100
  breakdown: {
    energy: number;
    macroBalance: number;
    satiety: number;
    quality: number;
    glycemicImpact: number;
    stability: number;
    adherence: number;
  };

  // V1.1 新增：状态解释
  statusLabel: {
    zh: string;
    en: string;
  };
  statusExplanation: string; // 本地化多行文案

  // 强弱点分析
  topStrength: {
    dimension: string;
    score: number;
    insight: string;
  };
  topWeakness: {
    dimension: string;
    score: number;
    suggestion: string;
  };

  // 行为奖励
  behaviorBonus: {
    streakDays: number;
    complianceRate: number;
    bonusPoints: number;
  };

  // 合规性对比（行为 vs 建议）
  complianceInsights: {
    calorieAdherence: number; // 实际 / 目标 × 100%
    proteinAdherence: number;
    fatAdherence: number;
    carbsAdherence: number;
    trend: 'up' | 'down' | 'stable'; // vs 昨日
  };

  // 决策系统信号
  decisionSignal: {
    overall: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' | null;
    riskFactors?: string[];
  };

  // 用户目标
  goals: {
    calorie: number;
    protein: number;
    fat: number;
    carbs: number;
  };

  // 实际摄入
  intake: {
    calorie: number;
    protein: number;
    fat: number;
    carbs: number;
    mealCount: number;
  };
}
```

---

## 6. 迭代实施路线（分阶段）

### Phase 1: 数据质量修复 (P0 - 1周)

**目标**：消除虚假评分，让 Layer 1 数据真实可信

| 改动                                     | 文件                         | 优先级 |
| ---------------------------------------- | ---------------------------- | ------ |
| 注入 BehaviorService，获取真实 stability | daily-summary.service.ts     | P0     |
| 修复 foodQuality/satiety fallback 逻辑   | nutrition-score.service.ts   | P0     |
| 在 controller 层处理"无记录"case         | food-nutrition.controller.ts | P0     |
| 新增 healthScore 维度计算                | nutrition-score.service.ts   | P0     |

**检验**：

- 测试用户无记录 → score=0（不是 50）
- 测试用户有记录但 quality=0 → 维度权重分摊，不虚高
- 测试稳定性维度 ≠80（用真实数据）

### Phase 2: 个性化增强 (P1 - 1.5周)

**目标**：根据 healthConditions 调整权重，纳入行为加成

| 改动                              | 文件                       | 优先级 |
| --------------------------------- | -------------------------- | ------ |
| 实现 computePersonalizedWeights() | nutrition-score.service.ts | P1     |
| 糖尿病 / 高血压 / 肾病条件处理    | nutrition-score.service.ts | P1     |
| 融入连胜加分和合规率指标          | nutrition-score.service.ts | P1     |
| 在 daily-summary 自动流调用       | daily-summary.service.ts   | P1     |

**检验**：

- 对糖尿病用户，glycemicImpact 权重应 ×1.5
- 连胜 14 天应有 +3pt 加成
- 权重总和恒为 100%

### Phase 3: 解释性增强 (P2 - 1周)

**目标**：生成自然语言状态解释，支持多语言

| 改动                           | 文件                                        | 优先级 |
| ------------------------------ | ------------------------------------------- | ------ |
| 实现 buildStatusExplanation()  | nutrition-score.service.ts (或分出 service) | P2     |
| 识别 topStrength / topWeakness | nutrition-score.service.ts                  | P2     |
| 增强 API response              | food-nutrition.controller.ts                | P2     |
| 前端适配新字段                 | web/pages/nutrition-score                   | P2     |

**检验**：

- 分数 85 以上 → statusLabel 应为"优秀"
- 饱腹感最低 → topWeakness + suggestion
- 文案应当包含具体建议

### Phase 4: 决策系统融合 (P3 - 1周，可并行 P2)

**目标**：将 FoodDecisionService 结果作为轻微调整信号

| 改动                                     | 文件                         | 优先级 |
| ---------------------------------------- | ---------------------------- | ------ |
| 在 controller 层注入 FoodDecisionService | food-nutrition.controller.ts | P3     |
| 将决策结果附加到 response                | food-nutrition.controller.ts | P3     |
| 可选：±2% 分数调整                       | nutrition-score.service.ts   | P3     |

**检验**：

- Decide 结果为 AVOID 时，score 不应大幅下降（最多 ±2%）
- Decide 结果必须作为"信号"，不是"结论"

---

## 7. 详细改动清单

### 7.1 nutrition-score.service.ts

**新增方法**：

```typescript
// 个性化权重计算
computePersonalizedWeights(
  goalType: GoalType,
  healthConditions: string[]
): Record<string, number>

// 7维评分（现有方法改进）
calcBreakdown(dailySummary, behaviorData): Record<string, number>

// 综合评分 + 行为加成
calculateDailyScore(breakdown, weights, streak, compliance): ScoreResult

// 状态解释生成（新增）
async buildStatusExplanation(...): Promise<string>

// 行为加成计算（新增）
private calcBehaviorBonus(streak, compliance): number
```

**改进项**：

1. 修复 fallback 逻辑：`avgQuality || 3` → `avgQuality > 0 ? avgQuality : 0`
2. 添加 healthConditions 参数到 `calculateScore`
3. 健康条件权重调整的 for 循环 + 归一化
4. 每个维度公式加入"无数据"case

### 7.2 daily-summary.service.ts

**改动**：

- 新增 BehaviorService 依赖注入
- 在 `updateDailySummary` 中调用 `behaviorService.getProfile(userId)` 获取 stabilityData
- 将 stabilityData 传给 `nutritionScoreService.calculateScore(..., stabilityData, healthConditions)`
- 新增 healthScore 计算（复用 nutrition-score 逻辑）

### 7.3 food-nutrition.controller.ts

**改动**：

- 新增 BehaviorService 依赖注入
- `getNutritionScore` 法中：
  1. 获取 dailySummary
  2. 获取 BehaviorService.getProfile(userId)
  3. 调用 `nutritionScoreService.calculateScore(..., stabilityData, healthConditions)`
  4. 调用 `buildStatusExplanation(...)` 生成文案
  5. 可选：注入 FoodDecisionService，获取决策信号
  6. 构建 enriched response

---

## 8. 数据库 Schema（不需修改）

所有新增数据均实时计算，无需数据库变更：

```sql
-- 现有表无改动

-- daily_summaries 概念扩展（查询时实时计算）：
-- - avgQuality, avgSatiety （已有，保持）
-- - idealWeights (计算: 每次请求时算)
-- - finalScore (计算: 每次请求时算)
-- - statusLabel (计算: 每次请求时算)

-- BehaviorService 数据已在现有表中：
-- - user_behavior.streak_days
-- - user_behavior.compliance_rate
-- - 等（假设已存在）
```

---

## 9. 性能与缓存策略

### 9.1 实时计算部分

- **calculateScore** 涉及 7 维逻辑，响应时间 <50ms （内存算）
- **buildStatusExplanation** 字符串拼接 <10ms

### 9.2 缓存建议（可选）

```typescript
// daily_summaries 每小时更新一次（异步 job）
// nutrition-score endpoint 可 Redis 缓存 30 分钟
@CacheKey(`nutrition-score:${userId}:${dateYYYYMMDD}`)
@CacheTTL(1800) // 30 分钟
async getNutritionScore(userId, date): Promise<Response> { ... }
```

---

## 10. 测试用例

### 10.1 单元测试（nutrition-score.service 核心算法）

```typescript
describe('NutritionScoreService', () => {
  // Layer 1: 行为数据真实性
  it('should return 0 for empty records', () => {
    const score = service.calculateDailyScore({}, {}, 0, 0);
    expect(score.score).toBe(0);
  });

  it('should use real avgQuality, not default 3', () => {
    const result = service.calcBreakdown({
      avgQuality: 0,
      mealCount: 1,
      ...
    });
    expect(result.quality).toBeLessThan(50); // 非虚高
  });

  // Layer 2: 个性化权重
  it('should adjust weights for diabetes', () => {
    const weights = service.computePersonalizedWeights(
      'maintenance',
      ['diabetes']
    );
    expect(weights['glycemicImpact']).toBeGreaterThan(
      GOAL_WEIGHTS.maintenance.glycemicImpact
    );
  });

  // Layer 3: 决策融合（非主导）
  it('should not override score based on decision alone', () => {
    const baseScore = 72;
    const decision = 'AVOID';
    const adjusted = service.adjustByDecision(baseScore, decision);
    expect(Math.abs(adjusted - baseScore)).toBeLessThanOrEqual(2); // ±2%
  });

  // 行为加成
  it('should add bonus for streak >= 7 days', () => {
    const bonus1 = service.calcBehaviorBonus(7, 0.8);
    const bonus0 = service.calcBehaviorBonus(6, 0.8);
    expect(bonus1).toBeGreaterThan(bonus0);
  });
});
```

### 10.2 集成测试（API 端点）

```typescript
describe('GET /nutrition-score', () => {
  it('should return enriched response with explanation', async () => {
    const res = await request(app)
      .get('/api/app/food/nutrition-score')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data).toMatchObject({
      score: expect.any(Number),
      breakdown: expect.any(Object),
      statusLabel: expect.any(Object),
      statusExplanation: expect.any(String),
      topStrength: expect.any(Object),
      topWeakness: expect.any(Object),
      behaviorBonus: expect.any(Object),
    });
  });

  it('statusExplanation should be non-empty for valid scores', async () => {
    const res = await request(app).get('/api/app/food/nutrition-score').set(...);
    expect(res.body.data.statusExplanation).not.toBe('');
    expect(res.body.data.statusExplanation.length).toBeGreaterThan(10);
  });
});
```

---

## 11. 向后兼容性

- ✅ 前端现有字段不变（score, breakdown 保持）
- ✅ 新增字段：statusLabel, statusExplanation, topStrength, etc.（可选消费）
- ✅ 旧客户端忽略新字段，无功能退化

---

## 12. 长期迭代方向（V2+）

1. **食物多样性维度**：7 天内不重复食物数量
2. **微量营养素**：当食物库补充维B/钙/铁时
3. **周期评分**：7天/月度聚合趋势
4. **AI 生成文案**：用 LLM 替代模板
5. **社交排名**：同目标用户百分位

---

## 13. 快速参考：关键参数

| 参数             | 默认值             | 调节方式                          |
| ---------------- | ------------------ | --------------------------------- |
| 饱腹感阈值       | 6                  | `SATIETY_TARGET` 常量             |
| 热量容忍度       | [0.85, 1.0] (减肥) | `TOLERANCE_RANGE` by goalType     |
| 健康条件权重倍数 | 1.5 (glycemic)     | `CONDITION_MULTIPLIERS` map       |
| 连胜加分周期     | 7天                | `STREAK_PERIOD` 常量              |
| 合规率加分阈值   | 0.85               | `COMPLIANCE_BONUS_THRESHOLD` 常量 |
| 决策系统影响范围 | ±2%                | `DECISION_ADJUSTMENT_RANGE` 常量  |
| 状态分阶         | [50, 65, 80]       | `STATUS_THRESHOLDS` map           |

所有参数均为配置常量，支持 A/B 测试和动态调参。

---

## 14. 快速启动 Checklist

- [ ] 1. 完成 Phase 1（数据质量）
- [ ] 2. 本地测试：用户无记录 → score=0
- [ ] 3. 本地测试：用户有记录 quality=0 → 权重分摊
- [ ] 4. 完成 Phase 2（个性化）
- [ ] 5. 测试糖尿病用户权重调整
- [ ] 6. 测试连胜加分逻辑
- [ ] 7. 完成 Phase 3（解释性）
- [ ] 8. 前端展示新字段（statusLabel/explanation）
- [ ] 9. 多语言测试（zh/en）
- [ ] 10. 性能基准测试（Q95 < 100ms）
- [ ] 11. UAT：真实用户反馈迭代
- [ ] 12. 发布到生产 (feature flag)

---

**文档版本历史**：

- V1.0 (2024-Q1): 初版设计方案
- V1.1 (2026-04-17): 强化数据融合架构、公式细化、状态解释完善
