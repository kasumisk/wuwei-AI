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
 */

import { Injectable } from '@nestjs/common';

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
    caution:   'control',
    avoid:     'urgent',
  },
  muscle_gain: {
    recommend: 'encourage',
    caution:   'neutral',
    avoid:     'control',
  },
  health: {
    recommend: 'affirm',
    caution:   'neutral',
    avoid:     'control',
  },
  maintenance: {
    recommend: 'neutral',
    caution:   'control',
    avoid:     'urgent',
  },
  habit: {
    recommend: 'encourage',
    caution:   'neutral',
    avoid:     'neutral',
  },
};

/** coachFocus 信号对语气的覆盖规则（高优先级信号优先） */
const FOCUS_TONE_OVERRIDE: Record<string, ToneKey> = {
  health_constraint: 'urgent',
  over_limit:        'urgent',
  late_night_window: 'control',
  protein_gap:       'encourage',
};

/** toneKey → 多语言修饰字符串 */
const TONE_MODIFIER_TEXT: Record<ToneKey, Record<string, string>> = {
  urgent: {
    'zh-CN': '请以紧迫且关切的语气，优先强调风险，建议立刻行动。',
    'en-US': 'Use an urgent and concerned tone. Emphasize risks first and suggest immediate action.',
    'ja-JP': '緊迫感を持って関心を示し、リスクを優先して即座な行動を促してください。',
  },
  control: {
    'zh-CN': '请以控制型语气，帮助用户克制冲动，聚焦于目标管理。',
    'en-US': 'Use a firm, controlling tone to help the user resist impulses and focus on goal management.',
    'ja-JP': 'コントロール型の語調で、ユーザーの衝動を抑え、目標管理に集中させてください。',
  },
  encourage: {
    'zh-CN': '请以鼓励型语气，肯定用户的努力，给出正向激励和可执行建议。',
    'en-US': 'Use an encouraging tone. Acknowledge the user\'s efforts and provide positive motivation with actionable advice.',
    'ja-JP': '励ます語調で、ユーザーの努力を認め、ポジティブな動機付けと実行可能なアドバイスを提供してください。',
  },
  affirm: {
    'zh-CN': '请以肯定语气，让用户感到选择正确并强化好习惯。',
    'en-US': 'Use an affirming tone. Make the user feel their choice is correct and reinforce good habits.',
    'ja-JP': '肯定的な語調で、ユーザーの選択が正しいと感じさせ、良い習慣を強化してください。',
  },
  neutral: {
    'zh-CN': '请保持中立客观语气，提供数据支撑的分析和具体建议。',
    'en-US': 'Use a neutral and objective tone. Provide data-supported analysis and specific recommendations.',
    'ja-JP': '中立的かつ客観的な語調で、データに基づく分析と具体的なアドバイスを提供してください。',
  },
};

// ==================== 服务 ====================

export interface ToneResolveInput {
  goalType?: string;
  verdict?: 'recommend' | 'caution' | 'avoid';
  coachFocus?: string;
  locale?: string;
}

@Injectable()
export class DecisionToneResolverService {
  /**
   * 解析最终语气修饰符字符串
   */
  resolve(input: ToneResolveInput): ToneResolution {
    const { goalType = 'health', verdict = 'caution', coachFocus, locale = 'zh-CN' } = input;

    // 1. 先检查 coachFocus 是否有覆盖语气
    const focusKey = coachFocus?.split(' ')[0]; // 取第一个词作为信号 key
    const signalOverride = focusKey ? FOCUS_TONE_OVERRIDE[focusKey] : undefined;
    if (signalOverride) {
      return {
        toneKey: signalOverride,
        toneModifier: TONE_MODIFIER_TEXT[signalOverride][locale] ?? TONE_MODIFIER_TEXT[signalOverride]['zh-CN'],
      };
    }

    // 2. goalType × verdict 矩阵
    const goalMatrix = GOAL_VERDICT_TONE[goalType] ?? GOAL_VERDICT_TONE.health;
    const toneKey: ToneKey = goalMatrix[verdict] ?? 'neutral';

    return {
      toneKey,
      toneModifier: TONE_MODIFIER_TEXT[toneKey][locale] ?? TONE_MODIFIER_TEXT[toneKey]['zh-CN'],
    };
  }

  /**
   * 仅返回语气修饰字符串（shorthand）
   */
  resolveModifier(input: ToneResolveInput): string {
    return this.resolve(input).toneModifier;
  }
}
