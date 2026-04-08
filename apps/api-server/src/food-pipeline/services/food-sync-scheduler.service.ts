import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FoodPipelineOrchestratorService } from './food-pipeline-orchestrator.service';
import { FoodConflictResolverService } from './food-conflict-resolver.service';
import { FoodQualityMonitorService } from './food-quality-monitor.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';

/**
 * 食物数据同步定时任务 (Phase 2/3)
 */
@Injectable()
export class FoodSyncSchedulerService {
  private readonly logger = new Logger(FoodSyncSchedulerService.name);

  constructor(
    private readonly orchestrator: FoodPipelineOrchestratorService,
    private readonly conflictResolver: FoodConflictResolverService,
    private readonly qualityMonitor: FoodQualityMonitorService,
    @InjectRepository(FoodLibrary) private readonly foodRepo: Repository<FoodLibrary>,
  ) {}

  /**
   * 每月1号凌晨3点同步 USDA 常见食物数据
   */
  @Cron('0 3 1 * *')
  async monthlyUsdaSync() {
    this.logger.log('Starting monthly USDA sync...');
    const commonCategories = [
      'chicken', 'beef', 'pork', 'fish', 'egg',
      'rice', 'bread', 'pasta', 'potato', 'oat',
      'broccoli', 'spinach', 'carrot', 'tomato', 'onion',
      'apple', 'banana', 'orange', 'strawberry',
      'milk', 'yogurt', 'cheese',
    ];

    for (const query of commonCategories) {
      try {
        const result = await this.orchestrator.importFromUsda(query, 50);
        this.logger.log(`USDA sync "${query}": created=${result.created}, updated=${result.updated}`);
      } catch (e) {
        this.logger.error(`USDA sync "${query}" failed: ${e.message}`);
      }
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * 每天凌晨4点自动解决冲突
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async dailyConflictResolution() {
    this.logger.log('Starting daily conflict resolution...');
    const result = await this.conflictResolver.resolveAllPending();
    this.logger.log(`Daily conflict resolution: ${result.resolved} resolved, ${result.needsReview} need review`);
  }

  /**
   * 每天凌晨5点批量计算分数
   */
  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async dailyScoreCalculation() {
    this.logger.log('Starting daily score calculation...');
    const result = await this.orchestrator.batchApplyRules({ limit: 1000, recalcAll: false });
    this.logger.log(`Score calculation done: ${result.processed} processed`);
  }

  /**
   * 每周一凌晨6点生成质量报告
   */
  @Cron('0 6 * * 1')
  async weeklyQualityReport() {
    this.logger.log('Generating weekly quality report...');
    const report = await this.qualityMonitor.generateReport();
    this.logger.log(`Quality Report: total=${report.totalFoods}, verified=${report.quality.verified}, pending_conflicts=${report.conflicts.pending}, translations=${report.translations.total}`);
  }

  /**
   * 每小时更新热门食物 popularity（基于使用频率）
   */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyPopularityUpdate() {
    // 基于 food_records 表统计最近7天的使用次数
    try {
      await this.foodRepo.query(`
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
  }
}
