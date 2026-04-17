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
import { CoachFormatOptions, FormattedCoachOutput } from './coach-format.types';

@Injectable()
export class CoachFormatService {
  private i18nStrings = {
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
  };

  /**
   * 格式化建议文本
   */
  formatSuggestion(
    action: 'should_eat' | 'can_skip' | 'should_avoid',
    options: CoachFormatOptions,
  ): string {
    const lang = options.language || 'zh';
    const strings = this.i18nStrings[lang] || this.i18nStrings.zh;
    const key = `coach.header.${action}`;
    return strings[key] || `Unknown action: ${action}`;
  }

  /**
   * 格式化时间范围
   */
  formatTimebound(hours: number, language: 'en' | 'zh' = 'zh'): string {
    const strings = this.i18nStrings[language];
    const template = strings['coach.timebound.hours'];
    return template.replace('{{hours}}', String(hours));
  }

  /**
   * 格式化营养值
   */
  formatNutrition(value: number, unit: string, language: 'en' | 'zh' = 'zh'): string {
    const strings = this.i18nStrings[language];
    const unitKeys = {
      calories: 'coach.nutrition.calories',
      protein: 'coach.nutrition.protein',
      fat: 'coach.nutrition.fat',
      carbs: 'coach.nutrition.carbs',
    };
    const key = unitKeys[unit] || `coach.nutrition.${unit}`;
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
    const lang = (options.language === 'zh' || options.language === 'en') ? options.language : 'zh';
    const actionPlan = `${suggestion}。${this.formatNutrition(nutrition.calories, 'calories', lang)}`;

    return {
      suggestion,
      actionPlan,
      encouragement: `使用${options.persona}模式`,
    };
  }

  /**
   * 翻译 i18n key
   */
  translate(key: string, language: 'en' | 'zh' = 'zh', variables?: Record<string, any>): string {
    const strings = this.i18nStrings[language] || this.i18nStrings.zh;
    let text = strings[key] || key;

    if (variables) {
      Object.entries(variables).forEach(([varKey, varValue]) => {
        text = text.replace(`{{${varKey}}}`, String(varValue));
      });
    }

    return text;
  }
}
