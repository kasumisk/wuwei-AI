/**
 * V6.8 Phase 2-C — 策略自动调优服务（Redis 同步升级）
 *
 * V6.8 变更:
 * - SEGMENT_STRATEGY_MAP 从 module-level 常量迁移到 Redis Hash（支持多实例同步）
 * - 新增 SegmentStrategyStore（本地缓存 + Redis Hash + 版本号 + Pub/Sub 失效）
 * - 最小样本量从 5 提升到 30
 * - 新增 Wilson score interval 显著性检验
 *
 * 定时任务:
 *   每周一凌晨 04:00 执行：
 *   1. 分析过去 7 天各 segment 在各策略下的接受率
 *   2. 找出每个 segment 表现最佳的策略（Wilson lower bound）
 *   3. 与当前映射对比，生成调优建议
 *   4. 高置信度（实验组 Wilson lower > 对照 Wilson upper）：自动应用；低置信度：仅记录日志
 *
 * 依赖:
 *   - PrismaService: 查询 traces/feedbacks/user_profiles_extended
 *   - RedisCacheService: 存储 segment→strategy 映射，支持跨实例同步
 */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { CronBackend, CronHandlerRegistry } from '../../../core/cron';
import { FeatureFlagService } from '../../feature-flag/feature-flag.service';

// ==================== 类型 ====================

/** 单个 segment 在某策略下的效果统计 */
interface SegmentStrategyStats {
  segmentName: string;
  strategyId: string;
  strategyName: string;
  totalFeedbacks: number;
  acceptedCount: number;
  acceptanceRate: number;
}

/** 调优建议 */
export interface TuningSuggestion {
  segment: string;
  currentStrategy: string;
  suggestedStrategy: string;
  currentRate: number;
  suggestedRate: number;
  improvement: number;
}

/** 自动调优执行结果摘要 */
export interface AutoTuneResult {
  analyzedSegments: number;
  suggestions: TuningSuggestion[];
  appliedCount: number;
  skippedCount: number;
  /** V7.9: 写入待审核的建议数 */
  pendingCount: number;
}

/** V6.8: segment→strategy 映射条目 */
interface SegmentMapping {
  strategyKey: string;
  appliedAt: string;
  source: 'default' | 'auto_tuner' | 'db_restore';
}

// ==================== V6.8: Redis key 常量 ====================

/** Redis Hash key: 存储所有 segment→strategy 映射 */
const REDIS_SEGMENT_MAP_KEY = 'strategy:segment_map';
/** Redis key: 版本号（用于本地缓存失效） */
const REDIS_SEGMENT_VERSION_KEY = 'strategy:segment_map:version';
/** Redis Pub/Sub channel: 映射更新通知 */
const REDIS_MAPPING_CHANNEL = 'strategy:mapping:updated';

/** V6.8: 最小样本量（从 5 提升到 30） */
const MIN_SAMPLE_SIZE = 30;

/** 默认初始映射（首次启动或 Redis 不可用时使用） */
const DEFAULT_SEGMENT_MAP: Record<string, string> = {
  new_user: 'warm_start',
  returning_user: 're_engage',
  disciplined_loser: 'precision',
  muscle_builder: 'precision',
  active_maintainer: 'discovery',
  casual_maintainer: 'discovery',
  binge_risk: 'precision',
};

@Injectable()
export class StrategyAutoTuner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StrategyAutoTuner.name);

  // ── V6.8: 本地缓存（避免每次读 Redis） ──
  private localCache = new Map<string, SegmentMapping>();
  private localVersion = 0;

  /** V6.8: Pub/Sub 订阅客户端（独立于主连接） */
  private subscriber: any = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly featureFlagService: FeatureFlagService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  // ==================== 启动与销毁 ====================

  /**
   * V6.8: 启动时初始化映射
   * 1. 从 Redis Hash 加载现有映射（如果有）
   * 2. 如果 Redis 无数据，从 DB strategy_tuning_log 恢复
   * 3. 如果都没有，写入默认映射到 Redis
   * 4. 订阅 Pub/Sub 通知
   */
  async onModuleInit(): Promise<void> {
    try {
      // 尝试从 Redis 加载
      const loaded = await this.loadFromRedis();
      if (loaded) {
        this.logger.log(
          `SegmentStrategyStore: 从 Redis 加载了 ${this.localCache.size} 个映射`,
        );
      } else {
        // Redis 无数据 → 从 DB 恢复
        await this.restoreFromDb();
      }

      // 订阅 Pub/Sub（异步，不阻塞启动）
      this.subscribeToPubSub().catch((err) => {
        this.logger.warn(
          `Pub/Sub 订阅失败（不影响功能）: ${(err as Error).message}`,
        );
      });
    } catch (err) {
      this.logger.warn(
        `StrategyAutoTuner: 启动初始化失败，使用默认映射: ${(err as Error).message}`,
      );
      this.seedDefaults();
    }
    this.cronRegistry.register('strategy-auto-tune-weekly', () =>
      this.autoTune(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(REDIS_MAPPING_CHANNEL);
        this.subscriber.disconnect();
      } catch {
        // ignore
      }
    }
  }

  // ==================== V6.8: 映射读写（本地缓存 + Redis） ====================

  /**
   * V6.8: 获取 segment 的策略映射
   * 读取流程: 本地缓存 → (版本检查) → Redis → 默认值
   */
  async getCurrentMappingAsync(segment: string): Promise<string> {
    await this.ensureFresh();
    return (
      this.localCache.get(segment)?.strategyKey ??
      DEFAULT_SEGMENT_MAP[segment] ??
      'balanced'
    );
  }

  /**
   * 获取当前 segment → strategy 映射（同步版，从本地缓存读取）
   * 注意: 首次调用前需确保 onModuleInit 已完成
   */
  getCurrentMapping(segment: string): string | undefined {
    return (
      this.localCache.get(segment)?.strategyKey ?? DEFAULT_SEGMENT_MAP[segment]
    );
  }

  /**
   * 获取当前所有映射（供 Admin API 展示）
   */
  async getAllMappings(): Promise<Record<string, string>> {
    await this.ensureFresh();
    const result: Record<string, string> = { ...DEFAULT_SEGMENT_MAP };
    for (const [k, v] of this.localCache) {
      result[k] = v.strategyKey;
    }
    return result;
  }

  /**
   * V6.8: 设置 segment→strategy 映射（写 Redis + Pub/Sub 通知）
   */
  async setMapping(
    segment: string,
    strategyKey: string,
    source: 'auto_tuner' | 'db_restore' = 'auto_tuner',
  ): Promise<void> {
    const mapping: SegmentMapping = {
      strategyKey,
      appliedAt: new Date().toISOString(),
      source,
    };

    // 1. 写 Redis Hash
    await this.redis.hSet(
      REDIS_SEGMENT_MAP_KEY,
      segment,
      JSON.stringify(mapping),
    );

    // 2. 自增版本号
    await this.redis.incr(REDIS_SEGMENT_VERSION_KEY);

    // 3. Pub/Sub 通知其他实例
    try {
      if (this.redis.isConnected) {
        const client = this.redis.getClient();
        await client.publish(REDIS_MAPPING_CHANNEL, segment);
      }
    } catch {
      // Pub/Sub 失败不影响功能，其他实例会通过版本号同步
    }

    // 4. 更新本地缓存
    this.localCache.set(segment, mapping);
  }

  // ==================== 定时任务入口 ====================

  /**
   * 每周一 04:00 执行策略自动调优
   * 分析过去 7 天的效果矩阵，调整 segment→strategy 映射
   */
  @Cron('0 4 * * 1', { name: 'strategy-auto-tune-weekly' })
  async autoTuneTick(): Promise<void> {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.autoTune();
  }

  async autoTune(): Promise<void> {
    await this.redis.runWithLock(
      'strategy:auto-tune',
      60 * 60 * 1000, // 1 小时过期
      () => this.doAutoTune(),
    );
  }

  private async doAutoTune(): Promise<void> {
    this.logger.log('开始策略自动调优...');

    const endDate = new Date();
    const startDate = new Date(Date.now() - 7 * 86400_000);

    // 1. 查询各 segment × strategy 的效果统计
    const stats = await this.querySegmentStrategyStats(startDate, endDate);

    if (stats.length === 0) {
      this.logger.log('效果数据不足，跳过自动调优');
      return;
    }

    // 2. V6.8: 找出每个 segment 的最佳策略（使用 Wilson lower bound）
    const segmentBest = new Map<
      string,
      {
        strategyName: string;
        rate: number;
        feedbacks: number;
        wilsonLower: number;
      }
    >();

    for (const row of stats) {
      // V6.8: 最小样本量从 5 提升到 30
      if (row.totalFeedbacks < MIN_SAMPLE_SIZE) continue;

      const wLower = this.wilsonLower(row.acceptedCount, row.totalFeedbacks);

      const current = segmentBest.get(row.segmentName);
      if (!current || wLower > current.wilsonLower) {
        segmentBest.set(row.segmentName, {
          strategyName: row.strategyName,
          rate: row.acceptanceRate,
          feedbacks: row.totalFeedbacks,
          wilsonLower: wLower,
        });
      }
    }

    // 3. 对比当前映射，生成调整建议
    const suggestions: TuningSuggestion[] = [];
    for (const [segment, best] of segmentBest) {
      const currentStrategy = this.getCurrentMapping(segment);
      if (!currentStrategy) continue;

      if (currentStrategy !== best.strategyName && best.rate > 0.3) {
        // V6.8: 使用 Wilson interval 比较
        const currentStats = stats.find(
          (s) =>
            s.segmentName === segment && s.strategyName === currentStrategy,
        );
        const currentRate = currentStats?.acceptanceRate ?? 0;
        const currentWilsonUpper = currentStats
          ? this.wilsonUpper(
              currentStats.acceptedCount,
              currentStats.totalFeedbacks,
            )
          : 0;

        // V6.8: 只有当实验组 Wilson lower > 对照 Wilson upper 才判定显著
        if (best.wilsonLower > currentWilsonUpper) {
          suggestions.push({
            segment,
            currentStrategy,
            suggestedStrategy: best.strategyName,
            currentRate,
            suggestedRate: best.rate,
            improvement: best.rate - currentRate,
          });
        }
      }
    }

    // 4. V7.9: 根据 feature flag 决定自动应用还是待审核
    //    flag 开启 = 保留旧行为（高置信度自动应用）
    //    flag 关闭 = 所有建议均写入 pending_review，需 Admin 手动审核
    let appliedCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;

    const autoApplyEnabled = await this.featureFlagService
      .isEnabled('strategy_auto_apply')
      .catch(() => false);

    for (const suggestion of suggestions) {
      const isHighConfidence =
        suggestion.improvement > 0.5 * (suggestion.currentRate || 0.01);

      if (autoApplyEnabled && isHighConfidence) {
        // 旧行为：高置信度自动应用
        await this.logTuningDecision(suggestion, true, 'auto_applied');
        await this.setMapping(suggestion.segment, suggestion.suggestedStrategy);
        appliedCount++;
        this.logger.log(
          `自动策略切换: ${suggestion.segment} ` +
            `${suggestion.currentStrategy} → ${suggestion.suggestedStrategy} ` +
            `(${(suggestion.currentRate * 100).toFixed(1)}% → ${(suggestion.suggestedRate * 100).toFixed(1)}%)`,
        );
      } else if (autoApplyEnabled && !isHighConfidence) {
        // 旧行为：低置信度跳过
        await this.logTuningDecision(suggestion, false, 'auto_applied');
        skippedCount++;
        this.logger.log(
          `策略调优建议（未自动应用，置信度不足）: ${JSON.stringify(suggestion)}`,
        );
      } else {
        // V7.9 新行为：所有建议写入 pending_review
        await this.logTuningDecision(suggestion, false, 'pending_review');
        pendingCount++;
        this.logger.log(
          `策略调优建议（待审核）: ${suggestion.segment} ` +
            `${suggestion.currentStrategy} → ${suggestion.suggestedStrategy} ` +
            `(${(suggestion.currentRate * 100).toFixed(1)}% → ${(suggestion.suggestedRate * 100).toFixed(1)}%)`,
        );
      }
    }

    const result: AutoTuneResult = {
      analyzedSegments: segmentBest.size,
      suggestions,
      appliedCount,
      skippedCount,
      pendingCount,
    };

    this.logger.log(
      `策略自动调优完成: 分析 ${result.analyzedSegments} 个分群, ` +
        `${result.suggestions.length} 条建议, ` +
        `${result.appliedCount} 条自动应用, ${result.skippedCount} 条跳过, ` +
        `${result.pendingCount} 条待审核`,
    );
  }

  // ==================== 自适应探索率 ====================

  /**
   * 自适应 exploration rate
   * 根据用户交互量和 Thompson Sampling 收敛程度调整
   *
   * @param totalInteractions 用户累计交互次数
   * @param tsConvergence 0-1，1=完全收敛（TS alpha/(alpha+beta) 的方差趋近于 0）
   * @returns 0.02 ~ baseRate 之间的探索率
   */
  calcAdaptiveExplorationRate(
    totalInteractions: number,
    tsConvergence: number,
  ): number {
    const baseRate = 0.15;

    // 交互量衰减：交互越多，探索越少
    const interactionDecay = Math.exp(-totalInteractions / 100);

    // 收敛衰减：TS 越收敛，探索越少
    const convergenceDecay = 1 - tsConvergence * 0.8;

    return Math.max(0.02, baseRate * interactionDecay * convergenceDecay);
  }

  // ==================== V6.8: Wilson Score Interval ====================

  /**
   * V6.8: Wilson score interval — lower bound
   * 用于保守估计真实接受率的下界
   *
   * @param successes 成功次数
   * @param total 总次数
   * @param z Z 值（默认 1.96 = 95% 置信度）
   */
  private wilsonLower(successes: number, total: number, z = 1.96): number {
    if (total === 0) return 0;
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
    return (center - spread) / denominator;
  }

  /**
   * V6.8: Wilson score interval — upper bound
   * 用于乐观估计真实接受率的上界
   */
  private wilsonUpper(successes: number, total: number, z = 1.96): number {
    if (total === 0) return 0;
    const p = successes / total;
    const denominator = 1 + (z * z) / total;
    const center = p + (z * z) / (2 * total);
    const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
    return (center + spread) / denominator;
  }

  // ==================== 内部方法 ====================

  /**
   * V6.8: 从 Redis Hash 加载所有映射到本地缓存
   * @returns true 如果 Redis 有数据
   */
  private async loadFromRedis(): Promise<boolean> {
    const all = await this.redis.hGetAll(REDIS_SEGMENT_MAP_KEY);
    if (!all || Object.keys(all).length === 0) return false;

    this.localCache.clear();
    for (const [k, v] of Object.entries(all)) {
      try {
        this.localCache.set(k, JSON.parse(v));
      } catch {
        // 跳过无法解析的条目
      }
    }

    // 同步版本号
    const versionStr = await this.redis.get<number>(REDIS_SEGMENT_VERSION_KEY);
    this.localVersion = versionStr ?? 0;

    return this.localCache.size > 0;
  }

  /**
   * V6.8: 确保本地缓存是最新的（通过版本号比对）
   * 如果 Redis 版本号 > 本地版本号，重新加载
   */
  private async ensureFresh(): Promise<void> {
    if (!this.redis.isConnected) return;

    try {
      const remoteVersion = await this.redis.get<number>(
        REDIS_SEGMENT_VERSION_KEY,
      );
      const rv = remoteVersion ?? 0;
      if (rv > this.localVersion) {
        await this.loadFromRedis();
      }
    } catch {
      // 版本检查失败，继续使用本地缓存
    }
  }

  /**
   * V6.6 → V6.8: 从 DB strategy_tuning_log 恢复最新的自动应用记录
   * 恢复后写入 Redis Hash
   */
  private async restoreFromDb(): Promise<void> {
    try {
      const allApplied = await this.prisma.strategyTuningLog.findMany({
        where: { autoApplied: true },
        orderBy: { createdAt: 'desc' },
        select: { segmentName: true, newStrategy: true, createdAt: true },
      });

      // 先加载默认映射
      this.seedDefaults();

      // 每个 segment 只取最新一条
      const recovered = new Set<string>();
      for (const log of allApplied) {
        if (!recovered.has(log.segmentName)) {
          const mapping: SegmentMapping = {
            strategyKey: log.newStrategy,
            appliedAt: log.createdAt.toISOString(),
            source: 'db_restore',
          };
          this.localCache.set(log.segmentName, mapping);
          recovered.add(log.segmentName);
        }
      }

      // 写入 Redis Hash
      for (const [segment, mapping] of this.localCache) {
        await this.redis.hSet(
          REDIS_SEGMENT_MAP_KEY,
          segment,
          JSON.stringify(mapping),
        );
      }
      await this.redis.incr(REDIS_SEGMENT_VERSION_KEY);
      this.localVersion++;

      if (recovered.size > 0) {
        this.logger.log(
          `SegmentStrategyStore: 从 DB 恢复了 ${recovered.size} 个映射并写入 Redis`,
        );
      } else {
        this.logger.log('SegmentStrategyStore: 无历史调优记录，使用默认映射');
      }
    } catch (err) {
      this.logger.warn(`DB 恢复失败，使用默认映射: ${(err as Error).message}`);
      this.seedDefaults();
    }
  }

  /**
   * 将默认映射加载到本地缓存
   */
  private seedDefaults(): void {
    this.localCache.clear();
    for (const [segment, strategy] of Object.entries(DEFAULT_SEGMENT_MAP)) {
      this.localCache.set(segment, {
        strategyKey: strategy,
        appliedAt: new Date().toISOString(),
        source: 'default',
      });
    }
  }

  /**
   * V6.8: 订阅 Pub/Sub 通知（跨实例同步）
   * 收到消息时刷新本地缓存版本号，下次 ensureFresh 时重新加载
   */
  private async subscribeToPubSub(): Promise<void> {
    if (!this.redis.isConnected) return;

    try {
      // ioredis: 订阅需要用独立连接（duplicate）
      const client = this.redis.getClient();
      this.subscriber = client.duplicate();

      await this.subscriber.subscribe(REDIS_MAPPING_CHANNEL);

      this.subscriber.on('message', (_channel: string, _message: string) => {
        // 收到通知 → 将本地版本号置零，下次 ensureFresh 时重新加载
        this.localVersion = 0;
        this.logger.debug(
          `Pub/Sub: 收到映射更新通知 (segment=${_message})，下次读取将刷新缓存`,
        );
      });

      this.logger.debug('Pub/Sub: 已订阅策略映射更新通知');
    } catch (err) {
      this.logger.warn(`Pub/Sub 订阅失败: ${(err as Error).message}`);
    }
  }

  /**
   * 查询过去 N 天各 segment × strategy 的效果统计
   */
  private async querySegmentStrategyStats(
    startDate: Date,
    endDate: Date,
  ): Promise<SegmentStrategyStats[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        segmentName: string;
        strategyId: string;
        strategy_name: string;
        total_feedbacks: bigint;
        accepted_count: bigint;
      }>
    >`
      SELECT
        (up.inferred_data->>'userSegment') AS segment_name,
        t.strategy_id,
        COALESCE(s.name, 'unknown') AS strategy_name,
        COUNT(f.id) AS total_feedbacks,
        COUNT(CASE WHEN f.action = 'accepted' THEN 1 END) AS accepted_count
      FROM recommendation_traces t
      JOIN recommendation_feedbacks f ON f.trace_id = t.id
      JOIN user_profiles up ON up.user_id = t.user_id
      LEFT JOIN strategy s ON s.id = t.strategy_id
      WHERE t.created_at >= ${startDate}
        AND t.created_at < ${endDate}
        AND up.inferred_data->>'userSegment' IS NOT NULL
        AND t.strategy_id IS NOT NULL
      GROUP BY (up.inferred_data->>'userSegment'), t.strategy_id, s.name
      HAVING COUNT(f.id) >= 3
      ORDER BY (up.inferred_data->>'userSegment'), COUNT(f.id) DESC
    `;

    return rows.map((r) => {
      const total = Number(r.total_feedbacks);
      const accepted = Number(r.accepted_count);
      return {
        segmentName: r.segmentName,
        strategyId: r.strategyId,
        strategyName: r.strategy_name,
        totalFeedbacks: total,
        acceptedCount: accepted,
        acceptanceRate: total > 0 ? accepted / total : 0,
      };
    });
  }

  /**
   * 从已查询的统计中获取指定 segment+strategy 的接受率
   */
  private getStatsRate(
    stats: SegmentStrategyStats[],
    segment: string,
    strategyName: string,
  ): number {
    const match = stats.find(
      (s) => s.segmentName === segment && s.strategyName === strategyName,
    );
    return match?.acceptanceRate ?? 0;
  }

  /**
   * 记录调优决策到 strategy_tuning_log 表
   *
   * V7.9: 新增 reviewStatus 参数，支持 'auto_applied' | 'pending_review'
   */
  private async logTuningDecision(
    suggestion: TuningSuggestion,
    autoApplied: boolean,
    reviewStatus: string = 'auto_applied',
  ): Promise<void> {
    try {
      await this.prisma.strategyTuningLog.create({
        data: {
          segmentName: suggestion.segment,
          previousStrategy: suggestion.currentStrategy,
          newStrategy: suggestion.suggestedStrategy,
          previousRate: suggestion.currentRate,
          newRate: suggestion.suggestedRate,
          improvement: suggestion.improvement,
          autoApplied: autoApplied,
          reviewStatus: reviewStatus,
        },
      });
    } catch (err) {
      this.logger.error(`记录调优日志失败: ${(err as Error).message}`);
    }
  }
}
