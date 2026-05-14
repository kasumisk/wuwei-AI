import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronBackend, CronHandlerRegistry } from '../../core/cron';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisCacheService } from '../../core/redis/redis-cache.service';
import { FoodPipelineOrchestratorService } from './food-pipeline-orchestrator.service';
import { FoodQualityMonitorService } from './food-quality-monitor.service';
import { FoodConflictResolverService } from './processing/food-conflict-resolver.service';

/**
 * 食物数据同步定时任务 (Phase 2/3)
 *
 * V7 Cron 解耦：
 *   - @Cron 装饰的 *Tick() 是 in-proc 入口（开发/测试）；带 shouldRunInProc() 守卫
 *   - 同名去 Tick 后缀的方法是真正的业务逻辑，外部 HTTP 触发（Cloud Scheduler）也调它
 *   - runWithLock 同时保护两条入口，防止并发
 */
@Injectable()
export class FoodSyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(FoodSyncSchedulerService.name);

  constructor(
    private readonly orchestrator: FoodPipelineOrchestratorService,
    private readonly conflictResolver: FoodConflictResolverService,
    private readonly qualityMonitor: FoodQualityMonitorService,
    private readonly prisma: PrismaService,
    private readonly redisCache: RedisCacheService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  onModuleInit() {
    this.cronRegistry.register('food-sync-monthly-usda', () =>
      this.monthlyUsdaSync(),
    );
    this.cronRegistry.register('food-sync-daily-conflict-resolution', () =>
      this.dailyConflictResolution(),
    );
    this.cronRegistry.register('food-sync-daily-score-calculation', () =>
      this.dailyScoreCalculation(),
    );
    this.cronRegistry.register('food-sync-weekly-quality-report', () =>
      this.weeklyQualityReport(),
    );
    this.cronRegistry.register('food-sync-hourly-popularity-update', () =>
      this.hourlyPopularityUpdate(),
    );
  }

  /**
   * 每月1号凌晨 5:30 同步 USDA 常见食物数据
   * V6.4: 从 03:00 移到 05:30 避免与 daily-precompute / weeklySegmentation 叠加
   */
  @Cron('30 5 1 * *')
  async monthlyUsdaSyncTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.monthlyUsdaSync();
  }

  async monthlyUsdaSync() {
    await this.redisCache.runWithLock('food:usda-sync', 60 * 60 * 1000, () =>
      this.doMonthlyUsdaSync(),
    );
  }

  private async doMonthlyUsdaSync() {
    this.logger.log('Starting monthly USDA sync...');
    const commonCategories = [
      'chicken',
      'beef',
      'pork',
      'fish',
      'egg',
      'rice',
      'bread',
      'pasta',
      'potato',
      'oat',
      'broccoli',
      'spinach',
      'carrot',
      'tomato',
      'onion',
      'apple',
      'banana',
      'orange',
      'strawberry',
      'milk',
      'yogurt',
      'cheese',
    ];

    for (const query of commonCategories) {
      try {
        const result = await this.orchestrator.importFromUsda(query, 50);
        this.logger.log(
          `USDA sync "${query}": created=${result.created}, updated=${result.updated}`,
        );
      } catch (e) {
        this.logger.error(`USDA sync "${query}" failed: ${e.message}`);
      }
      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  /**
   * 每天凌晨4点自动解决冲突
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async dailyConflictResolutionTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.dailyConflictResolution();
  }

  async dailyConflictResolution() {
    await this.redisCache.runWithLock(
      'food:conflict-resolution',
      30 * 60 * 1000,
      async () => {
        this.logger.log('Starting daily conflict resolution...');
        const result = await this.conflictResolver.resolveAllPending();
        this.logger.log(
          `Daily conflict resolution: ${result.resolved} resolved, ${result.needsReview} need review`,
        );
      },
    );
  }

  /**
   * 每天凌晨5点批量计算分数
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async dailyScoreCalculationTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.dailyScoreCalculation();
  }

  async dailyScoreCalculation() {
    await this.redisCache.runWithLock(
      'food:score-calculation',
      30 * 60 * 1000,
      async () => {
        this.logger.log('Starting daily score calculation...');
        const result = await this.orchestrator.batchApplyRules({
          limit: 1000,
          recalcAll: false,
        });
        this.logger.log(
          `Score calculation done: ${result.processed} processed`,
        );
      },
    );
  }

  /**
   * 每周一凌晨6点生成质量报告
   */
  @Cron('0 6 * * 1')
  async weeklyQualityReportTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.weeklyQualityReport();
  }

  async weeklyQualityReport() {
    await this.redisCache.runWithLock(
      'food:quality-report',
      30 * 60 * 1000,
      async () => {
        this.logger.log('Generating weekly quality report...');
        const report = await this.qualityMonitor.generateReport();
        this.logger.log(
          `Quality Report: total=${report.totalFoods}, verified=${report.quality.verified}, pending_conflicts=${report.conflicts.pending}, translations=${report.translations.total}`,
        );
      },
    );
  }

  /**
   * 每小时更新热门食物 popularity（基于使用频率）
   * V6.4: 从 :00 移到 :30 避免与 quota-reset 同时执行
   */
  @Cron('30 * * * *')
  async hourlyPopularityUpdateTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.hourlyPopularityUpdate();
  }

  async hourlyPopularityUpdate() {
    await this.redisCache.runWithLock(
      'food:popularity-update',
      10 * 60 * 1000,
      async () => {
        // 基于 food_records.foods JSON 数组统计最近7天的使用次数。
        // food_records 当前没有顶层 food_id 列；保存记录时食物项可能只有 name，
        // 未来若补充 foodId/libraryMatch.id，本 SQL 会优先使用结构化 ID。
        try {
          await this.prisma.$executeRawUnsafe(`
            WITH record_foods AS (
              SELECT
                NULLIF(
                  COALESCE(
                    item->>'foodId',
                    item->>'food_id',
                    item->>'libraryFoodId',
                    item#>>'{libraryMatch,id}'
                  ),
                  ''
                ) AS raw_food_id,
                NULLIF(item->>'name', '') AS food_name
              FROM food_records fr
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE
                  WHEN jsonb_typeof(fr.foods) = 'array' THEN fr.foods
                  ELSE '[]'::jsonb
                END
              ) AS item
              WHERE fr.created_at >= NOW() - INTERVAL '7 days'
            ),
            resolved AS (
              SELECT f.id AS food_id
              FROM record_foods rf
              JOIN foods f
                ON f.id = CASE
                  WHEN rf.raw_food_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                    THEN rf.raw_food_id::uuid
                  ELSE NULL
                END
                OR (
                  rf.raw_food_id IS NULL
                  AND rf.food_name IS NOT NULL
                  AND lower(f.name) = lower(rf.food_name)
                )
            ),
            usage AS (
              SELECT food_id, COUNT(*)::int AS usage_count
              FROM resolved
              GROUP BY food_id
            )
            UPDATE foods f
            SET popularity = usage.usage_count
            FROM usage
            WHERE f.id = usage.food_id
          `);
        } catch (e) {
          // food_records 表可能不关联，静默处理
          this.logger.debug(`Popularity update skipped: ${e.message}`);
        }
      },
    );
  }
}
