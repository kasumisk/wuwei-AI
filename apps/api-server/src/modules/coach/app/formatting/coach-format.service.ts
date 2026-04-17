/**
 * V2.4 CoachFormatService
 *
 * 职责：统一所有文本格式化、多语言翻译、时间表示
 *
 * 关键方法：
 * - formatSuggestion(action, persona, lang) → string
 * - formatTimebound(hours, lang) → string
 * - formatNutrition(value, unit, lang) → string
 */

import { Injectable } from '@nestjs/common';
import { I18nManagementService } from '../../../../config/i18n-management.service';
import { CoachFormatOptions, FormattedCoachOutput } from './coach-format.types';
import { ci, toCoachLocale } from '../../../decision/coach/coach-i18n';

@Injectable()
export class CoachFormatService {
  private readonly i18nStrings = {
    zh: {
      'coach.header.should_eat': '建议现在吃',
      'coach.header.can_skip': '可以先不吃',
      'coach.header.should_avoid': '建议先不吃',
      'coach.reason.protein_needed': '你需要补充蛋白质',
      'coach.reason.energy_needed': '你还可以补充碳水和能量',
      'coach.reason.calorie_limit': '热量接近目标，建议先休息',
      'coach.timebound.hours': '接下来 {{hours}} 小时内',
      'coach.nutrition.calories': '{{value}} 卡路里',
      'coach.nutrition.protein': '{{value}}g 蛋白质',
      'coach.nutrition.fat': '{{value}}g 脂肪',
      'coach.nutrition.carbs': '{{value}}g 碳水',
      'coach.persona.strict': '严格控制',
      'coach.persona.friendly': '温和建议',
      'coach.persona.data': '数据分析',
    },
    en: {
      'coach.header.should_eat': 'Good to eat now',
      'coach.header.can_skip': 'You can skip for now',
      'coach.header.should_avoid': 'Better to avoid',
      'coach.reason.protein_needed': 'You need more protein',
      'coach.reason.energy_needed': 'You still have room for carbs and energy',
      'coach.reason.calorie_limit': 'Close to your calorie goal',
      'coach.timebound.hours': 'within {{hours}} hours',
      'coach.nutrition.calories': '{{value}} calories',
      'coach.nutrition.protein': '{{value}}g protein',
      'coach.nutrition.fat': '{{value}}g fat',
      'coach.nutrition.carbs': '{{value}}g carbs',
      'coach.persona.strict': 'Strict control',
      'coach.persona.friendly': 'Gentle advice',
      'coach.persona.data': 'Data-driven',
    },
    ja: {
      'coach.header.should_eat': '今食べても大丈夫です',
      'coach.header.can_skip': '今は食べなくてもいいでしょう',
      'coach.header.should_avoid': '今は避けた方が良いです',
      'coach.reason.protein_needed': 'タンパク質を補充する必要があります',
      'coach.reason.energy_needed': '炭水化物とエネルギーをまだ補充できます',
      'coach.reason.calorie_limit': 'カロリー目標に近づいています',
      'coach.timebound.hours': '次の {{hours}} 時間以内',
      'coach.nutrition.calories': '{{value}} カロリー',
      'coach.nutrition.protein': '{{value}}g タンパク質',
      'coach.nutrition.fat': '{{value}}g 脂肪',
      'coach.nutrition.carbs': '{{value}}g 炭水化物',
      'coach.persona.strict': '厳格なコントロール',
      'coach.persona.friendly': '穏やかなアドバイス',
      'coach.persona.data': 'データ駆動',
    },
  } as const;

  constructor(private readonly i18nManagementService: I18nManagementService) {}

  private resolveLanguage(language?: string): 'zh' | 'en' | 'ja' {
    if (language === 'en') return 'en';
    if (language === 'ja' || language === 'ja-JP') return 'ja';
    return 'zh';
  }

  /**
   * 格式化建议文本
   */
  formatSuggestion(
    action: 'should_eat' | 'can_skip' | 'should_avoid',
    options: CoachFormatOptions,
  ): string {
    const language = options.language || 'zh';
    const i18nKeyMap: Record<string, string> = {
      should_eat: 'action.should_eat',
      can_skip: 'action.can_skip',
      should_avoid: 'action.should_avoid',
    };
    const translated = this.i18nManagementService.translate(
      i18nKeyMap[action] || action,
      language,
    );

    if (translated !== i18nKeyMap[action]) {
      return translated;
    }

    const lang = this.resolveLanguage(language);
    const strings = this.i18nStrings[lang] || this.i18nStrings.zh;
    const key = `coach.header.${action}`;
    return strings[key] || `Unknown action: ${action}`;
  }

  /**
   * 格式化时间范围
   */
  formatTimebound(hours: number, language: 'en' | 'zh' | 'ja' = 'zh'): string {
    const translated = this.i18nManagementService.translate(
      'time.within_hours',
      language,
      { hours },
    );
    if (translated !== 'time.within_hours') {
      return translated;
    }

    const strings = this.i18nStrings[this.resolveLanguage(language)];
    return strings['coach.timebound.hours'].replace('{{hours}}', String(hours));
  }

  /**
   * 格式化营养值
   */
  formatNutrition(
    value: number,
    unit: string,
    language: 'en' | 'zh' | 'ja' = 'zh',
  ): string {
    const i18nKeyMap: Record<string, string> = {
      calories: 'coach.nutrition.calories',
      protein: 'coach.nutrition.protein',
      fat: 'coach.nutrition.fat',
      carbs: 'coach.nutrition.carbs',
    };
    const key = i18nKeyMap[unit] || `coach.nutrition.${unit}`;
    const translated = this.i18nManagementService.translate(key, language, {
      value: value.toFixed(1),
    });

    if (translated !== key) {
      return translated;
    }

    const strings = this.i18nStrings[this.resolveLanguage(language)];
    const template = strings[key];
    if (!template) return `${value}${unit}`;
    return template.replace('{{value}}', value.toFixed(1));
  }

  /**
   * 生成完整的教练输出
   */
  generateFormattedOutput(
    action: string,
    nutrition: any,
    options: CoachFormatOptions,
  ): FormattedCoachOutput {
    const suggestion = this.formatSuggestion(action as any, options);
    const lang = this.resolveLanguage(options.language);
    const calorieText = this.formatNutrition(
      nutrition.calories,
      'calories',
      lang,
    );
    const proteinText =
      typeof nutrition.protein === 'number'
        ? this.formatNutrition(nutrition.protein, 'protein', lang)
        : undefined;

    const reasons = this.resolveReasons(
      action,
      options,
      calorieText,
      proteinText,
    );
    const suggestions = this.resolveSuggestions(action, options, nutrition);
    const actionPlan = [suggestion, ...suggestions].join('。');

    // V2.7: 置信度标签
    const confidenceLabel = this.resolveConfidenceLabel(
      options.decisionConfidence,
    );
    // V2.7: 最低分评分洞察
    const scoreInsight = this.resolveScoreInsight(
      options.breakdownExplanations,
      options.language,
    );

    return {
      suggestion,
      actionPlan,
      encouragement: this.resolveEncouragement(options),
      conclusion: suggestion,
      reasons,
      suggestions,
      tone: options.persona,
      confidenceLabel,
      scoreInsight,
    };
  }

  private resolveReasons(
    action: string,
    options: CoachFormatOptions,
    calorieText: string,
    proteinText?: string,
  ): string[] {
    if (action === 'should_avoid') {
      return [
        ci('format.reason.pushOverload', toCoachLocale(options.language)),
        calorieText,
      ];
    }
    if (action === 'can_skip') {
      return [
        ci('format.reason.noSignal', toCoachLocale(options.language)),
        calorieText,
      ];
    }

    return [
      proteinText ||
        this.translate(
          'coach.reason.protein_needed',
          this.resolveLanguage(options.language),
        ),
      calorieText,
    ].filter(Boolean);
  }

  private resolveSuggestions(
    action: string,
    options: CoachFormatOptions,
    nutrition: any,
  ): string[] {
    if (action === 'should_avoid') {
      const lang = toCoachLocale(options.language);
      return [
        ci('format.suggestion.switchLighter', lang),
        ci('format.suggestion.reduceFirst', lang),
      ];
    }
    if (action === 'can_skip') {
      const lang = toCoachLocale(options.language);
      return [
        ci('format.suggestion.observeHunger', lang),
        ci('format.suggestion.nextMealProtein', lang),
      ];
    }

    const lang = toCoachLocale(options.language);
    const suggestions = [ci('format.suggestion.keepPace', lang)];
    if (typeof nutrition.protein === 'number' && nutrition.protein < 20) {
      suggestions.push(ci('format.suggestion.addProtein', lang));
    }
    return suggestions;
  }

  private resolveEncouragement(options: CoachFormatOptions): string {
    const lang = toCoachLocale(options.language);
    const toneMap: Record<CoachFormatOptions['persona'], string> = {
      strict: ci('format.encouragement.strict', lang),
      friendly: ci('format.encouragement.friendly', lang),
      data: ci('format.encouragement.data', lang),
    };

    return toneMap[options.persona];
  }

  /** V2.7: 将 decisionConfidence (0-1) 映射到三档置信标签 */
  private resolveConfidenceLabel(
    confidence?: number,
  ): 'low' | 'medium' | 'high' | undefined {
    if (confidence == null) return undefined;
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  }

  /** V2.7: 从 breakdownExplanations 提取最低分 critical/warning 维度洞察 */
  private resolveScoreInsight(
    breakdownExplanations?: CoachFormatOptions['breakdownExplanations'],
    language?: string,
  ): string | undefined {
    if (!breakdownExplanations || breakdownExplanations.length === 0)
      return undefined;
    const candidates = breakdownExplanations.filter(
      (b) => b.impact === 'critical' || b.impact === 'warning',
    );
    if (candidates.length === 0) return undefined;
    const worst = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
    const label = worst.label || worst.dimension;
    return worst.message
      ? ci('format.scoreInsight', toCoachLocale(language), {
          label,
          score: String(worst.score),
          message: worst.message,
        })
      : undefined;
  }

  /**
   * 翻译 i18n key
   */
  translate(
    key: string,
    language: 'en' | 'zh' | 'ja' = 'zh',
    variables?: Record<string, any>,
  ): string {
    const translated = this.i18nManagementService.translate(
      key,
      language,
      variables,
    );
    if (translated !== key) {
      return translated;
    }

    const strings =
      this.i18nStrings[this.resolveLanguage(language)] || this.i18nStrings.zh;
    let text = strings[key] || key;

    if (variables) {
      Object.entries(variables).forEach(([varKey, varValue]) => {
        text = text.replace(`{{${varKey}}}`, String(varValue));
      });
    }

    return text;
  }
}
