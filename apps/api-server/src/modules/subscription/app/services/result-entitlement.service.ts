/**
 * V6.1 Phase 1.3 — 结果权益裁剪服务
 *
 * 职责:
 * - 按用户订阅等级裁剪 FoodAnalysisResultV61 的字段
 * - 免费版: 保留基础结论，隐藏深度解释、替代建议、微量营养素
 * - Pro 版: 返回完整分析结果（隐藏入库内部信息）
 * - Premium 版: 返回所有字段
 *
 * 设计决策:
 * - 裁剪在返回前端之前执行，不修改入库数据
 * - 裁剪后通过 entitlement.fieldsHidden 告知前端被隐藏了什么
 * - 免费版裁剪后会注入 upgradeTeaser，提升转化
 * - 使用 PlanEntitlementResolver 判断具体能力，而不是硬编码等级判断
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  GatedFeature,
  FeatureEntitlements,
  SubscriptionTier,
} from '../../subscription.types';
import { PlanEntitlementResolver } from './plan-entitlement-resolver.service';
import {
  FoodAnalysisResultV61,
  FREE_TIER_HIDDEN_FIELDS,
  PRO_TIER_HIDDEN_FIELDS,
  PREMIUM_TIER_HIDDEN_FIELDS,
} from '../../../decision/types/analysis-result.types';

@Injectable()
export class ResultEntitlementService {
  private readonly logger = new Logger(ResultEntitlementService.name);

  constructor(private readonly entitlementResolver: PlanEntitlementResolver) {}

  /**
   * 按订阅等级裁剪分析结果
   *
   * 输入完整的分析结果，输出裁剪后的结果（深拷贝，不修改原对象）
   *
   * @param result - 完整的分析结果
   * @param tier - 用户当前订阅等级
   * @param entitlements - 用户的权益配置
   * @returns 裁剪后的分析结果
   */
  trimResult(
    result: FoodAnalysisResultV61,
    tier: SubscriptionTier,
    entitlements: FeatureEntitlements,
  ): FoodAnalysisResultV61 {
    // Premium 不裁剪
    if (tier === SubscriptionTier.PREMIUM) {
      return {
        ...result,
        entitlement: {
          tier,
          fieldsHidden: PREMIUM_TIER_HIDDEN_FIELDS,
        },
      };
    }

    // 深拷贝避免修改原对象
    const trimmed: FoodAnalysisResultV61 = JSON.parse(JSON.stringify(result));

    // 判断各能力
    const hasDeepNutrition = this.entitlementResolver.hasCapability(
      entitlements,
      GatedFeature.DEEP_NUTRITION,
    );
    const hasAlternatives = this.entitlementResolver.hasCapability(
      entitlements,
      GatedFeature.PERSONALIZED_ALTERNATIVES,
    );
    const hasAdvancedExplain = this.entitlementResolver.hasCapability(
      entitlements,
      GatedFeature.ADVANCED_EXPLAIN,
    );

    const fieldsHidden: string[] = [];

    // ---- 深度营养拆解裁剪 ----
    if (!hasDeepNutrition) {
      // 移除微量营养素（fiber, sodium）
      for (const food of trimmed.foods) {
        delete food.fiber;
        delete food.sodium;
      }
      delete trimmed.totals.fiber;
      delete trimmed.totals.sodium;
      fieldsHidden.push(
        'foods.*.fiber',
        'foods.*.sodium',
        'totals.fiber',
        'totals.sodium',
      );
    }

    // ---- 个性化替代建议裁剪 ----
    if (!hasAlternatives) {
      trimmed.alternatives = [];
      fieldsHidden.push('alternatives');
    }

    // ---- 高级解释裁剪 ----
    if (!hasAdvancedExplain) {
      delete trimmed.explanation.primaryReason;
      delete trimmed.explanation.userContextImpact;
      fieldsHidden.push(
        'explanation.primaryReason',
        'explanation.userContextImpact',
      );

      // 注入升级引导文案
      trimmed.explanation.upgradeTeaser =
        '升级后可查看详细分析原因和个性化建议';
    }

    // ---- 入库信息只返回给 Premium（已经 early return 了，此处 tier 必为 FREE 或 PRO） ----
    delete trimmed.ingestion;
    if (!fieldsHidden.includes('ingestion')) {
      fieldsHidden.push('ingestion');
    }

    // 更新权益信息
    trimmed.entitlement = {
      tier,
      fieldsHidden,
    };

    return trimmed;
  }

  /**
   * 获取指定等级默认的隐藏字段列表
   *
   * 用于前端预判哪些字段会被隐藏（无需先调用分析接口）
   */
  getHiddenFieldsForTier(tier: SubscriptionTier): string[] {
    switch (tier) {
      case SubscriptionTier.FREE:
        return [...FREE_TIER_HIDDEN_FIELDS];
      case SubscriptionTier.PRO:
        return [...PRO_TIER_HIDDEN_FIELDS];
      case SubscriptionTier.PREMIUM:
        return [...PREMIUM_TIER_HIDDEN_FIELDS];
      default:
        return [...FREE_TIER_HIDDEN_FIELDS];
    }
  }
}
