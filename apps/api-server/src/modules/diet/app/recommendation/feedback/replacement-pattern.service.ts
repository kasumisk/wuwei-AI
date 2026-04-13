/**
 * V6.5 Phase 1F: ReplacementPatternService — 替换模式挖掘与权重调整
 *
 * 从用户的替换行为中提取模式（A→B 替换频率），转换为评分权重调整：
 * - A→B 替换频率 >= 2（30天内）：A 降权 15%，B 增权 10%
 * - A→B 替换频率 >= 5：A 降权 30%（强信号）
 *
 * 数据来源：replacement_patterns 表（Phase 1A 新建）
 * 触发时机：推荐引擎在 rankCandidates 前调用 getReplacementAdjustments()
 * 写入时机：用户提交替换反馈时调用 recordReplacement()
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';

/** 替换模式阈值 */
const WEAK_SIGNAL_THRESHOLD = 2; // 替换 >= 2 次
const STRONG_SIGNAL_THRESHOLD = 5; // 替换 >= 5 次

/** 降权/增权系数 */
const WEAK_DOWNWEIGHT = 0.85; // -15%
const STRONG_DOWNWEIGHT = 0.7; // -30%
const UPWEIGHT = 1.1; // +10%

/** 查询时间窗口（天） */
const LOOKBACK_DAYS = 30;

@Injectable()
export class ReplacementPatternService {
  private readonly logger = new Logger(ReplacementPatternService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户的替换模式权重调整
   *
   * 返回 Map<foodName, multiplier>，其中 multiplier < 1 表示降权，> 1 表示增权。
   * 推荐引擎将此乘数应用到对应食物的最终评分上。
   *
   * @param userId 用户 ID
   * @returns Map<foodName, number> — 食物名→评分乘数
   */
  async getReplacementAdjustments(
    userId: string,
  ): Promise<Map<string, number>> {
    const adjustments = new Map<string, number>();

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);

      const patterns = await this.prisma.replacementPatterns.findMany({
        where: {
          userId: userId,
          lastOccurred: { gte: cutoffDate },
          frequency: { gte: WEAK_SIGNAL_THRESHOLD },
        },
        select: {
          fromFoodName: true,
          toFoodName: true,
          frequency: true,
        },
      });

      for (const pattern of patterns) {
        // 被替换的食物（from）降权
        const fromName = pattern.fromFoodName;
        const currentFrom = adjustments.get(fromName) ?? 1.0;
        if (pattern.frequency >= STRONG_SIGNAL_THRESHOLD) {
          adjustments.set(fromName, currentFrom * STRONG_DOWNWEIGHT);
        } else {
          adjustments.set(fromName, currentFrom * WEAK_DOWNWEIGHT);
        }

        // 替换目标食物（to）增权
        const toName = pattern.toFoodName;
        const currentTo = adjustments.get(toName) ?? 1.0;
        adjustments.set(toName, currentTo * UPWEIGHT);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load replacement patterns for user ${userId}: ${err.message}`,
      );
      // 降级：返回空调整，不影响推荐流程
    }

    return adjustments;
  }

  /**
   * 记录一次替换行为
   *
   * 由反馈事件监听器调用（用户将 A 替换为 B 时）。
   * 使用 upsert：首次创建记录，后续累加 frequency。
   *
   * @param userId     用户 ID
   * @param fromFoodId 被替换食物 ID
   * @param fromName   被替换食物名称
   * @param toFoodId   替换目标食物 ID
   * @param toName     替换目标食物名称
   */
  async recordReplacement(
    userId: string,
    fromFoodId: string,
    fromName: string,
    toFoodId: string,
    toName: string,
  ): Promise<void> {
    try {
      await this.prisma.replacementPatterns.upsert({
        where: {
          userId_fromFoodId_toFoodId: {
            userId: userId,
            fromFoodId: fromFoodId,
            toFoodId: toFoodId,
          },
        },
        create: {
          userId: userId,
          fromFoodId: fromFoodId,
          fromFoodName: fromName,
          toFoodId: toFoodId,
          toFoodName: toName,
          frequency: 1,
        },
        update: {
          frequency: { increment: 1 },
          lastOccurred: new Date(),
          fromFoodName: fromName, // 名称可能更新
          toFoodName: toName,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record replacement ${fromName} → ${toName}: ${err.message}`,
      );
    }
  }
}
