import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';

/**
 * V6.6 Phase 2-B: ReplacementFeedbackInjectorService
 *
 * 从 replacement_patterns 表读取当前用户 90 天内的 A→B 替换记录，
 * 生成食物 ID → 评分权重乘数 Map，注入 rankCandidates 阶段。
 *
 * 权重规则：
 * - 被替换的食物（from_food_id）降权 20%（乘数 0.8），最低不低于 0.65
 * - 替换目标（to_food_id）增权 12%（乘数 1.12），最高不超过 1.25
 * - 时间衰减：最近 30 天满权重；30~90 天线性衰减至 60%
 * - 触发条件：替换频次 >= 2
 *
 * 幂等：多个替换链路对同一食物的乘数叠加，但受上下边界约束。
 */
@Injectable()
export class ReplacementFeedbackInjectorService {
  private readonly logger = new Logger(ReplacementFeedbackInjectorService.name);

  /** 被替换食物的降权乘数（每次叠加，不低于 MIN_FROM） */
  private static readonly REPLACED_FROM_MULTIPLIER = 0.8;
  /** 替换目标的增权乘数（每次叠加，不超过 MAX_TO） */
  private static readonly REPLACED_TO_MULTIPLIER = 1.12;

  /** 降权下界（多次替换不超过此惩罚） */
  private static readonly MIN_FROM = 0.65;
  /** 增权上界 */
  private static readonly MAX_TO = 1.25;

  /** 满权重窗口（天）：在此范围内衰减因子 = 1.0 */
  private static readonly FULL_WEIGHT_DAYS = 30;
  /** 查询窗口（天） */
  private static readonly LOOKBACK_DAYS = 90;
  /** 触发权重调整的最低替换次数 */
  private static readonly MIN_FREQUENCY = 2;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户的替换模式权重 Map
   *
   * @param userId  用户 ID
   * @returns Map<foodId, multiplier>
   *   - multiplier < 1.0 → 该食物曾被替换（降权）
   *   - multiplier > 1.0 → 该食物曾是替换目标（增权）
   *   - 食物不在 Map 中 → 乘数为 1.0（不做调整）
   */
  async getWeightMap(userId: string): Promise<Map<string, number>> {
    const weightMap = new Map<string, number>();
    try {
      const cutoff = new Date(
        Date.now() -
          ReplacementFeedbackInjectorService.LOOKBACK_DAYS * 86400_000,
      );
      const patterns = await this.prisma.replacement_patterns.findMany({
        where: {
          user_id: userId,
          last_occurred: { gte: cutoff },
          frequency: { gte: ReplacementFeedbackInjectorService.MIN_FREQUENCY },
        },
        select: {
          from_food_id: true,
          to_food_id: true,
          frequency: true,
          last_occurred: true,
        },
      });

      for (const p of patterns) {
        const daysSince = (Date.now() - p.last_occurred.getTime()) / 86400_000;

        // 时间衰减因子：30天内=1.0，30~90天线性衰减到0.6
        const decayFactor =
          daysSince <= ReplacementFeedbackInjectorService.FULL_WEIGHT_DAYS
            ? 1.0
            : Math.max(
                0.6,
                1.0 -
                  (daysSince -
                    ReplacementFeedbackInjectorService.FULL_WEIGHT_DAYS) /
                    60,
              );

        // 被替换食物降权（叠加，下界 0.65）
        const fromCurrent = weightMap.get(p.from_food_id) ?? 1.0;
        weightMap.set(
          p.from_food_id,
          Math.max(
            ReplacementFeedbackInjectorService.MIN_FROM,
            fromCurrent *
              ReplacementFeedbackInjectorService.REPLACED_FROM_MULTIPLIER *
              decayFactor,
          ),
        );

        // 替换目标增权（叠加，上界 1.25）
        const toCurrent = weightMap.get(p.to_food_id) ?? 1.0;
        weightMap.set(
          p.to_food_id,
          Math.min(
            ReplacementFeedbackInjectorService.MAX_TO,
            toCurrent *
              ReplacementFeedbackInjectorService.REPLACED_TO_MULTIPLIER *
              decayFactor,
          ),
        );
      }
    } catch (err) {
      this.logger.warn(
        `替换模式权重加载失败 (userId=${userId}): ${(err as Error).message}`,
      );
    }
    return weightMap;
  }
}
