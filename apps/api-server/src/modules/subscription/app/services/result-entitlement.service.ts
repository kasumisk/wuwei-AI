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
   * V7: 不再裁剪任何字段 — 所有等级返回完整结果。
   * 变现仅通过配额限制分析次数，不隐藏已产出的分析内容。
   * 保留 entitlement.tier 供前端展示等级标识。
   *
   * @param result - 完整的分析结果
   * @param tier - 用户当前订阅等级
   * @param _entitlements - 用户的权益配置（保留参数签名兼容性）
   * @returns 附带 entitlement 元数据的完整分析结果
   */
  trimResult(
    result: FoodAnalysisResultV61,
    tier: SubscriptionTier,
    _entitlements: FeatureEntitlements,
  ): FoodAnalysisResultV61 {
    return {
      ...result,
      entitlement: {
        tier,
        fieldsHidden: [],
      },
    };
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
