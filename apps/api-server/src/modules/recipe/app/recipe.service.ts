import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { Prisma } from '@prisma/client';
import {
  RecipeSummary,
  RecipeDetail,
  RecipeIngredientItem,
  RecipeRating,
  RecipeRatingSummary,
  ScoredRecipe,
} from '../recipe.types';
import {
  SearchRecipesDto,
  SubmitRecipeDto,
  RateRecipeDto,
} from './dto/recipe.dto';

/**
 * V6.3 P2-6: 菜谱服务 — 查询 + 评分
 *
 * 面向 App 端：搜索、详情、推荐评分
 */
@Injectable()
export class RecipeService {
  private readonly logger = new Logger(RecipeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 查询 ====================

  /**
   * 搜索菜谱（App 端）
   */
  async search(dto: SearchRecipesDto): Promise<{
    items: RecipeSummary[];
    total: number;
  }> {
    const limit = Math.min(dto.limit ?? 20, 50);
    const offset = dto.offset ?? 0;

    const where: Prisma.RecipesWhereInput = {
      isActive: true,
      reviewStatus: 'approved',
    };

    if (dto.cuisine) {
      where.cuisine = dto.cuisine;
    }
    if (dto.difficulty) {
      where.difficulty = dto.difficulty;
    }
    if (dto.maxCookTime) {
      where.cookTimeMinutes = { lte: dto.maxCookTime };
    }
    if (dto.tags) {
      const tagList = dto.tags.split(',').map((t) => t.trim());
      where.tags = { hasSome: tagList };
    }
    if (dto.q) {
      where.name = { contains: dto.q, mode: 'insensitive' };
    }

    const [items, total] = await Promise.all([
      this.prisma.recipes.findMany({
        where,
        orderBy: [{ qualityScore: 'desc' }, { usageCount: 'desc' }],
        skip: offset,
        take: limit,
        // V6.5 Phase 2M: 携带评分统计
        include: {
          _count: { select: { recipeRatings: true } },
        },
      }),
      this.prisma.recipes.count({ where }),
    ]);

    // V6.5 Phase 2M: 批量获取平均评分
    const recipeIds = items.map((r) => r.id);
    const avgMap = await this.batchAvgRatings(recipeIds);

    return {
      items: items.map((r) => this.toSummary(r, avgMap.get(r.id))),
      total,
    };
  }

  /**
   * 按 ID 获取菜谱详情（含食材）
   */
  async findById(id: string): Promise<RecipeDetail> {
    const recipe = await this.prisma.recipes.findUnique({
      where: { id },
      include: {
        recipeIngredients: { orderBy: { sortOrder: 'asc' } },
        // V6.5 Phase 2M: 携带评分统计
        _count: { select: { recipeRatings: true } },
      },
    });

    if (!recipe) {
      throw new NotFoundException(this.i18n.t('recipe.recipeNotFound', { id }));
    }

    // V6.5 Phase 2M: 获取平均评分
    const avgMap = await this.batchAvgRatings([id]);
    return this.toDetail(recipe, avgMap.get(id));
  }

  /**
   * 批量获取菜谱（供推荐引擎召回用）
   */
  async findActiveByFilters(filters: {
    cuisine?: string;
    maxDifficulty?: number;
    maxCookTime?: number;
    tags?: string[];
    limit?: number;
  }): Promise<RecipeDetail[]> {
    const where: Prisma.RecipesWhereInput = {
      isActive: true,
      reviewStatus: 'approved',
    };

    if (filters.cuisine) {
      where.cuisine = filters.cuisine;
    }
    if (filters.maxDifficulty) {
      where.difficulty = { lte: filters.maxDifficulty };
    }
    if (filters.maxCookTime) {
      where.cookTimeMinutes = { lte: filters.maxCookTime };
    }
    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }

    const recipes = await this.prisma.recipes.findMany({
      where,
      include: { recipeIngredients: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { qualityScore: 'desc' },
      take: filters.limit ?? 50,
    });

    return recipes.map((r) => this.toDetail(r));
  }

  /**
   * V6.3 P3-4: 用户提交菜谱（UGC）
   *
   * 默认进入 pending 审核态，且不对外可见。
   */
  async submitRecipe(
    userId: string,
    dto: SubmitRecipeDto,
  ): Promise<RecipeDetail> {
    const { ingredients, ...recipeData } = dto;

    const recipe = await this.prisma.recipes.create({
      data: {
        name: recipeData.name,
        description: recipeData.description,
        cuisine: recipeData.cuisine,
        difficulty: recipeData.difficulty ?? 1,
        prepTimeMinutes: recipeData.prepTimeMinutes,
        cookTimeMinutes: recipeData.cookTimeMinutes,
        servings: recipeData.servings ?? 1,
        tags: recipeData.tags ?? [],
        instructions: recipeData.instructions ?? Prisma.JsonNull,
        imageUrl: recipeData.imageUrl,
        source: 'user',
        reviewStatus: 'pending',
        submittedBy: userId,
        isActive: false,
        caloriesPerServing: recipeData.caloriesPerServing,
        proteinPerServing: recipeData.proteinPerServing,
        fatPerServing: recipeData.fatPerServing,
        carbsPerServing: recipeData.carbsPerServing,
        fiberPerServing: recipeData.fiberPerServing,
        qualityScore: 0,
        recipeIngredients: ingredients?.length
          ? {
              create: ingredients.map((ing, idx) => ({
                foodId: ing.foodId,
                ingredientName: ing.ingredientName,
                amount: ing.amount,
                unit: ing.unit,
                isOptional: ing.isOptional ?? false,
                sortOrder: ing.sortOrder ?? idx,
              })),
            }
          : undefined,
      },
      include: { recipeIngredients: { orderBy: { sortOrder: 'asc' } } },
    });

    this.logger.log(
      `用户提交菜谱待审核: ${recipe.name} (${recipe.id}), user=${userId}`,
    );
    return this.toDetail(recipe);
  }

  /**
   * 增加菜谱使用次数
   */
  async incrementUsageCount(recipeId: string): Promise<void> {
    await this.prisma.recipes.update({
      where: { id: recipeId },
      data: { usageCount: { increment: 1 } },
    });
  }

  // ==================== 评分（供推荐引擎使用） ====================

  /**
   * 对菜谱进行评分
   *
   * V6.5 Phase 1K: 评分维度扩展为4维
   * - nutritionMatch (45%): 菜谱营养与用户目标的匹配度
   * - preferenceMatch (25%): 菜系/标签与用户偏好的匹配度
   * - difficultyMatch (15%): 难度与用户技能的匹配度
   * - timeMatch (15%): 烹饪时间与场景的匹配度（工作日优先快手菜）
   */
  scoreRecipe(
    recipe: RecipeDetail,
    context: {
      targetCalories?: number;
      targetProtein?: number;
      targetFat?: number;
      targetCarbs?: number;
      cuisinePreferences?: string[];
      foodPreferences?: string[];
      cookingSkillLevel?: string;
      /** V6.5: 日期类型，用于烹饪时间匹配 */
      dayType?: 'weekday' | 'weekend';
    },
  ): ScoredRecipe {
    const nutritionMatch = this.calcNutritionMatch(recipe, context);
    const preferenceMatch = this.calcPreferenceMatch(recipe, context);
    const difficultyMatch = this.calcDifficultyMatch(recipe, context);
    // V6.5 Phase 1K: 烹饪时间匹配
    const timeMatch = this.calcTimeMatch(recipe, context);

    // V6.5: 45% 营养 + 25% 偏好 + 15% 难度 + 15% 时间
    const score =
      nutritionMatch * 0.45 +
      preferenceMatch * 0.25 +
      difficultyMatch * 0.15 +
      timeMatch * 0.15;

    return {
      recipe,
      score,
      nutritionMatch,
      preferenceMatch,
      difficultyMatch,
      timeMatch,
      whyThisRecipe: this.buildWhyThisRecipe(
        recipe,
        nutritionMatch,
        preferenceMatch,
        difficultyMatch,
        timeMatch,
        context,
      ),
    };
  }

  /**
   * 批量评分并排序
   */
  scoreAndRankRecipes(
    recipes: RecipeDetail[],
    context: {
      targetCalories?: number;
      targetProtein?: number;
      targetFat?: number;
      targetCarbs?: number;
      cuisinePreferences?: string[];
      foodPreferences?: string[];
      cookingSkillLevel?: string;
      /** V6.5: 日期类型，用于烹饪时间匹配 */
      dayType?: 'weekday' | 'weekend';
    },
    topN: number = 10,
  ): ScoredRecipe[] {
    return recipes
      .map((r) => this.scoreRecipe(r, context))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  // ==================== 内部方法 ====================

  /** 营养匹配度：每份营养与目标的偏差率 */
  private calcNutritionMatch(
    recipe: RecipeDetail,
    context: {
      targetCalories?: number;
      targetProtein?: number;
      targetFat?: number;
      targetCarbs?: number;
    },
  ): number {
    if (!context.targetCalories) return 0.5; // 无目标时中性

    const deviations: number[] = [];

    if (recipe.caloriesPerServing && context.targetCalories) {
      // 目标是单餐卡路里（总目标 / 3），允许 ±20% 偏差
      const mealTarget = context.targetCalories / 3;
      const dev = Math.abs(recipe.caloriesPerServing - mealTarget) / mealTarget;
      deviations.push(Math.max(0, 1 - dev));
    }
    if (recipe.proteinPerServing && context.targetProtein) {
      const mealTarget = context.targetProtein / 3;
      const dev = Math.abs(recipe.proteinPerServing - mealTarget) / mealTarget;
      deviations.push(Math.max(0, 1 - dev));
    }
    if (recipe.fatPerServing && context.targetFat) {
      const mealTarget = context.targetFat / 3;
      const dev = Math.abs(recipe.fatPerServing - mealTarget) / mealTarget;
      deviations.push(Math.max(0, 1 - dev));
    }
    if (recipe.carbsPerServing && context.targetCarbs) {
      const mealTarget = context.targetCarbs / 3;
      const dev = Math.abs(recipe.carbsPerServing - mealTarget) / mealTarget;
      deviations.push(Math.max(0, 1 - dev));
    }

    if (deviations.length === 0) return 0.5;
    return deviations.reduce((a, b) => a + b, 0) / deviations.length;
  }

  /** 偏好匹配度：菜系 + 标签匹配 */
  private calcPreferenceMatch(
    recipe: RecipeDetail,
    context: {
      cuisinePreferences?: string[];
      foodPreferences?: string[];
    },
  ): number {
    let score = 0.5; // 基准分

    // 菜系匹配
    if (
      recipe.cuisine &&
      context.cuisinePreferences &&
      context.cuisinePreferences.length > 0
    ) {
      if (context.cuisinePreferences.includes(recipe.cuisine)) {
        score += 0.3;
      }
    }

    // 标签匹配
    if (
      recipe.tags &&
      recipe.tags.length > 0 &&
      context.foodPreferences &&
      context.foodPreferences.length > 0
    ) {
      const matchCount = recipe.tags.filter((tag) =>
        context.foodPreferences!.some(
          (pref) => tag.includes(pref) || pref.includes(tag),
        ),
      ).length;
      score += Math.min(0.2, matchCount * 0.05);
    }

    return Math.min(1, score);
  }

  /** 难度匹配度：用户烹饪技能 vs 菜谱难度 */
  private calcDifficultyMatch(
    recipe: RecipeDetail,
    context: { cookingSkillLevel?: string },
  ): number {
    const skillToLevel: Record<string, number> = {
      beginner: 1,
      basic: 2,
      intermediate: 3,
      advanced: 4,
      expert: 5,
    };

    const userLevel = skillToLevel[context.cookingSkillLevel ?? 'basic'] ?? 2;
    const recipeDifficulty = recipe.difficulty;

    // 用户技能 >= 菜谱难度 → 满分；每差一级扣 0.25
    const gap = recipeDifficulty - userLevel;
    if (gap <= 0) return 1;
    return Math.max(0, 1 - gap * 0.25);
  }

  /**
   * V6.5 Phase 1K: 烹饪时间匹配评分
   *
   * 工作日优先快手菜（理想 ≤30min），周末允许更长时间（理想 ≤60min）。
   * 超过理想时间后线性衰减，超过上限给最低分。
   *
   * @returns 0-1 之间的匹配度（1 = 完美匹配）
   */
  private calcTimeMatch(
    recipe: RecipeDetail,
    context: { dayType?: 'weekday' | 'weekend' },
  ): number {
    const totalTime =
      (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);

    // 无时间信息时给中性分
    if (totalTime <= 0) return 0.5;

    const isWorkday = context.dayType === 'weekday';
    const idealTime = isWorkday ? 30 : 60; // 理想烹饪时间（分钟）
    const maxTime = isWorkday ? 60 : 120; // 最大可接受时间

    if (totalTime <= idealTime) return 1;
    if (totalTime >= maxTime) return 0.2;

    // 线性衰减：idealTime → maxTime 之间从 1.0 降到 0.2
    return 1 - ((totalTime - idealTime) / (maxTime - idealTime)) * 0.8;
  }

  /**
   * V6.3 P3-2: 生成菜谱级解释
   *
   * 采用最小可用实现：突出 1-2 个主要命中点，便于前端直接展示。
   * V6.5: 新增烹饪时间维度解释
   */
  private buildWhyThisRecipe(
    recipe: RecipeDetail,
    nutritionMatch: number,
    preferenceMatch: number,
    difficultyMatch: number,
    timeMatch: number,
    context: {
      targetCalories?: number;
      targetProtein?: number;
      targetFat?: number;
      targetCarbs?: number;
      cuisinePreferences?: string[];
      foodPreferences?: string[];
      cookingSkillLevel?: string;
      dayType?: 'weekday' | 'weekend';
    },
  ): string {
    const reasons: string[] = [];

    if (nutritionMatch >= 0.75) {
      reasons.push('营养结构与当前餐次目标较匹配');
    }

    if (
      recipe.cuisine &&
      context.cuisinePreferences?.length &&
      context.cuisinePreferences.includes(recipe.cuisine)
    ) {
      reasons.push(`符合你偏好的${recipe.cuisine}菜系`);
    }

    if (preferenceMatch >= 0.7 && recipe.tags?.length) {
      reasons.push('标签风格与您的饮食偏好较一致');
    }

    if (difficultyMatch >= 0.9) {
      reasons.push('烹饪难度与你当前的下厨能力匹配');
    }

    // V6.5: 烹饪时间解释
    if (timeMatch >= 0.9) {
      const totalTime =
        (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
      if (totalTime > 0 && totalTime <= 30) {
        reasons.push('快手菜，适合忙碌时段');
      } else if (totalTime > 0) {
        reasons.push('烹饪时间与当前场景较匹配');
      }
    }

    if (reasons.length === 0) {
      reasons.push('综合营养、偏好和操作难度后，这道菜是当前较稳妥的选择');
    }

    return reasons.slice(0, 2).join('，');
  }

  // ==================== V6.5 Phase 2M: 用户评分 ====================

  /**
   * 提交/更新用户评分（upsert — 同一用户对同一菜谱只保留一条）
   */
  async rateRecipe(
    userId: string,
    recipeId: string,
    dto: RateRecipeDto,
  ): Promise<RecipeRating> {
    // 确认菜谱存在
    const recipe = await this.prisma.recipes.findUnique({
      where: { id: recipeId },
      select: { id: true },
    });
    if (!recipe) {
      throw new NotFoundException(
        this.i18n.t('recipe.recipeNotFound', { id: recipeId }),
      );
    }

    const row = await this.prisma.recipeRatings.upsert({
      where: {
        recipeId_userId: {
          recipeId: recipeId,
          userId: userId,
        },
      },
      create: {
        recipeId: recipeId,
        userId: userId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
      update: {
        rating: dto.rating,
        comment: dto.comment ?? null,
      },
    });

    return this.toRating(row);
  }

  /**
   * 获取当前用户对某菜谱的评分
   */
  async getMyRating(
    userId: string,
    recipeId: string,
  ): Promise<RecipeRating | null> {
    const row = await this.prisma.recipeRatings.findUnique({
      where: {
        recipeId_userId: {
          recipeId: recipeId,
          userId: userId,
        },
      },
    });
    return row ? this.toRating(row) : null;
  }

  /**
   * 获取菜谱的评分汇总 + 分布
   */
  async getRatingSummary(recipeId: string): Promise<RecipeRatingSummary> {
    const [agg, ratings] = await Promise.all([
      this.prisma.recipeRatings.aggregate({
        where: { recipeId: recipeId },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.recipeRatings.groupBy({
        by: ['rating'],
        where: { recipeId: recipeId },
        _count: { rating: true },
      }),
    ]);

    const distribution: Record<number, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    for (const r of ratings) {
      distribution[r.rating] = r._count.rating;
    }

    return {
      recipeId,
      averageRating: agg._avg.rating
        ? Math.round(agg._avg.rating * 10) / 10
        : 0,
      ratingCount: agg._count.rating,
      distribution,
    };
  }

  /**
   * 删除用户对菜谱的评分
   */
  async deleteRating(userId: string, recipeId: string): Promise<boolean> {
    const result = await this.prisma.recipeRatings.deleteMany({
      where: { recipeId: recipeId, userId: userId },
    });
    return result.count > 0;
  }

  // ==================== 内部工具方法 ====================

  /**
   * 批量获取菜谱平均评分 — 避免 N+1
   */
  private async batchAvgRatings(
    recipeIds: string[],
  ): Promise<Map<string, number>> {
    if (recipeIds.length === 0) return new Map();
    const rows = await this.prisma.recipeRatings.groupBy({
      by: ['recipeId'],
      where: { recipeId: { in: recipeIds } },
      _avg: { rating: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r._avg.rating != null) {
        map.set(r.recipeId, Math.round(r._avg.rating * 10) / 10);
      }
    }
    return map;
  }

  private toRating(row: any): RecipeRating {
    return {
      id: row.id,
      recipeId: row.recipeId,
      userId: row.userId,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  // ==================== 数据转换 ====================

  private toSummary(row: any, avgRating?: number): RecipeSummary {
    const ratingCount = row._count?.recipeRatings ?? 0;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      cuisine: row.cuisine,
      difficulty: row.difficulty,
      prepTimeMinutes: row.prepTimeMinutes,
      cookTimeMinutes: row.cookTimeMinutes,
      servings: row.servings,
      tags: row.tags ?? [],
      imageUrl: row.imageUrl,
      source: row.source,
      caloriesPerServing: row.caloriesPerServing
        ? Number(row.caloriesPerServing)
        : null,
      proteinPerServing: row.proteinPerServing
        ? Number(row.proteinPerServing)
        : null,
      fatPerServing: row.fatPerServing ? Number(row.fatPerServing) : null,
      carbsPerServing: row.carbsPerServing ? Number(row.carbsPerServing) : null,
      fiberPerServing: row.fiberPerServing ? Number(row.fiberPerServing) : null,
      qualityScore: Number(row.qualityScore),
      usageCount: row.usageCount,
      averageRating: avgRating ?? null,
      ratingCount,
    };
  }

  private toDetail(row: any, avgRating?: number): RecipeDetail {
    return {
      ...this.toSummary(row, avgRating),
      instructions: row.instructions,
      ingredients: (row.recipeIngredients ?? []).map(
        (ing: any): RecipeIngredientItem => ({
          id: ing.id,
          foodId: ing.foodId,
          ingredientName: ing.ingredientName,
          amount: ing.amount ? Number(ing.amount) : null,
          unit: ing.unit,
          isOptional: ing.isOptional,
          sortOrder: ing.sortOrder,
        }),
      ),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
