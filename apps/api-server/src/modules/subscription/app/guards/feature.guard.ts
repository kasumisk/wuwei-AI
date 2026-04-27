/**
 * 基于功能权益的访问门控守卫
 *
 * 与 SubscriptionGuard（基于订阅等级）不同，
 * 本守卫直接读取用户当前计划的 entitlements 并检查对应功能是否开启。
 *
 * 流程:
 * 1. 读取路由元数据中的目标功能（GatedFeature）
 * 2. 通过 SubscriptionService.getUserSummary() 获取用户订阅摘要（含已解析的权益）
 * 3. 使用 PlanEntitlementResolver.hasCapability() 判断是否有权访问
 *
 * 关键点:
 * - getUserSummary() 已缓存（5 分钟 TTL），不会带来额外 DB 查询
 * - 免费用户的权益从 DB subscription_plan 表（tier='free'）读取，
 *   admin 修改 entitlements 后实时生效（缓存失效后生效）
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GatedFeature } from '../../subscription.types';
import { SubscriptionService } from '../services/subscription.service';
import { PlanEntitlementResolver } from '../services/plan-entitlement-resolver.service';
import { REQUIRED_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { I18nService } from '../../../../core/i18n/i18n.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  private readonly logger = new Logger(FeatureGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementResolver: PlanEntitlementResolver,
    private readonly i18n: I18nService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. 读取路由元数据中的目标功能
    const requiredFeature = this.reflector.getAllAndOverride<
      GatedFeature | undefined
    >(REQUIRED_FEATURE_KEY, [context.getHandler(), context.getClass()]);

    // 未设置功能要求 → 放行
    if (!requiredFeature) {
      return true;
    }

    // 2. 获取用户信息（由 AppJwtAuthGuard 注入）
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user?.id) {
      throw new ForbiddenException({
        code: 'AUTH_REQUIRED',
        message: this.i18n.t('subscription.guard.loginRequired'),
      });
    }

    // 3. 获取用户订阅摘要（含已解析的 entitlements，带缓存）
    const summary = await this.subscriptionService.getUserSummary(user.id);

    // 4. 检查功能权益
    const hasAccess = this.entitlementResolver.hasCapability(
      summary.entitlements,
      requiredFeature,
    );

    if (!hasAccess) {
      this.logger.debug(
        `用户 ${user.id} 无权访问功能 ${requiredFeature}（当前等级: ${summary.tier}）`,
      );
      throw new ForbiddenException({
        code: 'FEATURE_NOT_ENABLED',
        message: this.i18n.t('subscription.guard.featureNotIncluded'),
        currentTier: summary.tier,
        requiredFeature,
      });
    }

    return true;
  }
}
