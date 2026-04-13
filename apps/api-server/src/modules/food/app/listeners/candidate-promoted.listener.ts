/**
 * V6.2 Phase 3.8 — 候选食物晋升事件监听器
 *
 * 监听 CANDIDATE_PROMOTED 事件，处理：
 * - 日志记录候选食物晋升为正式食物
 * - 失效食物池缓存（使下次推荐能使用新晋升的食物）
 *
 * 所有操作异步执行，不阻塞主流程。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  CandidatePromotedEvent,
} from '../../../../core/events/domain-events';
import { FoodPoolCacheService } from '../../../diet/app/recommendation/pipeline/food-pool-cache.service';

@Injectable()
export class CandidatePromotedListener {
  private readonly logger = new Logger(CandidatePromotedListener.name);

  constructor(private readonly foodPoolCache: FoodPoolCacheService) {}

  @OnEvent(DomainEvents.CANDIDATE_PROMOTED, { async: true })
  async handleCandidatePromoted(event: CandidatePromotedEvent): Promise<void> {
    try {
      this.logger.log(
        `候选食物晋升: ${event.foodName} (candidateId=${event.candidateId}) → foodId=${event.promotedFoodId}`,
      );

      // 失效食物池缓存，使新晋升食物能被推荐引擎发现
      this.foodPoolCache.invalidate();
    } catch (err) {
      this.logger.error(
        `处理候选食物晋升事件失败: candidateId=${event.candidateId}, error=${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
