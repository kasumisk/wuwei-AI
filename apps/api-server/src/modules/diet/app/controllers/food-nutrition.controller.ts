import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { FoodRecordService } from '../services/food-record.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { NutritionScoreService } from '../services/nutrition-score.service';
import { BehaviorService } from '../services/behavior.service';
import { SaveUserProfileDto } from '../dto/food.dto';
import { getUserLocalHour } from '../../../../common/utils/timezone.util';
import { I18nService } from '../../../../core/i18n';
import { RequestContextService } from '../../../../core/context/request-context.service';

/** P3.1: 评分等级标签（与前端 4 档一致） */
function getStatusLabel(score: number): string {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'fair';
  return 'needs_improvement';
}

/**
 * 将 Prisma user_profiles 行（snake_case）转换为前端期望的 camelCase 格式
 */
function toProfileResponse(p: any) {
  if (!p) return null;
  return {
    id: p.id,
    userId: p.userId,
    gender: p.gender ?? null,
    birthYear: p.birthYear ?? null,
    heightCm: p.heightCm != null ? Number(p.heightCm) : null,
    weightKg: p.weightKg != null ? Number(p.weightKg) : null,
    targetWeightKg: p.targetWeightKg != null ? Number(p.targetWeightKg) : null,
    bodyFatPercent: p.bodyFatPercent != null ? Number(p.bodyFatPercent) : null,
    activityLevel: p.activityLevel,
    dailyCalorieGoal: p.dailyCalorieGoal ?? null,
    goal: p.goal,
    goalSpeed: p.goalSpeed,
    mealsPerDay: p.mealsPerDay,
    takeoutFrequency: p.takeoutFrequency,
    canCook: p.canCook,
    foodPreferences: p.foodPreferences ?? [],
    dietaryRestrictions: p.dietaryRestrictions ?? [],
    allergens: p.allergens ?? [],
    healthConditions: p.healthConditions ?? [],
    weakTimeSlots: p.weakTimeSlots ?? [],
    bingeTriggers: p.bingeTriggers ?? [],
    discipline: p.discipline,
    onboardingCompleted: p.onboardingCompleted ?? false,
    onboardingStep: p.onboardingStep ?? 0,
    dataCompleteness:
      p.dataCompleteness != null ? Number(p.dataCompleteness) : 0,
    regionCode: p.regionCode ?? 'CN',
    timezone: p.timezone ?? 'Asia/Shanghai',
    // V3.8 新增字段
    cookingSkillLevel: p.cookingSkillLevel ?? null,
    budgetLevel: p.budgetLevel ?? null,
    kitchenProfile: p.kitchenProfile ?? null,
    sleepQuality: p.sleepQuality ?? null,
    stressLevel: p.stressLevel ?? null,
    hydrationGoal: p.hydrationGoal ?? null,
    mealTimingPreference: p.mealTimingPreference ?? null,
    tasteIntensity: p.tasteIntensity ?? null,
    recommendationPreferences: p.recommendationPreferences ?? null,
    alcoholFrequency: p.alcoholFrequency ?? null,
    cuisinePreferences: p.cuisinePreferences ?? [],
    familySize: p.familySize ?? null,
    mealPrepWilling: p.mealPrepWilling ?? null,
    exerciseIntensity: p.exerciseIntensity ?? null,
    supplementsUsed: p.supplementsUsed ?? [],
    compoundGoal: p.compoundGoal ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@ApiTags('App 营养与档案')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodNutritionController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodRecordService: FoodRecordService,
    private readonly userProfileService: UserProfileService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly behaviorService: BehaviorService,
    private readonly i18n: I18nService,
    private readonly requestCtx: RequestContextService,
  ) {}

  /**
   * 获取今日营养评分详情
   * GET /api/app/food/nutrition-score
   */
  @Get('nutrition-score')
  @ApiOperation({ summary: '获取今日营养评分详情' })
  async getNutritionScore(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const [summary, profile, behaviorProfile] = await Promise.all([
      this.foodService.getTodaySummary(user.id),
      this.userProfileService.getProfile(user.id),
      this.behaviorService.getProfile(user.id),
    ]);

    // V1.5: 预加载配置权重（使 computePersonalizedWeights 可同步读取）
    await this.nutritionScoreService.preloadWeightsConfig();

    const goals = this.nutritionScoreService.calculateDailyGoals(profile);

    // V1.3: 获取用户本地小时数
    const tz = (profile as any)?.timezone || 'Asia/Shanghai';
    const localHour = getUserLocalHour(tz);

    // V1.4: 获取今日原始记录，聚合每餐决策信号
    const todayRecords = await this.foodRecordService.getTodayRecords(
      user.id,
      tz,
    );
    const mealSignals = this.nutritionScoreService.aggregateMealSignals(
      todayRecords,
      Number(profile?.mealsPerDay) || 3,
    );

    // 凌晨批量补录历史餐次时，不应按“当前小时进度”把能量分压到接近 0。
    // 条件：本地凌晨 + 已有多餐 + 热量已达全天较高比例 => 按全天目标评分。
    const shouldDisableTimeAwareScoring =
      localHour <= 1 &&
      summary.mealCount >= 2 &&
      goals.calories > 0 &&
      summary.totalCalories >= goals.calories * 0.6;
    const scoringHour = shouldDisableTimeAwareScoring ? undefined : localHour;

    // P1.3: 注入真实 stabilityData
    const stabilityData = {
      streakDays: behaviorProfile?.streakDays || 0,
      avgMealsPerDay: summary.mealCount,
      targetMeals: Number(profile?.mealsPerDay) || 3,
      complianceRate: Number(behaviorProfile?.avgComplianceRate) || 0,
    };

    // Bug1 fix: 从当天食物记录聚合加权平均 GI 和总碳水
    const { avgGI, totalCarbsFromFoods } =
      this.aggregateGlycemicData(todayRecords);

    const score = this.nutritionScoreService.calculateScore(
      {
        calories: summary.totalCalories,
        targetCalories: goals.calories,
        protein: summary.totalProtein || 0,
        fat: summary.totalFat || 0,
        carbs: summary.totalCarbs || 0,
        // Bug-Fix: 传入宏量绝对量目标，供"达成度门槛"评分使用
        targetProtein: goals.protein,
        targetCarbs: goals.carbs,
        targetFat: goals.fat,
        // Phase 1.2: 有记录时用真实值(若缺失用合理中性值3)，无记录时返回0
        // 这样权重分摊逻辑会自动处理零值维度
        foodQuality:
          summary.mealCount > 0
            ? summary.avgQuality > 0
              ? summary.avgQuality
              : 3
            : 0,
        satiety:
          summary.mealCount > 0
            ? summary.avgSatiety > 0
              ? summary.avgSatiety
              : 3
            : 0,
        glycemicIndex: avgGI || undefined,
        carbsPerServing: totalCarbsFromFoods || undefined,
      },
      profile?.goal || 'health',
      stabilityData,
      profile?.healthConditions as string[] | undefined,
      scoringHour,
      mealSignals,
    );

    const macroCompliance = {
      calorieAdherence:
        goals.calories > 0
          ? Math.round((summary.totalCalories / goals.calories) * 100)
          : 0,
      proteinAdherence:
        goals.protein > 0
          ? Math.round(((summary.totalProtein || 0) / goals.protein) * 100)
          : 0,
      fatAdherence:
        goals.fat > 0
          ? Math.round(((summary.totalFat || 0) / goals.fat) * 100)
          : 0,
      carbsAdherence:
        goals.carbs > 0
          ? Math.round(((summary.totalCarbs || 0) / goals.carbs) * 100)
          : 0,
    };

    const locale: 'zh' | 'en' | 'ja' = (() => {
      const raw = this.requestCtx.locale;
      if (raw === 'ja-JP') return 'ja';
      if (raw === 'en-US') return 'en';
      return 'zh';
    })();

    const feedbackBase = this.nutritionScoreService.generateFeedback(
      score.highlights,
      profile?.goal || 'health',
    );

    // 当宏量目标明显偏离时，避免误导性“各项达标”文案。
    const outOfRangeMacros = Object.entries(macroCompliance)
      .filter(([, value]) => value > 0 && (value < 70 || value > 110))
      .map(([key]) => key.replace('Adherence', ''));

    const macroNameMap: Record<string, Record<'zh' | 'en' | 'ja', string>> = {
      calorie: { zh: '热量', en: 'calories', ja: 'カロリー' },
      protein: { zh: '蛋白质', en: 'protein', ja: 'たんぱく質' },
      fat: { zh: '脂肪', en: 'fat', ja: '脂質' },
      carbs: { zh: '碳水', en: 'carbs', ja: '炭水化物' },
    };

    const feedback =
      summary.mealCount === 0
        ? locale === 'en'
          ? 'No meals recorded today yet. Start by logging your first meal.'
          : locale === 'ja'
            ? '今日はまだ食事記録がありません。まずは1食目を記録しましょう。'
            : '今日尚未记录饮食，开始记录第一餐吧。'
        : outOfRangeMacros.length > 0
          ? locale === 'en'
            ? `${outOfRangeMacros
                .map((m) => macroNameMap[m]?.[locale] || m)
                .join(
                  ', ',
                )} are not balanced yet. Adjust them gradually toward your target.`
            : locale === 'ja'
              ? `${outOfRangeMacros
                  .map((m) => macroNameMap[m]?.[locale] || m)
                  .join(
                    '、',
                  )}はまだバランスが取れていません。目標比率に向けて少しずつ調整しましょう。`
              : `${outOfRangeMacros.map((m) => macroNameMap[m]?.[locale] || m).join('、')}尚未达成平衡，建议按目标比例微调。`
          : feedbackBase;

    // V1.2: 宏量槽位状态检测
    const intake = {
      calories: summary.totalCalories,
      protein: summary.totalProtein || 0,
      fat: summary.totalFat || 0,
      carbs: summary.totalCarbs || 0,
    };
    const macroSlotStatus = this.nutritionScoreService.computeMacroSlotStatus(
      intake,
      {
        calories: goals.calories,
        protein: goals.protein,
        fat: goals.fat,
        carbs: goals.carbs,
      },
      localHour,
    );

    // V1.2: 结构化问题识别
    const issueHighlights = this.nutritionScoreService.detectIssueHighlights(
      intake,
      {
        calories: goals.calories,
        protein: goals.protein,
        fat: goals.fat,
        carbs: goals.carbs,
      },
      score.breakdown,
      summary.mealCount,
      locale,
      scoringHour,
    );

    // Phase 1.4: 生成自然语言状态解释（V1.2: 增加 macroSlotStatus 融合 + i18n locale）
    const statusExplanation = this.nutritionScoreService.buildStatusExplanation(
      score.breakdown,
      goals,
      {
        calories: summary.totalCalories,
        targetCalories: goals.calories,
        protein: summary.totalProtein || 0,
        fat: summary.totalFat || 0,
        carbs: summary.totalCarbs || 0,
        foodQuality:
          summary.mealCount > 0
            ? summary.avgQuality > 0
              ? summary.avgQuality
              : 3
            : 0,
        satiety:
          summary.mealCount > 0
            ? summary.avgSatiety > 0
              ? summary.avgSatiety
              : 3
            : 0,
      },
      stabilityData,
      score.decision,
      locale,
      macroSlotStatus,
      scoringHour,
      mealSignals,
    );

    // Phase 1.5: 增强 response — 状态标签、行为加分、最强/最弱维度、合规对比、状态解释
    const statusLabel = getStatusLabel(score.score);
    const breakdownEntries = Object.entries(score.breakdown) as Array<
      [string, number]
    >;
    const sorted = [...breakdownEntries].sort((a, b) => b[1] - a[1]);
    const topStrength = sorted[0]
      ? { dimension: sorted[0][0], score: Math.round(sorted[0][1]) }
      : undefined;
    const topWeakness = sorted[sorted.length - 1]
      ? {
          dimension: sorted[sorted.length - 1][0],
          score: Math.round(sorted[sorted.length - 1][1]),
        }
      : undefined;

    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: {
        totalScore: score.score,
        breakdown: score.breakdown,
        highlights: score.highlights,
        decision: score.decision,
        feedback,
        goals,
        intake: {
          calories: summary.totalCalories,
          protein: summary.totalProtein || 0,
          fat: summary.totalFat || 0,
          carbs: summary.totalCarbs || 0,
        },
        // Phase 1.5: 增强字段 - 状态标签和解释
        statusLabel,
        statusExplanation,
        topStrength,
        topWeakness,
        // 行为加分数据
        behaviorBonus: {
          streakDays: stabilityData.streakDays,
          complianceRate: stabilityData.complianceRate,
          bonusPoints:
            stabilityData.streakDays >= 7
              ? Math.min(5, Math.floor(stabilityData.streakDays / 7) * 1.5)
              : 0,
        },
        // 各宏量合规性对比
        complianceInsight: macroCompliance,
        // V1.2: 宏量槽位状态
        macroSlotStatus,
        // V1.2: 结构化问题列表
        issueHighlights,
        // V1.4: 每餐决策信号聚合 + 建议符合度
        mealSignals,
        decisionAlignment: this.nutritionScoreService.buildDecisionAlignment(
          mealSignals,
          locale,
          intake,
          {
            calories: goals.calories,
            protein: goals.protein,
            fat: goals.fat,
            carbs: goals.carbs,
          },
        ),
        // V1.5: 当前评分使用的维度权重及来源
        weights: score.weights,
        weightsSource: score.weightsSource,
        // V1.3: 每日进度（分离质量评分与完成度追踪）
        dailyProgress: {
          localHour,
          expectedProgress:
            Math.round(
              this.nutritionScoreService.getExpectedProgress(localHour) * 100,
            ) / 100,
          actualProgress:
            goals.calories > 0
              ? Math.round((summary.totalCalories / goals.calories) * 100) / 100
              : 0,
          // 既不能太少(< 70%预期)也不能太多(> 全天130%)才算 on track
          isOnTrack:
            goals.calories > 0
              ? summary.totalCalories / goals.calories >=
                  this.nutritionScoreService.getExpectedProgress(localHour) *
                    0.7 && summary.totalCalories / goals.calories <= 1.3
              : true,
        },
      },
    };
  }

  /**
   * 获取用户健康档案
   * GET /api/app/food/profile
   */
  @Get('profile')
  @ApiOperation({ summary: '获取用户健康档案' })
  async getProfile(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data: toProfileResponse(profile),
    };
  }

  /**
   * 保存/更新用户健康档案
   * PUT /api/app/food/profile
   */
  @Put('profile')
  @ApiOperation({ summary: '保存用户健康档案' })
  async saveProfile(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: SaveUserProfileDto,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.saveProfile(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.success'),
      data: toProfileResponse(profile),
    };
  }

  /**
   * 从当天食物记录的 foods JSON 中聚合加权平均 GI 和总碳水。
   * 权重 = 每个食物的碳水含量（碳水高的食物对血糖影响更大）。
   */
  private aggregateGlycemicData(records: any[]): {
    avgGI: number;
    totalCarbsFromFoods: number;
  } {
    let totalCarbs = 0;
    let weightedGISum = 0;

    for (const record of records) {
      const foods = Array.isArray(record.foods) ? record.foods : [];
      for (const food of foods) {
        const gi = Number(food.glycemicIndex) || 0;
        const carbs = Number(food.carbs) || Number(food.carbsG) || 0;
        if (gi > 0 && carbs > 0) {
          weightedGISum += gi * carbs;
          totalCarbs += carbs;
        }
      }
    }

    return {
      avgGI: totalCarbs > 0 ? Math.round(weightedGISum / totalCarbs) : 0,
      totalCarbsFromFoods: Math.round(totalCarbs),
    };
  }
}
