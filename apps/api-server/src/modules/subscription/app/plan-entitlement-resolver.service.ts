/**
 * V6.1 Phase 1.1 — 套餐能力解析服务
 *
 * 职责:
 * - 根据用户订阅等级解析完整的权益配置
 * - 优先从 DB（subscription_plan.entitlements）读取，兜底使用硬编码默认值
 * - 提供单功能查询（是否有权、配额多少）
 * - 支持运行时通过修改 DB 调整权益，无需重新部署
 *
 * 设计决策:
 * - 权益解析结果缓存在 SubscriptionService.getUserSummary() 中（5 分钟 TTL），
 *   此处不额外加缓存，避免双重缓存导致一致性问题
 * - DB 中的 entitlements JSONB 是 Partial<FeatureEntitlements>，
 *   缺失字段自动从 TIER_ENTITLEMENTS 默认值补全
 * - 免费用户无 subscription 记录，直接返回 TIER_ENTITLEMENTS[FREE]
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  GatedFeature,
  FeatureEntitlements,
  SubscriptionTier,
  TIER_ENTITLEMENTS,
  UNLIMITED,
} from '../subscription.types';

@Injectable()
export class PlanEntitlementResolver {
  private readonly logger = new Logger(PlanEntitlementResolver.name);

  /**
   * 解析完整权益配置
   *
   * 将 DB 中的 Partial<FeatureEntitlements> 与对应等级的默认值合并，
   * 确保返回完整的 FeatureEntitlements 对象。
   *
   * @param tier - 用户订阅等级
   * @param dbEntitlements - DB 中存储的权益覆盖（可能是部分字段）
   * @returns 合并后的完整权益配置
   */
  resolve(
    tier: SubscriptionTier,
    dbEntitlements?: Partial<FeatureEntitlements> | null,
  ): FeatureEntitlements {
    const defaults = TIER_ENTITLEMENTS[tier];

    // 无 DB 覆盖 → 直接返回默认值
    if (!dbEntitlements) {
      return { ...defaults };
    }

    // DB 值覆盖默认值（只覆盖 DB 中明确设置的字段）
    return { ...defaults, ...dbEntitlements };
  }

  /**
   * 查询单个功能的权益值
   *
   * @returns number（配额类）| boolean（开关类）| string（混合类，如导出格式）
   */
  getFeatureValue(
    entitlements: FeatureEntitlements,
    feature: GatedFeature,
  ): number | boolean | string {
    return entitlements[feature];
  }

  /**
   * 判断功能是否为计次类型（配额控制）
   *
   * 计次类功能在 Free 等级下有数值限额（>0 或 UNLIMITED），
   * 布尔型功能值为 true/false。
   */
  isCountableFeature(feature: GatedFeature): boolean {
    const freeValue = TIER_ENTITLEMENTS[SubscriptionTier.FREE][feature];
    return typeof freeValue === 'number';
  }

  /**
   * 判断功能是否为能力级开关（布尔控制）
   */
  isCapabilityFeature(feature: GatedFeature): boolean {
    const freeValue = TIER_ENTITLEMENTS[SubscriptionTier.FREE][feature];
    return typeof freeValue === 'boolean';
  }

  /**
   * 检查用户是否拥有某个能力级功能的访问权
   *
   * @returns true = 有权访问，false = 无权
   */
  hasCapability(
    entitlements: FeatureEntitlements,
    feature: GatedFeature,
  ): boolean {
    const value = entitlements[feature];
    // 布尔型直接返回
    if (typeof value === 'boolean') return value;
    // 字符串型（如 DATA_EXPORT = 'csv'）视为有权
    if (typeof value === 'string') return true;
    // 数值型: UNLIMITED 或 > 0 视为有权
    if (typeof value === 'number') return value === UNLIMITED || value > 0;
    return false;
  }

  /**
   * 获取计次类功能的配额上限
   *
   * @returns 配额上限（-1 表示无限），非计次类功能返回 null
   */
  getQuotaLimit(
    entitlements: FeatureEntitlements,
    feature: GatedFeature,
  ): number | null {
    const value = entitlements[feature];
    if (typeof value !== 'number') return null;
    return value;
  }

  /**
   * 列出所有计次类功能及其配额
   *
   * 用于初始化/更新用户的 usage_quota 记录
   */
  listCountableFeatures(
    entitlements: FeatureEntitlements,
  ): Array<{ feature: GatedFeature; limit: number }> {
    const result: Array<{ feature: GatedFeature; limit: number }> = [];

    for (const key of Object.values(GatedFeature)) {
      const value = entitlements[key];
      if (typeof value === 'number') {
        result.push({ feature: key, limit: value });
      }
    }

    return result;
  }

  /**
   * 列出所有能力级功能及其状态
   *
   * 用于前端展示功能解锁状态
   */
  listCapabilities(
    entitlements: FeatureEntitlements,
  ): Array<{ feature: GatedFeature; enabled: boolean; value?: string }> {
    const result: Array<{
      feature: GatedFeature;
      enabled: boolean;
      value?: string;
    }> = [];

    for (const key of Object.values(GatedFeature)) {
      const value = entitlements[key];
      if (typeof value === 'boolean') {
        result.push({ feature: key, enabled: value });
      } else if (typeof value === 'string') {
        result.push({ feature: key, enabled: true, value });
      }
    }

    return result;
  }
}
