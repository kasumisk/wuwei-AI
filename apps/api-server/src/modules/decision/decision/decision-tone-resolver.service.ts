/**
 * V3.0 Phase 2 — 决策语气解析服务
 *
 * 将用户目标(goalType) + 决策判定(verdict) + 教练重点(coachFocus)
 * 映射为结构化语气修饰符，供 coach-prompt-builder.service.ts 注入到 prompt。
 *
 * 设计原则:
 * - 纯函数，无 IO，可独立测试
 * - 不修改 coach-tone.config.ts 的人格 prompt（正交关系）
 * - 输出 toneModifier 字符串，直接嵌入 coach prompt
 *
 * V4.4: 内联多语言 maps 已迁移为 cl() 调用（decision-labels.ts tone.* keys）
 */

import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

// ==================== 语气修饰矩阵 ====================

type ToneKey = 'control' | 'encourage' | 'neutral' | 'urgent' | 'affirm';

interface ToneResolution {
  toneKey: ToneKey;
  toneModifier: string;
}

/**
 * goalType × verdict 核心矩阵
 * 优先级: health_constraint > verdict-specific
 */
const GOAL_VERDICT_TONE: Record<string, Record<string, ToneKey>> = {
  fat_loss: {
    recommend: 'affirm',
    caution: 'control',
    avoid: 'urgent',
  },
  muscle_gain: {
    recommend: 'encourage',
    caution: 'neutral',
    avoid: 'control',
  },
  health: {
    recommend: 'affirm',
    caution: 'neutral',
    avoid: 'control',
  },
  maintenance: {
    recommend: 'neutral',
    caution: 'control',
    avoid: 'urgent',
  },
  habit: {
    recommend: 'encourage',
    caution: 'neutral',
    avoid: 'neutral',
  },
};

/** coachFocus 信号对语气的覆盖规则（高优先级信号优先） */
const FOCUS_TONE_OVERRIDE: Record<string, ToneKey> = {
  health_constraint: 'urgent',
  over_limit: 'urgent',
  late_night_window: 'control',
  protein_gap: 'encourage',
};

// ==================== 服务 ====================

export interface ToneResolveInput {
  goalType?: string;
  verdict?: 'recommend' | 'caution' | 'avoid';
  coachFocus?: string;
  locale?: I18nLocale;
  /** V4.0: 用户执行率 (0-1)，影响语气强度 */
  executionRate?: number;
  /** V4.0: 连续天数 */
  streakDays?: number;
}

@Injectable()
export class DecisionToneResolverService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 解析最终语气修饰符字符串
   */
  resolve(input: ToneResolveInput): ToneResolution {
    const {
      goalType = 'health',
      verdict = 'caution',
      coachFocus,
      locale,
      executionRate,
      streakDays,
    } = input;

    // 1. 先检查 coachFocus 是否有覆盖语气
    const focusKey = coachFocus?.split(' ')[0]; // 取第一个词作为信号 key
    const signalOverride = focusKey ? FOCUS_TONE_OVERRIDE[focusKey] : undefined;
    if (signalOverride) {
      return {
        toneKey: signalOverride,
        // i18n-allow-dynamic
        toneModifier: this.i18n.t(`decision.tone.${signalOverride}`, locale),
      };
    }

    // 2. goalType × verdict 矩阵
    const goalMatrix = GOAL_VERDICT_TONE[goalType] ?? GOAL_VERDICT_TONE.health;
    let toneKey: ToneKey = goalMatrix[verdict] ?? 'neutral';

    // V4.0 P3.2: 根据 executionRate 调整语气
    // 高执行率(>80%) → 偏鼓励；低执行率(<50%) → 偏温和引导
    if (executionRate != null) {
      if (
        executionRate > 0.8 &&
        (toneKey === 'control' || toneKey === 'urgent')
      ) {
        toneKey = 'encourage';
      } else if (executionRate < 0.5 && toneKey === 'urgent') {
        toneKey = 'neutral'; // 低执行率时避免打击
      }
    }

    // i18n-allow-dynamic
    const baseTone = this.i18n.t(`decision.tone.${toneKey}`, locale);

    // V3.9 P3.1: 追加 goalType 专属语气补充
    // i18n-allow-dynamic
    const supplement = this.i18n.t(
      `decision.tone.supplement.${goalType}`,
      locale,
    );
    // 若 key 不存在，cl() 会返回 key 本身；此时跳过追加
    const hasSupplementKey = [
      'fat_loss',
      'muscle_gain',
      'health',
      'habit',
    ].includes(goalType);
    let toneModifier =
      hasSupplementKey && supplement ? `${baseTone}\n${supplement}` : baseTone;

    // V4.0 P3.2: 连续天数 > 7 天时追加激励
    if (streakDays != null && streakDays > 7) {
      const streakBoostText = this.i18n.t('decision.tone.streakBoost', locale, {
        days: streakDays,
      });
      toneModifier += '\n' + streakBoostText;
    }

    return {
      toneKey,
      toneModifier,
    };
  }

  /**
   * 仅返回语气修饰字符串（shorthand）
   */
  resolveModifier(input: ToneResolveInput): string {
    return this.resolve(input).toneModifier;
  }
}
