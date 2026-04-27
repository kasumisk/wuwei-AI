import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/**
 * V6.9 Phase 3-C: 食物数据渠道标注迁移服务
 *
 * 基于品类（category）+ 加工级别（processing_level）+ 大众化评分（commonality_score）
 * 自动推断 foods.available_channels，替代原来过于宽泛的默认值。
 *
 * 推断规则：
 * - 生鲜食材（veggie/fruit/protein/dairy/grain）→ home_cook; nova≤1 追加 restaurant
 * - 高加工（nova≥3）→ convenience
 * - 复合菜品（composite）→ delivery + restaurant + canteen
 * - 饮品（beverage）→ convenience + restaurant
 * - 零食（snack）→ convenience + home_cook
 * - 高大众化（≥80）→ 追加 canteen + delivery
 */
@Injectable()
export class ChannelMigrationService {
  private readonly logger = new Logger(ChannelMigrationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 执行全量迁移：遍历所有食物，重新计算 available_channels。
   * 适合在部署后一次性运行，或作为管理端手动触发的任务。
   *
   * @returns 迁移结果统计
   */
  async migrateAvailableChannels(): Promise<{
    total: number;
    updated: number;
    skipped: number;
    errors: number;
  }> {
    this.logger.log('开始食物渠道标注迁移...');

    const stats = { total: 0, updated: 0, skipped: 0, errors: 0 };

    // 分批处理，避免一次加载过多数据
    const BATCH_SIZE = 200;
    let cursor: string | undefined;

    while (true) {
      const foods = await this.prisma.food.findMany({
        select: {
          id: true,
          category: true,
          processingLevel: true,
          commonalityScore: true,
          availableChannels: true,
        },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
      });

      if (foods.length === 0) break;

      for (const food of foods) {
        stats.total++;
        try {
          const newChannels = this.inferChannels(food);
          const oldChannels = this.parseChannels(food.availableChannels);

          // 只在渠道列表发生变化时更新
          if (this.channelsEqual(oldChannels, newChannels)) {
            stats.skipped++;
            continue;
          }

          await this.prisma.food.update({
            where: { id: food.id },
            data: { availableChannels: newChannels },
          });
          stats.updated++;
        } catch (err) {
          stats.errors++;
          this.logger.warn(
            `迁移食物 ${food.id} 失败: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      cursor = foods[foods.length - 1].id;

      // 如果返回数量少于 batch size，说明已经到末尾
      if (foods.length < BATCH_SIZE) break;
    }

    this.logger.log(
      `渠道标注迁移完成: 总计=${stats.total}, 更新=${stats.updated}, 跳过=${stats.skipped}, 错误=${stats.errors}`,
    );
    return stats;
  }

  /**
   * 为单个食物推断可获得渠道。
   * 也可供其他服务在创建/更新食物时调用，保持标注一致性。
   */
  inferChannels(food: {
    category: string;
    processingLevel: number | null;
    commonalityScore: number;
  }): string[] {
    const channels: string[] = [];
    const cat = food.category;
    const nova = food.processingLevel ?? 0;

    // 生鲜食材: 家庭烹饪；低加工追加餐厅
    if (['veggie', 'fruit', 'protein', 'dairy', 'grain'].includes(cat)) {
      channels.push('home_cook');
      if (nova <= 1) channels.push('restaurant');
    }

    // 高加工食品: 便利店
    if (nova >= 3) {
      channels.push('convenience');
    }

    // 复合菜品: 外卖/餐厅/食堂
    if (cat === 'composite') {
      channels.push('delivery', 'restaurant', 'canteen');
    }

    // 饮品: 便利店/餐厅
    if (cat === 'beverage') {
      channels.push('convenience', 'restaurant');
    }

    // 零食: 便利店/家庭
    if (cat === 'snack') {
      channels.push('convenience', 'home_cook');
    }

    // 油脂/调味料: 主要家庭烹饪
    if (cat === 'fat' || cat === 'condiment') {
      channels.push('home_cook');
    }

    // 高大众化食物: 追加食堂和外卖
    if ((food.commonalityScore ?? 50) >= 80) {
      if (!channels.includes('canteen')) channels.push('canteen');
      if (!channels.includes('delivery')) channels.push('delivery');
    }

    // 去重
    return [...new Set(channels)];
  }

  /**
   * 解析 Json 字段为字符串数组
   */
  private parseChannels(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw as string[];
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // ignore parse error
      }
    }
    return [];
  }

  /**
   * 比较两个渠道列表是否等价（忽略顺序）
   */
  private channelsEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }
}
