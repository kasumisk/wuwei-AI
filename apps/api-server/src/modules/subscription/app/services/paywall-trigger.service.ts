/**
 * V6.1 Phase 1.7 — 付费墙触发策略服务
 *
 * 职责:
 * - 统一管理付费墙触发逻辑（何时、何种方式展示升级提示）
 * - 记录触发事件到 subscription_trigger_logs 表（转化漏斗分析）
 * - 提供前端展示数据（触发原因、推荐等级、文案）
 *
 * 设计原则:
 * - 付费墙不放在首次核心价值之前，放在"用户已经感到有用，但还差一点完整答案"的节点
 * - 硬付费墙（配额耗尽）阻断请求
 * - 软付费墙（能力不足）降级返回基础结果 + upgradeTeaser
 *
 * 触发点（设计文档 Section 7.4）:
 * 1. 分析结果被裁剪时（advanced_result）
 * 2. 配额耗尽时（analysis_limit）
 * 3. 历史记录查看限制时（history_view）
 * 4. 用户连续触发 caution/avoid 时（precision_upgrade）
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { subscription_trigger_logs as SubscriptionTriggerLog } from '@prisma/client';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  AccessDecision,
  PaywallInfo,
  SubscriptionTier,
  GatedFeature,
} from '../../subscription.types';
import {
  DomainEvents,
  PaywallTriggeredEvent,
} from '../../../../core/events/domain-events';

/** 付费墙触发记录输入 */
export interface PaywallTriggerInput {
  /** 用户 ID */
  userId: string;
  /** 触发场景 */
  triggerScene: string;
  /** 对应功能 */
  feature: GatedFeature | string;
  /** 当前订阅等级 */
  currentTier: SubscriptionTier;
  /** 推荐升级档位 */
  recommendedPlan: SubscriptionTier;
  /** A/B 实验桶（可选） */
  abBucket?: string;
}

/** 增强的付费墙展示数据 */
export interface EnhancedPaywallDisplay {
  /** 原始 paywall 信息 */
  paywall: PaywallInfo;
  /** 展示类型: hard（完全阻断）/ soft（降级返回） */
  type: 'hard' | 'soft';
  /** 升级卖点列表（前端展示） */
  benefits: string[];
  /** 触发日志 ID（可选，用于后续回写 converted） */
  triggerLogId?: string;
}

@Injectable()
export class PaywallTriggerService {
  private readonly logger = new Logger(PaywallTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    // V6.1 Phase 2.6: 域事件发射
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 处理 AccessDecision 中的付费墙触发
   *
   * 当 QuotaGateService 返回的 AccessDecision 包含 paywall 信息时调用:
   * 1. 异步记录触发日志
   * 2. 返回增强的展示数据
   *
   * @param accessDecision - QuotaGateService 返回的访问决策
   * @param userId - 用户 ID
   * @param feature - 功能标识
   * @param currentTier - 当前订阅等级
   * @returns 增强的付费墙展示数据，如果无需展示付费墙则返回 null
   */
  async handleAccessDecision(
    accessDecision: AccessDecision,
    userId: string,
    feature: GatedFeature | string,
    currentTier: SubscriptionTier,
  ): Promise<EnhancedPaywallDisplay | null> {
    if (!accessDecision.paywall) return null;

    const { paywall } = accessDecision;
    const isHard = !accessDecision.allowed;
    const triggerScene = isHard ? 'analysis_limit' : 'advanced_result';

    // 异步记录触发日志
    const logId = await this.recordTrigger({
      userId,
      triggerScene,
      feature,
      currentTier,
      recommendedPlan: paywall.recommendedTier,
    }).catch((err) => {
      this.logger.warn(`记录触发日志失败: ${(err as Error).message}`);
      return undefined;
    });

    return {
      paywall,
      type: isHard ? 'hard' : 'soft',
      benefits: this.getBenefitsForTier(paywall.recommendedTier),
      triggerLogId: logId,
    };
  }

  /**
   * 记录结果裁剪触发的软付费墙
   *
   * 当 ResultEntitlementService 裁剪了字段后调用
   */
  async recordResultTrimTrigger(
    userId: string,
    currentTier: SubscriptionTier,
    hiddenFields: string[],
  ): Promise<void> {
    if (hiddenFields.length === 0) return;

    // 根据隐藏字段判断触发的功能
    const features: string[] = [];
    if (hiddenFields.includes('alternatives')) {
      features.push(GatedFeature.PERSONALIZED_ALTERNATIVES);
    }
    if (
      hiddenFields.includes('explanation.primaryReason') ||
      hiddenFields.includes('explanation.userContextImpact')
    ) {
      features.push(GatedFeature.ADVANCED_EXPLAIN);
    }
    if (
      hiddenFields.includes('foods.*.fiber') ||
      hiddenFields.includes('totals.fiber')
    ) {
      features.push(GatedFeature.DEEP_NUTRITION);
    }

    const recommendedPlan =
      currentTier === SubscriptionTier.FREE
        ? SubscriptionTier.PRO
        : SubscriptionTier.PREMIUM;

    // 为每个触发功能记录日志（批量）
    for (const feature of features) {
      await this.recordTrigger({
        userId,
        triggerScene: 'advanced_result',
        feature,
        currentTier,
        recommendedPlan,
      }).catch((err) =>
        this.logger.warn(`记录裁剪触发日志失败: ${(err as Error).message}`),
      );
    }
  }

  /**
   * 记录付费墙触发事件到数据库
   *
   * @returns 触发日志 ID
   */
  async recordTrigger(input: PaywallTriggerInput): Promise<string | undefined> {
    try {
      const saved = await this.prisma.subscription_trigger_logs.create({
        data: {
          user_id: input.userId,
          trigger_scene: input.triggerScene,
          feature: input.feature,
          current_tier: input.currentTier,
          recommended_plan: input.recommendedPlan,
          ab_bucket: input.abBucket || null,
          converted: false,
        },
      });
      this.logger.debug(
        `付费墙触发已记录: userId=${input.userId}, scene=${input.triggerScene}, feature=${input.feature}`,
      );

      // V6.1 Phase 2.6: 发射付费墙触发事件（转化漏斗分析）
      this.eventEmitter.emit(
        DomainEvents.PAYWALL_TRIGGERED,
        new PaywallTriggeredEvent(
          input.userId,
          input.currentTier,
          input.recommendedPlan,
          input.triggerScene,
          input.feature,
        ),
      );

      return saved.id;
    } catch (err) {
      this.logger.warn(`保存触发日志失败: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * 标记触发事件为已转化
   *
   * 在用户成功订阅后调用，回写最近的相关触发日志
   */
  async markConverted(
    userId: string,
    convertedTier: SubscriptionTier,
  ): Promise<number> {
    // 标记最近 7 天内未转化的触发日志
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.subscription_trigger_logs.updateMany({
      where: {
        user_id: userId,
        converted: false,
        recommended_plan: convertedTier,
        created_at: { gte: sevenDaysAgo },
      },
      data: { converted: true },
    });

    const affected = result.count;
    if (affected > 0) {
      this.logger.log(
        `已标记 ${affected} 条触发日志为已转化: userId=${userId}, tier=${convertedTier}`,
      );
    }
    return affected;
  }

  /**
   * 获取用户最近的触发统计（用于智能推荐时机判断）
   */
  async getRecentTriggerCount(
    userId: string,
    hoursBack: number = 24,
  ): Promise<number> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return this.prisma.subscription_trigger_logs.count({
      where: {
        user_id: userId,
        created_at: { gte: since },
      },
    });
  }

  // ==================== 私有方法 ====================

  /**
   * 获取各档位的升级卖点（前端展示用）
   */
  private getBenefitsForTier(tier: SubscriptionTier): string[] {
    const benefits: Record<SubscriptionTier, string[]> = {
      [SubscriptionTier.PRO]: [
        '无限文本分析次数',
        '每天 20 次图片分析',
        '深度营养成分拆解',
        '个性化替代食物建议',
        '完整分析历史记录',
        '详细评分和高级解释',
      ],
      [SubscriptionTier.PREMIUM]: [
        '所有 Pro 功能',
        '无限图片分析次数',
        '全天膳食联动建议',
        '食谱智能生成',
        '健康趋势分析',
        '优先 AI 响应',
      ],
      [SubscriptionTier.FREE]: [],
    };
    return benefits[tier] ?? [];
  }
}
