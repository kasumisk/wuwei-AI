import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { FoodFeedbackStats } from './recommendation.types';
import {
  PreferenceUpdaterService,
  IncrementalPreferenceWeights,
} from './preference-updater.service';
import {
  DomainEvents,
  FeedbackSubmittedEvent,
  FeedbackRatings,
  ImplicitSignals,
} from '../../../../core/events/domain-events';

/**
 * V6 2.19: 多维反馈维度聚合统计 — 单个食物或全局的维度均值
 */
export interface FeedbackDimensionStats {
  /** 口味均值 (1-5) */
  avgTaste: number | null;
  /** 份量均值 (1-5) */
  avgPortion: number | null;
  /** 价格均值 (1-5) */
  avgPrice: number | null;
  /** 时间适合度均值 (1-5) */
  avgTiming: number | null;
  /** 有多维评分的反馈总数 */
  ratedCount: number;
}

/**
 * 推荐反馈服务 (V4 Phase 2.2 → V6 2.19 升级)
 *
 * 职责:
 * - 反馈写入: submitFeedback() — 含多维评分详情
 * - 反馈统计: getUserFeedbackStats() — 用于 Thompson Sampling
 * - V6 2.19: 多维反馈聚合: getUserDimensionStats() — 按食物/全局维度统计
 * - V4 Phase 3.1: 反馈后即时触发偏好权重增量更新
 */
@Injectable()
export class RecommendationFeedbackService {
  private readonly logger = new Logger(RecommendationFeedbackService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferenceUpdater: PreferenceUpdaterService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 提交推荐反馈 — accepted / replaced / skipped + 可选多维评分
   * 每条反馈对应一个推荐食物，由前端在用户操作时调用
   * V5 3.7: 新增 experimentId/groupId 关联 A/B 实验
   * V6 2.19: 新增 ratings（多维评分）和 implicitSignals（隐式行为信号）
   */
  async submitFeedback(params: {
    userId: string;
    mealType: string;
    foodName: string;
    foodId?: string;
    action: 'accepted' | 'replaced' | 'skipped';
    replacementFood?: string;
    recommendationScore?: number;
    goalType?: string;
    /** V5 3.7: A/B 实验 ID */
    experimentId?: string;
    /** V5 3.7: A/B 实验分组名 */
    groupId?: string;
    /** V6 2.19: 多维评分 */
    ratings?: FeedbackRatings;
    /** V6 2.19: 隐式行为信号 */
    implicitSignals?: ImplicitSignals;
  }): Promise<void> {
    try {
      // 1. 保存主反馈记录（与之前一致）
      const feedback = await this.prisma.recommendation_feedbacks.create({
        data: {
          user_id: params.userId,
          meal_type: params.mealType,
          food_name: params.foodName,
          food_id: params.foodId ?? null,
          action: params.action,
          replacement_food: params.replacementFood ?? null,
          recommendation_score: params.recommendationScore ?? null,
          goal_type: params.goalType ?? null,
          experiment_id: params.experimentId ?? null,
          group_id: params.groupId ?? null,
        },
      });

      // 2. V6 2.19: 如果有多维评分或隐式信号，保存详情记录
      const hasRatings = params.ratings && this.hasAnyRating(params.ratings);
      const hasSignals =
        params.implicitSignals && this.hasAnySignal(params.implicitSignals);

      if (hasRatings || hasSignals) {
        await this.prisma.feedback_details.create({
          data: {
            feedback_id: feedback.id,
            user_id: params.userId,
            food_name: params.foodName,
            meal_type: params.mealType,
            taste_rating: params.ratings?.taste ?? null,
            portion_rating: params.ratings?.portion ?? null,
            price_rating: params.ratings?.price ?? null,
            timing_rating: params.ratings?.timing ?? null,
            comment: params.ratings?.comment ?? null,
            dwell_time_ms: params.implicitSignals?.dwellTimeMs ?? null,
            detail_expanded: params.implicitSignals?.detailExpanded ?? null,
          },
        });
        this.logger.debug(
          `多维反馈详情已记录: [${params.foodName}] ` +
            `taste=${params.ratings?.taste ?? '-'} ` +
            `portion=${params.ratings?.portion ?? '-'} ` +
            `price=${params.ratings?.price ?? '-'} ` +
            `timing=${params.ratings?.timing ?? '-'}`,
        );
      }

      this.logger.log(
        `反馈已记录: ${params.action} [${params.foodName}]` +
          (params.replacementFood ? ` → ${params.replacementFood}` : '') +
          (hasRatings ? ' +多维评分' : ''),
      );

      // 3. V6 Phase 1.2: 发布域事件（V6 2.19 扩展载荷含 ratings + implicitSignals）
      this.eventEmitter.emit(
        DomainEvents.FEEDBACK_SUBMITTED,
        new FeedbackSubmittedEvent(
          params.userId,
          params.mealType,
          params.foodName,
          params.foodId,
          params.action,
          params.replacementFood,
          params.recommendationScore,
          params.goalType,
          params.experimentId,
          params.groupId,
          params.ratings,
          params.implicitSignals,
        ),
      );

      // 4. V4 Phase 3.1: 异步触发偏好权重增量更新（不阻塞反馈响应）
      // TODO(V6): 后续迁移到 @OnEvent 监听器中，进一步解耦
      this.triggerPreferenceUpdate({
        userId: params.userId,
        foodName: params.foodName,
        foodId: params.foodId,
        action: params.action,
      }).catch((err) => this.logger.warn(`偏好增量更新失败 (非阻塞): ${err}`));
    } catch (err) {
      this.logger.error(`保存反馈失败: ${err}`);
      throw err;
    }
  }

  /**
   * 获取用户对每个食物的反馈统计 — 用于 Thompson Sampling
   * 返回每个食物名的 {accepted, rejected} 计数
   * 未出现在返回结果中的食物 → 无反馈 → Beta(1,1) 均匀分布
   */
  async getUserFeedbackStats(
    userId: string,
  ): Promise<Record<string, FoodFeedbackStats>> {
    const stats: Record<string, FoodFeedbackStats> = {};
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      // 使用 SQL GROUP BY 在数据库端完成聚合，避免加载全部实体到内存
      const rows: { foodName: string; accepted: string; rejected: string }[] =
        await this.prisma.$queryRawUnsafe(
          `SELECT f.food_name AS "foodName",
                  SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END) AS "accepted",
                  SUM(CASE WHEN f.action != 'accepted' THEN 1 ELSE 0 END) AS "rejected"
           FROM recommendation_feedbacks f
           WHERE f.user_id = $1
             AND f.created_at >= $2
           GROUP BY f.food_name`,
          userId,
          since,
        );

      for (const row of rows) {
        stats[row.foodName] = {
          accepted: Number(row.accepted),
          rejected: Number(row.rejected),
        };
      }
    } catch (err) {
      this.logger.warn(`获取反馈统计失败: ${err}`);
    }
    return stats;
  }

  // ─── V6 2.19: 多维反馈聚合统计 ───

  /**
   * 获取用户的多维反馈聚合统计（按食物分组或全局）
   *
   * @param userId 用户 ID
   * @param days 统计窗口天数（默认 30 天）
   * @returns 按食物名分组的多维评分均值
   */
  async getUserDimensionStats(
    userId: string,
    days = 30,
  ): Promise<Record<string, FeedbackDimensionStats>> {
    const result: Record<string, FeedbackDimensionStats> = {};
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const rows: {
        foodName: string;
        avgTaste: string | null;
        avgPortion: string | null;
        avgPrice: string | null;
        avgTiming: string | null;
        cnt: string;
      }[] = await this.prisma.$queryRawUnsafe(
        `SELECT d.food_name AS "foodName",
                AVG(d.taste_rating) AS "avgTaste",
                AVG(d.portion_rating) AS "avgPortion",
                AVG(d.price_rating) AS "avgPrice",
                AVG(d.timing_rating) AS "avgTiming",
                COUNT(*) AS "cnt"
         FROM feedback_details d
         WHERE d.user_id = $1
           AND d.created_at >= $2
         GROUP BY d.food_name`,
        userId,
        since,
      );

      for (const row of rows) {
        result[row.foodName] = {
          avgTaste: row.avgTaste
            ? parseFloat(Number(row.avgTaste).toFixed(2))
            : null,
          avgPortion: row.avgPortion
            ? parseFloat(Number(row.avgPortion).toFixed(2))
            : null,
          avgPrice: row.avgPrice
            ? parseFloat(Number(row.avgPrice).toFixed(2))
            : null,
          avgTiming: row.avgTiming
            ? parseFloat(Number(row.avgTiming).toFixed(2))
            : null,
          ratedCount: Number(row.cnt),
        };
      }
    } catch (err) {
      this.logger.warn(`获取多维反馈统计失败: ${err}`);
    }
    return result;
  }

  /**
   * 获取用户的全局多维反馈均值（不按食物分组）
   * 用于画像推断和策略引擎
   */
  async getUserGlobalDimensionStats(
    userId: string,
    days = 30,
  ): Promise<FeedbackDimensionStats> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const rows: Array<{
        avgTaste: string | null;
        avgPortion: string | null;
        avgPrice: string | null;
        avgTiming: string | null;
        cnt: string;
      }> = await this.prisma.$queryRawUnsafe(
        `SELECT AVG(d.taste_rating) AS "avgTaste",
                AVG(d.portion_rating) AS "avgPortion",
                AVG(d.price_rating) AS "avgPrice",
                AVG(d.timing_rating) AS "avgTiming",
                COUNT(*) AS "cnt"
         FROM feedback_details d
         WHERE d.user_id = $1
           AND d.created_at >= $2`,
        userId,
        since,
      );

      const row = rows[0] ?? null;

      return {
        avgTaste: row?.avgTaste
          ? parseFloat(Number(row.avgTaste).toFixed(2))
          : null,
        avgPortion: row?.avgPortion
          ? parseFloat(Number(row.avgPortion).toFixed(2))
          : null,
        avgPrice: row?.avgPrice
          ? parseFloat(Number(row.avgPrice).toFixed(2))
          : null,
        avgTiming: row?.avgTiming
          ? parseFloat(Number(row.avgTiming).toFixed(2))
          : null,
        ratedCount: Number(row?.cnt ?? 0),
      };
    } catch (err) {
      this.logger.warn(`获取全局多维反馈统计失败: ${err}`);
      return {
        avgTaste: null,
        avgPortion: null,
        avgPrice: null,
        avgTiming: null,
        ratedCount: 0,
      };
    }
  }

  // ─── V4 Phase 3.1: 偏好增量更新 ───

  /**
   * 反馈后即时更新偏好权重
   * 读取 → 增量更新 → 写回 user_inferred_profiles.preferenceWeights
   */
  private async triggerPreferenceUpdate(params: {
    userId: string;
    foodName: string;
    foodId?: string;
    action: 'accepted' | 'replaced' | 'skipped';
  }): Promise<void> {
    // 1. 读取当前增量权重
    let inferredProfile = await this.prisma.user_inferred_profiles.findFirst({
      where: { user_id: params.userId },
    });

    const currentWeights =
      (inferredProfile?.preference_weights as IncrementalPreferenceWeights | null) ??
      null;

    // 2. 增量更新
    const updatedWeights = await this.preferenceUpdater.updateFromFeedback(
      params,
      currentWeights,
    );

    // 3. 写回
    if (inferredProfile) {
      await this.prisma.user_inferred_profiles.update({
        where: { id: inferredProfile.id },
        data: {
          preference_weights: updatedWeights as any,
        },
      });
    } else {
      // 如果没有推断画像，创建一个最小的（仅包含偏好权重）
      await this.prisma.user_inferred_profiles.create({
        data: {
          user_id: params.userId,
          preference_weights: updatedWeights as any,
        },
      });
    }

    this.logger.debug(
      `偏好权重增量更新: userId=${params.userId}, action=${params.action}, ` +
        `food=${params.foodName}, updateCount=${updatedWeights.updateCount}`,
    );
  }

  // ─── 私有工具方法 ───

  /** 检查 ratings 对象是否含有至少一个有效评分 */
  private hasAnyRating(ratings: FeedbackRatings): boolean {
    return (
      ratings.taste != null ||
      ratings.portion != null ||
      ratings.price != null ||
      ratings.timing != null ||
      (ratings.comment != null && ratings.comment.trim().length > 0)
    );
  }

  /** 检查 implicitSignals 对象是否含有至少一个有效信号 */
  private hasAnySignal(signals: ImplicitSignals): boolean {
    return signals.dwellTimeMs != null || signals.detailExpanded != null;
  }
}
