/**
 * V6 Phase 1.10 — PrecomputeService（每日推荐预计算）
 *
 * 核心职责：
 * 1. Cron 调度: 凌晨 3:00 为活跃用户生成次日三餐推荐（兜底）
 * 2. 队列驱动: 通过 BullMQ `recommendation-precompute` 队列并发处理
 * 3. 查询接口: 推荐请求时优先读取预计算结果
 * 4. 失效机制: 画像变更事件 → 删除该用户当日预计算
 * 5. V6.3 P2-11: 事件驱动单用户预计算 — 画像变更/饮食记录/反馈提交
 *    均触发单用户预计算 job（防抖 5 分钟，同一用户不重复入队）
 *
 * 集成方式：
 * - FoodService.getRecommendation() 先查 getPrecomputed()
 * - 命中 → 直接返回（延迟 < 200ms），标记 isUsed
 * - 未命中 → 回退到实时计算（现有逻辑不变）
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MealRecommendation } from './recommendation/recommendation.types';
import {
  DomainEvents,
  ProfileUpdatedEvent,
  MealRecordedEvent,
  FeedbackSubmittedEvent,
} from '../../../core/events/domain-events';
import { QUEUE_NAMES } from '../../../core/queue/queue.constants';

// ─── 常量 ───

/** 策略版本（画像变更时递增以判断预计算是否过时） */
const CURRENT_STRATEGY_VERSION = 'v6.1.10';

/** 餐次类型列表 */
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;

/** 活跃用户判断: 最近 7 天有饮食记录 */
const ACTIVE_USER_DAYS = 7;

/** 预计算 job 数据结构 */
export interface PrecomputeJobData {
  userId: string;
  date: string;
  mealTypes: string[];
}

@Injectable()
export class PrecomputeService {
  private readonly logger = new Logger(PrecomputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
    private readonly precomputeQueue: Queue,
  ) {}

  // ─── 查询接口（推荐请求时调用） ───

  /**
   * 查询预计算推荐结果
   *
   * V6.9 Phase 3-B: 新增 channel 参数，切换渠道时不命中旧缓存。
   * 返回 null 表示未命中，调用方应回退到实时计算。
   */
  async getPrecomputed(
    userId: string,
    date: string,
    mealType: string,
    channel?: string,
  ): Promise<{
    result: MealRecommendation;
    scenarioResults: Record<string, unknown> | null;
  } | null> {
    const record = await this.prisma.precomputed_recommendations.findFirst({
      where: {
        user_id: userId,
        date,
        meal_type: mealType,
        channel: channel ?? 'unknown',
        strategy_version: CURRENT_STRATEGY_VERSION,
        expires_at: { gt: new Date() },
      },
    });

    if (!record) return null;

    // 标记为已使用（异步，不阻塞返回）
    if (!record.is_used) {
      this.prisma.precomputed_recommendations
        .update({ where: { id: record.id }, data: { is_used: true } })
        .catch(() => {
          /* non-critical */
        });
    }

    return {
      result: record.result as unknown as MealRecommendation,
      scenarioResults: record.scenario_results as Record<
        string,
        unknown
      > | null,
    };
  }

  // ─── 存储接口（Worker 调用） ───

  /**
   * 存储预计算结果
   *
   * V6.9 Phase 3-B: 新增 channel 参数，与渠道维度关联存储。
   */
  async savePrecomputed(
    userId: string,
    date: string,
    mealType: string,
    result: MealRecommendation,
    scenarioResults?: Record<string, unknown>,
    channel?: string,
  ): Promise<void> {
    // 计算过期时间: date 当天 23:59:59
    const expiresAt = new Date(`${date}T23:59:59`);
    const ch = channel ?? 'unknown';

    await this.prisma.precomputed_recommendations.upsert({
      where: {
        user_id_date_meal_type_channel: {
          user_id: userId,
          date,
          meal_type: mealType,
          channel: ch,
        },
      },
      update: {
        result: result as any,
        scenario_results: (scenarioResults || null) as any,
        strategy_version: CURRENT_STRATEGY_VERSION,
        expires_at: expiresAt,
        is_used: false,
      },
      create: {
        user_id: userId,
        date,
        meal_type: mealType,
        channel: ch,
        result: result as any,
        scenario_results: (scenarioResults || null) as any,
        strategy_version: CURRENT_STRATEGY_VERSION,
        expires_at: expiresAt,
        is_used: false,
      },
    });

    this.logger.debug(
      `预计算已存储: userId=${userId}, date=${date}, mealType=${mealType}`,
    );
  }

  // ─── Cron 调度 ───

  /**
   * 每日凌晨 3:00 触发预计算
   *
   * 1. 查找最近 7 天有饮食记录的活跃用户
   * 2. 为每个用户创建一个 BullMQ job，计算次日三餐推荐
   */
  @Cron('0 3 * * *', { name: 'daily-precompute' })
  async triggerDailyPrecompute(): Promise<void> {
    this.logger.log('每日预计算开始...');

    const activeUserIds = await this.getActiveUserIds();
    if (activeUserIds.length === 0) {
      this.logger.log('无活跃用户，跳过预计算');
      return;
    }

    // 次日日期
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);

    // 批量入队
    const jobs = activeUserIds.map((userId) => ({
      name: `precompute-${userId}-${tomorrowStr}`,
      data: {
        userId,
        date: tomorrowStr,
        mealTypes: [...MEAL_TYPES],
      } satisfies PrecomputeJobData,
      opts: {
        // 同一用户同一天不重复计算
        jobId: `precompute:${userId}:${tomorrowStr}`,
        attempts: 2,
        backoff: { type: 'exponential' as const, delay: 5000 },
      },
    }));

    await this.precomputeQueue.addBulk(jobs);
    this.logger.log(
      `预计算任务已入队: ${activeUserIds.length} 个用户, 日期=${tomorrowStr}`,
    );
  }

  // ─── 事件监听: 画像变更失效 + 单用户预计算 ───

  /**
   * 监听画像更新事件 → 删除该用户当日及次日的预计算 → 触发单用户重计算
   *
   * 画像变更意味着推荐策略可能不同，预计算结果过时需要重新计算。
   */
  @OnEvent(DomainEvents.PROFILE_UPDATED, { async: true })
  async handleProfileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const deleteResult =
        await this.prisma.precomputed_recommendations.deleteMany({
          where: {
            user_id: event.userId,
            date: { in: [today, tomorrowStr] },
          },
        });

      if (deleteResult.count > 0) {
        this.logger.debug(
          `预计算已失效: userId=${event.userId}, 删除 ${deleteResult.count} 条, 原因=${event.updateType}`,
        );
      }

      // V6.3 P2-11: 触发单用户预计算（防抖）
      await this.triggerSingleUserPrecompute(event.userId, 'profile_updated');
    } catch (err) {
      this.logger.warn(
        `预计算失效失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  // ─── V6.3 P2-11: 事件驱动单用户预计算 ───

  /**
   * 监听饮食记录事件 → 触发单用户预计算
   *
   * 用户记录了新的饮食数据后，已有预计算可能不再准确（如剩余热量预算变化），
   * 需要重新计算当日剩余餐次的推荐。
   */
  @OnEvent(DomainEvents.MEAL_RECORDED, { async: true })
  async handleMealRecorded(event: MealRecordedEvent): Promise<void> {
    try {
      await this.triggerSingleUserPrecompute(event.userId, 'meal_recorded');
    } catch (err) {
      this.logger.warn(
        `饮食记录触发预计算失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * 监听反馈提交事件 → 触发单用户预计算
   *
   * 用户提交反馈后偏好权重可能变化，推荐结果需要更新。
   */
  @OnEvent(DomainEvents.FEEDBACK_SUBMITTED, { async: true })
  async handleFeedbackSubmitted(event: FeedbackSubmittedEvent): Promise<void> {
    try {
      await this.triggerSingleUserPrecompute(
        event.userId,
        'feedback_submitted',
      );
    } catch (err) {
      this.logger.warn(
        `反馈触发预计算失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * V6.3 P2-11: 触发单用户预计算
   *
   * 防抖机制: 使用 jobId 实现 5 分钟防抖 — 同一用户在 5 分钟内的多次事件
   * 只会创建一个 job（BullMQ 的 jobId 唯一性保证）。
   *
   * @param userId 用户 ID
   * @param trigger 触发原因（用于日志和调试）
   */
  private async triggerSingleUserPrecompute(
    userId: string,
    trigger: string,
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    // 5 分钟时间窗口生成唯一 slot（同一 slot 内只入队一次）
    const debounceSlot = Math.floor(Date.now() / (5 * 60 * 1000));
    const jobId = `precompute:event:${userId}:${today}:${debounceSlot}`;

    try {
      await this.precomputeQueue.add(
        `event-precompute-${userId}`,
        {
          userId,
          date: today,
          mealTypes: [...MEAL_TYPES],
        } satisfies PrecomputeJobData,
        {
          jobId,
          attempts: 2,
          backoff: { type: 'exponential' as const, delay: 5000 },
          // 延迟 30 秒执行，避免短时间内多次画像更新导致的重复计算
          delay: 30_000,
        },
      );

      this.logger.debug(
        `事件驱动预计算已入队: userId=${userId}, trigger=${trigger}, jobId=${jobId}`,
      );
    } catch (err) {
      // BullMQ 对重复 jobId 会抛出错误（已有相同 job），这是预期行为
      if ((err as Error).message?.includes('Job already exists')) {
        this.logger.debug(
          `事件驱动预计算已在队列中（防抖生效）: userId=${userId}, trigger=${trigger}`,
        );
      } else {
        throw err;
      }
    }
  }

  // ─── 清理 ───

  /**
   * 每日清理过期的预计算记录（凌晨 4:15）
   * V6.4: 从 04:00 移到 04:15 避免与 dailyConflictResolution 同时执行
   */
  @Cron('15 4 * * *', { name: 'cleanup-precomputed' })
  async cleanupExpired(): Promise<void> {
    const result = await this.prisma.precomputed_recommendations.deleteMany({
      where: { expires_at: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`清理过期预计算: ${result.count} 条`);
    }
  }

  // ─── 私有方法 ───

  /**
   * V6.2 3.6: 获取最近 7 天有饮食记录的活跃用户 ID（游标分页）
   *
   * 使用 raw SQL DISTINCT + LIMIT/OFFSET 分页，避免一次性加载全量。
   * 由于只返回 user_id，内存占用已经较小，但在用户量级大时仍有好处。
   */
  private async getActiveUserIds(): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - ACTIVE_USER_DAYS);

    const PAGE_SIZE = 1000;
    const userIds: string[] = [];
    let offset = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await this.prisma.$queryRawUnsafe<
        Array<{ user_id: string }>
      >(
        `SELECT DISTINCT user_id FROM food_records
         WHERE created_at > $1
         ORDER BY user_id
         LIMIT $2 OFFSET $3`,
        since,
        PAGE_SIZE,
        offset,
      );

      if (page.length === 0) break;
      userIds.push(...page.map((r) => r.user_id));
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return userIds;
  }
}
