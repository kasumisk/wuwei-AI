import { Injectable, Logger } from '@nestjs/common';
import {
  CollaborativeFilteringService,
  CFScoreMap,
} from './collaborative-filtering.service';
import { CFRecallResult } from './recommendation.types';

/**
 * V6.7 Phase 2-B: CF 召回适配器
 *
 * 将 CollaborativeFilteringService 的分数映射转换为召回候选列表，
 * 供 RecallMergerService 三路合并使用。
 *
 * 仅返回 CF score > 0.1 的食物作为召回候选，避免低分噪声。
 */
@Injectable()
export class CFRecallService {
  private readonly logger = new Logger(CFRecallService.name);

  /** CF 分数最低阈值（低于此值不作为召回候选） */
  private static readonly MIN_CF_SCORE = 0.1;

  constructor(private readonly cf: CollaborativeFilteringService) {}

  /**
   * 将 CF 分数转为召回候选列表
   *
   * @param userId      用户 ID
   * @param excludedIds 排除的食物 ID（已在规则/语义召回中选中的）
   * @param topK        最多返回数量
   * @returns CF 召回结果列表（按 cfScore 降序）
   */
  async recall(
    userId: string,
    excludedIds: Set<string>,
    topK: number,
  ): Promise<CFRecallResult[]> {
    try {
      const cfMap: CFScoreMap = await this.cf.getCFScores(userId);
      const { scores } = cfMap;

      return Object.entries(scores)
        .filter(
          ([id, score]) =>
            score > CFRecallService.MIN_CF_SCORE && !excludedIds.has(id),
        )
        .sort((a, b) => b[1] - a[1])
        .slice(0, topK)
        .map(([id, score]) => ({ foodId: id, cfScore: score }));
    } catch (err) {
      this.logger.warn(
        `CF 召回失败 (userId=${userId}): ${(err as Error).message}`,
      );
      return [];
    }
  }
}
