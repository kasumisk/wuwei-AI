import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../../food/entities/food-library.entity';

/**
 * 偏好自动更新服务 (V4 Phase 3.1)
 *
 * 设计动机:
 * - 当前 PreferenceProfileService 每次从 recommendation_feedbacks 实时聚合 60 天数据，
 *   对权重的变化完全被动（等待下次推荐时才重新计算）
 * - 本服务在每次 submitFeedback() 后立即进行增量更新:
 *   1. 查询被反馈食物的 category / mainIngredient / foodGroup
 *   2. 按 incremental EMA 公式调整对应维度的权重
 *   3. 单次变化上限 ±5%，总权重归一化到 [0.3, 1.5]
 *
 * 增量公式:
 *   newWeight = oldWeight + direction * LEARNING_RATE
 *   direction: accepted → +1, replaced/skipped → -1
 *   LEARNING_RATE = 0.03 (即最大 3% 单次变化，连续同向时可累积)
 *
 * 注意:
 * - 这是一个 "即时反馈 → 即时更新" 的热路径，不替代
 *   PreferenceProfileService 的全量重算（那是冷路径，用于初始化和校准）
 * - 增量权重存储在 user_inferred_profiles.preferenceWeights (jsonb)
 * - 如果用户没有增量权重，回退到 PreferenceProfileService 的全量计算
 */

/** 增量权重存储结构 */
export interface IncrementalPreferenceWeights {
  categoryWeights: Record<string, number>;
  ingredientWeights: Record<string, number>;
  foodGroupWeights: Record<string, number>;
  foodNameWeights: Record<string, number>;
  /** 最近一次更新时间 (ISO string) */
  lastUpdatedAt: string;
  /** 总更新次数 */
  updateCount: number;
}

/** 单次反馈的增量更新参数 */
export interface FeedbackUpdateParams {
  userId: string;
  foodName: string;
  foodId?: string;
  action: 'accepted' | 'replaced' | 'skipped';
}

@Injectable()
export class PreferenceUpdaterService {
  private readonly logger = new Logger(PreferenceUpdaterService.name);

  /** 单次学习率 — 控制权重变化速度 */
  private readonly LEARNING_RATE = 0.03;

  /** 权重下界 */
  private readonly WEIGHT_MIN = 0.3;

  /** 权重上界 */
  private readonly WEIGHT_MAX = 1.5;

  /** 食物名级别的学习率更保守 (避免过拟合) */
  private readonly NAME_LEARNING_RATE = 0.02;

  /** 食物名权重范围更窄 */
  private readonly NAME_WEIGHT_MIN = 0.7;
  private readonly NAME_WEIGHT_MAX = 1.2;

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
  ) {}

  /**
   * 根据反馈增量更新偏好权重
   *
   * @param params 反馈参数
   * @param currentWeights 当前权重（从 UserInferredProfile.preferenceWeights 获取，可能为 null）
   * @returns 更新后的权重
   */
  async updateFromFeedback(
    params: FeedbackUpdateParams,
    currentWeights: IncrementalPreferenceWeights | null,
  ): Promise<IncrementalPreferenceWeights> {
    const weights = currentWeights ?? this.createEmptyWeights();

    // 1. 查找食物的分类维度
    const dimensions = await this.lookupFoodDimensions(
      params.foodId,
      params.foodName,
    );

    // 2. 计算方向: accepted → +1, replaced/skipped → -1
    const direction = params.action === 'accepted' ? 1 : -1;

    // 3. 按维度增量更新
    if (dimensions.category) {
      weights.categoryWeights[dimensions.category] = this.clampWeight(
        (weights.categoryWeights[dimensions.category] ?? 1.0) +
          direction * this.LEARNING_RATE,
        this.WEIGHT_MIN,
        this.WEIGHT_MAX,
      );
    }

    if (dimensions.mainIngredient) {
      weights.ingredientWeights[dimensions.mainIngredient] = this.clampWeight(
        (weights.ingredientWeights[dimensions.mainIngredient] ?? 1.0) +
          direction * this.LEARNING_RATE,
        this.WEIGHT_MIN,
        this.WEIGHT_MAX,
      );
    }

    if (dimensions.foodGroup) {
      weights.foodGroupWeights[dimensions.foodGroup] = this.clampWeight(
        (weights.foodGroupWeights[dimensions.foodGroup] ?? 1.0) +
          direction * this.LEARNING_RATE,
        this.WEIGHT_MIN,
        this.WEIGHT_MAX,
      );
    }

    // 食物名使用更保守的学习率
    if (params.foodName) {
      weights.foodNameWeights[params.foodName] = this.clampWeight(
        (weights.foodNameWeights[params.foodName] ?? 1.0) +
          direction * this.NAME_LEARNING_RATE,
        this.NAME_WEIGHT_MIN,
        this.NAME_WEIGHT_MAX,
      );
    }

    weights.lastUpdatedAt = new Date().toISOString();
    weights.updateCount++;

    return weights;
  }

  /**
   * 创建空的增量权重结构
   */
  createEmptyWeights(): IncrementalPreferenceWeights {
    return {
      categoryWeights: {},
      ingredientWeights: {},
      foodGroupWeights: {},
      foodNameWeights: {},
      lastUpdatedAt: new Date().toISOString(),
      updateCount: 0,
    };
  }

  /**
   * 查找食物的分类维度 — 用于确定更新哪些权重键
   */
  private async lookupFoodDimensions(
    foodId?: string,
    foodName?: string,
  ): Promise<{
    category?: string;
    mainIngredient?: string;
    foodGroup?: string;
  }> {
    try {
      let food: FoodLibrary | null = null;

      // 优先按 ID 查找
      if (foodId) {
        food = await this.foodLibraryRepo.findOne({
          where: { id: foodId },
          select: ['id', 'category', 'mainIngredient', 'foodGroup'],
        });
      }

      // 回退到按名称查找
      if (!food && foodName) {
        food = await this.foodLibraryRepo.findOne({
          where: { name: foodName },
          select: ['id', 'category', 'mainIngredient', 'foodGroup'],
        });
      }

      if (!food) {
        this.logger.debug(
          `食物未找到: id=${foodId}, name=${foodName} — 仅更新 foodName 权重`,
        );
        return {};
      }

      return {
        category: food.category || undefined,
        mainIngredient: food.mainIngredient || undefined,
        foodGroup: food.foodGroup || undefined,
      };
    } catch (err) {
      this.logger.warn(`查找食物维度失败: ${err}`);
      return {};
    }
  }

  /**
   * 限制权重在 [min, max] 范围内
   */
  private clampWeight(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
