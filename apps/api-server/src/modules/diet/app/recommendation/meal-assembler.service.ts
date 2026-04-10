import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import {
  ScoredFood,
  MealTarget,
  MealRecommendation,
  FoodFeedbackStats,
} from './recommendation.types';
import { t } from './i18n-messages';

@Injectable()
export class MealAssemblerService {
  /**
   * 多维多样性控制
   * - 排除最近吃过的食物名
   * - 限制同一 category 最多2个
   * - 限制同一 mainIngredient 最多1个（避免"鸡胸沙拉"+"白切鸡"同时出现）
   * - 限制同一 foodGroup 最多2个（确保食物组均衡）
   */
  diversify(
    foods: ScoredFood[],
    recentFoodNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    const result: ScoredFood[] = [];
    const usedCategories = new Set<string>();
    const usedIngredients = new Set<string>();
    const usedFoodGroups = new Map<string, number>();

    for (const sf of foods) {
      if (result.length >= limit) break;
      if (recentFoodNames.includes(sf.food.name)) continue;

      // category 级别：同分类最多2个
      if (
        usedCategories.has(sf.food.category) &&
        result.filter((r) => r.food.category === sf.food.category).length >= 2
      )
        continue;

      // mainIngredient 级别：同主料最多1个
      const ingredient = sf.food.mainIngredient || '';
      if (ingredient && usedIngredients.has(ingredient)) continue;

      // foodGroup 级别：同食物组最多2个
      const group = sf.food.foodGroup || '';
      if (group && (usedFoodGroups.get(group) || 0) >= 2) continue;

      result.push(sf);
      usedCategories.add(sf.food.category);
      if (ingredient) usedIngredients.add(ingredient);
      if (group)
        usedFoodGroups.set(group, (usedFoodGroups.get(group) || 0) + 1);
    }

    // 兜底：如果约束太严导致选不够，放宽约束补足
    if (result.length < limit) {
      for (const sf of foods) {
        if (result.length >= limit) break;
        if (!result.includes(sf)) result.push(sf);
      }
    }

    return result;
  }

  /** 相似度惩罚多样化（用于每日计划） */
  diversifyWithPenalty(
    scored: ScoredFood[],
    excludeNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    const candidates = scored.filter(
      (sf) => !excludeNames.includes(sf.food.name),
    );
    const result: ScoredFood[] = [];

    const remaining = [...candidates];
    while (result.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      remaining.forEach((item, i) => {
        let penalty = 0;
        for (const selected of result) {
          penalty += this.similarity(item.food, selected.food) * 0.3;
        }
        const finalScore = item.score - penalty;
        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestIdx = i;
        }
      });

      result.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return result;
  }

  /**
   * Thompson Sampling 探索（V6 2.6: 自适应探索范围）
   *
   * 每个食物从 Beta(α, β) 分布中采样一个探索系数 ∈ [0, 1]，
   * 映射到 [minMult, maxMult] 后乘以原始分数，再排序。
   *
   * - 新食物（无反馈）→ Beta(1,1) = 均匀分布 → 探索系数随机 → 有机会被推到前面
   * - 多次接受的食物 → Beta(大α, 小β) → 采样集中在高端 → 稳定加分
   * - 多次拒绝的食物 → Beta(小α, 大β) → 采样集中在低端 → 自然沉底
   *
   * V6 2.6: explorationRange 参数由推荐引擎根据用户成熟度自适应计算
   * - 新用户: [0.3, 1.7] — 高探索
   * - 成熟用户: [0.7, 1.3] — 高利用
   *
   * @param scored 已评分的食物列表
   * @param feedbackStats 每个食物名的反馈统计 {accepted, rejected}
   * @param explorationRange 探索系数映射范围 [min, max]（默认 [0.5, 1.5]，向后兼容）
   */
  addExploration(
    scored: ScoredFood[],
    feedbackStats?: Record<string, FoodFeedbackStats>,
    explorationRange?: [number, number],
  ): ScoredFood[] {
    const [minMult, maxMult] = explorationRange ?? [0.5, 1.5];
    return scored
      .map((sf) => {
        const stats = feedbackStats?.[sf.food.name];
        // Beta 先验: α = accepted + 1, β = rejected + 1
        const alpha = (stats?.accepted ?? 0) + 1;
        const beta = (stats?.rejected ?? 0) + 1;
        // 从 Beta(α, β) 采样，映射到 [minMult, maxMult] 作为探索系数
        const sample = this.sampleBeta(alpha, beta);
        const explorationMultiplier = minMult + sample * (maxMult - minMult);
        return {
          ...sf,
          score: sf.score * explorationMultiplier,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Beta 分布采样 — Jöhnk's algorithm
   * 对于 α,β 均较小的场景（典型反馈次数 <100），该算法高效且精确
   */
  private sampleBeta(alpha: number, beta: number): number {
    // 特殊情况: Beta(1,1) = Uniform(0,1)
    if (alpha === 1 && beta === 1) return Math.random();

    const gammaA = this.sampleGamma(alpha);
    const gammaB = this.sampleGamma(beta);
    const sum = gammaA + gammaB;
    if (sum === 0) return 0.5;
    return gammaA / sum;
  }

  /**
   * Gamma 分布采样 — Marsaglia & Tsang's method
   * 用于通过 Gamma 采样构造 Beta 分布: Beta(a,b) = Ga(a) / (Ga(a) + Ga(b))
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      // shape < 1: 用 shape+1 采样后做幂变换
      const g = this.sampleGamma(shape + 1);
      return g * Math.pow(Math.random(), 1 / shape);
    }

    // Marsaglia & Tsang's method for shape >= 1
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.sampleStdNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Box-Muller 标准正态分布采样 */
  private sampleStdNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** 份量调整：缩放到目标预算，支持边界裁剪 + 步进量化 */
  adjustPortions(picks: ScoredFood[], budget: number): ScoredFood[] {
    const totalCal = picks.reduce((s, p) => s + p.servingCalories, 0);
    if (totalCal <= 0) return picks;

    const globalRatio = budget / totalCal;
    if (Math.abs(globalRatio - 1) < 0.05) return picks;

    // 第一轮: 逐个食物计算最佳缩放比，受边界约束
    const adjusted = picks.map((p) => {
      const portions = p.food.commonPortions || [];
      let minRatio = 0.5;
      let maxRatio = 2.0;

      if (portions.length > 0) {
        const standardG = p.food.standardServingG || 100;
        const portionGrams = portions.map((pt) => pt.grams);
        const minG = Math.min(...portionGrams);
        const maxG = Math.max(...portionGrams);
        minRatio = Math.max(0.5, minG / standardG);
        maxRatio = Math.min(2.0, maxG / standardG);
      }

      // 裁剪到边界范围
      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, globalRatio));
      // 步进量化到 0.25 步长（对应"半份、3/4份、1份、1.25份..."）
      const quantizedRatio = Math.round(clampedRatio * 4) / 4;
      // 量化后再裁剪一次确保不越界
      const finalRatio = Math.max(minRatio, Math.min(maxRatio, quantizedRatio));

      return {
        ...p,
        servingCalories: Math.round(p.servingCalories * finalRatio),
        servingProtein: Math.round(p.servingProtein * finalRatio),
        servingFat: Math.round(p.servingFat * finalRatio),
        servingCarbs: Math.round(p.servingCarbs * finalRatio),
      };
    });

    // 第二轮: 如果总热量偏差 >15%，找余量最大的食物微调
    const adjustedTotal = adjusted.reduce((s, p) => s + p.servingCalories, 0);
    const deviation = (adjustedTotal - budget) / budget;

    if (Math.abs(deviation) > 0.15 && adjusted.length > 1) {
      // 找到可调整幅度最大的食物进行二次微调
      let bestIdx = 0;
      let bestSlack = 0;

      for (let i = 0; i < adjusted.length; i++) {
        const original = picks[i].servingCalories;
        const current = adjusted[i].servingCalories;
        const portions = picks[i].food.commonPortions || [];
        const standardG = picks[i].food.standardServingG || 100;

        let maxR = 2.0;
        let minR = 0.5;
        if (portions.length > 0) {
          const portionGrams = portions.map((pt) => pt.grams);
          minR = Math.max(0.5, Math.min(...portionGrams) / standardG);
          maxR = Math.min(2.0, Math.max(...portionGrams) / standardG);
        }

        const slack =
          deviation > 0
            ? current - original * minR // 可减少的空间
            : original * maxR - current; // 可增加的空间

        if (slack > bestSlack) {
          bestSlack = slack;
          bestIdx = i;
        }
      }

      // 微调该食物的热量来补偿偏差
      const calDiff = adjustedTotal - budget;
      const maxAdj = Math.min(Math.abs(calDiff), bestSlack);
      const adj = calDiff > 0 ? -maxAdj : maxAdj;

      if (adjusted[bestIdx].servingCalories > 0) {
        const adjRatio =
          (adjusted[bestIdx].servingCalories + adj) /
          adjusted[bestIdx].servingCalories;
        adjusted[bestIdx] = {
          ...adjusted[bestIdx],
          servingCalories: Math.round(
            adjusted[bestIdx].servingCalories * adjRatio,
          ),
          servingProtein: Math.round(
            adjusted[bestIdx].servingProtein * adjRatio,
          ),
          servingFat: Math.round(adjusted[bestIdx].servingFat * adjRatio),
          servingCarbs: Math.round(adjusted[bestIdx].servingCarbs * adjRatio),
        };
      }
    }

    return adjusted;
  }

  /** 聚合推荐结果 */
  aggregateMealResult(picks: ScoredFood[], tip: string): MealRecommendation {
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);
    const displayText = picks
      .map((p) =>
        t('display.foodItem', {
          name: p.food.name,
          serving: p.food.standardServingDesc || '',
          calories: p.servingCalories,
        }),
      )
      .join(' + ');
    return {
      foods: picks,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      displayText,
      tip,
    };
  }

  /** 构建推荐提示 (V4: i18n) */
  buildTip(
    mealType: string,
    goalType: string,
    target: MealTarget,
    actualCal: number,
  ): string {
    const tips: string[] = [];

    if (actualCal > target.calories * 1.1) {
      tips.push(t('tip.caloriesOver'));
    } else if (actualCal < target.calories * 0.7) {
      tips.push(t('tip.caloriesUnder'));
    }

    const goalTipKey = `tip.goal.${goalType}`;
    tips.push(
      t(goalTipKey) !== goalTipKey ? t(goalTipKey) : t('tip.goal.health'),
    );

    const mealTipKey = `tip.meal.${mealType}`;
    const mealTip = t(mealTipKey);
    if (mealTip !== mealTipKey) tips.push(mealTip);

    return tips.filter(Boolean).join('；');
  }

  /** 食物相似度计算 */
  similarity(a: FoodLibrary, b: FoodLibrary): number {
    let score = 0;
    if (a.category === b.category) score += 0.3;

    const mainA = a.mainIngredient || '';
    const mainB = b.mainIngredient || '';
    if (mainA && mainB && mainA === mainB) score += 0.5;

    const subA = a.subCategory || '';
    const subB = b.subCategory || '';
    if (subA && subB && subA === subB) score += 0.2;

    const tagsA = a.tags || [];
    const tagsB = b.tags || [];
    score += tagsA.filter((t) => tagsB.includes(t)).length * 0.05;

    return Math.min(score, 1);
  }

  /**
   * V4 Phase 2.7 — 食物搭配关系加分/减分 (E5)
   *
   * 利用 FoodLibrary.compatibility 的 goodWith / badWith 数据，
   * 对候选食物与已选食物的搭配关系进行评分调整。
   *
   * 匹配逻辑：goodWith/badWith 中的字符串可以匹配食物名或食物分类。
   *
   * @param candidate  候选食物
   * @param picks      已选食物列表
   * @returns 搭配加分 (正=互补/推荐搭配, 负=不宜同食)
   *          典型范围: [-0.15, +0.15]
   */
  compatibilityBonus(candidate: FoodLibrary, picks: FoodLibrary[]): number {
    if (picks.length === 0) return 0;

    let bonus = 0;
    const candidateCompat = candidate.compatibility || {};
    const candidateGoodWith: string[] = candidateCompat['goodWith'] || [];
    const candidateBadWith: string[] = candidateCompat['badWith'] || [];

    for (const pick of picks) {
      const pickCompat = pick.compatibility || {};
      const pickGoodWith: string[] = pickCompat['goodWith'] || [];
      const pickBadWith: string[] = pickCompat['badWith'] || [];

      // 正向：候选的 goodWith 匹配已选的名字/分类
      if (
        candidateGoodWith.some(
          (g) =>
            g === pick.name || g === pick.category || g === pick.mainIngredient,
        )
      ) {
        bonus += 0.05;
      }

      // 正向：已选的 goodWith 匹配候选的名字/分类
      if (
        pickGoodWith.some(
          (g) =>
            g === candidate.name ||
            g === candidate.category ||
            g === candidate.mainIngredient,
        )
      ) {
        bonus += 0.05;
      }

      // 负向：候选的 badWith 匹配已选
      if (
        candidateBadWith.some(
          (b) =>
            b === pick.name || b === pick.category || b === pick.mainIngredient,
        )
      ) {
        bonus -= 0.1;
      }

      // 负向：已选的 badWith 匹配候选
      if (
        pickBadWith.some(
          (b) =>
            b === candidate.name ||
            b === candidate.category ||
            b === candidate.mainIngredient,
        )
      ) {
        bonus -= 0.1;
      }
    }

    // 裁剪到合理范围
    return Math.max(-0.15, Math.min(0.15, bonus));
  }
}
