import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodScorerService } from './food-scorer.service';
import { MealAssemblerService } from './meal-assembler.service';
import {
  UserProfileConstraints,
  UserPreferenceProfile,
} from './recommendation.types';
import { filterByAllergens } from './allergen-filter.util';

/**
 * V4 E7: 相关品类映射 — 当同品类候选不足时，扩展到营养功能相近的品类
 *
 * 设计原则:
 * - protein ↔ dairy: 都是蛋白质来源
 * - grain ↔ composite: 都是碳水主食
 * - veggie ↔ fruit: 都是微量营养素来源
 * - snack ↔ fruit: 健康零食和水果可互替
 */
const RELATED_CATEGORIES: Record<string, string[]> = {
  protein: ['dairy'],
  dairy: ['protein'],
  grain: ['composite'],
  composite: ['grain'],
  veggie: ['fruit'],
  fruit: ['veggie', 'snack'],
  snack: ['fruit'],
  beverage: [],
  fat: [],
  condiment: [],
};

/**
 * 替代候选项 — findSubstitutes() 返回结构
 */
export interface SubstituteCandidate {
  food: any;
  /** 综合替代评分 (0~1) */
  substituteScore: number;
  /** 与原食物的相似度 (0~1) */
  similarity: number;
  /** 营养接近度 (0~1) */
  nutritionProximity: number;
  /** 每标准份营养 */
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
  /** 历史替换次数（0 = 无历史） */
  historicalCount: number;
  /** V4 E7: 是否为跨品类替代（供前端标注"营养等价替代"） */
  crossCategory: boolean;
}

/**
 * 食物替代服务 (V4 Phase 2.2 — 从 RecommendationEngineService 提取)
 *
 * 职责:
 * - 为指定食物查找替代候选: findSubstitutes()
 * - 查询用户历史替换模式: getReplacementHistory()
 *
 * 算法流程:
 * 1. 加载原食物 → 确定 category / mainIngredient / 营养基线
 * 2. 筛选同 category 的候选（扩展到相近分类兜底）
 * 3. 排除过敏原 + 用户 avoids
 * 4. 对每个候选计算综合替代评分:
 *    - 相似度 (0~1)  × 0.35
 *    - 营养接近度     × 0.30
 *    - 历史替换偏好   × 0.20
 *    - 用户画像加分   × 0.15
 * 5. 排序返回 Top-K
 */
@Injectable()
export class SubstitutionService {
  private readonly logger = new Logger(SubstitutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
  ) {}

  /**
   * 为指定食物查找替代候选
   *
   * @param foodId      原食物ID
   * @param userId      用户ID（用于查历史替换模式和偏好）
   * @param mealType    餐次（用于 mealTypes 过滤）
   * @param topK        返回数量（默认5）
   * @param excludeNames 额外排除的食物名（如当餐已选食物）
   * @param userConstraints 用户约束（过敏原、健康状况等）
   * @param preferenceProfile 用户偏好画像
   */
  async findSubstitutes(
    foodId: string,
    userId: string,
    mealType?: string,
    topK = 5,
    excludeNames: string[] = [],
    userConstraints?: UserProfileConstraints,
    preferenceProfile?: UserPreferenceProfile,
  ): Promise<SubstituteCandidate[]> {
    // 1. 加载原食物
    const originalFood = await this.prisma.foods.findFirst({
      where: { id: foodId },
    });
    if (!originalFood) {
      this.logger.warn(`替代查找失败: 食物 ${foodId} 不存在`);
      return [];
    }

    // 2. 加载候选池 — 同 category 优先，V4 E7: 不足时扩展到相关品类
    let candidates = await this.prisma.foods.findMany({
      where: { is_verified: true, category: originalFood.category },
    });

    // 排除自身
    candidates = candidates.filter((f) => f.id !== originalFood.id);

    // 标记同品类候选
    const sameCategoryCandidateIds = new Set(candidates.map((f) => f.id));

    // V4 E7: 如果同品类候选不足 3 个，扩展到相关品类
    const MIN_SAME_CATEGORY = 3;
    if (candidates.length < MIN_SAME_CATEGORY) {
      const relatedCategories = RELATED_CATEGORIES[originalFood.category] || [];
      if (relatedCategories.length > 0) {
        const crossCandidates = await this.prisma.foods.findMany({
          where: {
            is_verified: true,
            category: { in: relatedCategories },
            id: { not: originalFood.id },
          },
        });
        // 合并，去重
        const existingIds = new Set(candidates.map((c) => c.id));
        for (const cc of crossCandidates) {
          if (!existingIds.has(cc.id)) {
            candidates.push(cc);
          }
        }
      }
    }

    // mealType 过滤
    if (mealType) {
      const mtFiltered = candidates.filter((f) => {
        const mt: string[] = (f as any).meal_types || [];
        return mt.length === 0 || mt.includes(mealType);
      });
      // 兜底：如果过滤后太少，保留未过滤集
      if (mtFiltered.length >= 3) candidates = mtFiltered;
    }

    // 排除过敏原 — 统一使用 allergen-filter.util (V4 A6)
    if (userConstraints?.allergens?.length) {
      candidates = filterByAllergens(
        candidates as any,
        userConstraints.allergens,
      ) as any;
    }

    // 排除 excludeNames
    if (excludeNames.length > 0) {
      const excludeSet = new Set(excludeNames);
      candidates = candidates.filter((f) => !excludeSet.has(f.name));
    }

    if (candidates.length === 0) return [];

    // 3. 加载历史替换模式（原食物→? 的频率）
    const replacementMap = await this.getReplacementHistory(
      userId,
      originalFood.name,
    );

    // 4. 计算每个候选的综合替代评分
    const origServing = this.foodScorer.calcServingNutrition(
      originalFood as any,
    );

    const scored: SubstituteCandidate[] = candidates.map((candidate) => {
      const serving = this.foodScorer.calcServingNutrition(candidate as any);
      const isCrossCategory = !sameCategoryCandidateIds.has(candidate.id);

      // 4a. 相似度 (0~1) — 复用 MealAssembler 的逻辑
      const sim = this.mealAssembler.similarity(
        originalFood as any,
        candidate as any,
      );

      // 4b. 营养接近度 — 基于热量和蛋白质的相对距离
      const calDiff =
        origServing.servingCalories > 0
          ? Math.abs(serving.servingCalories - origServing.servingCalories) /
            origServing.servingCalories
          : 0;
      const protDiff =
        origServing.servingProtein > 0
          ? Math.abs(serving.servingProtein - origServing.servingProtein) /
            Math.max(origServing.servingProtein, 1)
          : 0;
      // 距离越小越好: 1 - clamp(avgDiff, 0, 1)
      const nutritionProximity = Math.max(
        0,
        1 - (calDiff * 0.6 + protDiff * 0.4),
      );

      // 4c. 历史替换加分 — 有历史替换记录则高分
      const histCount = replacementMap[candidate.name] || 0;
      // 归一化: min(count / 3, 1) — 3次以上即满分
      const histScore = Math.min(histCount / 3, 1);

      // 4d. 用户偏好画像加分
      let prefScore = 0.5; // 默认中性
      if (preferenceProfile) {
        let factors = 0;
        let sum = 0;
        const catW = preferenceProfile.categoryWeights[candidate.category];
        if (catW !== undefined) {
          // 0.3~1.3 映射到 0~1
          sum += (catW - 0.3) / 1.0;
          factors++;
        }
        if (candidate.main_ingredient) {
          const ingW =
            preferenceProfile.ingredientWeights[candidate.main_ingredient];
          if (ingW !== undefined) {
            sum += (ingW - 0.3) / 1.0;
            factors++;
          }
        }
        const nameW = preferenceProfile.foodNameWeights[candidate.name];
        if (nameW !== undefined) {
          // 0.7~1.2 映射到 0~1
          sum += (nameW - 0.7) / 0.5;
          factors++;
        }
        if (factors > 0) prefScore = sum / factors;
      }

      // 综合评分
      const baseScore =
        sim * 0.35 +
        nutritionProximity * 0.3 +
        histScore * 0.2 +
        prefScore * 0.15;

      // V4 E7: 跨品类候选轻微降权（优先推荐同品类）
      const substituteScore = isCrossCategory ? baseScore * 0.9 : baseScore;

      return {
        food: candidate,
        substituteScore,
        similarity: sim,
        nutritionProximity,
        servingCalories: serving.servingCalories,
        servingProtein: serving.servingProtein,
        servingFat: serving.servingFat,
        servingCarbs: serving.servingCarbs,
        historicalCount: histCount,
        crossCategory: isCrossCategory,
      };
    });

    // 5. 排序返回 Top-K
    scored.sort((a, b) => b.substituteScore - a.substituteScore);
    return scored.slice(0, topK);
  }

  /**
   * 查询用户历史替换模式: 原食物名 → {替换食物名: 次数}
   * 直接从 feedbackRepo 实时查询（和 BehaviorService.analyzeReplacementPatterns 同源）
   */
  private async getReplacementHistory(
    userId: string,
    originalFoodName: string,
  ): Promise<Record<string, number>> {
    const map: Record<string, number> = {};
    try {
      const since = new Date();
      since.setDate(since.getDate() - 90); // 90天窗口

      const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
        where: {
          user_id: userId,
          action: 'replaced',
          food_name: originalFoodName,
          replacement_food: { not: null },
          created_at: { gte: since },
        },
      });

      for (const fb of feedbacks) {
        if (fb.replacement_food) {
          map[fb.replacement_food] = (map[fb.replacement_food] || 0) + 1;
        }
      }
    } catch (err) {
      this.logger.warn(`查询替换历史失败: ${err}`);
    }
    return map;
  }
}
