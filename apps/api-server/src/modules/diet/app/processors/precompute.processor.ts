/**
 * V6 Phase 1.10 — PrecomputeProcessor（BullMQ Worker）
 *
 * 处理每日推荐预计算 job。
 * 每个 job 对应一个用户的一天，包含多个餐次（breakfast/lunch/dinner）。
 *
 * 流程：
 * 1. 获取用户画像
 * 2. 获取用户当前摄入（默认 consumed=0，因为是预计算次日）
 * 3. 调用 RecommendationEngineService 生成各餐推荐
 * 4. 存储到 precomputed_recommendations 表（按所有已知渠道各存一份）
 *
 * 5.3 修复（2026-05-02）：
 *   原实现 savePrecomputed 不传 channel，全部写为 'unknown'，
 *   导致 (userId, date, mealType, channel) 唯一索引的 channel 槽被
 *   'unknown' 占满，真实渠道（app/web/miniprogram）查询时永远未命中。
 *   现改为：推荐引擎只跑一次，结果复用，为每个已知渠道（含 unknown）
 *   各 upsert 一条记录，确保所有渠道都能命中预计算缓存。
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUE_NAMES,
  QUEUE_DEFAULT_OPTIONS,
  DeadLetterService,
  TaskHandlerRegistry,
  processorAsHandler,
} from '../../../../core/queue';
import {
  PrecomputeService,
  PrecomputeJobData,
} from '../services/precompute.service';
import { RecommendationEngineService } from '../services/recommendation-engine.service';
import { ProfileCacheService } from '../../../user/app/services/profile/profile-cache.service';
import { NutritionScoreService } from '../services/nutrition-score.service';
import {
  UserProfileConstraints,
  MealTarget,
} from '../recommendation/types/recommendation.types';
import { KNOWN_CHANNELS } from '../recommendation/utils/channel';

/** 5.3 修复: 批量预计算时写入的渠道列表（所有已知渠道，含 unknown 兜底） */
const PRECOMPUTE_CHANNELS = KNOWN_CHANNELS;

@Processor(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
export class PrecomputeProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PrecomputeProcessor.name);

  constructor(
    private readonly precomputeService: PrecomputeService,
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly profileCache: ProfileCacheService,
    private readonly nutritionScore: NutritionScoreService,
    // V6.5 Phase 2A: DLQ 服务
    private readonly deadLetterService: DeadLetterService,
    private readonly registry: TaskHandlerRegistry,
  ) {
    super();
  }

  onModuleInit(): void {
    this.registry.register(
      QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE,
      '*',
      processorAsHandler(this),
    );
  }

  async process(job: Job<PrecomputeJobData>): Promise<void> {
    const { userId, date, mealTypes } = job.data;
    this.logger.debug(
      `开始预计算: userId=${userId}, date=${date}, meals=${mealTypes.join(',')}`,
    );

    try {
      // 1. 获取用户画像
      const fullProfile = await this.profileCache.getFullProfile(userId);
      const declared = fullProfile.declared;
      if (!declared) {
        this.logger.debug(`跳过预计算（无画像）: userId=${userId}`);
        return;
      }

      // 从 declared 画像构造 DailyGoalProfile，调用 calculateDailyGoals
      const goalType = declared.goal || 'health';
      const goals = this.nutritionScore.calculateDailyGoals({
        weightKg: declared.weightKg != null ? Number(declared.weightKg) : null,
        dailyCalorieGoal: declared.dailyCalorieGoal,
        goal: goalType,
      });

      // 2. 预计算默认: consumed=0（次日初始状态）
      const consumed = { calories: 0, protein: 0 };
      const dailyTarget: MealTarget = {
        calories: goals.calories,
        protein: goals.protein,
        fat: goals.fat,
        carbs: goals.carbs,
      };

      const userConstraints: UserProfileConstraints = {
        dietaryRestrictions: (declared.dietaryRestrictions as string[]) || [],
        weakTimeSlots: (declared.weakTimeSlots as string[]) || [],
        discipline: declared.discipline || 'medium',
        allergens: (declared.allergens as string[]) || [],
        healthConditions: (declared.healthConditions as string[]) || [],
        regionCode: declared.regionCode || 'CN',
        // V6.2 3.4: 声明画像新字段
        cookingSkillLevel: declared.cookingSkillLevel as string | undefined,
        budgetLevel: declared.budgetLevel as string | undefined,
        cuisinePreferences:
          (declared.cuisinePreferences as string[]) || undefined,
      };

      // 3. 逐餐次生成推荐
      for (const mealType of mealTypes) {
        try {
          // 计算餐次预算
          const mealRatios: Record<string, number> = {
            breakfast: 0.3,
            lunch: 0.4,
            dinner: 0.3,
          };
          const ratio = mealRatios[mealType] || 0.33;
          const budget = {
            calories: Math.round(goals.calories * ratio),
            protein: Math.round(goals.protein * ratio),
            fat: Math.round(goals.fat * ratio),
            carbs: Math.round(goals.carbs * ratio),
          };

          // 主推荐
          const result = await this.recommendationEngine.recommendMeal(
            userId,
            mealType,
            goalType,
            consumed,
            budget,
            dailyTarget,
            userConstraints,
          );

          // 场景化推荐
          const scenarioResults =
            await this.recommendationEngine.recommendByScenario(
              userId,
              mealType,
              goalType,
              consumed,
              budget,
              dailyTarget,
              userConstraints,
            );

          // 4. 5.3 修复: 为所有已知渠道各存一份预计算结果
          //    推荐引擎只跑一次（渠道差异在实时路径体现），
          //    预计算作为兜底缓存，所有渠道共享同一份结果内容。
          //    这样无论用户从 app/web/miniprogram/api 哪个渠道访问，
          //    都能命中预计算缓存，而不是因 channel='unknown' 独占唯一索引槽。
          await Promise.all(
            PRECOMPUTE_CHANNELS.map((channel) =>
              this.precomputeService.savePrecomputed(
                userId,
                date,
                mealType,
                result,
                scenarioResults as unknown as Record<string, unknown>,
                channel,
              ),
            ),
          );

          // 更新 consumed（后续餐次基于已消耗量计算）
          consumed.calories += result.totalCalories;
          consumed.protein += result.totalProtein;
        } catch (mealErr) {
          this.logger.warn(
            `预计算餐次失败: userId=${userId}, meal=${mealType}, ${(mealErr as Error).message}`,
          );
          // 单餐失败不影响其他餐次
        }
      }

      this.logger.debug(`预计算完成: userId=${userId}, date=${date}`);
    } catch (err) {
      this.logger.error(
        `预计算失败: userId=${userId}, date=${date}, ${(err as Error).message}`,
      );
      throw err; // 让 BullMQ 重试
    }
  }

  /**
   * V6.5 Phase 2A: BullMQ failed 事件钩子
   * 当 job 重试耗尽（最终失败）时，存入 DLQ
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<PrecomputeJobData>, error: Error): Promise<void> {
    const maxAttempts =
      job.opts?.attempts ??
      QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE].maxRetries +
        1;
    if (job.attemptsMade >= maxAttempts) {
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    }
  }
}
