# 🍎 多维营养评分优化方案 — 完整实施文档

> **版本**：v2.0 | **日期**：2026-04-08
>
> **核心变更**：系统从「仅热量驱动」升级为「6 维去耦合营养评分 + 目标权重 + 惩罚机制」体系

---

## 目录

- [一、现状问题分析](#一现状问题分析)
- [二、6 维营养模型设计（去耦合版）](#二6-维营养模型设计去耦合版)
- [三、目标权重评分算法](#三目标权重评分算法)
- [四、数据库变更方案](#四数据库变更方案)
- [五、后端实现方案](#五后端实现方案)
- [六、AI Prompt 升级方案](#六ai-prompt-升级方案)
- [七、前端展示方案](#七前端展示方案)
- [八、文件变更清单](#八文件变更清单)
- [九、实施步骤](#九实施步骤)

---

## 一、现状问题分析

### 1.1 现有 FoodItem 数据结构

```typescript
// 当前 food-record.entity.ts 中的 FoodItem
interface FoodItem {
  name: string;
  calories: number;     // ← 只有热量
  quantity?: string;
  category?: string;
}
```

### 1.2 现有 DailySummary 只追踪热量

```typescript
// 当前 daily-summary.entity.ts
totalCalories: number;      // ← 只有总热量
calorieGoal: number | null; // ← 只有热量目标
mealCount: number;
```

### 1.3 现有 AI 分析只看热量做决策

```
决策规则（当前）：
- SAFE: 剩余热量充足 + 食物清淡
- LIMIT: 剩余热量 <30%
- AVOID: 已超标
→ 完全基于热量单一维度
```

### 1.4 现有每日计划只分配热量预算

```typescript
// 当前 daily-plan.service.ts
const morningBudget = Math.round(goal * 0.25); // 纯热量
const lunchBudget = Math.round(goal * 0.35);
```

### 1.5 核心问题总结

| 问题 | 影响 |
|------|------|
| 只看热量，忽略蛋白质/脂肪/碳水 | 用户可能热量达标但蛋白质严重不足 |
| 减脂/增肌/健康用户用相同逻辑 | 增肌用户需要高蛋白，但系统无法给出差异化建议 |
| 食物质量未评估 | 200kcal 薯片 vs 200kcal 鸡胸肉，系统认为等价 |
| 饱腹感未考虑 | 推荐低卡但不饱腹的食物，用户容易饿了暴食 |
| 每日状态只展示卡路里进度条 | 用户无法看到蛋白质、脂肪是否达标 |

---

## 二、6 维营养模型设计（去耦合版）

### 2.1 评分维度定义

> **设计原则**：每个维度独立评分互不耦合，碳水与脂肪合并为「宏量结构」统一评估比例合理性

| 维度 | 字段名 | 评分方式 | 数据来源 | 说明 |
|------|--------|---------|---------|------|
| **热量合理性** | `energy` | 偏差法：\|实际-目标\|/目标 | AI 识别 + 后端计算 | 越接近目标越高分 |
| **蛋白质占比** | `proteinRatio` | 区间法：蛋白质热量/总热量 | AI 识别 + 后端计算 | 按目标类型设不同理想区间 |
| **宏量结构** | `macroBalance` | 区间法：碳水%+脂肪%合理性 | AI 识别 + 后端计算 | 碳水 40-55%、脂肪 20-30% |
| **食物质量** | `foodQuality` | 直接映射：1-10 → 10-100 | AI 综合评估 | 加工程度/天然度/营养密度 |
| **饱腹感** | `satiety` | 直接映射：1-10 → 10-100 | AI 综合评估 | 纤维/蛋白/体积/消化速度 |
| **饮食稳定性** | `stability` | 规则计算 | 后端历史数据 | 连续记录天数 + 餐次规律性（可选） |

### 2.2 FoodItem 扩展结构

```typescript
interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  // 新增营养数据（AI 返回）
  protein?: number;     // 蛋白质 g
  fat?: number;         // 脂肪 g
  carbs?: number;       // 碳水 g
  quality?: number;     // 食物质量 1-10
  satiety?: number;     // 饱腹感 1-10
}
```

### 2.3 质量分与饱腹分评估标准（提供给 AI 的规则）

**食物质量评分标准（`quality`, 1-10 分）**：

| 分数区间 | 标准 | 示例 |
|----------|------|------|
| 9-10 | 天然、未加工、高营养密度 | 水煮蛋、三文鱼刺身、西兰花、蓝莓 |
| 7-8 | 轻加工、营养保留好 | 烤鸡胸、糙米饭、酸奶（无糖） |
| 5-6 | 中度加工、有添加剂 | 白米饭、普通面包、炒菜（少油） |
| 3-4 | 深度加工、高油高糖 | 炸鸡、红烧肉、蛋糕 |
| 1-2 | 超加工食品、几乎无营养 | 薯片、碳酸饮料、方便面 |

**饱腹感评分标准（`satiety`, 1-10 分）**：

| 分数区间 | 标准 | 示例 |
|----------|------|------|
| 9-10 | 高蛋白+高纤维+大体积 | 鸡胸肉+大量蔬菜、燕麦粥 |
| 7-8 | 中等蛋白或纤维 | 米饭+肉菜、全麦三明治 |
| 5-6 | 一般饱腹 | 普通炒饭、面条 |
| 3-4 | 低饱腹/快速消化 | 甜品、白面包、果汁 |
| 1-2 | 几乎无饱腹 | 碳酸饮料、糖果 |

---

## 三、目标权重评分算法

### 3.1 评分输入结构

```typescript
type NutritionInput = {
  calories: number;         // 实际摄入热量 kcal
  targetCalories: number;   // 目标热量 kcal
  protein: number;          // 蛋白质 g
  carbs: number;            // 碳水 g
  fat: number;              // 脂肪 g
  foodQuality: number;      // 食物质量 1-10
  satiety: number;          // 饱腹感 1-10
}

type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';
```

### 3.2 权重配置（按用户目标）

```typescript
const GOAL_WEIGHTS: Record<GoalType, NutritionWeights> = {
  fat_loss: {
    energy: 0.35,          // 热量控制是减脂核心
    proteinRatio: 0.25,    // 高蛋白保肌减脂
    macroBalance: 0.15,    // 控碳水、控脂肪
    foodQuality: 0.10,     // 远离加工食品
    satiety: 0.10,         // 吃饱防暴食
    stability: 0.05,       // 坚持记录
  },
  muscle_gain: {
    proteinRatio: 0.30,    // 蛋白质第一优先
    energy: 0.25,          // 热量必须够
    macroBalance: 0.20,    // 碳水供能、脂肪适宜
    foodQuality: 0.10,     // 干净增肌
    satiety: 0.05,         // 次要
    stability: 0.10,       // 规律饮食很重要
  },
  health: {
    foodQuality: 0.30,     // 食物天然度最高优先
    macroBalance: 0.20,    // 营养均衡
    energy: 0.15,          // 不超标即可
    satiety: 0.15,         // 舒适不饿
    proteinRatio: 0.10,    // 适量蛋白
    stability: 0.10,       // 规律饮食
  },
  habit: {
    foodQuality: 0.25,     // 减少垃圾食品
    satiety: 0.20,         // 不饿才能坚持
    energy: 0.20,          // 大方向控制
    proteinRatio: 0.15,    // 适量蛋白
    macroBalance: 0.10,    // 粗略均衡
    stability: 0.10,       // 养成习惯
  },
};
```

### 3.3 基础工具函数

```typescript
function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * 区间评分：值在 [min, max] 范围内得满分，偏离越远扣分越多
 */
function rangeScore(value: number, min: number, max: number): number {
  if (value >= min && value <= max) return 100;
  const diff = value < min ? min - value : value - max;
  return clamp(100 - diff * 200); // 偏差每 0.01 扣 2 分
}
```

### 3.4 各维度评分算法

#### ① 热量合理性（Energy Score）

```typescript
/**
 * 偏差法评分：实际热量与目标热量的偏差越小越好
 *
 *   偏差 ±5%  → ≈ 95 分
 *   偏差 ±20% → ≈ 80 分
 *   偏差 >50% → 低分
 */
function calcEnergyScore(actual: number, target: number): number {
  if (target <= 0) return 80;
  return clamp(100 - (Math.abs(actual - target) / target) * 100);
}
```

#### ② 蛋白质占比（Protein Ratio Score）

```typescript
/**
 * 蛋白质热量占总热量的比例，按目标类型设定理想区间
 *
 *   减脂：25%-35%（高蛋白保肌）
 *   增肌：25%-40%（肌肉合成需要）
 *   健康：15%-25%（均衡即可）
 *   习惯：15%-30%（宽松）
 */
function calcProteinRatioScore(
  protein: number,
  calories: number,
  goal: GoalType,
): number {
  if (calories <= 0) return 80;
  const proteinCalories = protein * 4;
  const ratio = proteinCalories / calories;

  const ranges: Record<GoalType, [number, number]> = {
    fat_loss:     [0.25, 0.35],
    muscle_gain:  [0.25, 0.40],
    health:       [0.15, 0.25],
    habit:        [0.15, 0.30],
  };

  const [min, max] = ranges[goal];
  return rangeScore(ratio, min, max);
}
```

#### ③ 宏量结构（Macro Balance Score）

```typescript
/**
 * 碳水和脂肪的热量占比是否合理
 * 理想范围：碳水 40-55%，脂肪 20-30%
 * 取两者的平均分
 */
function calcMacroScore(
  carbs: number,
  fat: number,
  calories: number,
): number {
  if (calories <= 0) return 80;
  const carbRatio = (carbs * 4) / calories;
  const fatRatio = (fat * 9) / calories;

  const carbScore = rangeScore(carbRatio, 0.40, 0.55);
  const fatScore = rangeScore(fatRatio, 0.20, 0.30);

  return (carbScore + fatScore) / 2;
}
```

#### ④ 食物质量（Food Quality Score）

```typescript
/** AI 返回 1-10 → 映射到 10-100 */
function calcFoodQualityScore(quality: number): number {
  return clamp(quality * 10, 0, 100);
}
```

#### ⑤ 饱腹感（Satiety Score）

```typescript
/** AI 返回 1-10 → 映射到 10-100 */
function calcSatietyScore(satiety: number): number {
  return clamp(satiety * 10, 0, 100);
}
```

#### ⑥ 饮食稳定性（Stability Score，可选）

```typescript
/**
 * 基于历史数据计算：
 * - 连续记录天数（streak）
 * - 餐次规律性
 */
function calcStabilityScore(
  streakDays: number,
  avgMealsPerDay: number,
  targetMeals: number,
): number {
  // 连胜分：满 7 天 → 50 分，满 30 天 → 满分
  const streakScore = clamp(
    streakDays >= 30 ? 100 : streakDays >= 7 ? 50 + (streakDays - 7) * (50 / 23) : streakDays * (50 / 7)
  );
  // 餐次规律分：每天 3 餐 → 100%，偏差扣分
  const mealRegularity = targetMeals > 0
    ? clamp(100 - Math.abs(avgMealsPerDay - targetMeals) / targetMeals * 100)
    : 80;

  return Math.round((streakScore + mealRegularity) / 2);
}
```

### 3.5 惩罚机制（关键）

> 当出现极端偏差时，在总分基础上乘以惩罚系数，避免「均分掩盖极端问题」

```typescript
function applyPenalties(
  score: number,
  input: NutritionInput,
): number {
  let penalized = score;

  // 🚨 热量严重超标（>130%）→ 总分 ×0.7
  if (input.calories > input.targetCalories * 1.3) {
    penalized *= 0.7;
  }

  // 🚨 蛋白质严重不足（占比 <10%）→ 总分 ×0.8
  if (input.calories > 0) {
    const proteinRatio = (input.protein * 4) / input.calories;
    if (proteinRatio < 0.10) {
      penalized *= 0.8;
    }
  }

  // 🚨 食物质量极差（均分 <2）→ 总分 ×0.85
  if (input.foodQuality < 2) {
    penalized *= 0.85;
  }

  return Math.round(penalized);
}
```

### 3.6 综合评分函数（完整实现）

```typescript
export function calculateNutritionScore(
  input: NutritionInput,
  goal: GoalType,
  stabilityData?: { streakDays: number; avgMealsPerDay: number; targetMeals: number },
): {
  score: number;
  breakdown: NutritionScoreBreakdown;
  highlights: string[];
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
} {
  // === 1. 各维度评分 ===
  const energy = calcEnergyScore(input.calories, input.targetCalories);

  const proteinRatio = calcProteinRatioScore(
    input.protein, input.calories, goal,
  );

  const macroBalance = calcMacroScore(
    input.carbs, input.fat, input.calories,
  );

  const foodQuality = calcFoodQualityScore(input.foodQuality);

  const satiety = calcSatietyScore(input.satiety);

  const stability = stabilityData
    ? calcStabilityScore(stabilityData.streakDays, stabilityData.avgMealsPerDay, stabilityData.targetMeals)
    : 80; // 无数据时给中等分

  // === 2. 加权求和 ===
  const weights = GOAL_WEIGHTS[goal];
  let score =
    energy * weights.energy +
    proteinRatio * weights.proteinRatio +
    macroBalance * weights.macroBalance +
    foodQuality * weights.foodQuality +
    satiety * weights.satiety +
    stability * weights.stability;

  // === 3. 惩罚机制 ===
  score = applyPenalties(score, input);

  // === 4. 生成 highlights（最多 3 条） ===
  const highlights = generateHighlights(
    { energy, proteinRatio, macroBalance, foodQuality, satiety, stability },
    input, goal,
  );

  // === 5. 评分 → 决策映射 ===
  const decision = scoreToDecision(score);

  return {
    score: Math.round(score),
    breakdown: { energy, proteinRatio, macroBalance, foodQuality, satiety, stability },
    highlights,
    decision,
  };
}
```

### 3.7 评分 → 决策映射

```typescript
function scoreToDecision(score: number): 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' {
  if (score >= 75) return 'SAFE';    // 🟢 放心吃
  if (score >= 55) return 'OK';      // 🟡 注意份量
  if (score >= 35) return 'LIMIT';   // 🟠 建议少吃
  return 'AVOID';                     // 🔴 不建议
}
```

### 3.8 Highlights 生成（可解释性）

```typescript
function generateHighlights(
  scores: NutritionScoreBreakdown,
  input: NutritionInput,
  goal: GoalType,
): string[] {
  const highlights: string[] = [];

  // 正面
  if (scores.energy >= 85) highlights.push('✅ 热量控制良好');
  if (scores.proteinRatio >= 85) highlights.push('✅ 蛋白质摄入充足');
  if (scores.macroBalance >= 85) highlights.push('✅ 营养结构均衡');
  if (scores.foodQuality >= 80) highlights.push('✅ 食物品质优秀');

  // 负面（优先展示）
  if (input.calories > input.targetCalories * 1.3) {
    highlights.unshift('⚠️ 热量严重超标');
  } else if (scores.energy < 60) {
    highlights.unshift('⚠️ 热量偏离目标');
  }

  if (scores.proteinRatio < 50) {
    highlights.unshift('⚠️ 蛋白质严重不足');
  } else if (scores.proteinRatio < 70) {
    highlights.unshift('⚠️ 蛋白质偏低');
  }

  if (scores.macroBalance < 50) highlights.unshift('⚠️ 碳水/脂肪比例失衡');
  if (scores.foodQuality < 40) highlights.unshift('⚠️ 加工食品偏多');
  if (scores.satiety < 40) highlights.unshift('⚠️ 饱腹感不足，容易饿');

  return highlights.slice(0, 3); // 最多返回 3 条
}
```

### 3.9 每日营养目标计算

```typescript
interface DailyNutritionGoals {
  calories: number;    // kcal
  protein: number;     // g
  fat: number;         // g
  carbs: number;       // g
  quality: number;     // 目标均分 (>=7)
  satiety: number;     // 目标均分 (>=6)
}

function calculateDailyGoals(profile: UserProfile): DailyNutritionGoals {
  const weight = profile.weightKg || 65;
  const calorieGoal = profile.dailyCalorieGoal || 2000;
  const goal = profile.goal || 'health';

  // 蛋白质目标 (g) = 体重 × 系数
  const proteinPerKg: Record<GoalType, number> = {
    fat_loss: 2.0, muscle_gain: 2.2, health: 1.3, habit: 1.1,
  };
  const protein = Math.round(weight * (proteinPerKg[goal] || 1.3));

  // 脂肪目标 (g) = 热量 × 脂肪比例 / 9
  const fatPercent: Record<GoalType, number> = {
    fat_loss: 0.22, muscle_gain: 0.22, health: 0.28, habit: 0.28,
  };
  const fat = Math.round((calorieGoal * (fatPercent[goal] || 0.25)) / 9);

  // 碳水 (g) = 剩余热量 / 4
  const carbsCalories = calorieGoal - protein * 4 - fat * 9;
  const carbs = Math.round(Math.max(carbsCalories, 0) / 4);

  return { calories: calorieGoal, protein, fat, carbs, quality: 7, satiety: 6 };
}
```

### 3.10 返回结构定义

```typescript
type NutritionScoreBreakdown = {
  energy: number;         // 热量合理性 0-100
  proteinRatio: number;   // 蛋白质占比 0-100
  macroBalance: number;   // 宏量结构 0-100
  foodQuality: number;    // 食物质量 0-100
  satiety: number;        // 饱腹感 0-100
  stability: number;      // 饮食稳定性 0-100
}

// 完整返回示例
{
  score: 78,
  breakdown: {
    energy: 85,
    proteinRatio: 60,
    macroBalance: 70,
    foodQuality: 80,
    satiety: 75,
    stability: 90,
  },
  highlights: [
    '⚠️ 蛋白质偏低',
    '✅ 热量控制良好',
    '✅ 食物品质优秀',
  ],
  decision: 'SAFE',
}
```

---

## 四、数据库变更方案

### 4.1 新增 Migration: `1750000000000-AddNutritionDimensions`

```sql
-- ========================================
-- 1. food_records.foods JSONB 中的 FoodItem 结构扩展
--    （JSONB 不需要 ALTER COLUMN，只需后端代码和 AI prompt 变更）
--
-- 2. food_records 新增餐食级营养汇总字段
-- ========================================

ALTER TABLE food_records
  ADD COLUMN IF NOT EXISTS total_protein DECIMAL(6,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fat DECIMAL(6,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_carbs DECIMAL(6,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_quality DECIMAL(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_satiety DECIMAL(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nutrition_score INT DEFAULT 0;

COMMENT ON COLUMN food_records.total_protein IS '本餐总蛋白质 g';
COMMENT ON COLUMN food_records.total_fat IS '本餐总脂肪 g';
COMMENT ON COLUMN food_records.total_carbs IS '本餐总碳水 g';
COMMENT ON COLUMN food_records.avg_quality IS '本餐食物平均质量分 1-10';
COMMENT ON COLUMN food_records.avg_satiety IS '本餐食物平均饱腹感 1-10';
COMMENT ON COLUMN food_records.nutrition_score IS '本餐综合营养评分 0-100';

-- ========================================
-- 3. daily_summaries 新增多维汇总字段
-- ========================================

ALTER TABLE daily_summaries
  ADD COLUMN IF NOT EXISTS total_protein DECIMAL(7,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fat DECIMAL(7,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_carbs DECIMAL(7,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_quality DECIMAL(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_satiety DECIMAL(3,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nutrition_score INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS protein_goal DECIMAL(6,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fat_goal DECIMAL(6,1) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carbs_goal DECIMAL(6,1) DEFAULT 0;

COMMENT ON COLUMN daily_summaries.total_protein IS '今日总蛋白质 g';
COMMENT ON COLUMN daily_summaries.total_fat IS '今日总脂肪 g';
COMMENT ON COLUMN daily_summaries.total_carbs IS '今日总碳水 g';
COMMENT ON COLUMN daily_summaries.avg_quality IS '今日食物平均质量分';
COMMENT ON COLUMN daily_summaries.avg_satiety IS '今日食物平均饱腹感';
COMMENT ON COLUMN daily_summaries.nutrition_score IS '今日综合营养评分 0-100';
COMMENT ON COLUMN daily_summaries.protein_goal IS '今日蛋白质目标 g';
COMMENT ON COLUMN daily_summaries.fat_goal IS '今日脂肪目标 g';
COMMENT ON COLUMN daily_summaries.carbs_goal IS '今日碳水目标 g';

-- ========================================
-- 4. daily_plans 的 MealPlan JSONB 结构扩展
--    （JSONB 不需要 ALTER COLUMN）
--    新结构: { foods, calories, protein, fat, carbs, tip }
-- ========================================
```

### 4.2 实体变更总结

| 实体 | 变更类型 | 新增字段 |
|------|---------|---------|
| `FoodRecord` | 新增列 | `totalProtein`, `totalFat`, `totalCarbs`, `avgQuality`, `avgSatiety`, `nutritionScore` |
| `DailySummary` | 新增列 | `totalProtein`, `totalFat`, `totalCarbs`, `avgQuality`, `avgSatiety`, `nutritionScore`, `proteinGoal`, `fatGoal`, `carbsGoal` |
| `FoodItem` (接口) | 扩展属性 | `protein`, `fat`, `carbs`, `quality`, `satiety` |
| `MealPlan` (接口) | 扩展属性 | `protein`, `fat`, `carbs` |
| `AnalysisResult` (接口) | 扩展属性 | `totalProtein`, `totalFat`, `totalCarbs`, `avgQuality`, `avgSatiety`, `nutritionScore`, `scoreBreakdown`, `highlights` |

---

## 五、后端实现方案

### 5.1 新建营养评分服务 `nutrition-score.service.ts`

```
位置: apps/api-server/src/app/services/nutrition-score.service.ts
```

职责：
- 根据用户档案计算每日各维度营养目标
- 计算单餐/每日综合评分（偏差法 + 区间法 + 惩罚机制）
- 生成 highlights 和决策建议

```typescript
import { Injectable } from '@nestjs/common';
import { UserProfile, GoalType } from '../../entities/user-profile.entity';

// ==================== 类型 ====================

export interface DailyNutritionGoals {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  quality: number;
  satiety: number;
}

export interface NutritionInput {
  calories: number;
  targetCalories: number;
  protein: number;
  carbs: number;
  fat: number;
  foodQuality: number;  // 1-10
  satiety: number;      // 1-10
}

export interface NutritionScoreBreakdown {
  energy: number;
  proteinRatio: number;
  macroBalance: number;
  foodQuality: number;
  satiety: number;
  stability: number;
}

export interface NutritionScoreResult {
  score: number;
  breakdown: NutritionScoreBreakdown;
  highlights: string[];
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
}

// ==================== 权重配置 ====================

const GOAL_WEIGHTS = {
  fat_loss:     { energy: 0.35, proteinRatio: 0.25, macroBalance: 0.15, foodQuality: 0.10, satiety: 0.10, stability: 0.05 },
  muscle_gain:  { proteinRatio: 0.30, energy: 0.25, macroBalance: 0.20, foodQuality: 0.10, satiety: 0.05, stability: 0.10 },
  health:       { foodQuality: 0.30, macroBalance: 0.20, energy: 0.15, satiety: 0.15, proteinRatio: 0.10, stability: 0.10 },
  habit:        { foodQuality: 0.25, satiety: 0.20, energy: 0.20, proteinRatio: 0.15, macroBalance: 0.10, stability: 0.10 },
};

// ==================== 蛋白质占比理想区间 ====================

const PROTEIN_RATIO_RANGES: Record<string, [number, number]> = {
  fat_loss:    [0.25, 0.35],
  muscle_gain: [0.25, 0.40],
  health:      [0.15, 0.25],
  habit:       [0.15, 0.30],
};

// ==================== Service ====================

@Injectable()
export class NutritionScoreService {

  // ─── 工具函数 ───

  private clamp(v: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, v));
  }

  private rangeScore(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 100;
    const diff = value < min ? min - value : value - max;
    return this.clamp(100 - diff * 200);
  }

  // ─── 每日目标计算 ───

  calculateDailyGoals(profile: UserProfile): DailyNutritionGoals {
    const weight = Number(profile?.weightKg) || 65;
    const calorieGoal = profile?.dailyCalorieGoal || 2000;
    const goal = profile?.goal || 'health';

    const proteinPerKg: Record<string, number> = {
      fat_loss: 2.0, muscle_gain: 2.2, health: 1.3, habit: 1.1,
    };
    const protein = Math.round(weight * (proteinPerKg[goal] || 1.3));

    const fatPercent: Record<string, number> = {
      fat_loss: 0.22, muscle_gain: 0.22, health: 0.28, habit: 0.28,
    };
    const fat = Math.round((calorieGoal * (fatPercent[goal] || 0.25)) / 9);

    const carbsCalories = calorieGoal - protein * 4 - fat * 9;
    const carbs = Math.round(Math.max(carbsCalories, 0) / 4);

    return { calories: calorieGoal, protein, fat, carbs, quality: 7, satiety: 6 };
  }

  // ─── 各维度评分 ───

  private calcEnergyScore(actual: number, target: number): number {
    if (target <= 0) return 80;
    return this.clamp(100 - (Math.abs(actual - target) / target) * 100);
  }

  private calcProteinRatioScore(protein: number, calories: number, goal: string): number {
    if (calories <= 0) return 80;
    const ratio = (protein * 4) / calories;
    const [min, max] = PROTEIN_RATIO_RANGES[goal] || [0.15, 0.25];
    return this.rangeScore(ratio, min, max);
  }

  private calcMacroScore(carbs: number, fat: number, calories: number): number {
    if (calories <= 0) return 80;
    const carbRatio = (carbs * 4) / calories;
    const fatRatio = (fat * 9) / calories;
    return (this.rangeScore(carbRatio, 0.40, 0.55) + this.rangeScore(fatRatio, 0.20, 0.30)) / 2;
  }

  private calcStabilityScore(streakDays: number, avgMealsPerDay: number, targetMeals: number): number {
    const streakScore = this.clamp(
      streakDays >= 30 ? 100 : streakDays >= 7 ? 50 + (streakDays - 7) * (50 / 23) : streakDays * (50 / 7),
    );
    const mealRegularity = targetMeals > 0
      ? this.clamp(100 - (Math.abs(avgMealsPerDay - targetMeals) / targetMeals) * 100)
      : 80;
    return Math.round((streakScore + mealRegularity) / 2);
  }

  // ─── 惩罚机制 ───

  private applyPenalties(score: number, input: NutritionInput): number {
    let penalized = score;

    // 热量严重超标 (>130%) → ×0.7
    if (input.calories > input.targetCalories * 1.3) {
      penalized *= 0.7;
    }
    // 蛋白质严重不足 (占比 <10%) → ×0.8
    if (input.calories > 0 && (input.protein * 4) / input.calories < 0.10) {
      penalized *= 0.8;
    }
    // 食物质量极差 (<2) → ×0.85
    if (input.foodQuality < 2) {
      penalized *= 0.85;
    }

    return Math.round(penalized);
  }

  // ─── Highlights 生成 ───

  private generateHighlights(
    scores: NutritionScoreBreakdown,
    input: NutritionInput,
  ): string[] {
    const hl: string[] = [];

    // 负面优先
    if (input.calories > input.targetCalories * 1.3) hl.push('⚠️ 热量严重超标');
    else if (scores.energy < 60) hl.push('⚠️ 热量偏离目标');

    if (scores.proteinRatio < 50) hl.push('⚠️ 蛋白质严重不足');
    else if (scores.proteinRatio < 70) hl.push('⚠️ 蛋白质偏低');

    if (scores.macroBalance < 50) hl.push('⚠️ 碳水/脂肪比例失衡');
    if (scores.foodQuality < 40) hl.push('⚠️ 加工食品偏多');
    if (scores.satiety < 40) hl.push('⚠️ 饱腹感不足，容易饿');

    // 正面
    if (scores.energy >= 85) hl.push('✅ 热量控制良好');
    if (scores.proteinRatio >= 85) hl.push('✅ 蛋白质摄入充足');
    if (scores.macroBalance >= 85) hl.push('✅ 营养结构均衡');
    if (scores.foodQuality >= 80) hl.push('✅ 食物品质优秀');

    return hl.slice(0, 3);
  }

  // ─── 决策映射 ───

  private scoreToDecision(score: number): 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' {
    if (score >= 75) return 'SAFE';
    if (score >= 55) return 'OK';
    if (score >= 35) return 'LIMIT';
    return 'AVOID';
  }

  // ─── 核心：综合评分 ───

  calculateScore(
    input: NutritionInput,
    goal: string,
    stabilityData?: { streakDays: number; avgMealsPerDay: number; targetMeals: number },
  ): NutritionScoreResult {
    const energy = this.calcEnergyScore(input.calories, input.targetCalories);
    const proteinRatio = this.calcProteinRatioScore(input.protein, input.calories, goal);
    const macroBalance = this.calcMacroScore(input.carbs, input.fat, input.calories);
    const foodQuality = this.clamp(input.foodQuality * 10, 0, 100);
    const satiety = this.clamp(input.satiety * 10, 0, 100);
    const stability = stabilityData
      ? this.calcStabilityScore(stabilityData.streakDays, stabilityData.avgMealsPerDay, stabilityData.targetMeals)
      : 80;

    const w = GOAL_WEIGHTS[goal] || GOAL_WEIGHTS.health;
    let score =
      energy * w.energy +
      proteinRatio * w.proteinRatio +
      macroBalance * w.macroBalance +
      foodQuality * w.foodQuality +
      satiety * w.satiety +
      stability * w.stability;

    score = this.applyPenalties(score, input);

    const breakdown = { energy, proteinRatio, macroBalance, foodQuality, satiety, stability };
    const highlights = this.generateHighlights(breakdown, input);
    const decision = this.scoreToDecision(score);

    return { score: Math.round(score), breakdown, highlights, decision };
  }

  // ─── 单餐评分（吃完本餐后的预期分） ───

  calculateMealScore(
    mealNutrition: { calories: number; protein: number; fat: number; carbs: number; avgQuality: number; avgSatiety: number },
    todayTotals: { calories: number; protein: number; fat: number; carbs: number },
    goals: DailyNutritionGoals,
    goal: string,
    stabilityData?: { streakDays: number; avgMealsPerDay: number; targetMeals: number },
  ): NutritionScoreResult {
    const afterMeal: NutritionInput = {
      calories: todayTotals.calories + mealNutrition.calories,
      targetCalories: goals.calories,
      protein: todayTotals.protein + mealNutrition.protein,
      carbs: todayTotals.carbs + mealNutrition.carbs,
      fat: todayTotals.fat + mealNutrition.fat,
      foodQuality: mealNutrition.avgQuality,
      satiety: mealNutrition.avgSatiety,
    };
    return this.calculateScore(afterMeal, goal, stabilityData);
  }

  // ─── 反馈文案生成 ───

  generateFeedback(highlights: string[], goal: string): string {
    const warns = highlights.filter(h => h.startsWith('⚠️'));
    if (warns.length === 0) return '今日饮食各项达标，继续保持！';

    const GOAL_TIPS: Record<string, string> = {
      fat_loss: '；减脂期优先保证蛋白质',
      muscle_gain: '；增肌期关注蛋白和热量是否足够',
      health: '；多吃天然食物保持均衡',
      habit: '；坚持记录就是最大进步',
    };

    return warns.map(w => w.replace('⚠️ ', '')).join('；') + (GOAL_TIPS[goal] || '');
  }
}
```

### 5.2 修改 `analyze.service.ts` — 评分集成

**核心变更**：

1. `AnalysisResult` 接口新增 `totalProtein`, `totalFat`, `totalCarbs`, `avgQuality`, `avgSatiety`, `nutritionScore`, `scoreBreakdown`, `highlights`
2. AI Prompt 要求返回每个食物的 protein/fat/carbs/quality/satiety
3. `buildUserContext()` 注入多维营养目标 + 当前进度 + 目标类型
4. 解析 AI 结果后，用 `NutritionScoreService` 算分并覆盖 decision

```typescript
// analyze.service.ts 的 analyzeImage() 完整流程：

async analyzeImage(imageUrl, mealType, userId) {
  // 1. 获取用户档案 + 今日营养累计
  const profile = await this.userProfileService.getProfile(userId);
  const goals = this.nutritionScoreService.calculateDailyGoals(profile);
  const todayTotals = await this.foodService.getTodayNutritionTotals(userId);
  const goalType = profile?.goal || 'health';

  // 2. 构建用户上下文（含多维目标 + 目标类型说明）
  const userContext = this.buildUserContextV2(profile, goals, todayTotals, goalType);

  // 3. 行为画像 + 人格
  const behaviorContext = await this.behaviorService.getBehaviorContext(userId);
  const personaPrompt = this.getPersonaPrompt(userId);

  // 4. 按目标类型选择差异化 Prompt
  const systemPrompt = buildGoalAwarePrompt(goalType, 
    [personaPrompt, userContext, behaviorContext].filter(Boolean).join('\n\n'));

  // 5. 调用 Vision AI
  const aiResult = this.parseAnalysisResult(aiResponse);

  // 6. 用评分引擎计算分数（权威性 > AI 文本判断）
  const stabilityData = await this.getStabilityData(userId);
  const scoreResult = this.nutritionScoreService.calculateMealScore(
    {
      calories: aiResult.totalCalories,
      protein: aiResult.totalProtein,
      fat: aiResult.totalFat,
      carbs: aiResult.totalCarbs,
      avgQuality: aiResult.avgQuality,
      avgSatiety: aiResult.avgSatiety,
    },
    todayTotals, goals, goalType, stabilityData,
  );

  // 7. 评分覆盖 AI 原始 decision
  aiResult.nutritionScore = scoreResult.score;
  aiResult.decision = scoreResult.decision;
  aiResult.scoreBreakdown = scoreResult.breakdown;
  aiResult.highlights = scoreResult.highlights;

  return aiResult;
}
```

### 5.3 修改 `food.service.ts` — 多维汇总

**`updateDailySummary()` 方法升级**：

```typescript
private async updateDailySummary(userId: string, recordDate: Date): Promise<void> {
  // ... 现有热量汇总逻辑 ...

  // 新增：计算多维汇总
  const totalProtein = records.reduce((sum, r) => sum + (r.totalProtein || 0), 0);
  const totalFat = records.reduce((sum, r) => sum + (r.totalFat || 0), 0);
  const totalCarbs = records.reduce((sum, r) => sum + (r.totalCarbs || 0), 0);

  // 加权平均质量分和饱腹分（按热量权重）
  const totalCal = records.reduce((s, r) => s + r.totalCalories, 0) || 1;
  const avgQuality = records.reduce(
    (s, r) => s + (r.avgQuality || 0) * r.totalCalories, 0
  ) / totalCal;
  const avgSatiety = records.reduce(
    (s, r) => s + (r.avgSatiety || 0) * r.totalCalories, 0
  ) / totalCal;

  // 营养目标（从用户档案计算）
  const profile = await this.userProfileService.getProfile(userId);
  const goals = this.nutritionScoreService.calculateDailyGoals(profile);

  // 综合评分（使用 calculateScore，输入含 targetCalories）
  const goalType = profile?.goal || 'health';
  const stabilityData = await this.getStabilityData(userId);
  const scoreResult = this.nutritionScoreService.calculateScore(
    {
      calories: totalCalories,
      targetCalories: goals.calories,
      protein: totalProtein,
      fat: totalFat,
      carbs: totalCarbs,
      foodQuality: avgQuality,
      satiety: avgSatiety,
    },
    goalType, stabilityData,
  );
  const totalScore = scoreResult.score;

  summary.totalProtein = totalProtein;
  summary.totalFat = totalFat;
  summary.totalCarbs = totalCarbs;
  summary.avgQuality = Math.round(avgQuality * 10) / 10;
  summary.avgSatiety = Math.round(avgSatiety * 10) / 10;
  summary.nutritionScore = totalScore;
  summary.proteinGoal = goals.protein;
  summary.fatGoal = goals.fat;
  summary.carbsGoal = goals.carbs;

  await this.summaryRepo.save(summary);
}
```

**`getTodaySummary()` 返回扩展**：

```typescript
async getTodaySummary(userId: string): Promise<DailySummaryResult> {
  // ... 现有逻辑 ...
  
  // 新增返回字段
  return {
    totalCalories,
    calorieGoal,
    mealCount,
    remaining,
    // 新增
    totalProtein: summary?.totalProtein || 0,
    totalFat: summary?.totalFat || 0,
    totalCarbs: summary?.totalCarbs || 0,
    avgQuality: summary?.avgQuality || 0,
    avgSatiety: summary?.avgSatiety || 0,
    nutritionScore: summary?.nutritionScore || 0,
    proteinGoal: summary?.proteinGoal || 0,
    fatGoal: summary?.fatGoal || 0,
    carbsGoal: summary?.carbsGoal || 0,
  };
}
```

### 5.4 修改 `daily-plan.service.ts` — 多维度餐食规划

**MealPlan 接口扩展**：

```typescript
interface MealPlan {
  foods: string;
  calories: number;
  protein: number;    // 新增
  fat: number;        // 新增
  carbs: number;      // 新增
  tip: string;
}
```

**`generatePlan()` 升级**：

```typescript
private async generatePlan(userId: string, date: string): Promise<DailyPlan> {
  const profile = await this.userProfileService.getProfile(userId);
  const goals = this.nutritionScoreService.calculateDailyGoals(profile);
  const goalType = profile?.goal || 'health';

  // 按比例分配各餐「多维预算」
  const mealRatios = { morning: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 };

  const morningPlan = this.buildMealPlanV2('breakfast', {
    calories: Math.round(goals.calories * mealRatios.morning),
    protein: Math.round(goals.protein * mealRatios.morning),
    fat: Math.round(goals.fat * mealRatios.morning),
    carbs: Math.round(goals.carbs * mealRatios.morning),
  }, goalType);
  // ... 其他餐次类似 ...

  const strategy = this.buildStrategyV2(goals, goalType);
  // ...
}
```

**`buildMealPlanV2()` 方法**：

```typescript
private buildMealPlanV2(
  mealType: string,
  budget: { calories: number; protein: number; fat: number; carbs: number },
  goalType: GoalType,
): MealPlan {
  // 根据目标类型选择不同推荐食物模板
  // 减脂：优先高蛋白低碳方案
  // 增肌：优先高蛋白高碳方案
  // 健康：优先高质量天然食物方案

  const presets: Record<string, Record<string, Array<{
    min: number; foods: string; cal: number; protein: number; fat: number; carbs: number; tip: string;
  }>>> = {
    fat_loss: {
      breakfast: [
        { min: 400, foods: '水煮蛋×2 + 燕麦粥 + 蓝莓', cal: 380, protein: 22, fat: 12, carbs: 42, tip: '高蛋白启动代谢' },
        { min: 300, foods: '希腊酸奶 + 坚果少量', cal: 280, protein: 18, fat: 10, carbs: 28, tip: '简单高蛋白' },
        { min: 0, foods: '黑咖啡 + 水煮蛋', cal: 80, protein: 7, fat: 5, carbs: 1, tip: '极简高蛋白' },
      ],
      lunch: [
        { min: 600, foods: '鸡胸肉 + 杂粮饭 + 西兰花', cal: 550, protein: 40, fat: 12, carbs: 55, tip: '高蛋白标准减脂餐' },
        { min: 400, foods: '清蒸鱼 + 蒜炒青菜 + 少量米饭', cal: 420, protein: 32, fat: 10, carbs: 35, tip: '清淡高蛋白' },
        { min: 0, foods: '蔬菜沙拉 + 水煮蛋×2', cal: 280, protein: 16, fat: 8, carbs: 15, tip: '低碳轻食' },
      ],
      // dinner, snack ...
    },
    muscle_gain: {
      breakfast: [
        { min: 500, foods: '蛋白粉奶昔 + 全麦吐司 + 香蕉', cal: 520, protein: 35, fat: 12, carbs: 65, tip: '增肌高蛋白碳水' },
        { min: 400, foods: '水煮蛋×3 + 燕麦粥 + 牛奶', cal: 450, protein: 28, fat: 15, carbs: 45, tip: '蛋白质充足' },
        { min: 0, foods: '牛奶 + 面包 + 鸡蛋', cal: 350, protein: 18, fat: 12, carbs: 40, tip: '基础增肌早餐' },
      ],
      // lunch, dinner, snack ...
    },
    // health, habit 同理...
  };

  const goalPresets = presets[goalType] || presets.fat_loss;
  const options = goalPresets[mealType] || goalPresets.lunch || [];
  const match = options.find(o => budget.calories >= o.min) || options[options.length - 1];

  return {
    foods: match?.foods || '清淡饮食',
    calories: match?.cal || budget.calories,
    protein: match?.protein || 0,
    fat: match?.fat || 0,
    carbs: match?.carbs || 0,
    tip: match?.tip || '注意均衡',
  };
}
```

### 5.5 修改 `food.controller.ts` — 新增评分接口

```typescript
// 新增端点：获取今日营养评分详情
@Get('nutrition-score')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: '获取今日营养评分详情' })
async getNutritionScore(@CurrentAppUser() user: any) {
  const profile = await this.userProfileService.getProfile(user.id);
  const goals = this.nutritionScoreService.calculateDailyGoals(profile);
  const todayTotals = await this.foodService.getTodayNutritionTotals(user.id);
  const goalType = profile?.goal || 'health';
  const stabilityData = await this.getStabilityData(user.id);

  const result = this.nutritionScoreService.calculateScore(
    {
      calories: todayTotals.calories,
      targetCalories: goals.calories,
      protein: todayTotals.protein,
      fat: todayTotals.fat,
      carbs: todayTotals.carbs,
      foodQuality: todayTotals.avgQuality,
      satiety: todayTotals.avgSatiety,
    },
    goalType, stabilityData,
  );

  return {
    success: true, code: 200, message: '操作成功',
    data: {
      score: result.score,
      breakdown: result.breakdown,
      highlights: result.highlights,
      decision: result.decision,
      goals,
      totals: todayTotals,
      goalType,
    },
  };
}
```

### 5.6 修改 `food.dto.ts` — DTO 扩展

```typescript
// SaveFoodRecordDto 新增
@IsOptional() @IsNumber() totalProtein?: number;
@IsOptional() @IsNumber() totalFat?: number;
@IsOptional() @IsNumber() totalCarbs?: number;
@IsOptional() @IsNumber() avgQuality?: number;
@IsOptional() @IsNumber() avgSatiety?: number;
@IsOptional() @IsNumber() nutritionScore?: number;
```

### 5.7 修改 `buildUserContext()` — 注入多维信息 + 目标导向

```typescript
private buildUserContextV2(
  profile: UserProfile,
  goals: DailyNutritionGoals,
  todayTotals: { calories: number; protein: number; fat: number; carbs: number },
  goalType: string,
): string {
  const remaining = {
    calories: goals.calories - todayTotals.calories,
    protein: goals.protein - todayTotals.protein,
    fat: goals.fat - todayTotals.fat,
    carbs: goals.carbs - todayTotals.carbs,
  };

  // 目标类型描述 + 关注重点
  const GOAL_CONTEXT: Record<string, { label: string; focus: string; warn: string }> = {
    fat_loss: {
      label: '减脂',
      focus: '优先关注：热量不超标 + 蛋白质充足。碳水和脂肪要控制。',
      warn: '如果本餐热量超出剩余预算或蛋白质占比过低，应明确提醒。',
    },
    muscle_gain: {
      label: '增肌',
      focus: '优先关注：蛋白质是否充足 + 热量不能太低。碳水保证训练能量。',
      warn: '蛋白质不够要提醒，热量偏低时也要注意提示"吃够了热量才能增肌"。',
    },
    health: {
      label: '均衡健康',
      focus: '优先关注：食物质量和营养均衡。不过度在意热量，关注天然食材比例。',
      warn: '如果加工食品比例过高，要提醒选择更天然的食物。',
    },
    habit: {
      label: '改善饮食习惯',
      focus: '优先关注：食物质量和饱腹感。鼓励坚持记录，不苛责热量。',
      warn: '语气更温和，多正向激励，不过度苛责数字。',
    },
  };

  const gc = GOAL_CONTEXT[goalType] || GOAL_CONTEXT.health;

  return `【用户饮食目标】${gc.label}
${gc.focus}
${gc.warn}

【今日营养预算剩余】
- 热量：剩余 ${remaining.calories} kcal（总目标 ${goals.calories}，已摄入 ${todayTotals.calories}）
- 蛋白质：剩余 ${remaining.protein}g（总目标 ${goals.protein}g，已摄入 ${todayTotals.protein}g）
- 脂肪：剩余 ${remaining.fat}g（总目标 ${goals.fat}g，已摄入 ${todayTotals.fat}g）
- 碳水：剩余 ${remaining.carbs}g（总目标 ${goals.carbs}g，已摄入 ${todayTotals.carbs}g）

【用户信息】
- 体重：${profile?.weightKg || '未知'}kg
- 活动量：${profile?.activityLevel || '未知'}
- 饮食偏好：${profile?.foodPreferences?.join('、') || '无'}
- 忌口：${profile?.dietaryRestrictions?.join('、') || '无'}`;
}
```

---

## 六、AI Prompt 升级方案

### 6.1 Prompt 架构：目标差异化

**核心理念**：不同目标用户看食物的视角完全不同，AI 的关注点和语气也应不同。

```
┌───────────────────────────────────────────────────┐
│  buildGoalAwarePrompt(goalType, userContext)       │
│                                                    │
│  = BASE_PROMPT（通用骨架 + JSON 格式 + 营养规则）   │
│  + GOAL_FOCUS_BLOCK[goalType]（目标差异化段落）     │
│  + userContext（今日营养状态 + 用户信息）           │
└───────────────────────────────────────────────────┘
```

### 6.2 通用骨架 Prompt（BASE_PROMPT）

```typescript
const BASE_PROMPT = `你是专业饮食教练，风格：朋友式、简洁、可执行。
你的目标不是提供营养知识，而是帮助用户做"吃或不吃"的决策。

用户上传了一张外卖或餐食图片。请识别图中所有菜品，估算多维营养数据，并做出决策判断。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    {
      "name": "菜名",
      "calories": 数字,
      "protein": 数字,
      "fat": 数字,
      "carbs": 数字,
      "quantity": "份量描述",
      "category": "分类",
      "quality": 数字1到10,
      "satiety": 数字1到10
    }
  ],
  "totalCalories": 总热量数字,
  "totalProtein": 总蛋白质克数,
  "totalFat": 总脂肪克数,
  "totalCarbs": 总碳水克数,
  "avgQuality": 所有食物质量分均值(保留1位小数),
  "avgSatiety": 所有食物饱腹感均值(保留1位小数),
  "mealType": "breakfast|lunch|dinner|snack",
  "decision": "SAFE|OK|LIMIT|AVOID",
  "riskLevel": "🟢|🟡|🟠|🔴",
  "reason": "一句话原因，不超过20字",
  "suggestion": "具体可执行建议，不超过25字",
  "insteadOptions": ["替代方案1", "替代方案2", "替代方案3"],
  "compensation": {
    "diet": "饮食补救，一句话",
    "activity": "运动补救，一句话",
    "nextMeal": "下一餐建议，一句话"
  },
  "contextComment": "基于今日多维营养状态的点评，一句话",
  "encouragement": "积极鼓励语，一句话",
  "advice": "综合营养建议，不超过30字",
  "isHealthy": true或false
}

营养估算规则：
- protein/fat/carbs 单位为克(g)，精确到整数
- quality（食物质量）评分标准：
  - 9-10: 天然未加工（水煮蛋、三文鱼、西兰花）
  - 7-8: 轻加工（烤鸡胸、糙米、无糖酸奶）
  - 5-6: 中度加工（白米饭、炒菜少油）
  - 3-4: 深度加工（炸鸡、红烧肉、蛋糕）
  - 1-2: 超加工（薯片、碳酸饮料、方便面）
- satiety（饱腹感）评分标准：
  - 9-10: 高蛋白+高纤维+大体积（鸡胸+蔬菜、燕麦粥）
  - 7-8: 中等蛋白或纤维（米饭+肉菜）
  - 5-6: 一般（炒饭、面条）
  - 3-4: 低饱腹（甜品、白面包、果汁）
  - 1-2: 几乎无饱腹（碳酸饮料、糖果）

替代方案规则：
- 替代方案应补足当前缺失的维度（如蛋白不足→推荐高蛋白替代）
- 每条不超过15字

其他规则：
- category 只能是 主食/蔬菜/蛋白质/汤类/水果/饮品/零食
- 热量和营养素估算保守（宁少不多）
- 无法识别时，foods 返回空数组
- 像朋友一样说话`;
```

### 6.3 目标差异化段落（GOAL_FOCUS_BLOCK）

```typescript
const GOAL_FOCUS_BLOCK: Record<string, string> = {

  fat_loss: `
【减脂用户特别指令 — 你最关注的是热量和蛋白质】

决策优先级（按此顺序判断）：
1. 热量是否在剩余预算内？ → 超出太多直接 LIMIT/AVOID
2. 蛋白质占比是否 ≥ 25%？ → 不够则在 suggestion 中提醒
3. 食物质量如何？加工食品 → 降一级判断
4. 饱腹感强不强？→ 不强则在 advice 中提醒

语气要求：
- 对高蛋白低热量食物热情肯定："蛋白质拉满！好选择！"
- 对高碳水低蛋白：直接指出"碳水太多蛋白太少，下次加个蛋"
- 替代方案优先推荐等热量但高蛋白的选择
- contextComment 必须提到热量预算剩余和蛋白质缺口`,

  muscle_gain: `
【增肌用户特别指令 — 你最关注的是蛋白质和够不够吃】

决策优先级（按此顺序判断）：
1. 蛋白质是否充足（本餐 ≥ 30g）？ → 不够在 suggestion 中明确建议加量
2. 热量是否足够？不够则提醒"增肌得吃够"，不要轻易说"热量太高"
3. 碳水是否支撑训练？ → 训练日碳水要充足
4. 质量和加工度参考，但不做主要判断

语气要求：
- 对大份高蛋白：热情肯定"增肌必备，蛋白质给力！"
- 对吃太少/蛋白不够：温和提醒"这个量有点少，加个鸡胸或蛋白粉"
- 不要因为热量高就判 LIMIT，增肌用户热量稍多 OK
- 只有脂肪占比过高（>40%）或加工食物太多才降级
- contextComment 必须提到蛋白质摄入进度和热量是否足够`,

  health: `
【健康均衡用户特别指令 — 你最关注的是食物质量和营养均衡】

决策优先级（按此顺序判断）：
1. 食物是否天然、少加工？ → quality < 5 的要提醒
2. 三大营养素比例是否均衡？ → 不需要极端，碳水40-55%/蛋白15-25%/脂肪20-30%
3. 热量是否大致合理（±20% 都可以接受，不苛责）
4. 饱腹感和餐食搭配是否合理

语气要求：
- 对天然食物为主的餐食：真诚肯定"搭配得很好，天然食物为主"
- 对加工食品为主：温和建议"下次可以多选新鲜食材"
- 对热量不用太敏感，±20% 都标 SAFE
- 替代方案推荐同类但更天然的选择
- contextComment 聚焦食物质量和搭配评价`,

  habit: `
【改善习惯用户特别指令 — 你最关注的是食物质量和坚持记录】

决策优先级（按此顺序判断）：
1. 用户记录了这餐本身就值得肯定 → encouragement 一定要积极
2. 食物质量如何？有无天然食物？ → 有的话大力肯定"有蔬菜！好习惯"
3. 饱腹感如何？会不会很快就饿？ → 建议加些高纤维食物
4. 热量不是重点 → 除非严重超标否则不做主要判断

语气要求：
- 全程正向为主："记录就是最大的进步！"
- 即使选择不太好也要先肯定再建议："虽然炸鸡热量高，但你主动记录了"
- 对热量的判断很宽松，不轻易判 LIMIT/AVOID
- 只有极端情况（全是超加工 + 热量爆表）才判 AVOID
- suggestion 和 advice 用鼓励+引导式语气，不用否定词
- contextComment 关注饮食习惯改善趋势`,

};
```

### 6.4 组装函数

```typescript
function buildGoalAwarePrompt(goalType: string, userContext: string): string {
  const focusBlock = GOAL_FOCUS_BLOCK[goalType] || GOAL_FOCUS_BLOCK.health;
  return [BASE_PROMPT, focusBlock, userContext].join('\n\n');
}
```

### 6.5 AI 返回后的评分覆盖逻辑

AI 返回的 `decision` 仅作参考，后端评分算法为最终权威：

```
AI 识别食物 → 返回 protein/fat/carbs/quality/satiety
      ↓
NutritionScoreService.calculateMealScore()
      ↓
用评分引擎计算 score + decision（以此为准）
      ↓
如果 AI decision 和算法 decision 差距 > 1级，取更严格的那个
```

```typescript
// 评分覆盖 + 安全兜底
function resolveDecision(
  aiDecision: string,
  engineDecision: string,
): string {
  const rank = { SAFE: 0, OK: 1, LIMIT: 2, AVOID: 3 };
  const aiRank = rank[aiDecision] ?? 1;
  const engineRank = rank[engineDecision] ?? 1;

  // 差距 > 1 级时，取更严格的
  if (Math.abs(aiRank - engineRank) > 1) {
    return aiRank > engineRank ? aiDecision : engineDecision;
  }
  // 否则以引擎为准
  return engineDecision;
}
```

### 6.6 Prompt 效果对比

| 场景 | 旧 Prompt（通用） | 新 Prompt（目标差异化） |
|------|-------------------|----------------------|
| 减脂用户吃了一碗炒饭 | "热量520kcal, OK" | "碳水70g但蛋白只有8g，蛋白质占比太低。换蛋炒饭+鸡胸" |
| 增肌用户吃了鸡胸+米饭 | "热量450kcal, SAFE" | "蛋白质42g，给力！热量OK，碳水支撑训练" |
| 健康用户吃了方便面 | "热量380kcal, LIMIT" | "超加工食品质量偏低，下次选手工面+鸡蛋" |
| 习惯用户吃了炸鸡 | "热量680kcal, AVOID" | "记录就是进步！炸鸡虽然热量高，下次试试烤鸡？" |

---

## 七、前端展示方案

### 7.1 首页「今日状态」卡片升级

**现有**：

```
┌─────────────────────────────┐
│ 剩余 1,260 / 2,000 kcal    │
│ ██████████░░░░  63%         │
│ 已摄入 740   记录 2 餐      │
└─────────────────────────────┘
```

**升级为**（根据用户目标动态排列）：

```
┌────────────────────────────────────┐
│ 🔥 今日饮食评分  78 分              │
│                                    │
│ ─ 按目标权重排列（减脂用户示例） ─   │
│                                    │
│ 🔥 热量       740 / 2000 kcal  ✅  │
│ ██████████░░░░░░░░░  37%           │
│                                    │
│ 🥩 蛋白质     35 / 120 g      ⚠️  │
│ ██████░░░░░░░░░░░░░  29%           │
│                                    │
│ 🍚 碳水       95 / 200 g      ✅  │
│ ██████████░░░░░░░░░  48%           │
│                                    │
│ 💧 脂肪       22 / 50 g       ✅  │
│ ██████████░░░░░░░░░  44%           │
│                                    │
│ 💡 蛋白质偏低，下一餐多补充肉蛋奶    │
└────────────────────────────────────┘
```

### 7.2 不同目标用户的维度排列

```typescript
// 首页展示的维度进度条顺序（按目标权重由高到低）
const DISPLAY_ORDER: Record<GoalType, string[]> = {
  fat_loss:     ['calories', 'protein', 'carbs', 'fat'],        // 减脂：热量>蛋白>碳水>脂肪
  muscle_gain:  ['protein', 'calories', 'carbs', 'fat'],        // 增肌：蛋白>热量>碳水>脂肪
  health:       ['calories', 'protein', 'fat', 'carbs'],        // 健康：均衡展示
  habit:        ['calories', 'protein', 'carbs', 'fat'],        // 习惯：基础展示
};

// 维度标签映射
const DIMENSION_LABELS: Record<string, { icon: string; label: string; unit: string }> = {
  calories: { icon: '🔥', label: '热量', unit: 'kcal' },
  protein:  { icon: '🥩', label: '蛋白质', unit: 'g' },
  carbs:    { icon: '🍚', label: '碳水', unit: 'g' },
  fat:      { icon: '💧', label: '脂肪', unit: 'g' },
};
```

### 7.3 DecisionCard 组件升级

分析结果页面的 DecisionCard 新增维度得分展示：

```
┌─────────────────────────────────┐
│ 🟠 建议少吃          评分 42    │
│                                 │
│ 宫保鸡丁              520 kcal  │
│ 蛋白质 25g  脂肪 28g  碳水 35g │
│ 质量 4/10   饱腹 5/10           │
│                                 │
│ ⚠️ 脂肪偏高  ⚠️ 食物质量偏低    │
│                                 │
│ 💡 换成烤鸡胸 / 去掉花生酱汁    │
└─────────────────────────────────┘
```

### 7.4 每日计划卡片升级

```
┌────────────────────────────────────────┐
│ 🍳 早餐建议                  400 kcal │
│ 水煮蛋×2 + 燕麦粥 + 蓝莓              │
│ 蛋白质 22g · 脂肪 12g · 碳水 42g      │
│ 💡 高蛋白启动代谢                      │
├────────────────────────────────────────┤
│ 🥗 午餐建议                  550 kcal │
│ ...                                    │
└────────────────────────────────────────┘
```

### 7.5 前端类型扩展

```typescript
// food.ts 类型扩展

export interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  protein?: number;     // 新增
  fat?: number;         // 新增
  carbs?: number;       // 新增
  quality?: number;     // 新增 (1-10)
  satiety?: number;     // 新增 (1-10)
}

export interface NutritionScoreBreakdown {
  energy: number;         // 热量合理性 0-100
  proteinRatio: number;   // 蛋白质占比 0-100
  macroBalance: number;   // 宏量结构 0-100
  foodQuality: number;    // 食物质量 0-100
  satiety: number;        // 饱腹感 0-100
  stability: number;      // 饮食稳定性 0-100
}

export interface AnalysisResult {
  // ... 现有字段 ...
  totalProtein: number;                    // 新增
  totalFat: number;                        // 新增
  totalCarbs: number;                      // 新增
  avgQuality: number;                      // 新增
  avgSatiety: number;                      // 新增
  nutritionScore: number;                  // 新增 (0-100)
  scoreBreakdown?: NutritionScoreBreakdown; // 新增（6维评分明细）
  highlights?: string[];                   // 新增（最多3条文案）
}

export interface DailySummary {
  totalCalories: number;
  calorieGoal: number | null;
  mealCount: number;
  remaining: number;
  // 新增
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  avgQuality: number;
  avgSatiety: number;
  nutritionScore: number;
  proteinGoal: number;
  fatGoal: number;
  carbsGoal: number;
}

export interface MealPlan {
  foods: string;
  calories: number;
  protein: number;      // 新增
  fat: number;          // 新增
  carbs: number;        // 新增
  tip: string;
}

// GET /food/nutrition-score 返回类型
export interface NutritionScoreResponse {
  score: number;
  breakdown: NutritionScoreBreakdown;
  highlights: string[];
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  goals: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    quality: number;
    satiety: number;
  };
  totals: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    avgQuality: number;
    avgSatiety: number;
  };
  goalType: string;
}
```

---

## 八、文件变更清单

### 8.1 后端（api-server）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/migrations/1750000000000-AddNutritionDimensions.ts` | **新建** | food_records 6 列 + daily_summaries 9 列 |
| `src/app/services/nutrition-score.service.ts` | **新建** | 营养评分引擎（权重配置 + 评分算法 + 反馈生成） |
| `src/entities/food-record.entity.ts` | **修改** | 新增 totalProtein/totalFat/totalCarbs/avgQuality/avgSatiety/nutritionScore + FoodItem 接口扩展 |
| `src/entities/daily-summary.entity.ts` | **修改** | 新增 9 个营养相关列 |
| `src/entities/daily-plan.entity.ts` | **修改** | MealPlan 接口新增 protein/fat/carbs |
| `src/app/services/analyze.service.ts` | **修改** | Prompt V3 + AnalysisResult 扩展 + buildUserContext 多维化 + 注入 NutritionScoreService |
| `src/app/services/food.service.ts` | **修改** | updateDailySummary 多维化 + getTodaySummary 返回扩展 + 新增 getTodayNutritionTotals |
| `src/app/services/daily-plan.service.ts` | **修改** | MealPlan 多维化 + 目标差异化推荐 + 注入 NutritionScoreService |
| `src/app/controllers/food.controller.ts` | **修改** | 新增 GET nutrition-score 端点 |
| `src/app/dto/food.dto.ts` | **修改** | SaveFoodRecordDto 新增 6 字段 |
| `src/app/app-client.module.ts` | **修改** | 注册 NutritionScoreService |

### 8.2 前端（web）

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/lib/api/food.ts` | **修改** | FoodItem/AnalysisResult/DailySummary/MealPlan 类型扩展 + NutritionScoreResult 接口 + getNutritionScore API |
| `src/components/decision-card.tsx` | **修改** | 展示多维评分和维度状态 |
| `src/components/nutrition-dimensions.tsx` | **新建** | 今日多维营养进度组件（多进度条 + 状态标识） |
| `src/pages-component/home/index.tsx` | **修改** | 今日状态区替换为多维营养评分卡片 |
| `src/app/[locale]/analyze/page.tsx` | **修改** | 分析结果展示多维数据和评分 |

### 8.3 变更统计

| 类别 | 新增 | 修改 |
|------|------|------|
| 迁移 | 1 | 0 |
| 服务 | 1 | 3 |
| 实体 | 0 | 3 |
| 控制器 | 0 | 1 |
| DTO | 0 | 1 |
| 模块 | 0 | 1 |
| 前端组件 | 1 | 2 |
| 前端页面 | 0 | 1 |
| 前端API | 0 | 1 |
| **合计** | **3** | **13** |

---

## 九、实施步骤

### Phase 1：数据层（后端基础）

```
1. 新建 Migration 1750000000000-AddNutritionDimensions
2. 修改 food-record.entity.ts — 新增 6 个营养列
3. 修改 daily-summary.entity.ts — 新增 9 个营养列
4. 修改 daily-plan.entity.ts — MealPlan 接口扩展
5. 修改 food.dto.ts — SaveFoodRecordDto 新增字段
6. 运行 migration 验证
```

### Phase 2：评分引擎（核心算法）

```
1. 新建 nutrition-score.service.ts
   - 每日目标计算 calculateDailyGoals()
   - 综合评分 calculateScore()（偏差法 + 区间法 + 惩罚）
   - 单餐评分 calculateMealScore()（含已有进度）
   - Highlights 生成（最多 3 条）
   - 反馈生成 generateFeedback()
2. 注册到 app-client.module.ts
3. 单元测试：构造不同目标的用户，验证评分和决策输出
```

### Phase 3：AI 分析升级

```
1. 修改 analyze.service.ts
   - 目标差异化 Prompt（BASE_PROMPT + GOAL_FOCUS_BLOCK）
   - AnalysisResult 接口扩展（scoreBreakdown + highlights）
   - buildUserContextV2() 注入多维状态 + 目标导向说明
   - 分析结果后用 NutritionScoreService.calculateMealScore() 计算评分
   - resolveDecision() 引擎评分覆盖 AI decision
   - parseAnalysisResult() 扩展解析新字段
2. 测试：上传图片验证 AI 返回的 protein/fat/carbs/quality/satiety 数据
3. 测试：不同目标用户（减脂/增肌/健康/习惯）对同一食物的 decision 差异
```

### Phase 4：汇总与计划升级

```
1. 修改 food.service.ts
   - updateDailySummary() 多维化
   - getTodaySummary() 返回扩展
   - 新增 getTodayNutritionTotals()
2. 修改 daily-plan.service.ts
   - buildMealPlanV2() 多维度推荐
   - generatePlan() 按目标差异化
3. 修改 food.controller.ts
   - 新增 GET nutrition-score 端点
```

### Phase 5：前端展示

```
1. 修改 food.ts 类型定义
2. 新建 nutrition-dimensions.tsx 组件
3. 修改首页 — 多维营养评分卡片
4. 修改 DecisionCard — 展示维度评分
5. 修改分析结果页 — 展示多维数据
```

---

## 附录：兼容性设计

### A. 向后兼容

1. **所有新增字段都有默认值**，不影响现有数据和老版本客户端
2. **FoodItem 中 protein/fat/carbs/quality/satiety 均可选**，老记录不会报错
3. **评分字段 nutritionScore 默认 0**，前端判断 `score > 0 ? 显示 : 隐藏`
4. **MealPlan 新增的 protein/fat/carbs 有默认值 0**，前端按 `> 0` 判断是否显示

### B. AI 容错

1. AI 未返回 protein/fat/carbs 时，根据热量和类别粗估：
   ```
   蛋白质估算 = totalCalories * 0.15 / 4  (占总热量 15%)
   脂肪估算   = totalCalories * 0.30 / 9  (占总热量 30%)
   碳水估算   = totalCalories * 0.55 / 4  (占总热量 55%)
   ```
2. AI 未返回 quality/satiety 时，根据 category 给默认值：
   ```
   蛋白质类 → quality 7, satiety 8
   蔬菜类   → quality 8, satiety 6
   主食类   → quality 5, satiety 6
   零食类   → quality 3, satiety 3
   饮品类   → quality 4, satiety 2
   ```

### C. 成本控制

- 营养评分算法（NutritionScoreService）全部规则引擎，**零 AI 调用成本**
- 每日营养目标计算基于数学公式，**零 AI 成本**
- AI 调用次数不增加（只是 prompt 要求多返回几个字段）
- MealPlan 推荐仍用规则引擎的 presets 模板
