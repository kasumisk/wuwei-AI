import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { t } from '../recommendation/utils/i18n-messages';
import {
  ScoringConfigService,
  DailyScoreWeightsConfig,
} from '../recommendation/context/scoring-config.service';

// ==================== 类型 ====================

export type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';

/**
 * V4: 用于 calculateDailyGoals 的用户画像字段子集
 * 替代 `profile: any` (修复 D1)
 *
 * weightKg 接受 Prisma.Decimal 以兼容 UserProfiles 模型直接传入
 */
export interface DailyGoalProfile {
  weightKg?: number | Prisma.Decimal | null;
  dailyCalorieGoal?: number | null;
  goal?: string | null;
}

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
  /** 血糖指数 0-100，可选 */
  glycemicIndex?: number;
  /** 标准份量碳水克数，用于计算 GL */
  carbsPerServing?: number;
}

export interface NutritionScoreBreakdown {
  energy: number;
  proteinRatio: number;
  macroBalance: number;
  foodQuality: number;
  satiety: number;
  stability: number;
  glycemicImpact: number;
  /** V1.4: 每餐决策质量综合分（决策 pipeline 可能无此数据） */
  mealQuality?: number;
}

export interface NutritionScoreResult {
  score: number;
  breakdown: NutritionScoreBreakdown;
  highlights: string[];
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  /** V1.5: 本次评分实际使用的维度权重（归一化后） */
  weights?: Record<string, number>;
  /** V1.5: 权重来源 — 'config' 表示从运行时配置读取，'default' 表示硬编码 */
  weightsSource?: 'config' | 'default';
}

// ── V1.2: 宏量槽位状态 ──

export interface DailyMacroSlotStatus {
  calories: 'deficit' | 'ok' | 'excess';
  protein: 'deficit' | 'ok' | 'excess';
  fat: 'deficit' | 'ok' | 'excess';
  carbs: 'deficit' | 'ok' | 'excess';
  dominantDeficit?: 'calories' | 'protein' | 'fat' | 'carbs';
  dominantExcess?: 'calories' | 'protein' | 'fat' | 'carbs';
}

// ── V1.2: 结构化问题 ──

export interface IssueHighlight {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
}

// ── V1.4: 每餐决策信号聚合 ──

export interface MealSignalAggregation {
  totalMeals: number;
  healthyMeals: number;
  healthyRatio: number;
  avgMealScore: number;
  decisionDistribution: { safe: number; warn: number; stop: number };
  mealTypes: string[];
  mealDiversity: number;
}

// ── V1.6: 结构化状态解释 ──

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
  /** 向后兼容：拼接的纯文本 */
  text: string;
  /** V1.6: 分段结构，前端可独立渲染 */
  segments: StatusSegment[];
}

// ── V1.6: 宏量偏离明细 ──

export interface MacroDeviation {
  macro: 'calories' | 'protein' | 'fat' | 'carbs';
  direction: 'deficit' | 'excess';
  percent: number;
  message: string;
}

export interface DecisionAlignment {
  alignmentScore: number;
  deviationCount: number;
  deviationMeals: string[];
  summary: string;
  /** V1.6: per-macro 偏离明细 */
  macroDeviations?: MacroDeviation[];
}

// ==================== 权重配置 ====================

const GOAL_WEIGHTS: Record<string, Record<string, number>> = {
  fat_loss: {
    energy: 0.25,
    proteinRatio: 0.2,
    macroBalance: 0.1,
    foodQuality: 0.05,
    satiety: 0.05,
    stability: 0.05,
    glycemicImpact: 0.12,
    mealQuality: 0.18,
  },
  muscle_gain: {
    proteinRatio: 0.25,
    energy: 0.2,
    macroBalance: 0.15,
    foodQuality: 0.07,
    satiety: 0.03,
    stability: 0.08,
    glycemicImpact: 0.05,
    mealQuality: 0.17,
  },
  health: {
    foodQuality: 0.2,
    mealQuality: 0.2,
    macroBalance: 0.15,
    energy: 0.1,
    satiety: 0.1,
    proteinRatio: 0.08,
    stability: 0.07,
    glycemicImpact: 0.1,
  },
  habit: {
    foodQuality: 0.18,
    mealQuality: 0.18,
    satiety: 0.15,
    energy: 0.15,
    proteinRatio: 0.1,
    macroBalance: 0.08,
    stability: 0.08,
    glycemicImpact: 0.08,
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
  /** V1.5: 注入评分配置服务，用于运行时权重可配置化 */
  constructor(
    @Optional()
    private readonly scoringConfigService?: ScoringConfigService,
  ) {}

  /** V1.5: 缓存配置权重，避免每次 calculateScore 都做 async 读取 */
  private cachedWeightsConfig: DailyScoreWeightsConfig | null = null;
  private cachedWeightsTime = 0;
  private readonly WEIGHTS_CACHE_TTL = 60_000; // 1 分钟本地缓存

  /**
   * V1.5: 预加载配置权重（由 controller 在调用 calculateScore 前调用）
   * 这样 computePersonalizedWeights 可保持同步
   */
  async preloadWeightsConfig(): Promise<DailyScoreWeightsConfig | null> {
    if (
      this.cachedWeightsConfig &&
      Date.now() - this.cachedWeightsTime < this.WEIGHTS_CACHE_TTL
    ) {
      return this.cachedWeightsConfig;
    }
    if (!this.scoringConfigService) return null;
    try {
      const config = await this.scoringConfigService.getDailyScoreWeights();
      if (config) {
        this.cachedWeightsConfig = config;
        this.cachedWeightsTime = Date.now();
      }
      return config;
    } catch {
      return null;
    }
  }

  // ─── 工具函数 ───

  private clamp(v: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, v));
  }

  /**
   * V1.3: 时间进度曲线 — 返回该时间点预期的热量摄入进度（0-1）
   * 基于典型三餐模式（早 7-9, 午 12-13, 晚 18-19）
   */
  getExpectedProgress(localHour: number): number {
    const points: [number, number][] = [
      [0, 0],
      [6, 0],
      [9, 0.25],
      [13, 0.5],
      [19, 0.8],
      [22, 1.0],
      [24, 1.0],
    ];
    const h = Math.max(0, Math.min(24, localHour));
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      if (h <= x1) {
        if (x1 === x0) return y0;
        return y0 + ((y1 - y0) * (h - x0)) / (x1 - x0);
      }
    }
    return 1.0;
  }

  // ─── V1.4: 每餐决策信号聚合 ───

  /**
   * 从今日所有 food_records 聚合每餐的决策/质量信号
   * @param records 今日饮食记录（Prisma FoodRecords 行）
   * @param targetMeals 用户目标餐数（默认 3）
   */
  aggregateMealSignals(
    records: Array<{
      decision?: string | null;
      isHealthy?: boolean | null;
      nutritionScore?: number | null;
      mealType?: string | null;
    }>,
    targetMeals: number = 3,
  ): MealSignalAggregation {
    if (records.length === 0) {
      return {
        totalMeals: 0,
        healthyMeals: 0,
        healthyRatio: 0,
        avgMealScore: 0,
        decisionDistribution: { safe: 0, warn: 0, stop: 0 },
        mealTypes: [],
        mealDiversity: 0,
      };
    }

    let healthyCount = 0;
    let scoreSum = 0;
    let scoreCount = 0;
    const dist = { safe: 0, warn: 0, stop: 0 };
    const mealTypeSet = new Set<string>();

    for (const r of records) {
      if (r.isHealthy === true) healthyCount++;
      if (r.nutritionScore != null && r.nutritionScore > 0) {
        scoreSum += r.nutritionScore;
        scoreCount++;
      }
      const dec = (r.decision || '').toUpperCase();
      if (dec === 'SAFE') dist.safe++;
      else if (dec === 'WARN') dist.warn++;
      else if (dec === 'STOP') dist.stop++;
      if (r.mealType) mealTypeSet.add(r.mealType);
    }

    const total = records.length;
    return {
      totalMeals: total,
      healthyMeals: healthyCount,
      healthyRatio: total > 0 ? healthyCount / total : 0,
      avgMealScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
      decisionDistribution: dist,
      mealTypes: Array.from(mealTypeSet),
      mealDiversity:
        targetMeals > 0
          ? Math.min(1, mealTypeSet.size / targetMeals)
          : mealTypeSet.size > 0
            ? 1
            : 0,
    };
  }

  /**
   * V1.4: 计算 mealQuality 维度分（0-100）
   * = healthyRatio×40 + avgMealScore×0.4 + decisionBonus×20
   */
  calcMealQualityScore(signals: MealSignalAggregation): number {
    if (signals.totalMeals === 0) return 75; // 中性默认

    // 决策奖励
    let decisionBonus = 1.0;
    if (signals.decisionDistribution.stop > 0) {
      decisionBonus = 0.3;
    } else if (signals.decisionDistribution.warn > 0) {
      decisionBonus = 0.7;
    }

    const score =
      signals.healthyRatio * 40 +
      signals.avgMealScore * 0.4 +
      decisionBonus * 20;

    return this.clamp(Math.round(score));
  }

  /**
   * V1.4: 构建决策偏离度（Decision Alignment）
   */
  buildDecisionAlignment(
    signals: MealSignalAggregation,
    locale: 'zh' | 'en' | 'ja' = 'zh',
    /** V1.6: 实际摄入和目标，用于计算 per-macro 偏离 */
    intake?: { calories: number; protein: number; fat: number; carbs: number },
    goals?: { calories: number; protein: number; fat: number; carbs: number },
  ): DecisionAlignment {
    if (signals.totalMeals === 0) {
      const noDataMsg =
        locale === 'zh'
          ? '暂无饮食记录'
          : locale === 'ja'
            ? '食事記録がありません'
            : 'No meal records yet';
      return {
        alignmentScore: 0,
        deviationCount: 0,
        deviationMeals: [],
        summary: noDataMsg,
      };
    }

    const deviationCount =
      signals.decisionDistribution.warn + signals.decisionDistribution.stop;
    const alignmentScore = this.clamp(
      Math.round(
        ((signals.totalMeals - deviationCount) / signals.totalMeals) * 100,
      ),
    );

    // 偏离的餐别（简化：无法确定具体哪一餐，用 warn/stop 计数描述）
    const deviationMeals: string[] = [];
    // 没有具体餐别映射，留空

    const aligned = signals.totalMeals - deviationCount;
    const summary =
      locale === 'zh'
        ? `${signals.totalMeals}餐中${aligned}餐符合建议`
        : locale === 'ja'
          ? `${signals.totalMeals}食中${aligned}食が推奨に合致`
          : `${aligned} of ${signals.totalMeals} meals aligned with recommendations`;

    return {
      alignmentScore,
      deviationCount,
      deviationMeals,
      summary,
      macroDeviations: this.computeMacroDeviations(intake, goals, locale),
    };
  }

  /**
   * V1.6: 计算 per-macro 偏离明细
   */
  private computeMacroDeviations(
    intake?: { calories: number; protein: number; fat: number; carbs: number },
    goals?: { calories: number; protein: number; fat: number; carbs: number },
    locale: 'zh' | 'en' | 'ja' = 'zh',
  ): MacroDeviation[] {
    if (!intake || !goals) return [];
    const deviations: MacroDeviation[] = [];
    const macros = ['calories', 'protein', 'fat', 'carbs'] as const;
    const labels: Record<string, Record<'zh' | 'en' | 'ja', string>> = {
      calories: { zh: '热量', en: 'Calories', ja: 'カロリー' },
      protein: { zh: '蛋白质', en: 'Protein', ja: 'タンパク質' },
      fat: { zh: '脂肪', en: 'Fat', ja: '脂肪' },
      carbs: { zh: '碳水', en: 'Carbs', ja: '炭水化物' },
    };

    for (const macro of macros) {
      const goal = goals[macro];
      if (goal <= 0) continue;
      const pct = Math.round((intake[macro] / goal) * 100);
      if (pct < 70) {
        const name = labels[macro][locale];
        deviations.push({
          macro,
          direction: 'deficit',
          percent: pct,
          message:
            locale === 'zh'
              ? `${name}仅达目标${pct}%`
              : locale === 'ja'
                ? `${name}は目標の${pct}%のみ`
                : `${name} only ${pct}% of target`,
        });
      } else if (pct > 130) {
        const name = labels[macro][locale];
        deviations.push({
          macro,
          direction: 'excess',
          percent: pct,
          message:
            locale === 'zh'
              ? `${name}已达目标${pct}%`
              : locale === 'ja'
                ? `${name}は目標の${pct}%`
                : `${name} at ${pct}% of target`,
        });
      }
    }
    return deviations;
  }

  private rangeScore(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 100;
    const diff = value < min ? min - value : value - max;
    return this.clamp(100 - diff * 200);
  }

  /**
   * 对数映射 — 将 1-10 映射到 0-100
   * 低分区差异大（边际效用高），高分区差异小（边际效用递减）
   */
  private logScale100(value: number): number {
    const clamped = Math.max(0, Math.min(10, value));
    return (Math.log(1 + clamped) / Math.log(11)) * 100;
  }

  // ─── 每日目标计算 ───

  calculateDailyGoals(
    profile: DailyGoalProfile | null | undefined,
  ): DailyNutritionGoals {
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

  // ─── 个性化权重计算 (V1.1 Phase 1.1) ───

  /**
   * 根据用户目标和健康条件计算个性化权重
   * Layer 2: 个性化理解 (Contextual)
   *
   * 流程:
   * 1. 获取基础权重（按目标类型）
   * 2. 基于健康条件调整权重倍数
   * 3. 重新归一化使权重总和为 100%
   *
   * @param goalType 用户目标（fat_loss/muscle_gain/health/habit）
   * @param healthConditions 健康条件数组（diabetes/kidney/cholesterol等）
   * @returns 归一化后的权重对象（当前7个维度）
   */
  computePersonalizedWeights(
    goalType: string = 'health',
    healthConditions: string[] = [],
  ): Record<string, number> {
    // V1.5: 优先从运行时配置读取权重（预加载到本地缓存）
    const cfg = this.cachedWeightsConfig;

    // Step 1: 基础权重（按目标）— 配置优先，降级到硬编码
    let weights: Record<string, number> = {
      ...((cfg?.goalWeights?.[goalType] ||
        cfg?.goalWeights?.health ||
        GOAL_WEIGHTS[goalType] ||
        GOAL_WEIGHTS.health) as Record<string, number>),
    };

    // Step 2: 健康条件调整 — 配置优先，降级到硬编码
    const conditionMultipliers: Record<
      string,
      Record<string, number>
    > = cfg?.healthConditionMultipliers || {
      diabetes: { glycemicImpact: 1.5, energy: 1.2 },
      blood_sugar: { glycemicImpact: 1.5, energy: 1.2 },
      hypertension: { macroBalance: 1.2 },
      kidney: { proteinRatio: 1.3, macroBalance: 0.9 },
      cholesterol: { macroBalance: 1.3 },
      cardiovascular: { macroBalance: 1.3, foodQuality: 1.1 },
    };

    const conditions = new Set(healthConditions.map((c) => c.toLowerCase()));
    for (const cond of conditions) {
      if (conditionMultipliers[cond]) {
        const mults = conditionMultipliers[cond];
        for (const [dim, mult] of Object.entries(mults)) {
          weights[dim] = (weights[dim] || 0) * mult;
        }
      }
    }

    // Step 3: 重新归一化（权重总和 = 1.0）
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    const normalized: Record<string, number> = {};
    if (sum > 0) {
      for (const [dim, w] of Object.entries(weights)) {
        // 保留 4 位小数精度供计算，实际使用时可四舍五入
        normalized[dim] = Math.round((w / sum) * 100 * 100) / 10000;
      }
    } else {
      // Fallback 方法：默认均匀分布
      const dims = Object.keys(weights);
      const even = 1.0 / (dims.length || 7);
      for (const dim of dims) {
        normalized[dim] = even;
      }
    }

    return normalized;
  }

  // ─── 各维度评分 ───

  /**
   * 热量评分 — 高斯钟形函数（V1.3: 时间感知）
   * 接近目标最优，偏差越大分数越低。
   * σ 根据目标类型动态调整（减脂严格、增肌宽松）。
   * 非对称惩罚：减脂超标扣更重，增肌不足扣更重。
   *
   * V1.3: 当 localHour 有值时，使用时间进度曲线调整 target，
   * 避免早上因"全天目标未完成"而得 0 分。
   */
  private calcEnergyScore(
    actual: number,
    target: number,
    goal?: string,
    localHour?: number,
  ): number {
    if (target <= 0) return 80;

    // V1.3: 时间感知 — 用调整后的目标替代全天目标
    let effectiveTarget = target;
    if (localHour != null) {
      const progress = this.getExpectedProgress(localHour);
      effectiveTarget = Math.max(target * 0.1, target * progress);
    }

    const sigmaRatio: Record<string, number> = {
      fat_loss: 0.12,
      muscle_gain: 0.2,
      health: 0.25,
      habit: 0.25,
    };
    const sigma = effectiveTarget * (sigmaRatio[goal || 'health'] || 0.15);
    // V1.3: sigma 最小值保护，避免 effectiveTarget 过小时 sigma→0 导致极端评分
    const safeSigma = Math.max(sigma, target * 0.05);
    const diff = actual - effectiveTarget;
    let score = 100 * Math.exp(-(diff * diff) / (2 * safeSigma * safeSigma));

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

  /**
   * 血糖影响评分 — Sigmoid(GL)
   * 使用血糖负荷 GL = GI × 碳水(g) / 100，比 GI 更准确反映实际血糖冲击。
   * GL < 10 → ~95分（低血糖负荷）
   * GL 10-20 → ~75分（中等）
   * GL > 20 → 分数急剧下降
   */
  private calcGlycemicImpactScore(
    glycemicIndex?: number,
    carbsPerServing?: number,
  ): number {
    // 无 GI 数据 → 给中等分，不影响整体评分
    if (!glycemicIndex || glycemicIndex <= 0) return 75;
    // 无碳水数据 → 仅基于 GI 做粗略评分
    const carbs = carbsPerServing ?? 15; // 默认 15g 碳水作为 fallback
    const gl = (glycemicIndex * carbs) / 100;
    // Sigmoid: score = 100 / (1 + e^(0.3 * (GL - 15)))
    return this.clamp(100 / (1 + Math.exp(0.3 * (gl - 15))));
  }

  private calcStabilityScore(
    streakDays: number,
    avgMealsPerDay: number,
    targetMeals: number,
    complianceRate?: number,
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
    // P2.3: 合规率加权（0-1 → 0-100 × 0.3）
    if (complianceRate != null && complianceRate > 0) {
      const complianceScore = this.clamp(complianceRate * 100);
      return Math.round(
        streakScore * 0.35 + mealRegularity * 0.35 + complianceScore * 0.3,
      );
    }
    return Math.round((streakScore + mealRegularity) / 2);
  }

  // ─── 惩罚机制 ───

  private applyAdjustments(
    score: number,
    input: NutritionInput,
    streakDays?: number,
    /** V1.4: 时间感知惩罚 */
    localHour?: number,
  ): number {
    let adjusted = score;

    // V1.4: 时间感知热量超标惩罚
    // 当有 localHour 时，用调整后的目标判断超标
    let effectiveTarget = input.targetCalories;
    if (localHour != null) {
      const progress = this.getExpectedProgress(localHour);
      effectiveTarget = Math.max(
        input.targetCalories * 0.1,
        input.targetCalories * progress,
      );
    }

    // 惩罚
    if (input.calories > effectiveTarget * 1.3) {
      adjusted *= 0.7;
    }
    if (input.calories > 0 && (input.protein * 4) / input.calories < 0.1) {
      adjusted *= 0.8;
    }
    if (input.foodQuality > 0 && input.foodQuality < 2) {
      adjusted *= 0.85;
    }
    // P2.2: 连胜正向激励（7天+1.5, 14天+3, 21天+4.5, 最高+5）
    if (streakDays && streakDays >= 7) {
      adjusted += Math.min(5, Math.floor(streakDays / 7) * 1.5);
    }
    return Math.round(this.clamp(adjusted));
  }

  // ─── Highlights 生成 ───

  private generateHighlights(
    scores: NutritionScoreBreakdown,
    input: NutritionInput,
  ): string[] {
    const hl: string[] = [];

    if (input.calories > input.targetCalories * 1.3)
      hl.push(
        t('nutrition.highlight.caloriesOver', {
          percent: String(
            Math.round((input.calories / input.targetCalories - 1) * 100),
          ),
        }),
      );
    else if (scores.energy < 60)
      hl.push(
        t('nutrition.highlight.caloriesUnder', {
          percent: String(100 - scores.energy),
        }),
      );

    if (scores.proteinRatio < 50)
      hl.push(
        t('nutrition.highlight.proteinLow', {
          percent: String(100 - scores.proteinRatio),
        }),
      );
    else if (scores.proteinRatio < 70)
      hl.push(
        t('nutrition.highlight.proteinLow', {
          percent: String(100 - scores.proteinRatio),
        }),
      );

    if (scores.macroBalance < 50)
      hl.push(
        t('nutrition.highlight.carbsHigh', {
          percent: String(100 - scores.macroBalance),
        }),
      );
    if (scores.foodQuality < 40)
      hl.push(
        t('nutrition.highlight.fatHigh', {
          percent: String(100 - scores.foodQuality),
        }),
      );
    if (scores.satiety < 40)
      hl.push(
        t('nutrition.highlight.fiberLow', {
          percent: String(100 - scores.satiety),
        }),
      );
    if (scores.glycemicImpact < 40)
      hl.push(
        t('nutrition.highlight.sodiumHigh', {
          percent: String(100 - scores.glycemicImpact),
        }),
      );

    if (scores.energy >= 85) hl.push(t('nutrition.highlight.caloriesGood'));
    if (scores.proteinRatio >= 85)
      hl.push(t('nutrition.highlight.proteinGood'));
    if (scores.macroBalance >= 85) hl.push(t('nutrition.highlight.carbsGood'));
    if (scores.foodQuality >= 80) hl.push(t('nutrition.highlight.fatGood'));

    return hl.slice(0, 3);
  }

  // ─── 决策映射 ───

  private scoreToDecision(score: number): 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' {
    if (score >= 75) return 'SAFE';
    if (score >= 55) return 'OK';
    if (score >= 35) return 'LIMIT';
    return 'AVOID';
  }

  // ─── 状态解释生成 (V1.1 Phase 1.4) ───

  /**
   * 生成自然语言的状态解释文案
   * Layer 5: 状态解释 + 前端呈现
   *
   * 融合信息：
   * - 7维评分分解 (topStrength/topWeakness)
   * - 用户进度 (streakDays, complianceRate)
   * - 决策信号 (decision)
   * - 用户目标类型 (goal)
   *
   * @param breakdown 7维评分结果
   * @param goals 用户目标对象
   * @param input 营养输入（用于对比）
   * @param stabilityData 行为数据（连胜、合规率等）
   * @param decision 决策系统结果
   * @param locale 语言（zh/en）
   * @returns 自然语言解释文案
   */
  buildStatusExplanation(
    breakdown: NutritionScoreBreakdown,
    goals: DailyNutritionGoals,
    input: NutritionInput,
    stabilityData?: {
      streakDays: number;
      avgMealsPerDay: number;
      complianceRate?: number;
    },
    decision?: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID',
    locale: 'zh' | 'en' | 'ja' = 'zh',
    macroSlotStatus?: DailyMacroSlotStatus,
    /** V1.3: 用户本地小时数，用于时间感知措辞 */
    localHour?: number,
    /** V1.4: 每餐决策信号聚合 */
    mealSignals?: MealSignalAggregation,
  ): StructuredStatusExplanation {
    const segments: StatusSegment[] = [];

    // 识别强点和弱点
    const dims = [
      'energy',
      'proteinRatio',
      'macroBalance',
      'foodQuality',
      'satiety',
      'stability',
      'glycemicImpact',
    ] as const;
    const sorted = [...dims].sort((a, b) => breakdown[b] - breakdown[a]);
    const topWeakness = sorted[sorted.length - 1];

    // V1.3: 时间感知 — 早上不说"热量不足"
    const isEarlyDay = localHour != null && localHour < 14;

    // 基础状态文案（三语）— V1.6: 改为结构化 segments
    if (locale === 'zh') {
      if (breakdown.energy >= 80)
        segments.push({
          type: 'energy',
          text: '热量摄入适度，符合目标。',
          sentiment: 'positive',
        });
      else if (breakdown.energy < 40 && !isEarlyDay)
        segments.push({
          type: 'energy',
          text: '⚠️ 今日热量摄入不足，建议加餐。',
          sentiment: 'warning',
        });
      else if (isEarlyDay && breakdown.energy >= 40)
        segments.push({
          type: 'energy',
          text: '进度正常，继续保持。',
          sentiment: 'positive',
        });
      if (breakdown.satiety >= 75)
        segments.push({
          type: 'satiety',
          text: '饱腹感充分，选择恰当。',
          sentiment: 'positive',
        });
      else if (breakdown.satiety < 40)
        segments.push({
          type: 'satiety',
          text: '⚠️ 饱腹感不足，可增加纤维和蛋白质。',
          sentiment: 'warning',
        });
    } else if (locale === 'ja') {
      if (breakdown.energy >= 80)
        segments.push({
          type: 'energy',
          text: 'カロリー摂取は目標通りです。',
          sentiment: 'positive',
        });
      else if (breakdown.energy < 40 && !isEarlyDay)
        segments.push({
          type: 'energy',
          text: '⚠️ カロリー摂取が不足しています。食事を追加しましょう。',
          sentiment: 'warning',
        });
      else if (isEarlyDay && breakdown.energy >= 40)
        segments.push({
          type: 'energy',
          text: '順調です。この調子で続けましょう。',
          sentiment: 'positive',
        });
      if (breakdown.satiety >= 75)
        segments.push({
          type: 'satiety',
          text: '満腹感は十分です。',
          sentiment: 'positive',
        });
      else if (breakdown.satiety < 40)
        segments.push({
          type: 'satiety',
          text: '⚠️ 満腹感が不足しています。食物繊維やタンパク質を増やしましょう。',
          sentiment: 'warning',
        });
    } else {
      if (breakdown.energy >= 80)
        segments.push({
          type: 'energy',
          text: 'Calorie intake is on target.',
          sentiment: 'positive',
        });
      else if (breakdown.energy < 40 && !isEarlyDay)
        segments.push({
          type: 'energy',
          text: '⚠️ Calorie intake is too low. Consider adding a meal.',
          sentiment: 'warning',
        });
      else if (isEarlyDay && breakdown.energy >= 40)
        segments.push({
          type: 'energy',
          text: 'On track so far. Keep it up.',
          sentiment: 'positive',
        });
      if (breakdown.satiety >= 75)
        segments.push({
          type: 'satiety',
          text: 'Good satiety. Choices were satisfying.',
          sentiment: 'positive',
        });
      else if (breakdown.satiety < 40)
        segments.push({
          type: 'satiety',
          text: '⚠️ Low satiety. Consider adding fiber or protein.',
          sentiment: 'warning',
        });
    }

    // V1.2: 宏量槽位状态信号
    if (macroSlotStatus) {
      const slotLabels: Record<
        'zh' | 'en' | 'ja',
        Record<string, Record<string, string>>
      > = {
        zh: {
          protein: {
            deficit: '蛋白质不足',
            ok: '蛋白质正常',
            excess: '蛋白质充足',
          },
          carbs: { deficit: '碳水偏低', ok: '碳水正常', excess: '碳水偏高' },
          fat: { deficit: '脂肪偏低', ok: '脂肪正常', excess: '脂肪偏高' },
        },
        en: {
          protein: {
            deficit: 'protein low',
            ok: 'protein normal',
            excess: 'protein sufficient',
          },
          carbs: {
            deficit: 'carbs low',
            ok: 'carbs normal',
            excess: 'carbs high',
          },
          fat: { deficit: 'fat low', ok: 'fat normal', excess: 'fat high' },
        },
        ja: {
          protein: {
            deficit: 'タンパク質不足',
            ok: 'タンパク質正常',
            excess: 'タンパク質充分',
          },
          carbs: {
            deficit: '炭水化物不足',
            ok: '炭水化物正常',
            excess: '炭水化物過多',
          },
          fat: { deficit: '脂肪不足', ok: '脂肪正常', excess: '脂肪過多' },
        },
      };
      const labels = slotLabels[locale];
      // Only mention non-ok slots to keep it concise
      const nonOk = (['protein', 'carbs', 'fat'] as const).filter(
        (m) => macroSlotStatus[m] !== 'ok',
      );
      if (nonOk.length > 0) {
        const prefix =
          locale === 'zh'
            ? '宏量状态：'
            : locale === 'ja'
              ? 'マクロ状態：'
              : 'Macro status: ';
        segments.push({
          type: 'macro',
          text:
            prefix +
            nonOk
              .map((m) => labels[m][macroSlotStatus[m]])
              .join(locale === 'en' ? ', ' : '、'),
          sentiment: 'warning',
        });
      }
    }

    // 融合行为信号（连胜、合规率）
    if (stabilityData?.streakDays && stabilityData.streakDays >= 14) {
      segments.push({
        type: 'streak',
        text:
          locale === 'zh'
            ? `连胜 ${stabilityData.streakDays} 天 🔥，坚持很棒！`
            : locale === 'ja'
              ? `${stabilityData.streakDays}日連続 🔥 素晴らしい！`
              : `${stabilityData.streakDays} days streak 🔥 Keep it up!`,
        sentiment: 'positive',
      });
    } else if (stabilityData?.streakDays && stabilityData.streakDays >= 7) {
      segments.push({
        type: 'streak',
        text:
          locale === 'zh'
            ? `连胜 ${stabilityData.streakDays} 天，继续保持！`
            : locale === 'ja'
              ? `${stabilityData.streakDays}日連続、この調子で！`
              : `${stabilityData.streakDays} days streak. Keep going!`,
        sentiment: 'positive',
      });
    }

    if (stabilityData?.complianceRate && stabilityData.complianceRate >= 0.9) {
      segments.push({
        type: 'compliance',
        text:
          locale === 'zh'
            ? `目标达成率 ${Math.round(stabilityData.complianceRate * 100)}% ✅，接近完美！`
            : locale === 'ja'
              ? `目標達成率 ${Math.round(stabilityData.complianceRate * 100)}% ✅ ほぼ完璧！`
              : `${Math.round(stabilityData.complianceRate * 100)}% goal achievement ✅ Nearly perfect!`,
        sentiment: 'positive',
      });
    }

    // 融合决策信号
    if (decision === 'AVOID' && breakdown[topWeakness] < 50) {
      segments.push({
        type: 'decision',
        text:
          locale === 'zh'
            ? `💡 今日餐食与建议有偏离，${topWeakness} 维度是主要原因。`
            : locale === 'ja'
              ? `💡 本日の食事は推奨から外れています。「${topWeakness}」が主な原因です。`
              : `💡 Today's meals deviate from recommendations. "${topWeakness}" is the main concern.`,
        sentiment: 'negative',
      });
    } else if (decision === 'SAFE') {
      segments.push({
        type: 'decision',
        text:
          locale === 'zh'
            ? '✅ 符合营养建议。'
            : locale === 'ja'
              ? '✅ 栄養推奨に合致しています。'
              : '✅ Aligned with nutrition recommendations.',
        sentiment: 'positive',
      });
    }

    // V1.4: 融合每餐决策信号
    if (mealSignals && mealSignals.totalMeals > 0) {
      const { healthyRatio, decisionDistribution: dist } = mealSignals;
      if (dist.stop > 0) {
        segments.push({
          type: 'meal_signal',
          text:
            locale === 'zh'
              ? `⚠️ 今日有${dist.stop}餐被标记为不建议食用。`
              : locale === 'ja'
                ? `⚠️ 本日${dist.stop}食が非推奨と判定されました。`
                : `⚠️ ${dist.stop} meal(s) flagged as not recommended today.`,
          sentiment: 'negative',
        });
      } else if (healthyRatio >= 0.8) {
        segments.push({
          type: 'meal_signal',
          text:
            locale === 'zh'
              ? `✅ ${Math.round(healthyRatio * 100)}%的餐食被评为健康。`
              : locale === 'ja'
                ? `✅ ${Math.round(healthyRatio * 100)}%の食事が健康的と評価されました。`
                : `✅ ${Math.round(healthyRatio * 100)}% of meals rated as healthy.`,
          sentiment: 'positive',
        });
      } else if (dist.warn > 0) {
        segments.push({
          type: 'meal_signal',
          text:
            locale === 'zh'
              ? `💡 今日有${dist.warn}餐需要注意饮食搭配。`
              : locale === 'ja'
                ? `💡 本日${dist.warn}食は食事バランスに注意が必要です。`
                : `💡 ${dist.warn} meal(s) need dietary balance attention.`,
          sentiment: 'warning',
        });
      }
    }

    // 针对最弱维度给出改善建议
    if (topWeakness && breakdown[topWeakness] < 60) {
      const tips: Record<string, Record<string, string>> = {
        satiety: {
          zh: '💡 建议下餐增加高纤维或高蛋白食物。',
          en: '💡 Next meal: add high-fiber or high-protein foods.',
          ja: '💡 次の食事では食物繊維やタンパク質を増やしましょう。',
        },
        energy: {
          zh: isEarlyDay
            ? '💡 继续均衡饮食，注意下一餐的搭配。'
            : '💡 热量偏低，建议加餐或增加份量。',
          en: isEarlyDay
            ? '💡 Keep eating balanced. Focus on your next meal.'
            : '💡 Calories are low. Add a snack or increase portions.',
          ja: isEarlyDay
            ? '💡 バランスの良い食事を続けましょう。次の食事に注目。'
            : '💡 カロリーが低いです。間食を追加するか量を増やしましょう。',
        },
        glycemicImpact: {
          zh: '💡 血糖波动较大，建议选择低GI食物。',
          en: '💡 Blood sugar impact is high. Choose low-GI foods.',
          ja: '💡 血糖値への影響が大きいです。低GI食品を選びましょう。',
        },
        foodQuality: {
          zh: '💡 食物质量可改进，选择更营养密集的食物。',
          en: '💡 Food quality can improve. Choose nutrient-dense foods.',
          ja: '💡 食事の質を改善できます。栄養密度の高い食品を選びましょう。',
        },
      };

      if (tips[topWeakness]) {
        segments.push({
          type: 'tip',
          text: tips[topWeakness][locale],
          sentiment: 'neutral',
        });
      }
    }

    const text = segments
      .map((s) => s.text)
      .filter(Boolean)
      .join(' ');
    return { text, segments };
  }

  // ─── V1.2: 宏量槽位状态检测 ───

  /**
   * 计算四维宏量槽位状态（deficit/ok/excess）
   * 与 ContextualAnalysis.macroSlotStatus 逻辑等价，但无跨模块依赖
   */
  computeMacroSlotStatus(
    intake: { calories: number; protein: number; fat: number; carbs: number },
    goals: { calories: number; protein: number; fat: number; carbs: number },
    /** V1.3: 用户本地小时数，用于时间感知阈值 */
    localHour?: number,
  ): DailyMacroSlotStatus {
    // V1.3: 时间感知 — deficit 阈值按时间进度调整
    const expectedProg =
      localHour != null ? this.getExpectedProgress(localHour) : 1.0;
    const deficitRatio = Math.max(0.15, expectedProg * 0.7);

    const classify = (
      consumed: number,
      goal: number,
    ): 'deficit' | 'ok' | 'excess' => {
      if (goal <= 0) return 'ok';
      const ratio = consumed / goal;
      if (ratio < deficitRatio) return 'deficit';
      if (ratio > 1.15) return 'excess';
      return 'ok';
    };

    const status: DailyMacroSlotStatus = {
      calories: classify(intake.calories, goals.calories),
      protein: classify(intake.protein, goals.protein),
      fat: classify(intake.fat, goals.fat),
      carbs: classify(intake.carbs, goals.carbs),
    };

    // 找最大缺口和最大超标
    const macros = ['calories', 'protein', 'fat', 'carbs'] as const;
    let maxDeficitRatio = Infinity;
    let maxExcessRatio = 0;
    for (const m of macros) {
      const goal = goals[m];
      if (goal <= 0) continue;
      const ratio = intake[m] / goal;
      if (status[m] === 'deficit' && ratio < maxDeficitRatio) {
        maxDeficitRatio = ratio;
        status.dominantDeficit = m;
      }
      if (status[m] === 'excess' && ratio > maxExcessRatio) {
        maxExcessRatio = ratio;
        status.dominantExcess = m;
      }
    }

    return status;
  }

  // ─── V1.2: 结构化问题识别 ───

  /**
   * 从营养数据直接检测问题，返回结构化问题列表
   * 与 ContextualAnalysis.identifiedIssues 等价但轻量
   */
  detectIssueHighlights(
    intake: { calories: number; protein: number; fat: number; carbs: number },
    goals: { calories: number; protein: number; fat: number; carbs: number },
    breakdown: NutritionScoreBreakdown,
    mealCount: number,
    locale: 'zh' | 'en' | 'ja' = 'zh',
    /** V1.3: 用户本地小时数，用于时间感知阈值 */
    localHour?: number,
  ): IssueHighlight[] {
    const issues: IssueHighlight[] = [];
    if (mealCount === 0) return issues;

    const MSGS: Record<
      string,
      Record<'zh' | 'en' | 'ja', (pct: number) => string>
    > = {
      calorie_excess: {
        zh: (p) => `热量超标，已达目标的${p}%`,
        en: (p) => `Calorie intake at ${p}% of target — over limit`,
        ja: (p) => `カロリー超過、目標の${p}%に到達`,
      },
      calorie_deficit: {
        zh: (p) => `热量严重不足，仅达目标的${p}%`,
        en: (p) => `Calorie intake critically low — only ${p}% of target`,
        ja: (p) => `カロリー大幅不足、目標のわずか${p}%`,
      },
      protein_deficit: {
        zh: (p) => `蛋白质摄入不足，仅达目标的${p}%`,
        en: (p) => `Protein intake low — only ${p}% of target`,
        ja: (p) => `タンパク質不足、目標のわずか${p}%`,
      },
      fat_excess: {
        zh: (p) => `脂肪摄入偏高，已达目标的${p}%`,
        en: (p) => `Fat intake high — ${p}% of target`,
        ja: (p) => `脂肪摂取過多、目標の${p}%`,
      },
      carbs_excess: {
        zh: (p) => `碳水摄入偏高，已达目标的${p}%`,
        en: (p) => `Carb intake high — ${p}% of target`,
        ja: (p) => `炭水化物摂取過多、目標の${p}%`,
      },
      low_quality: {
        zh: () => '食物质量偏低，建议选择营养密度更高的食物',
        en: () => 'Food quality is low — choose more nutrient-dense options',
        ja: () => '食事の質が低い、栄養密度の高い食品を選びましょう',
      },
      low_satiety: {
        zh: () => '饱腹感不足，建议增加纤维和蛋白质',
        en: () => 'Low satiety — add more fiber and protein',
        ja: () => '満腹感不足、食物繊維とタンパク質を増やしましょう',
      },
      glycemic_risk: {
        zh: () => '血糖波动风险较大，建议选择低GI食物',
        en: () => 'High glycemic impact — choose low-GI foods',
        ja: () => '血糖値変動リスクが高い、低GI食品を選びましょう',
      },
    };

    const pct = (consumed: number, goal: number) =>
      goal > 0 ? Math.round((consumed / goal) * 100) : 0;

    // Calorie checks — V1.3: 时间感知阈值
    const calPct = pct(intake.calories, goals.calories);
    const expectedProg =
      localHour != null ? this.getExpectedProgress(localHour) : 1.0;
    // 超标阈值：expectedProgress × 130% + 30% 缓冲（最低 130%）
    const excessThreshold = Math.max(130, Math.round(expectedProg * 130 + 30));
    // 不足阈值：expectedProgress × 50%（最低 15%，防止极端）
    const deficitThreshold = Math.max(15, Math.round(expectedProg * 50));

    if (calPct > excessThreshold) {
      issues.push({
        type: 'calorie_excess',
        severity: 'high',
        message: MSGS.calorie_excess[locale](calPct),
      });
    } else if (calPct < deficitThreshold && mealCount >= 2) {
      issues.push({
        type: 'calorie_deficit',
        severity: 'high',
        message: MSGS.calorie_deficit[locale](calPct),
      });
    }

    // Protein
    const protPct = pct(intake.protein, goals.protein);
    if (protPct < 60) {
      issues.push({
        type: 'protein_deficit',
        severity: 'high',
        message: MSGS.protein_deficit[locale](protPct),
      });
    }

    // Fat
    const fatPct = pct(intake.fat, goals.fat);
    if (fatPct > 130) {
      issues.push({
        type: 'fat_excess',
        severity: 'medium',
        message: MSGS.fat_excess[locale](fatPct),
      });
    }

    // Carbs
    const carbPct = pct(intake.carbs, goals.carbs);
    if (carbPct > 140) {
      issues.push({
        type: 'carbs_excess',
        severity: 'medium',
        message: MSGS.carbs_excess[locale](carbPct),
      });
    }

    // Quality / satiety / glycemic
    if (breakdown.foodQuality < 40) {
      issues.push({
        type: 'low_quality',
        severity: 'medium',
        message: MSGS.low_quality[locale](0),
      });
    }
    if (breakdown.satiety < 40) {
      issues.push({
        type: 'low_satiety',
        severity: 'low',
        message: MSGS.low_satiety[locale](0),
      });
    }
    if (breakdown.glycemicImpact < 40) {
      issues.push({
        type: 'glycemic_risk',
        severity: 'medium',
        message: MSGS.glycemic_risk[locale](0),
      });
    }

    // Sort by severity
    const SEV_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
    return issues;
  }

  // ─── 核心：综合评分 ───

  calculateScore(
    input: NutritionInput,
    goal: string,
    stabilityData?: {
      streakDays: number;
      avgMealsPerDay: number;
      targetMeals: number;
      /** P2.2: 近 30 天合规率 0-1 */
      complianceRate?: number;
    },
    /** P2.1: 用户健康条件，用于动态调整维度权重 */
    healthConditions?: string[],
    /** V1.3: 用户本地小时数（0-23），用于时间感知评分 */
    localHour?: number,
    /** V1.4: 每餐决策信号聚合，用于 mealQuality 维度 */
    mealSignals?: MealSignalAggregation,
  ): NutritionScoreResult {
    const energy = this.calcEnergyScore(
      input.calories,
      input.targetCalories,
      goal,
      localHour,
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
    const foodQuality = this.logScale100(input.foodQuality);
    const satiety = this.logScale100(input.satiety);
    const stability = stabilityData
      ? this.calcStabilityScore(
          stabilityData.streakDays,
          stabilityData.avgMealsPerDay,
          stabilityData.targetMeals,
          stabilityData.complianceRate,
        )
      : 80;
    const glycemicImpact = this.calcGlycemicImpactScore(
      input.glycemicIndex,
      input.carbsPerServing,
    );
    // V1.4: 餐食质量综合分
    const mealQuality = mealSignals
      ? this.calcMealQualityScore(mealSignals)
      : 75;

    // Layer 2: 个性化权重计算 (V1.1 Phase 1)
    let w = this.computePersonalizedWeights(goal, healthConditions || []);

    // 处理零值维度：当 foodQuality/satiety 数据缺失（值 <= 0）时，
    // 将其权重分摊给有数据的维度（保证总权重 = 1.0）
    const zeroDataDims: string[] = [];
    if (input.foodQuality <= 0) zeroDataDims.push('foodQuality');
    if (input.satiety <= 0) zeroDataDims.push('satiety');

    if (zeroDataDims.length > 0) {
      let redistributed = 0;
      for (const dim of zeroDataDims) {
        redistributed += w[dim] || 0;
        w[dim] = 0;
      }
      // 按比例分摊给有数据的维度
      const activeDims = Object.keys(w).filter(
        (k) => w[k] > 0 && !zeroDataDims.includes(k),
      );
      const activeTotal = activeDims.reduce((s, k) => s + w[k], 0);
      if (activeTotal > 0) {
        for (const k of activeDims) {
          w[k] += redistributed * (w[k] / activeTotal);
        }
      }
    }

    // Layer 1 + Layer 2: 加权求和（权重单位已归一化为 0-1）
    let score =
      energy * (w.energy || 0) +
      proteinRatio * (w.proteinRatio || 0) +
      macroBalance * (w.macroBalance || 0) +
      foodQuality * (w.foodQuality || 0) +
      satiety * (w.satiety || 0) +
      stability * (w.stability || 0) +
      glycemicImpact * (w.glycemicImpact || 0) +
      mealQuality * (w.mealQuality || 0);

    score = this.applyAdjustments(
      score,
      input,
      stabilityData?.streakDays,
      localHour,
    );

    const breakdown = {
      energy,
      proteinRatio,
      macroBalance,
      foodQuality,
      satiety,
      stability,
      glycemicImpact,
      mealQuality,
    };
    const highlights = this.generateHighlights(breakdown, input);
    const decision = this.scoreToDecision(score);

    return {
      score: Math.round(score),
      breakdown,
      highlights,
      decision,
      weights: w,
      weightsSource: this.cachedWeightsConfig ? 'config' : 'default',
    };
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
    if (warns.length === 0) return t('nutrition.feedback.allGood');

    const GOAL_TIPS: Record<string, string> = {
      fat_loss:
        t('nutrition.feedback.separator') +
        t('nutrition.feedback.caloriesTip', { direction: '' }),
      muscle_gain:
        t('nutrition.feedback.separator') +
        t('nutrition.feedback.proteinTip', { direction: '' }),
      health:
        t('nutrition.feedback.separator') +
        t('nutrition.feedback.fatTip', { direction: '' }),
      habit:
        t('nutrition.feedback.separator') +
        t('nutrition.feedback.carbsTip', { direction: '' }),
    };

    return (
      warns
        .map((w) => w.replace('⚠️ ', ''))
        .join(t('nutrition.feedback.separator')) + (GOAL_TIPS[goal] || '')
    );
  }
}
