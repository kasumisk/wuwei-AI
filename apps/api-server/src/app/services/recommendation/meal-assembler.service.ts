import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../entities/food-library.entity';
import {
  ScoredFood,
  MealTarget,
  MealRecommendation,
} from './recommendation.types';

@Injectable()
export class MealAssemblerService {
  /** 简单多样性控制 */
  diversify(
    foods: ScoredFood[],
    recentFoodNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    const result: ScoredFood[] = [];
    const usedCategories = new Set<string>();

    for (const sf of foods) {
      if (result.length >= limit) break;
      if (recentFoodNames.includes(sf.food.name)) continue;
      if (
        usedCategories.has(sf.food.category) &&
        result.filter((r) => r.food.category === sf.food.category).length >= 2
      )
        continue;

      result.push(sf);
      usedCategories.add(sf.food.category);
    }

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

  /** ε-greedy 随机探索 */
  addExploration(scored: ScoredFood[], epsilon: number = 0.15): ScoredFood[] {
    return scored
      .map((sf) => ({
        ...sf,
        score: sf.score * (1 + (Math.random() - 0.5) * epsilon),
      }))
      .sort((a, b) => b.score - a.score);
  }

  /** 份量调整：缩放到目标预算 */
  adjustPortions(picks: ScoredFood[], budget: number): ScoredFood[] {
    const totalCal = picks.reduce((s, p) => s + p.servingCalories, 0);
    if (totalCal <= 0) return picks;

    const globalRatio = budget / totalCal;
    if (Math.abs(globalRatio - 1) < 0.05) return picks;

    return picks.map((p) => {
      const portions = p.food.commonPortions || [];
      let minRatio = 0.6;
      let maxRatio = 1.5;

      if (portions.length > 0) {
        const standardG = p.food.standardServingG || 100;
        const portionGrams = portions.map((pt) => pt.grams);
        const minG = Math.min(...portionGrams);
        const maxG = Math.max(...portionGrams);
        minRatio = Math.max(0.5, minG / standardG);
        maxRatio = Math.min(2.0, maxG / standardG);
      }

      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, globalRatio));

      return {
        ...p,
        servingCalories: Math.round(p.servingCalories * clampedRatio),
        servingProtein: Math.round(p.servingProtein * clampedRatio),
        servingFat: Math.round(p.servingFat * clampedRatio),
        servingCarbs: Math.round(p.servingCarbs * clampedRatio),
      };
    });
  }

  /** 聚合推荐结果 */
  aggregateMealResult(picks: ScoredFood[], tip: string): MealRecommendation {
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);
    const displayText = picks
      .map(
        (p) =>
          `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`,
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

  /** 构建推荐提示 */
  buildTip(
    mealType: string,
    goalType: string,
    target: MealTarget,
    actualCal: number,
  ): string {
    const tips: string[] = [];

    if (actualCal > target.calories * 1.1) {
      tips.push('推荐总热量略超预算，可减少份量');
    } else if (actualCal < target.calories * 0.7) {
      tips.push('推荐量偏少，可适当加一份水果或酸奶');
    }

    const goalTip: Record<string, string> = {
      fat_loss: '减脂期优先高蛋白低脂食物',
      muscle_gain: '增肌期碳水蛋白并重',
      health: '均衡搭配，注意蔬果',
      habit: '保持规律即可',
    };
    tips.push(goalTip[goalType] || goalTip.health);

    const mealTip: Record<string, string> = {
      breakfast: '早餐注意蛋白质摄入',
      lunch: '午餐是一天的能量主力',
      dinner: '晚餐清淡为主',
      snack: '加餐控量，选择健康零食',
    };
    tips.push(mealTip[mealType] || '');

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
}
