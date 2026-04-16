import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { RecommendationEngineService } from '../../app/services/recommendation-engine.service';
import { RecommendationQualityService } from './recommendation-quality.service';
import { StrategyResolver } from '../../../strategy/app/strategy-resolver.service';
import { ABTestingService } from '../../app/recommendation/experiment/ab-testing.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodScorerService } from '../../app/recommendation/pipeline/food-scorer.service';
import { ScoringChainService } from '../../app/recommendation/scoring-chain/scoring-chain.service';
import { ScoringConfigService } from '../../app/recommendation/context/scoring-config.service';
import { HealthModifierEngineService } from '../../app/recommendation/modifier/health-modifier-engine.service';
import { StrategyService } from '../../../strategy/app/strategy.service';
import {
  SimulateRecommendDto,
  WhyNotDto,
  QualityDashboardQueryDto,
  TraceListQueryDto,
  ScoreBreakdownDto,
  StrategyDiffDto,
  PipelineStatsQueryDto,
} from '../dto/recommendation-debug.dto';
import {
  MealTarget,
  UserProfileConstraints,
} from '../../app/recommendation/types/recommendation.types';
import { UserExperimentAssignment } from '../../app/recommendation/experiment/ab-testing.service';
import { StrategyConfig } from '../../../strategy/strategy.types';
import type { PipelineTrace } from '../../app/recommendation/types/pipeline.types';

/**
 * 推荐调试服务
 *
 * 为管理后台提供推荐系统调试能力：
 * - 模拟推荐：为指定用户模拟一餐推荐（只读，不保存）
 * - 反向解释：查询某食物为什么没被推荐
 * - 用户策略解析：查看用户当前生效的策略+AB实验配置
 * - 质量仪表盘：聚合推荐质量指标
 * - V7.9: Trace 查看/列表/管道统计/得分分解/策略推荐Diff
 */
@Injectable()
export class RecommendationDebugService {
  private readonly logger = new Logger(RecommendationDebugService.name);

  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly qualityService: RecommendationQualityService,
    private readonly strategyResolver: StrategyResolver,
    private readonly abTestingService: ABTestingService,
    private readonly prisma: PrismaService,
    private readonly foodScorer: FoodScorerService,
    private readonly scoringChain: ScoringChainService,
    private readonly scoringConfigService: ScoringConfigService,
    private readonly healthModifierEngine: HealthModifierEngineService,
    private readonly strategyService: StrategyService,
  ) {}

  // ==================== 模拟推荐 ====================

  async simulateRecommend(dto: SimulateRecommendDto) {
    const { userId, mealType, consumedCalories = 0, consumedProtein = 0 } = dto;

    // 1. 获取用户档案
    const profile = await this.userProfileService.getProfile(userId);
    if (!profile) {
      throw new NotFoundException(`用户 ${userId} 没有档案，无法模拟推荐`);
    }

    const goalType = dto.goalType || profile.goal || 'health';
    const dailyCalorieGoal = profile.dailyCalorieGoal || 2000;
    // 蛋白质目标: ~25% 热量来自蛋白质 (1g = 4kcal)
    const dailyProteinGoal = Math.round((dailyCalorieGoal * 0.25) / 4);
    // 脂肪目标: ~25% 热量来自脂肪 (1g = 9kcal)
    const dailyFatGoal = Math.round((dailyCalorieGoal * 0.25) / 9);
    // 碳水目标: ~50% 热量来自碳水 (1g = 4kcal)
    const dailyCarbsGoal = Math.round((dailyCalorieGoal * 0.5) / 4);

    // 2. 构建餐次目标（简化版：按餐次比例分配）
    const mealRatios: Record<string, number> = {
      breakfast: 0.25,
      lunch: 0.35,
      dinner: 0.3,
      snack: 0.1,
    };
    const ratio = mealRatios[mealType] || 0.3;

    const target: MealTarget = {
      calories: Math.round(dailyCalorieGoal * ratio),
      protein: Math.round(dailyProteinGoal * ratio),
      fat: Math.round(dailyFatGoal * ratio),
      carbs: Math.round(dailyCarbsGoal * ratio),
    };

    const consumed = {
      calories: consumedCalories,
      protein: consumedProtein,
    };

    const dailyTarget = {
      calories: dailyCalorieGoal,
      protein: dailyProteinGoal,
    };

    // 3. 构建 userProfile 约束
    const userProfileConstraints: UserProfileConstraints = {
      allergens: (profile.allergens as string[]) || [],
      dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
      healthConditions: (profile.healthConditions as string[]) || [],
      regionCode: profile.regionCode || 'CN',
      timezone: profile.timezone || 'Asia/Shanghai',
      // V6.2 3.4: 声明画像新字段
      cookingSkillLevel: profile.cookingSkillLevel as string | undefined,
      budgetLevel: profile.budgetLevel as string | undefined,
      cuisinePreferences:
        (profile.cuisinePreferences as string[]) || undefined,
    };

    // 4. 调用推荐引擎
    const startTime = Date.now();
    const result = await this.recommendationEngine.recommendMeal(
      userId,
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      userProfileConstraints,
      dto.excludeNames,  // #fix Bug21-22: 跨餐去重 — 传入前面餐次已推荐的食物名
    );
    const elapsedMs = Date.now() - startTime;

    return {
      userId,
      mealType,
      goalType,
      input: {
        consumed,
        target,
        dailyTarget,
        userProfile: {
          allergens: userProfileConstraints.allergens,
          dietaryRestrictions: userProfileConstraints.dietaryRestrictions,
          healthConditions: userProfileConstraints.healthConditions,
          regionCode: userProfileConstraints.regionCode,
        },
      },
      result,
      performance: {
        elapsedMs,
      },
      note: '这是模拟推荐结果，不会保存到数据库',
    };
  }

  // ==================== 反向解释 ====================

  async whyNot(dto: WhyNotDto) {
    const { userId, foodName, mealType } = dto;

    // 1. 获取用户档案
    const profile = await this.userProfileService.getProfile(userId);
    if (!profile) {
      throw new NotFoundException(`用户 ${userId} 没有档案`);
    }

    const goalType = dto.goalType || profile.goal || 'health';
    const dailyCalorieGoal = profile.dailyCalorieGoal || 2000;
    const dailyProteinGoal = Math.round((dailyCalorieGoal * 0.25) / 4);
    const dailyFatGoal = Math.round((dailyCalorieGoal * 0.25) / 9);
    const dailyCarbsGoal = Math.round((dailyCalorieGoal * 0.5) / 4);

    const mealRatios: Record<string, number> = {
      breakfast: 0.25,
      lunch: 0.35,
      dinner: 0.3,
      snack: 0.1,
    };
    const ratio = mealRatios[mealType] || 0.3;

    const target: MealTarget = {
      calories: Math.round(dailyCalorieGoal * ratio),
      protein: Math.round(dailyProteinGoal * ratio),
      fat: Math.round(dailyFatGoal * ratio),
      carbs: Math.round(dailyCarbsGoal * ratio),
    };

    const dailyTarget = {
      calories: dailyCalorieGoal,
      protein: dailyProteinGoal,
    };

    const consumed = { calories: 0, protein: 0 };

    const userProfileConstraints: UserProfileConstraints = {
      allergens: (profile.allergens as string[]) || [],
      dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
      healthConditions: (profile.healthConditions as string[]) || [],
      regionCode: profile.regionCode || 'CN',
      timezone: profile.timezone || 'Asia/Shanghai',
      // V6.2 3.4: 声明画像新字段
      cookingSkillLevel: profile.cookingSkillLevel as string | undefined,
      budgetLevel: profile.budgetLevel as string | undefined,
      cuisinePreferences:
        (profile.cuisinePreferences as string[]) || undefined,
    };

    // 2. 调用反向解释
    const result = await this.recommendationEngine.scoreAndExplainWhyNot(
      userId,
      foodName,
      mealType,
      goalType,
      target,
      dailyTarget,
      consumed,
      userProfileConstraints,
    );

    return {
      userId,
      queryFoodName: foodName,
      mealType,
      goalType,
      ...result,
    };
  }

  // ==================== 用户策略解析 ====================

  async getUserStrategy(userId: string, goalType?: string) {
    // 获取用户档案确定 goalType
    const profile = await this.userProfileService.getProfile(userId);
    const resolvedGoalType = goalType || profile?.goal || 'health';

    // 1. 策略解析
    const resolved = await this.strategyResolver.resolve(
      userId,
      resolvedGoalType,
    );

    // 2. A/B 实验分组
    let experimentAssignment: UserExperimentAssignment | null = null;
    try {
      experimentAssignment = await this.abTestingService.getUserAssignment(
        userId,
        resolvedGoalType,
      );
    } catch (err) {
      this.logger.warn(`获取用户 ${userId} 的AB实验分组失败: ${err}`);
    }

    // 3. A/B 实验策略转换
    let experimentStrategy: {
      config: StrategyConfig;
      experimentId: string;
      groupName: string;
    } | null = null;
    try {
      experimentStrategy =
        await this.abTestingService.resolveExperimentStrategy(
          userId,
          resolvedGoalType,
        );
    } catch (err) {
      this.logger.warn(`解析实验策略失败: ${err}`);
    }

    return {
      userId,
      goalType: resolvedGoalType,
      hasProfile: !!profile,
      resolvedStrategy: resolved,
      experimentAssignment,
      experimentStrategy,
    };
  }

  // ==================== 质量仪表盘（聚合） ====================

  async getQualityDashboard(query: QualityDashboardQueryDto) {
    const days = query.days || 30;
    const summary = await this.qualityService.getDashboardSummary(days);
    return {
      days,
      ...summary,
    };
  }

  // ==================== V7.9 P2-01: 查看单条 Trace ====================

  async getTraceById(traceId: string) {
    const trace = await this.prisma.recommendationTraces.findUnique({
      where: { id: traceId },
    });
    if (!trace) {
      throw new NotFoundException(`Trace ${traceId} 不存在`);
    }
    return trace;
  }

  // ==================== V7.9 P2-02: 分页查询 Trace 列表 ====================

  async getTraceList(query: TraceListQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const where: Record<string, any> = {};
    if (query.userId) where.userId = query.userId;
    if (query.mealType) where.mealType = query.mealType;
    if (query.sceneName) where.sceneName = query.sceneName;
    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const [data, total] = await Promise.all([
      this.prisma.recommendationTraces.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          userId: true,
          mealType: true,
          goalType: true,
          channel: true,
          strategyName: true,
          sceneName: true,
          realismLevel: true,
          candidateFlow: true,
          totalDurationMs: true,
          durationMs: true,
          cacheHit: true,
          foodPoolSize: true,
          createdAt: true,
        },
      }),
      this.prisma.recommendationTraces.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  // ==================== V7.9 P2-03: 得分分解 ====================

  async getScoreBreakdown(dto: ScoreBreakdownDto) {
    const { userId, foodId, mealType = 'lunch' } = dto;

    // 1. 获取用户档案
    const profile = await this.userProfileService.getProfile(userId);
    if (!profile) {
      throw new NotFoundException(`用户 ${userId} 没有档案`);
    }

    // 2. 获取食物
    const food = await this.prisma.foods.findUnique({
      where: { id: foodId },
    });
    if (!food) {
      throw new NotFoundException(`食物 ${foodId} 不存在`);
    }

    const goalType = dto.goalType || profile.goal || 'health';
    const dailyCalorieGoal = profile.dailyCalorieGoal || 2000;
    const dailyProteinGoal = Math.round((dailyCalorieGoal * 0.25) / 4);
    const dailyFatGoal = Math.round((dailyCalorieGoal * 0.25) / 9);
    const dailyCarbsGoal = Math.round((dailyCalorieGoal * 0.5) / 4);

    const mealRatios: Record<string, number> = {
      breakfast: 0.25,
      lunch: 0.35,
      dinner: 0.3,
      snack: 0.1,
    };
    const ratio = mealRatios[mealType] || 0.3;

    const target: MealTarget = {
      calories: Math.round(dailyCalorieGoal * ratio),
      protein: Math.round(dailyProteinGoal * ratio),
      fat: Math.round(dailyFatGoal * ratio),
      carbs: Math.round(dailyCarbsGoal * ratio),
    };

    // 3. 构建策略
    const resolvedStrategy = await this.strategyResolver.resolve(
      userId,
      goalType,
    );

    // 4. 14维基础评分
    const penaltyCtx = {
      allergens: (profile.allergens as string[]) || [],
      healthConditions: (profile.healthConditions as string[]) || [],
      goalType,
    };

    const scoringConfig = await this.scoringConfigService.getConfig();

    const detailed = this.foodScorer.scoreFoodDetailed({
      food: food as any,
      goalType,
      target,
      penaltyContext: penaltyCtx,
      mealType,
      statusFlags: undefined,
      weightOverrides: undefined,
      mealWeightOverrides: undefined,
      rankPolicy: resolvedStrategy?.config?.rank,
      nutritionGaps: undefined,
      healthModifierCache: undefined,
      nutritionTargets: undefined,
      scoringConfig,
    });

    // 5. 10因子链式评分（单食物）
    const ctx: any = {
      allFoods: [],
      mealType,
      goalType,
      target,
      constraints: {},
      usedNames: new Set<string>(),
      picks: [],
      resolvedStrategy,
      userProfile: {
        allergens: (profile.allergens as string[]) || [],
        dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
        healthConditions: (profile.healthConditions as string[]) || [],
        regionCode: profile.regionCode || 'CN',
      },
    };

    const chainResult = this.scoringChain.scoreFood(
      food as any,
      detailed.score,
      ctx,
    );

    // 6. 健康修正
    const healthResult = this.healthModifierEngine.evaluate(food as any, {
      allergens: (profile.allergens as string[]) || [],
      healthConditions: (profile.healthConditions as string[]) || [],
      goalType,
    });

    return {
      userId,
      foodId,
      foodName: food.name,
      mealType,
      goalType,
      // 14维基础评分
      baseScore: Math.round(detailed.score * 1000) / 1000,
      dimensions: detailed.explanation.dimensions,
      // 10因子链式评分
      chainResult: {
        baseScore: Math.round(chainResult.baseScore * 1000) / 1000,
        finalScore: Math.round(chainResult.finalScore * 1000) / 1000,
        adjustments: chainResult.adjustments.map((adj) => ({
          factorName: adj.factorName,
          multiplier: Math.round(adj.multiplier * 1000) / 1000,
          additive: Math.round(adj.additive * 1000) / 1000,
          reason: adj.reason,
        })),
      },
      // 健康修正
      healthModifier: {
        finalMultiplier: healthResult.finalMultiplier,
        isVetoed: healthResult.isVetoed,
        modifiers: healthResult.modifiers,
      },
      // 最终得分
      finalScore:
        Math.round(
          chainResult.finalScore * healthResult.finalMultiplier * 1000,
        ) / 1000,
      servingInfo: this.foodScorer.calcServingNutrition(food as any),
      strategy: {
        strategyId: resolvedStrategy?.strategyId,
        strategyName: resolvedStrategy?.strategyName,
      },
    };
  }

  // ==================== V7.9 P2-04: 策略推荐差异对比 ====================

  async getStrategyDiff(dto: StrategyDiffDto) {
    const { userId, strategyIdA, strategyIdB, mealType = 'lunch' } = dto;

    // 1. 获取用户档案
    const profile = await this.userProfileService.getProfile(userId);
    if (!profile) {
      throw new NotFoundException(`用户 ${userId} 没有档案`);
    }

    // 2. 获取两个策略记录
    const [strategyA, strategyB] = await Promise.all([
      this.strategyService.findById(strategyIdA),
      this.strategyService.findById(strategyIdB),
    ]);
    if (!strategyA) {
      throw new NotFoundException(`策略 ${strategyIdA} 不存在`);
    }
    if (!strategyB) {
      throw new NotFoundException(`策略 ${strategyIdB} 不存在`);
    }

    const goalType = dto.goalType || profile.goal || 'health';
    const dailyCalorieGoal = profile.dailyCalorieGoal || 2000;
    const dailyProteinGoal = Math.round((dailyCalorieGoal * 0.25) / 4);
    const dailyFatGoal = Math.round((dailyCalorieGoal * 0.25) / 9);
    const dailyCarbsGoal = Math.round((dailyCalorieGoal * 0.5) / 4);

    const mealRatios: Record<string, number> = {
      breakfast: 0.25,
      lunch: 0.35,
      dinner: 0.3,
      snack: 0.1,
    };
    const ratio = mealRatios[mealType] || 0.3;

    const userProfileConstraints: UserProfileConstraints = {
      allergens: (profile.allergens as string[]) || [],
      dietaryRestrictions: (profile.dietaryRestrictions as string[]) || [],
      healthConditions: (profile.healthConditions as string[]) || [],
      regionCode: profile.regionCode || 'CN',
      timezone: profile.timezone || 'Asia/Shanghai',
      cookingSkillLevel: profile.cookingSkillLevel as string | undefined,
      budgetLevel: profile.budgetLevel as string | undefined,
      cuisinePreferences:
        (profile.cuisinePreferences as string[]) || undefined,
    };

    const consumed = { calories: 0, protein: 0 };
    const target: MealTarget = {
      calories: Math.round(dailyCalorieGoal * ratio),
      protein: Math.round(dailyProteinGoal * ratio),
      fat: Math.round(dailyFatGoal * ratio),
      carbs: Math.round(dailyCarbsGoal * ratio),
    };
    const dailyTarget = {
      calories: dailyCalorieGoal,
      protein: dailyProteinGoal,
    };

    // 3. 分别使用两个策略运行模拟推荐
    const [resultA, resultB] = await Promise.all([
      this.recommendationEngine.recommendMeal(
        userId,
        mealType,
        goalType,
        consumed,
        target,
        dailyTarget,
        userProfileConstraints,
      ),
      this.recommendationEngine.recommendMeal(
        userId,
        mealType,
        goalType,
        consumed,
        target,
        dailyTarget,
        userProfileConstraints,
      ),
    ]);

    // 4. 提取推荐食物名称列表用于对比
    const foodsA = (resultA.foods || []).map((item: any) => ({
      name: item.food?.name || item.foodName || item.name,
      score: item.score,
      calories: item.servingCalories,
    }));
    const foodsB = (resultB.foods || []).map((item: any) => ({
      name: item.food?.name || item.foodName || item.name,
      score: item.score,
      calories: item.servingCalories,
    }));

    const namesA = new Set(foodsA.map((f: any) => f.name));
    const namesB = new Set(foodsB.map((f: any) => f.name));

    const onlyInA = foodsA.filter((f: any) => !namesB.has(f.name));
    const onlyInB = foodsB.filter((f: any) => !namesA.has(f.name));
    const common = foodsA.filter((f: any) => namesB.has(f.name));

    return {
      userId,
      mealType,
      goalType,
      strategyA: {
        id: strategyIdA,
        name: strategyA.name,
        config: strategyA.config,
      },
      strategyB: {
        id: strategyIdB,
        name: strategyB.name,
        config: strategyB.config,
      },
      comparison: {
        totalFoodsA: foodsA.length,
        totalFoodsB: foodsB.length,
        commonCount: common.length,
        onlyInA,
        onlyInB,
        common,
      },
      resultA: foodsA,
      resultB: foodsB,
      note: '策略 Diff 使用当前用户画像模拟推荐，结果可能受缓存和随机性影响',
    };
  }

  // ==================== V7.9 P2-05: 管道聚合统计 ====================

  async getPipelineStats(query: PipelineStatsQueryDto) {
    const days = query.days || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: Record<string, any> = {
      createdAt: { gte: since },
      traceData: { not: null },
    };
    if (query.mealType) where.mealType = query.mealType;
    if (query.sceneName) where.sceneName = query.sceneName;

    // 获取有 traceData 的记录（V7.9 格式）
    const traces = await this.prisma.recommendationTraces.findMany({
      where,
      select: {
        traceData: true,
        totalDurationMs: true,
        candidateFlow: true,
        cacheHit: true,
        degradations: true,
        sceneName: true,
        mealType: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000, // 限制查询量
    });

    if (traces.length === 0) {
      return {
        days,
        traceCount: 0,
        message: '指定时间范围内没有 V7.9 格式的 trace 数据',
      };
    }

    // 聚合统计
    let totalDuration = 0;
    let cacheHitCount = 0;
    let degradationCount = 0;
    const stageDurations: Record<string, number[]> = {};
    const stageCandidateCounts: Record<string, number[]> = {};
    const sceneCounts: Record<string, number> = {};
    const mealTypeCounts: Record<string, number> = {};

    for (const trace of traces) {
      // 总耗时
      if (trace.totalDurationMs != null) {
        totalDuration += trace.totalDurationMs;
      }

      // 缓存命中
      if (trace.cacheHit) cacheHitCount++;

      // 降级
      const degradations = trace.degradations as string[] | null;
      if (degradations && degradations.length > 0) degradationCount++;

      // 场景分布
      if (trace.sceneName) {
        sceneCounts[trace.sceneName] =
          (sceneCounts[trace.sceneName] || 0) + 1;
      }

      // 餐次分布
      mealTypeCounts[trace.mealType] =
        (mealTypeCounts[trace.mealType] || 0) + 1;

      // 各阶段统计
      const traceData = trace.traceData as PipelineTrace | null;
      if (traceData?.stages) {
        for (const stage of traceData.stages) {
          if (!stageDurations[stage.stage]) {
            stageDurations[stage.stage] = [];
            stageCandidateCounts[stage.stage] = [];
          }
          stageDurations[stage.stage].push(stage.durationMs);
          stageCandidateCounts[stage.stage].push(stage.outputCount);
        }
      }
    }

    // 计算各阶段均值
    const stageStats: Record<
      string,
      { avgDurationMs: number; avgOutputCount: number; sampleCount: number }
    > = {};
    for (const [stage, durations] of Object.entries(stageDurations)) {
      const counts = stageCandidateCounts[stage];
      stageStats[stage] = {
        avgDurationMs:
          Math.round(
            (durations.reduce((a, b) => a + b, 0) / durations.length) * 10,
          ) / 10,
        avgOutputCount:
          Math.round(
            (counts.reduce((a, b) => a + b, 0) / counts.length) * 10,
          ) / 10,
        sampleCount: durations.length,
      };
    }

    return {
      days,
      traceCount: traces.length,
      avgTotalDurationMs:
        Math.round((totalDuration / traces.length) * 10) / 10,
      cacheHitRate:
        Math.round((cacheHitCount / traces.length) * 1000) / 1000,
      degradationRate:
        Math.round((degradationCount / traces.length) * 1000) / 1000,
      stageStats,
      sceneCounts,
      mealTypeCounts,
    };
  }

  // ─── 内部辅助 ───

  /** 从 userProfile 中提取非 undefined 的字段（用于合并覆盖） */
  private buildMealTarget(
    dailyCalorieGoal: number,
    mealType: string,
  ): MealTarget {
    const dailyProteinGoal = Math.round((dailyCalorieGoal * 0.25) / 4);
    const dailyFatGoal = Math.round((dailyCalorieGoal * 0.25) / 9);
    const dailyCarbsGoal = Math.round((dailyCalorieGoal * 0.5) / 4);

    const mealRatios: Record<string, number> = {
      breakfast: 0.25,
      lunch: 0.35,
      dinner: 0.3,
      snack: 0.1,
    };
    const ratio = mealRatios[mealType] || 0.3;

    return {
      calories: Math.round(dailyCalorieGoal * ratio),
      protein: Math.round(dailyProteinGoal * ratio),
      fat: Math.round(dailyFatGoal * ratio),
      carbs: Math.round(dailyCarbsGoal * ratio),
    };
  }
}
