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
    this.cronRegistry.register('food-sync-monthly-usda', () => this.monthlyUsdaSync());
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
        // 基于 food_records 表统计最近7天的使用次数
        try {
          await this.prisma.$executeRawUnsafe(`
        UPDATE foods f
        SET popularity = COALESCE(sub.usage_count, 0)
        FROM (
          SELECT fr.food_id, COUNT(*) as usage_count
          FROM food_records fr
          WHERE fr.created_at >= NOW() - INTERVAL '7 days'
          GROUP BY fr.food_id
        ) sub
        WHERE f.id = sub.food_id
      `);
        } catch (e) {
          // food_records 表可能不关联，静默处理
          this.logger.debug(`Popularity update skipped: ${e.message}`);
        }
      },
    );
  }
}
