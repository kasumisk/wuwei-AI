import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { FoodConflict } from '../../entities/food-conflict.entity';
import { FoodLibrary } from '../../entities/food-library.entity';
import { FoodChangeLog } from '../../entities/food-change-log.entity';

/**
 * 食物数据冲突自动解决服务
 * 规则:
 *   - 热量差异 < 5% → 取高优先级来源值
 *   - 热量差异 5-15% → 取加权平均
 *   - 热量差异 > 15% → 标记人工审核
 *   - 分类不一致 → 取高优先级来源
 *   - 过敏原差异 → 取并集（安全优先）
 */
@Injectable()
export class FoodConflictResolverService {
  private readonly logger = new Logger(FoodConflictResolverService.name);

  // 来源优先级 (值越大优先级越高)
  private readonly SOURCE_PRIORITY: Record<string, number> = {
    usda: 100,
    manual: 90,
    openfoodfacts: 70,
    ai: 50,
    crawl: 30,
  };

  constructor(
    @InjectRepository(FoodConflict)
    private readonly conflictRepo: Repository<FoodConflict>,
    @InjectRepository(FoodLibrary)
    private readonly foodRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodChangeLog)
    private readonly changeLogRepo: Repository<FoodChangeLog>,
  ) {}

  /**
   * 检测并记录冲突
   */
  async detectConflicts(
    foodId: string,
    existingValues: Record<string, any>,
    incomingValues: Record<string, any>,
    incomingSource: string,
  ): Promise<FoodConflict[]> {
    const conflicts: FoodConflict[] = [];

    const numericFields = [
      'calories', 'protein', 'fat', 'carbs', 'fiber', 'sugar',
      'sodium', 'potassium', 'calcium', 'iron',
      'glycemicIndex', 'processingLevel',
    ];

    for (const field of numericFields) {
      const oldVal = existingValues[field];
      const newVal = incomingValues[field];
      if (oldVal == null || newVal == null) continue;
      if (oldVal === newVal) continue;

      const diff = oldVal > 0 ? Math.abs(oldVal - newVal) / oldVal : 1;
      if (diff < 0.05) continue; // 差异小于5%忽略

      const existing = await this.conflictRepo.findOne({
        where: { foodId, field, resolution: IsNull() },
      });
      if (existing) continue; // 已有未解决的冲突

      const conflict = this.conflictRepo.create({
        foodId,
        field,
        sources: [
          { source: existingValues.primarySource || 'existing', value: oldVal },
          { source: incomingSource, value: newVal },
        ],
      });
      conflicts.push(await this.conflictRepo.save(conflict));
    }

    // 分类冲突
    if (existingValues.category && incomingValues.category && existingValues.category !== incomingValues.category) {
      const existing = await this.conflictRepo.findOne({
        where: { foodId, field: 'category', resolution: IsNull() },
      });
      if (!existing) {
        const conflict = this.conflictRepo.create({
          foodId,
          field: 'category',
          sources: [
            { source: existingValues.primarySource || 'existing', value: existingValues.category },
            { source: incomingSource, value: incomingValues.category },
          ],
        });
        conflicts.push(await this.conflictRepo.save(conflict));
      }
    }

    return conflicts;
  }

  /**
   * 自动解决待处理冲突
   */
  async resolveAllPending(): Promise<{ resolved: number; needsReview: number }> {
    const pendingConflicts = await this.conflictRepo.find({
      where: { resolution: IsNull() },
      relations: ['food'],
    });

    let resolved = 0;
    let needsReview = 0;

    for (const conflict of pendingConflicts) {
      const result = this.autoResolve(conflict);
      if (result) {
        conflict.resolution = result.resolution;
        conflict.resolvedValue = result.resolvedValue;
        conflict.resolvedBy = 'auto_pipeline';
        conflict.resolvedAt = new Date();
        await this.conflictRepo.save(conflict);

        // 更新食物数据
        if (result.resolution !== 'needs_review') {
          await this.foodRepo.update(conflict.foodId, {
            [conflict.field]: result.resolvedValue,
          } as any);
          resolved++;
        } else {
          needsReview++;
        }
      }
    }

    this.logger.log(`Conflict resolution: ${resolved} resolved, ${needsReview} need review`);
    return { resolved, needsReview };
  }

  /**
   * 单条自动解决逻辑
   */
  private autoResolve(conflict: FoodConflict): {
    resolution: string;
    resolvedValue: string;
  } | null {
    const sources = conflict.sources as Array<{ source: string; value: any }>;
    if (!sources || sources.length < 2) return null;

    // 获取各来源优先级
    const sorted = [...sources].sort(
      (a, b) => (this.SOURCE_PRIORITY[b.source] || 0) - (this.SOURCE_PRIORITY[a.source] || 0),
    );

    const highPriorityValue = sorted[0].value;
    const lowPriorityValue = sorted[sources.length - 1].value;

    // 过敏原特殊处理: 取并集
    if (conflict.field === 'allergens') {
      const union = [...new Set(sources.flatMap(s => Array.isArray(s.value) ? s.value : []))];
      return { resolution: 'union_safety', resolvedValue: JSON.stringify(union) };
    }

    // 分类冲突: 取高优先级
    if (conflict.field === 'category') {
      return { resolution: 'highest_priority', resolvedValue: String(highPriorityValue) };
    }

    // 数值冲突
    if (typeof highPriorityValue === 'number' && typeof lowPriorityValue === 'number') {
      const diff = highPriorityValue > 0
        ? Math.abs(highPriorityValue - lowPriorityValue) / highPriorityValue
        : 1;

      if (diff < 0.05) {
        // < 5%: 取高优先级
        return { resolution: 'highest_priority', resolvedValue: String(highPriorityValue) };
      } else if (diff <= 0.15) {
        // 5-15%: 加权平均
        const weights = sources.map(s => this.SOURCE_PRIORITY[s.source] || 50);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const weighted = sources.reduce(
          (sum, s, i) => sum + (Number(s.value) || 0) * weights[i],
          0,
        ) / totalWeight;
        return {
          resolution: 'weighted_average',
          resolvedValue: String(Math.round(weighted * 10) / 10),
        };
      } else {
        // > 15%: 需人工审核
        return { resolution: 'needs_review', resolvedValue: String(highPriorityValue) };
      }
    }

    return { resolution: 'highest_priority', resolvedValue: String(highPriorityValue) };
  }
}
