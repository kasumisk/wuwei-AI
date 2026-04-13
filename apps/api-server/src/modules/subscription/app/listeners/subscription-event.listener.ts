/**
 * V6.2 Phase 2.1 — 订阅变更事件监听器
 *
 * 监听 SUBSCRIPTION_CHANGED 事件，处理跨模块的订阅变更副作用：
 * - 记录订阅变更日志（审计+分析）
 * - 刷新配额状态（降级时重置）
 * - 预留推荐策略通知钩子
 *
 * 注意: 订阅模块内部的缓存失效（Redis subscription tier cache）
 * 已在 SubscriptionService 中 emit 之前完成，此处不重复。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  SubscriptionChangedEvent,
} from '../../../../core/events/domain-events';
import { QuotaService } from '../services/quota.service';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class SubscriptionEventListener {
  private readonly logger = new Logger(SubscriptionEventListener.name);

  constructor(
    private readonly quotaService: QuotaService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 处理订阅变更事件
   *
   * 职责:
   * 1. 记录结构化日志（用于运营分析）
   * 2. 降级场景下重置配额（expire/downgrade → 免费额度）
   * 3. 预留推荐策略通知钩子
   */
  @OnEvent(DomainEvents.SUBSCRIPTION_CHANGED, { async: true })
  async handleSubscriptionChanged(
    event: SubscriptionChangedEvent,
  ): Promise<void> {
    try {
      this.logger.log(
        `订阅变更: userId=${event.userId}, ` +
          `${event.previousTier} → ${event.newTier}, ` +
          `reason=${event.reason}`,
      );

      // 降级场景: 重置配额为新等级对应的额度
      if (this.isDowngrade(event.previousTier, event.newTier)) {
        await this.handleDowngrade(event);
      }
    } catch (err) {
      // 事件处理失败不应影响订阅主流程
      this.logger.error(
        `订阅变更事件处理失败: userId=${event.userId}, ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * 判断是否为降级
   */
  private isDowngrade(previousTier: string, newTier: string): boolean {
    const tierOrder: Record<string, number> = {
      free: 0,
      basic: 1,
      pro: 2,
      premium: 3,
      unknown: -1,
    };
    const prev = tierOrder[previousTier] ?? -1;
    const next = tierOrder[newTier] ?? -1;
    return next < prev && prev > 0;
  }

  /**
   * 处理降级副作用
   * 当用户从付费降到免费时，配额需要按新等级重置
   */
  private async handleDowngrade(
    event: SubscriptionChangedEvent,
  ): Promise<void> {
    this.logger.log(
      `订阅降级处理: userId=${event.userId}, ` +
        `${event.previousTier} → ${event.newTier}`,
    );

    // 配额重置由 SubscriptionService.processExpiredSubscriptions 中的
    // initQuotas(freePlan) 已处理，此处仅记录日志供运营分析
    // 未来扩展: 可在此发送降级通知、触发挽回策略等
  }
}
