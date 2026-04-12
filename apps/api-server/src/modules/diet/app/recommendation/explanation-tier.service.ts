/**
 * V7.2 P2-F: ExplanationTierService — 付费分层门控服务
 *
 * 从 ExplanationGeneratorService 拆分的付费预览逻辑。
 * 负责对 ExplanationV2 应用免费/付费门控策略。
 *
 * 职责：
 * - applyUpgradeTeaser()      — 单条解释的付费预览门控
 * - applyUpgradeTeaserBatch() — 批量解释的付费预览门控
 *
 * 设计原则：
 * - 纯函数，无外部 DI 依赖
 * - 免费用户: 裁剪高级可视化（雷达图仅 Top-3、进度条清空、对比卡置零）
 * - 付费用户: 原样返回
 * - 当 SubscriptionModule 上线后，由功能门控自动调用
 */

import { Injectable } from '@nestjs/common';
import type { ExplanationV2 } from './scoring-explanation.interface';
import { t, type Locale } from './i18n-messages';

@Injectable()
export class ExplanationTierService {
  /**
   * 付费内容门控 — 对 ExplanationV2 应用付费预览策略
   *
   * 免费用户可见:
   *   - summary, primaryReason, healthTip（V1 基础字段）
   *   - radarChart 的 Top-3 维度（其余维度 score 置 0、标注 locked）
   *   - upgradeTeaser 提示文案
   *
   * 免费用户不可见（置空）:
   *   - progressBars（清空为空数组）
   *   - comparisonCard（置为零值）
   *   - whyNotExplanation（清空）
   *
   * 付费用户: 原样返回，不做任何裁剪
   *
   * @param explanation  完整的 V2 解释对象
   * @param isPremium    用户是否为付费用户
   * @returns 门控后的 ExplanationV2
   */
  applyUpgradeTeaser(
    explanation: ExplanationV2,
    isPremium: boolean,
  ): ExplanationV2 {
    // 付费用户 — 原样返回
    if (isPremium) {
      return explanation;
    }

    // 免费用户 — 裁剪高级内容

    // 雷达图: 仅展示权重最高的 3 个维度，其余 score 置 0
    const topDims = [...explanation.radarChart.dimensions]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((d) => d.name);

    const gatedRadarDimensions = explanation.radarChart.dimensions.map(
      (dim) => {
        if (topDims.includes(dim.name)) {
          return dim; // Top-3 维度完整展示
        }
        return {
          ...dim,
          score: 0, // 隐藏分数
          benchmark: 0, // 隐藏基准
        };
      },
    );

    return {
      // V1 基础字段 — 免费可见
      summary: explanation.summary,
      primaryReason: explanation.primaryReason,
      healthTip: explanation.healthTip,

      // 雷达图 — 仅 Top-3 可见
      radarChart: { dimensions: gatedRadarDimensions },

      // 进度条 — 付费内容，清空
      progressBars: [],

      // 对比卡片 — 付费内容，置零
      comparisonCard: {
        vsUserAvg: 0,
        vsHealthyTarget: 0,
        trend7d: [],
      },

      // 反向解释 — 付费内容，清空
      whyNotExplanation: undefined,

      // 付费预览提示（国际化）
      upgradeTeaser: t(
        'premium.upgradeTeaser',
        {},
        explanation.locale as Locale,
      ),

      locale: explanation.locale,
    };
  }

  /**
   * 批量应用付费预览门控
   *
   * 对一组 ExplanationV2 统一应用付费/免费策略。
   * 适用于日计划等批量返回场景。
   */
  applyUpgradeTeaserBatch(
    explanations: Map<string, ExplanationV2>,
    isPremium: boolean,
  ): Map<string, ExplanationV2> {
    if (isPremium) return explanations; // 付费用户不处理

    const gated = new Map<string, ExplanationV2>();
    for (const [key, exp] of explanations) {
      gated.set(key, this.applyUpgradeTeaser(exp, false));
    }
    return gated;
  }
}
