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
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { getUserLocalDate } from '../../../../common/utils/timezone.util';
import { DEFAULT_TIMEZONE } from '../../../../common/config/regional-defaults';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { MealRecommendation } from '../recommendation/types/recommendation.types';
import {
  DomainEvents,
  ProfileUpdatedEvent,
  MealRecordedEvent,
  FeedbackSubmittedEvent,
} from '../../../../core/events/domain-events';
import { QUEUE_NAMES } from '../../../../core/queue/queue.constants';
import { MetricsService } from '../../../../core/metrics/metrics.service';
import {
  normalizeChannel,
  type RecommendationChannel,
} from '../recommendation/utils/channel';
import {
  QuotaGateService,
} from '../../../subscription/app/services/quota-gate.service';
import { GatedFeature } from '../../../subscription/subscription.types';

// ─── 常量 ───

/**
 * V8.0: 策略版本改为动态获取
 * 优先从环境变量 STRATEGY_VERSION 读取，回退到默认值
 * 当推荐策略变更时，只需更新环境变量即可自动失效旧预计算缓存
 */
const DEFAULT_STRATEGY_VERSION = 'v8.0.0';

/** 餐次类型列表 */
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'] as const;

/** 活跃用户判断: 最近 7 天有饮食记录 */
const ACTIVE_USER_DAYS = 7;

function buildPrecomputeJobId(parts: Array<string | number>): string {
  return parts.join('_');
}

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
    private readonly configService: ConfigService,
    private readonly redisCache: RedisCacheService,
    @InjectQueue(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
    private readonly precomputeQueue: Queue,
    private readonly metricsService: MetricsService,
    private readonly quotaGate: QuotaGateService,
  ) {}

  /**
   * V8.0: 获取当前策略版本
   * 优先从环境变量 STRATEGY_VERSION 读取，回退到默认值
   */
  private get strategyVersion(): string {
    return (
      this.configService.get<string>('STRATEGY_VERSION') ??
      DEFAULT_STRATEGY_VERSION
    );
  }

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
    const ch: RecommendationChannel = normalizeChannel(channel, (raw) => {
      // 非白名单值降级为 unknown 时记一条 warn，便于后续排查异常 channel 分布。
      // 不阻塞主链路，不抛错。
      this.logger.warn(
        `[precompute.getPrecomputed] unknown channel "${raw}" normalized to "unknown"`,
      );
    });
    // P0-4: 记录 channel 分布（含 unknown），观察 client-context middleware 上线
    // 后 unknown 占比是否回落到 < 1%
    this.metricsService.recommendationChannel.inc({ channel: ch });
    const record = await this.prisma.precomputedRecommendations.findFirst({
      where: {
        userId: userId,
        date,
        mealType: mealType,
        channel: ch,
        strategyVersion: this.strategyVersion,
        expiresAt: { gt: new Date() },
      },
    });

    if (!record) return null;

    // 标记为已使用（异步，不阻塞返回）
    if (!record.isUsed) {
      this.prisma.precomputedRecommendations
        .update({ where: { id: record.id }, data: { isUsed: true } })
        .catch(() => {
          /* non-critical */
        });
    }

    return {
      result: record.result as unknown as MealRecommendation,
      scenarioResults: record.scenarioResults as Record<string, unknown> | null,
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
    // P0-3: 使用 normalizeChannel 保证 store 端与 lookup 端走同一规范化逻辑，
    // 避免 "App"/"app"/" app " 等导致同一逻辑渠道写入多份缓存。
    const ch: RecommendationChannel = normalizeChannel(channel, (raw) => {
      this.logger.warn(
        `[precompute.savePrecomputed] unknown channel "${raw}" normalized to "unknown"`,
      );
    });

    await this.prisma.precomputedRecommendations.upsert({
      where: {
        userId_date_mealType_channel: {
          userId: userId,
          date,
          mealType: mealType,
          channel: ch,
        },
      },
      update: {
        result: result as any,
        scenarioResults: (scenarioResults || null) as any,
        strategyVersion: this.strategyVersion,
        expiresAt: expiresAt,
        isUsed: false,
      },
      create: {
        userId: userId,
        date,
        mealType: mealType,
        channel: ch,
        result: result as any,
        scenarioResults: (scenarioResults || null) as any,
        strategyVersion: this.strategyVersion,
        expiresAt: expiresAt,
        isUsed: false,
      },
    });

    this.logger.debug(
      `预计算已存储: userId=${userId}, date=${date}, mealType=${mealType}`,
    );
  }

  // ─── Cron 调度 ───

  /**
   * P5 修复（2026-05-02）：每日 07:00 触发预计算
   *
   * 原定 03:00，但 weight-learner-daily（06:30）尚未运行，
   * 导致预计算使用的是 T-1 的旧权重，新权重最长延迟 20.5h 才能生效。
   *
   * 调度依赖顺序（每日）：
   *   04:15  cleanup-precomputed   — 清理过期记录
   *   06:00  learned-ranking       — 每周一更新 segment 排序权重（LearnedRankingService）
   *   06:30  weight-learner-daily  — 更新全局/区域/用户级评分权重（WeightLearnerService）
   *   07:00  daily-precompute      — 用最新权重为活跃用户生成次日推荐 ← 本 Cron
   *
   * 1. 查找最近 7 天有饮食记录的活跃用户
   * 2. 为每个用户创建一个 BullMQ job，计算次日三餐推荐
   */
  @Cron('0 7 * * *', { name: 'daily-precompute' })
  async triggerDailyPrecompute(): Promise<void> {
    await this.redisCache.runWithLock(
      'precompute:daily',
      20 * 60 * 1000, // 20 分钟过期
      () => this.doTriggerDailyPrecompute(),
    );
  }

  private async doTriggerDailyPrecompute(): Promise<void> {
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
        jobId: buildPrecomputeJobId(['precompute', userId, tomorrowStr]),
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
      // P2-2.12: 切日点用用户本地时区
      const tz = await this.getUserTimezone(event.userId);
      const today = getUserLocalDate(tz);
      const tomorrowDate = new Date();
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = getUserLocalDate(tz, tomorrowDate);

      const deleteResult =
        await this.prisma.precomputedRecommendations.deleteMany({
          where: {
            userId: event.userId,
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
   * 权益检查: 仅对拥有 WEEKLY_PLAN 权益的用户入队，无权益用户直接跳过。
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
    // 权益检查：无 WEEKLY_PLAN 权益的用户不预计算
    const decision = await this.quotaGate.checkOnly(
      userId,
      GatedFeature.WEEKLY_PLAN,
    );
    if (!decision.allowed) {
      this.logger.debug(
        `跳过预计算（无权益）: userId=${userId}, trigger=${trigger}`,
      );
      return;
    }

    // P2-2.12: 切日点用用户本地时区（debounceSlot 仍按服务器 5 分钟窗口，与时区无关）
    const tz = await this.getUserTimezone(userId);
    const today = getUserLocalDate(tz);
    const debounceSlot = Math.floor(Date.now() / (5 * 60 * 1000));
    const jobId = buildPrecomputeJobId([
      'precompute',
      'event',
      userId,
      today,
      debounceSlot,
    ]);

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
          removeOnComplete: 500,
          removeOnFail: 100,
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
    await this.redisCache.runWithLock(
      'precompute:cleanup',
      5 * 60 * 1000,
      async () => {
        const result = await this.prisma.precomputedRecommendations.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
        if (result.count > 0) {
          this.logger.log(`清理过期预计算: ${result.count} 条`);
        }
      },
    );
  }

  // ─── 私有方法 ───

  /**
   * V6.2 3.6 / V6.2.1: 获取最近 7 天有饮食记录且拥有 weekly_plan 权益的活跃用户 ID
   *
   * 权益过滤规则：
   * - 用户必须拥有有效（active 或 grace）订阅
   * - 所订阅套餐的 entitlements JSON 中 weekly_plan = true
   * - 无权益用户不入队，不浪费计算资源
   *
   * 使用 raw SQL DISTINCT + LIMIT/OFFSET 分页，避免一次性加载全量。
   */
  private async getActiveUserIds(): Promise<string[]> {
    const since = new Date();
    since.setDate(since.getDate() - ACTIVE_USER_DAYS);

    const PAGE_SIZE = 1000;
    const userIds: string[] = [];
    let offset = 0;

    while (true) {
      const page = await this.prisma.$queryRawUnsafe<Array<{ userId: string }>>(
        `SELECT DISTINCT fr.user_id
         FROM food_records fr
         INNER JOIN subscription s
           ON s.user_id = fr.user_id
           AND s.status IN ('active', 'grace')
           AND s.expires_at > NOW()
         INNER JOIN subscription_plan sp
           ON sp.id = s.plan_id
           AND (sp.entitlements->>'weekly_plan')::boolean = true
         WHERE fr.created_at > $1
         ORDER BY fr.user_id
         LIMIT $2 OFFSET $3`,
        since,
        PAGE_SIZE,
        offset,
      );

      if (page.length === 0) break;
      userIds.push(...page.map((r) => r.userId));
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return userIds;
  }

  /**
   * P2-2.12: 查询用户时区，缺失时回退 DEFAULT_TIMEZONE 并 warn
   *
   * 注意：仅供切日点计算使用，无 L1 缓存（事件级别调用频率较低，
   * UserProfiles 自身已被全局 ProfileCacheService 覆盖；这里直接走 DB
   * 避免循环依赖 ProfileResolver）。
   */
  private async getUserTimezone(userId: string): Promise<string> {
    try {
      const profile = await this.prisma.userProfiles.findUnique({
        where: { userId },
        select: { timezone: true },
      });
      const tz = profile?.timezone;
      if (typeof tz === 'string' && tz.length > 0) {
        return tz;
      }
    } catch (err) {
      this.logger.warn(
        `[P2-2.12] failed to load timezone for user=${userId}: ${(err as Error).message}`,
      );
    }
    this.logger.warn(
      `[P2-2.12] timezone missing for user=${userId}, fallback to ${DEFAULT_TIMEZONE}`,
    );
    return DEFAULT_TIMEZONE;
  }
}
