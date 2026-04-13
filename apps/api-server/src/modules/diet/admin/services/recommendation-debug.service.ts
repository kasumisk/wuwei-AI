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
import {
  SimulateRecommendDto,
  WhyNotDto,
  QualityDashboardQueryDto,
} from '../dto/recommendation-debug.dto';
import {
  MealTarget,
  UserProfileConstraints,
} from '../../app/recommendation/types/recommendation.types';
import { UserExperimentAssignment } from '../../app/recommendation/experiment/ab-testing.service';
import { StrategyConfig } from '../../../strategy/strategy.types';

/**
 * 推荐调试服务
 *
 * 为管理后台提供推荐系统调试能力：
 * - 模拟推荐：为指定用户模拟一餐推荐（只读，不保存）
 * - 反向解释：查询某食物为什么没被推荐
 * - 用户策略解析：查看用户当前生效的策略+AB实验配置
 * - 质量仪表盘：聚合推荐质量指标
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
}
