/**
 * V6 Phase 1.10 — PrecomputeService（每日推荐预计算）
 *
 * 核心职责：
 * 1. Cron 调度: 凌晨 3:00 为活跃用户生成次日三餐推荐
 * 2. 队列驱动: 通过 BullMQ `recommendation-precompute` 队列并发处理
 * 3. 查询接口: 推荐请求时优先读取预计算结果
 * 4. 失效机制: 画像变更事件 → 删除该用户当日预计算
 *
 * 集成方式：
 * - FoodService.getRecommendation() 先查 getPrecomputed()
 * - 命中 → 直接返回（延迟 < 200ms），标记 isUsed
 * - 未命中 → 回退到实时计算（现有逻辑不变）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { PrecomputedRecommendation } from '../entities/precomputed-recommendation.entity';
import { FoodRecord } from '../entities/food-record.entity';
import { MealRecommendation } from './recommendation/recommendation.types';
import {
  DomainEvents,
  ProfileUpdatedEvent,
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
    @InjectRepository(PrecomputedRecommendation)
    private readonly precomputeRepo: Repository<PrecomputedRecommendation>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectQueue(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
    private readonly precomputeQueue: Queue,
  ) {}

  // ─── 查询接口（推荐请求时调用） ───

  /**
   * 查询预计算推荐结果
   *
   * 返回 null 表示未命中，调用方应回退到实时计算。
   */
  async getPrecomputed(
    userId: string,
    date: string,
    mealType: string,
  ): Promise<{
    result: MealRecommendation;
    scenarioResults: Record<string, unknown> | null;
  } | null> {
    const record = await this.precomputeRepo.findOne({
      where: {
        userId,
        date,
        mealType,
        strategyVersion: CURRENT_STRATEGY_VERSION,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (!record) return null;

    // 标记为已使用（异步，不阻塞返回）
    if (!record.isUsed) {
      this.precomputeRepo.update(record.id, { isUsed: true }).catch(() => {
        /* non-critical */
      });
    }

    return {
      result: record.result as unknown as MealRecommendation,
      scenarioResults: record.scenarioResults,
    };
  }

  // ─── 存储接口（Worker 调用） ───

  /**
   * 存储预计算结果
   */
  async savePrecomputed(
    userId: string,
    date: string,
    mealType: string,
    result: MealRecommendation,
    scenarioResults?: Record<string, unknown>,
  ): Promise<void> {
    // 计算过期时间: date 当天 23:59:59
    const expiresAt = new Date(`${date}T23:59:59`);

    // TypeORM upsert 的 _QueryDeepPartialEntity 与 jsonb 字段类型不兼容，
    // 使用 query builder + 类型断言绕过
    await this.precomputeRepo
      .createQueryBuilder()
      .insert()
      .into(PrecomputedRecommendation)
      .values({
        userId,
        date,
        mealType,
        result: result as any,
        scenarioResults: (scenarioResults || null) as any,
        strategyVersion: CURRENT_STRATEGY_VERSION,
        expiresAt,
        isUsed: false,
      })
      .orUpdate(
        [
          'result',
          'scenario_results',
          'strategy_version',
          'expires_at',
          'is_used',
        ],
        ['user_id', 'date', 'meal_type'],
      )
      .execute();

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

  // ─── 事件监听: 画像变更失效 ───

  /**
   * 监听画像更新事件 → 删除该用户当日及次日的预计算
   *
   * 画像变更意味着推荐策略可能不同，预计算结果过时需要重新计算。
   */
  @OnEvent(DomainEvents.PROFILE_UPDATED)
  async handleProfileUpdated(event: ProfileUpdatedEvent): Promise<void> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().slice(0, 10);

      const deleteResult = await this.precomputeRepo.delete([
        { userId: event.userId, date: today },
        { userId: event.userId, date: tomorrowStr },
      ]);

      if (deleteResult.affected && deleteResult.affected > 0) {
        this.logger.debug(
          `预计算已失效: userId=${event.userId}, 删除 ${deleteResult.affected} 条, 原因=${event.updateType}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `预计算失效失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  // ─── 清理 ───

  /**
   * 每日清理过期的预计算记录（凌晨 4:00）
   */
  @Cron('0 4 * * *', { name: 'cleanup-precomputed' })
  async cleanupExpired(): Promise<void> {
    const result = await this.precomputeRepo.delete({
      expiresAt: LessThan(new Date()),
    });
    if (result.affected && result.affected > 0) {
      this.logger.log(`清理过期预计算: ${result.affected} 条`);
    }
  }

  // ─── 私有方法 ───

  /**
   * 获取最近 7 天有饮食记录的活跃用户 ID
   */
  private async getActiveUserIds(): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - ACTIVE_USER_DAYS);

    const results = await this.foodRecordRepo
      .createQueryBuilder('record')
      .select('DISTINCT record.user_id', 'userId')
      .where('record.created_at > :since', { since })
      .getRawMany<{ userId: string }>();

    return results.map((r) => r.userId);
  }
}
