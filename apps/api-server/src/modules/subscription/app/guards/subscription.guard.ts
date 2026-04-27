/**
 * V6 Phase 2.13 — 订阅门控守卫
 *
 * 职责:
 *   读取 @RequireSubscription / @RequireSubscriptionTier 设置的最低等级，
 *   查询用户当前订阅等级，判断是否满足要求。
 *
 * 等级层级（从低到高）: free < pro < premium
 *   - 要求 pro  → pro / premium 通过
 *   - 要求 premium → 仅 premium 通过
 *
 * 依赖:
 *   - SubscriptionService.getUserTier() — 带 Redis 缓存的等级查询
 *   - 请求中必须已通过 AppJwtAuthGuard 注入 user
 *
 * 错误响应:
 *   403 — 订阅等级不足，返回当前等级和所需等级，前端可据此弹出升级引导
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SubscriptionTier } from '../../subscription.types';
import { SubscriptionService } from '../services/subscription.service';
import { SUBSCRIPTION_TIER_KEY } from '../decorators/require-subscription.decorator';
import { I18nService } from '../../../../core/i18n/i18n.service';

/**
 * 等级权重映射 — 用于数值比较
 * free(0) < pro(1) < premium(2)
 */
const TIER_WEIGHT: Record<SubscriptionTier, number> = {
  [SubscriptionTier.FREE]: 0,
  [SubscriptionTier.PRO]: 1,
  [SubscriptionTier.PREMIUM]: 2,
};

@Injectable()
export class SubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(SubscriptionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
    private readonly i18n: I18nService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 读取路由元数据中的最低等级要求
    const requiredTier = this.reflector.getAllAndOverride<
      SubscriptionTier | undefined
    >(SUBSCRIPTION_TIER_KEY, [context.getHandler(), context.getClass()]);

    // 未设置等级要求 → 无需门控，放行
    if (!requiredTier) {
      return true;
    }

    // 2. 从请求中获取用户信息（由 AppJwtAuthGuard 注入）
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) {
      // 未认证 — 此处不应出现（门控守卫应在 Auth 守卫之后执行）
      throw new ForbiddenException({
        code: 'AUTH_REQUIRED',
        message: this.i18n.t('subscription.guard.loginRequired'),
      });
    }

    // 3. 查询用户当前等级（带缓存）
    const userTier = await this.subscriptionService.getUserTier(user.id);

    // 4. 比较等级权重
    const userWeight = TIER_WEIGHT[userTier] ?? 0;
    const requiredWeight = TIER_WEIGHT[requiredTier] ?? 0;

    if (userWeight >= requiredWeight) {
      return true;
    }

    // 5. 等级不足 → 抛出 403，携带升级信息
    this.logger.debug(
      `用户 ${user.id} 订阅等级不足: 当前=${userTier}, 需要=${requiredTier}`,
    );

    throw new ForbiddenException({
      code: 'SUBSCRIPTION_REQUIRED',
      message: this.i18n.t('subscription.guard.tierRequired', {
        tier: requiredTier,
      }),
      currentTier: userTier,
      requiredTier,
    });
  }
}
