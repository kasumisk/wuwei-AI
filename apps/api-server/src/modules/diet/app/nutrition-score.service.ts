import { Injectable } from '@nestjs/common';

// ==================== 类型 ====================

export type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';

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
  foodQuality: number; // 1-10
  satiety: number; // 1-10
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

const GOAL_WEIGHTS: Record<string, Record<string, number>> = {
  fat_loss: {
    energy: 0.35,
    proteinRatio: 0.25,
    macroBalance: 0.15,
    foodQuality: 0.1,
    satiety: 0.1,
    stability: 0.05,
  },
  muscle_gain: {
    proteinRatio: 0.3,
    energy: 0.25,
    macroBalance: 0.2,
    foodQuality: 0.1,
    satiety: 0.05,
    stability: 0.1,
  },
  health: {
    foodQuality: 0.3,
    macroBalance: 0.2,
    energy: 0.15,
    satiety: 0.15,
    proteinRatio: 0.1,
    stability: 0.1,
  },
  habit: {
    foodQuality: 0.25,
    satiety: 0.2,
    energy: 0.2,
    proteinRatio: 0.15,
    macroBalance: 0.1,
    stability: 0.1,
  },
};

const PROTEIN_RATIO_RANGES: Record<string, [number, number]> = {
  fat_loss: [0.25, 0.35],
  muscle_gain: [0.25, 0.4],
  health: [0.15, 0.25],
  habit: [0.15, 0.3],
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

  calculateDailyGoals(profile: any): DailyNutritionGoals {
    const weight = Number(profile?.weightKg) || 65;
    const calorieGoal = profile?.dailyCalorieGoal || 2000;
    const goal = profile?.goal || 'health';

    const proteinPerKg: Record<string, number> = {
      fat_loss: 2.0,
      muscle_gain: 2.2,
      health: 1.3,
      habit: 1.1,
    };
    const protein = Math.round(weight * (proteinPerKg[goal] || 1.3));

    const fatPercent: Record<string, number> = {
      fat_loss: 0.22,
      muscle_gain: 0.22,
      health: 0.28,
      habit: 0.28,
    };
    const fat = Math.round((calorieGoal * (fatPercent[goal] || 0.25)) / 9);

    const carbsCalories = calorieGoal - protein * 4 - fat * 9;
    const carbs = Math.round(Math.max(carbsCalories, 0) / 4);

    return {
      calories: calorieGoal,
      protein,
      fat,
      carbs,
      quality: 7,
      satiety: 6,
    };
  }

  // ─── 各维度评分 ───

  /**
   * 热量评分 — 高斯钟形函数
   * 接近目标最优，偏差越大分数越低。
   * σ 根据目标类型动态调整（减脂严格、增肌宽松）。
   * 非对称惩罚：减脂超标扣更重，增肌不足扣更重。
   */
  private calcEnergyScore(
    actual: number,
    target: number,
    goal?: string,
  ): number {
    if (target <= 0) return 80;
    const sigmaRatio: Record<string, number> = {
      fat_loss: 0.12,
      muscle_gain: 0.2,
      health: 0.15,
      habit: 0.25,
    };
    const sigma = target * (sigmaRatio[goal || 'health'] || 0.15);
    const diff = actual - target;
    let score = 100 * Math.exp(-(diff * diff) / (2 * sigma * sigma));

    // 非对称惩罚
    if (goal === 'fat_loss' && diff > 0) {
      score *= 0.85;
    }
    if (goal === 'muscle_gain' && diff < 0) {
      score *= 0.9;
    }
    return this.clamp(score);
  }

  /**
   * 蛋白质评分 — 分段函数
   * 不足区线性增长，达标区满分，超标区缓慢下降。
   */
  private calcProteinRatioScore(
    protein: number,
    calories: number,
    goal: string,
  ): number {
    if (calories <= 0) return 80;
    const ratio = (protein * 4) / calories;
    const [min, max] = PROTEIN_RATIO_RANGES[goal] || [0.15, 0.25];

    if (ratio >= min && ratio <= max) return 100;
    if (ratio < min) return this.clamp(30 + 70 * (ratio / min));
    // 超标区缓慢衰减
    return this.clamp(100 - 50 * ((ratio - max) / 0.15));
  }

  private calcMacroScore(carbs: number, fat: number, calories: number): number {
    if (calories <= 0) return 80;
    const carbRatio = (carbs * 4) / calories;
    const fatRatio = (fat * 9) / calories;
    return (
      (this.rangeScore(carbRatio, 0.4, 0.55) +
        this.rangeScore(fatRatio, 0.2, 0.3)) /
      2
    );
  }

  private calcStabilityScore(
    streakDays: number,
    avgMealsPerDay: number,
    targetMeals: number,
  ): number {
    const streakScore = this.clamp(
      streakDays >= 30
        ? 100
        : streakDays >= 7
          ? 50 + (streakDays - 7) * (50 / 23)
          : streakDays * (50 / 7),
    );
    const mealRegularity =
      targetMeals > 0
        ? this.clamp(
            100 - (Math.abs(avgMealsPerDay - targetMeals) / targetMeals) * 100,
          )
        : 80;
    return Math.round((streakScore + mealRegularity) / 2);
  }

  // ─── 惩罚机制 ───

  private applyPenalties(score: number, input: NutritionInput): number {
    let penalized = score;
    if (input.calories > input.targetCalories * 1.3) {
      penalized *= 0.7;
    }
    if (input.calories > 0 && (input.protein * 4) / input.calories < 0.1) {
      penalized *= 0.8;
    }
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

    if (input.calories > input.targetCalories * 1.3) hl.push('⚠️ 热量严重超标');
    else if (scores.energy < 60) hl.push('⚠️ 热量偏离目标');

    if (scores.proteinRatio < 50) hl.push('⚠️ 蛋白质严重不足');
    else if (scores.proteinRatio < 70) hl.push('⚠️ 蛋白质偏低');

    if (scores.macroBalance < 50) hl.push('⚠️ 碳水/脂肪比例失衡');
    if (scores.foodQuality < 40) hl.push('⚠️ 加工食品偏多');
    if (scores.satiety < 40) hl.push('⚠️ 饱腹感不足，容易饿');

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
    stabilityData?: {
      streakDays: number;
      avgMealsPerDay: number;
      targetMeals: number;
    },
  ): NutritionScoreResult {
    const energy = this.calcEnergyScore(
      input.calories,
      input.targetCalories,
      goal,
    );
    const proteinRatio = this.calcProteinRatioScore(
      input.protein,
      input.calories,
      goal,
    );
    const macroBalance = this.calcMacroScore(
      input.carbs,
      input.fat,
      input.calories,
    );
    const foodQuality = this.clamp(input.foodQuality * 10, 0, 100);
    const satiety = this.clamp(input.satiety * 10, 0, 100);
    const stability = stabilityData
      ? this.calcStabilityScore(
          stabilityData.streakDays,
          stabilityData.avgMealsPerDay,
          stabilityData.targetMeals,
        )
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

    const breakdown = {
      energy,
      proteinRatio,
      macroBalance,
      foodQuality,
      satiety,
      stability,
    };
    const highlights = this.generateHighlights(breakdown, input);
    const decision = this.scoreToDecision(score);

    return { score: Math.round(score), breakdown, highlights, decision };
  }

  // ─── 单餐评分（吃完本餐后的预期分） ───

  calculateMealScore(
    mealNutrition: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
      avgQuality: number;
      avgSatiety: number;
    },
    todayTotals: {
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
    },
    goals: DailyNutritionGoals,
    goal: string,
    stabilityData?: {
      streakDays: number;
      avgMealsPerDay: number;
      targetMeals: number;
    },
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
    const warns = highlights.filter((h) => h.startsWith('⚠️'));
    if (warns.length === 0) return '今日饮食各项达标，继续保持！';

    const GOAL_TIPS: Record<string, string> = {
      fat_loss: '；减脂期优先保证蛋白质',
      muscle_gain: '；增肌期关注蛋白和热量是否足够',
      health: '；多吃天然食物保持均衡',
      habit: '；坚持记录就是最大进步',
    };

    return (
      warns.map((w) => w.replace('⚠️ ', '')).join('；') +
      (GOAL_TIPS[goal] || '')
    );
  }
}
