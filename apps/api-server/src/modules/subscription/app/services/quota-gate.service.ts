/**
 * V6.1 Phase 1.2 — 统一配额门控服务
 *
 * 职责:
 * - 提供统一的配额检查/扣减入口，替代业务代码直接调用 QuotaService
 * - 返回 AccessDecision 对象，告知调用方：是否放行、是否已扣配额、是否需要降级/付费墙
 * - 将"配额检查"和"能力检查"统一在一个入口，Controller 不再需要分别调用两个服务
 *
 * 设计决策:
 * - QuotaGateService 不替代 QuotaService，而是在其之上增加一层业务语义
 * - QuotaService 仍然负责底层 CRUD 和 Cron 重置
 * - 计次类功能走 QuotaService.check/increment
 * - 能力级功能走 PlanEntitlementResolver.hasCapability
 * - 两者结果统一封装为 AccessDecision
 *
 * 使用方式:
 * ```ts
 * const access = await quotaGateService.checkAccess({
 *   userId,
 *   feature: GatedFeature.AI_TEXT_ANALYSIS,
 *   scene: 'food_analysis',
 *   consumeQuota: true,
 * });
 * if (!access.allowed) {
 *   return ResponseWrapper.error(403, access.paywall?.message ?? '配额不足');
 * }
 * ```
 */
import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from '../../../../core/i18n/i18n.service';
import {
  GatedFeature,
  FeatureEntitlements,
  SubscriptionTier,
  AccessDecision,
  PaywallInfo,
  QuotaCheckContext,
  UNLIMITED,
} from '../../subscription.types';
import { QuotaService, QuotaStatus } from './quota.service';
import { SubscriptionService } from './subscription.service';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';

/** 等级推荐映射: 当前等级 → 建议升级到的等级 */
const UPGRADE_TARGET: Record<SubscriptionTier, SubscriptionTier> = {
  [SubscriptionTier.FREE]: SubscriptionTier.PRO,
  [SubscriptionTier.PRO]: SubscriptionTier.PREMIUM,
  [SubscriptionTier.PREMIUM]: SubscriptionTier.PREMIUM,
};

@Injectable()
export class QuotaGateService {
  private readonly logger = new Logger(QuotaGateService.name);

  constructor(
    private readonly quotaService: QuotaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly entitlementResolver: PlanEntitlementResolver,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 统一配额/能力检查入口
   *
   * 处理逻辑:
   * 1. 获取用户订阅概要和权益配置
   * 2. 判断功能类型（计次 vs 能力）
   * 3. 计次类: 检查配额，可选扣减
   * 4. 能力类: 检查是否有权
   * 5. 封装为 AccessDecision 返回
   */
  async checkAccess(context: QuotaCheckContext): Promise<AccessDecision> {
    const { userId, feature, scene, consumeQuota = true } = context;

    // 1. 获取用户订阅概要
    const summary = await this.subscriptionService.getUserSummary(userId);
    const { tier, entitlements } = summary;

    // 2. 判断功能类型
    const isCountable = this.entitlementResolver.isCountableFeature(feature);

    if (isCountable) {
      // ---- 计次类功能: 走配额检查 ----
      return this.handleCountableFeature(
        userId,
        feature,
        tier,
        consumeQuota,
        scene,
      );
    } else {
      // ---- 能力级功能: 走开关检查 ----
      return this.handleCapabilityFeature(feature, tier, entitlements, scene);
    }
  }

  /**
   * 仅检查不扣减的便捷方法
   */
  async checkOnly(
    userId: string,
    feature: GatedFeature,
  ): Promise<AccessDecision> {
    return this.checkAccess({
      userId,
      feature,
      consumeQuota: false,
    });
  }

  /**
   * 批量检查多个功能的访问权限（不扣减配额）
   *
   * 用于前端一次性查询用户在多个功能上的权限状态
   */
  async checkMultiple(
    userId: string,
    features: GatedFeature[],
  ): Promise<Record<string, AccessDecision>> {
    const result: Record<string, AccessDecision> = {};
    for (const feature of features) {
      result[feature] = await this.checkOnly(userId, feature);
    }
    return result;
  }

  // ==================== 私有方法 ====================

  /**
   * 处理计次类功能的访问检查
   *
   * P1-1 原子化改造：
   * - 原实现先 check() 再 increment()，两步之间有竞态窗口（两个并发请求都通过 check，
   *   然后都 increment，导致实际使用超过 quota_limit）。
   * - 新实现：需要扣减时直接调用原子 increment()（内部 CAS SQL），由它决定允许/拒绝。
   *   不需要扣减时（consumeQuota=false）仍调 check() 做只读查询。
   */
  private async handleCountableFeature(
    userId: string,
    feature: GatedFeature,
    tier: SubscriptionTier,
    consumeQuota: boolean,
    scene?: string,
  ): Promise<AccessDecision> {
    if (consumeQuota) {
      // 直接原子扣减：increment() 内部 CAS 保证不超额
      try {
        await this.quotaService.increment(userId, feature);
        return {
          allowed: true,
          quotaConsumed: true,
          degradeMode: 'none',
        };
      } catch {
        // ForbiddenException → 配额耗尽（或 UNLIMITED 以外的意外失败）
        const quotaStatus = await this.quotaService
          .getQuotaStatus(userId, feature)
          .catch(() => null);
        return {
          allowed: false,
          quotaConsumed: false,
          degradeMode: 'none',
          paywall: this.buildQuotaExhaustedPaywall(
            feature,
            tier,
            quotaStatus,
            scene,
          ),
        };
      }
    }

    // 只检查不扣减（check 是只读的，UI 展示用）
    const hasQuota = await this.quotaService.check(userId, feature);
    if (!hasQuota) {
      const quotaStatus = await this.quotaService.getQuotaStatus(
        userId,
        feature,
      );
      return {
        allowed: false,
        quotaConsumed: false,
        degradeMode: 'none',
        paywall: this.buildQuotaExhaustedPaywall(
          feature,
          tier,
          quotaStatus,
          scene,
        ),
      };
    }

    return {
      allowed: true,
      quotaConsumed: false,
      degradeMode: 'none',
    };
  }

  /**
   * 处理能力级功能的访问检查
   */
  private handleCapabilityFeature(
    feature: GatedFeature,
    tier: SubscriptionTier,
    entitlements: FeatureEntitlements,
    scene?: string,
  ): AccessDecision {
    const hasAccess = this.entitlementResolver.hasCapability(
      entitlements,
      feature,
    );

    if (hasAccess) {
      return {
        allowed: true,
        quotaConsumed: false,
        degradeMode: 'none',
      };
    }

    // 能力不足 → 软付费墙（结果降级 + 升级提示）
    return {
      allowed: true, // 不完全阻断，而是降级返回
      quotaConsumed: false,
      degradeMode: 'basic_result',
      paywall: this.buildCapabilityPaywall(feature, tier, scene),
    };
  }

  /**
   * 构建配额耗尽的付费墙信息
   */
  private buildQuotaExhaustedPaywall(
    feature: GatedFeature,
    tier: SubscriptionTier,
    quotaStatus: QuotaStatus | null,
    scene?: string,
  ): PaywallInfo {
    const targetTier = UPGRADE_TARGET[tier];
    const featureName = this.featureDisplayName(feature);
    const message = quotaStatus?.resetAt
      ? this.i18n.t('subscription.quota.exceededWithReset', {
          feature: featureName,
          resetAt: quotaStatus.resetAt.toLocaleString('zh-CN'),
          targetTier,
        })
      : this.i18n.t('subscription.quota.exceededNoReset', {
          feature: featureName,
          targetTier,
        });

    return {
      code: 'quota_exceeded',
      message,
      recommendedTier: targetTier,
      triggerScene: scene ?? `${feature}_quota_exceeded`,
    };
  }

  /**
   * 构建能力不足的付费墙信息（软付费墙）
   */
  private buildCapabilityPaywall(
    feature: GatedFeature,
    tier: SubscriptionTier,
    scene?: string,
  ): PaywallInfo {
    const targetTier = UPGRADE_TARGET[tier];

    return {
      code: 'advanced_result_hidden',
      message: this.i18n.t('subscription.quota.upgradeUnlock', {
        targetTier,
        feature: this.featureDisplayName(feature),
      }),
      recommendedTier: targetTier,
      triggerScene: scene ?? `${feature}_capability_locked`,
    };
  }

  /**
   * 功能标识的中文展示名
   */
  private featureDisplayName(feature: GatedFeature): string {
    const keyMap: Record<GatedFeature, string> = {
      [GatedFeature.RECOMMENDATION]: 'subscription.featureName.recommendation',
      [GatedFeature.AI_IMAGE_ANALYSIS]:
        'subscription.featureName.aiImageAnalysis',
      [GatedFeature.AI_TEXT_ANALYSIS]:
        'subscription.featureName.aiTextAnalysis',
      [GatedFeature.AI_COACH]: 'subscription.featureName.aiCoach',
      [GatedFeature.ANALYSIS_HISTORY]:
        'subscription.featureName.analysisHistory',
      [GatedFeature.DETAILED_SCORE]: 'subscription.featureName.detailedScore',
      [GatedFeature.ADVANCED_EXPLAIN]:
        'subscription.featureName.advancedExplain',
      [GatedFeature.DEEP_NUTRITION]: 'subscription.featureName.deepNutrition',
      [GatedFeature.PERSONALIZED_ALTERNATIVES]:
        'subscription.featureName.personalizedAlternatives',
      [GatedFeature.REPORTS]: 'subscription.featureName.reports',
      [GatedFeature.DATA_EXPORT]: 'subscription.featureName.dataExport',
      [GatedFeature.FULL_DAY_PLAN]: 'subscription.featureName.fullDayPlan',
      [GatedFeature.FULL_DAY_LINKAGE]:
        'subscription.featureName.fullDayLinkage',
      [GatedFeature.RECIPE_GENERATION]:
        'subscription.featureName.recipeGeneration',
      [GatedFeature.HEALTH_TREND]: 'subscription.featureName.healthTrend',
      [GatedFeature.PRIORITY_AI]: 'subscription.featureName.priorityAi',
      [GatedFeature.BEHAVIOR_ANALYSIS]:
        'subscription.featureName.behaviorAnalysis',
      [GatedFeature.COACH_STYLE]: 'subscription.featureName.coachStyle',
      [GatedFeature.ADVANCED_CHALLENGES]:
        'subscription.featureName.advancedChallenges',
    };
    const i18nKey = keyMap[feature];
    if (!i18nKey) return feature;
    return this.i18n.t(i18nKey);
  }
}
