/**
 * V2.4 I18n Service
 * 
 * 职责：统一管理多语言翻译、i18n key 映射
 */

import { Injectable } from '@nestjs/common';
import { EXTENDED_I18N_TRANSLATIONS } from './extended-i18n';

@Injectable()
export class I18nService {
  private readonly translations = {
    zh: {
      // 决策理由
      'decision.reason.protein_deficit': '你需要补充蛋白质',
      'decision.reason.protein_deficit_high': '你缺少蛋白质（超过20克）',
      'decision.reason.carbs_needed': '你还可以补充碳水和能量',
      'decision.reason.calorie_limit': '热量接近目标，建议先别吃',
      'decision.reason.calorie_limit_reached': '热量已满，建议先不吃',
      'decision.reason.fat_excess': '脂肪摄入过高',
      'decision.reason.no_deficit': '暂无特殊营养需求',
      'decision.reason.user_preference': '你喜欢这个食物',

      // 决策行动
      'decision.action.must_eat': '建议现在吃',
      'decision.action.should_eat': '可以吃',
      'decision.action.can_skip': '可以先不吃',
      'decision.action.should_avoid': '建议先不吃',

      // 评分问题
      'scoring.issue.protein_deficit': '蛋白质不足',
      'scoring.issue.protein_deficit_high': '蛋白质严重不足',
      'scoring.issue.protein_deficit_medium': '蛋白质不足',
      'scoring.issue.protein_deficit_low': '蛋白质略低',
      'scoring.issue.fat_excess': '脂肪过高',
      'scoring.issue.carbs_excess': '碳水过高',
      'scoring.issue.calories_over': '热量超标',
      'scoring.issue.fiber_low': '纤维素不足',

      // 教练提示
      'coach.suggestion.protein': '补充蛋白质对肌肉恢复很重要',
      'coach.suggestion.balance': '保持营养均衡很关键',
      'coach.timebound.hours': '接下来 {{hours}} 小时内',
      'coach.nutrition.calories': '{{value}} 卡路里',
      'coach.nutrition.protein': '{{value}}g 蛋白质',

      // 替代方案
      'alternative.reason.similar_nutrition': '营养价值相近',
      'alternative.reason.lower_fat': '脂肪更低',
      'alternative.reason.higher_protein': '蛋白质更高',
    },
    en: {
      // 决策理由
      'decision.reason.protein_deficit': 'You need more protein',
      'decision.reason.protein_deficit_high': 'You lack protein (more than 20g)',
      'decision.reason.carbs_needed': 'You can still consume carbs and energy',
      'decision.reason.calorie_limit': 'Approaching calorie goal, better to skip',
      'decision.reason.calorie_limit_reached': 'Calorie goal reached, skip for now',
      'decision.reason.fat_excess': 'Fat intake is too high',
      'decision.reason.no_deficit': 'No special nutrition needs',
      'decision.reason.user_preference': 'You like this food',

      // 决策行动
      'decision.action.must_eat': 'Good to eat now',
      'decision.action.should_eat': 'You can eat',
      'decision.action.can_skip': 'You can skip',
      'decision.action.should_avoid': 'Better to avoid',

      // 评分问题
      'scoring.issue.protein_deficit': 'Protein deficit',
      'scoring.issue.protein_deficit_high': 'Severe protein deficit',
      'scoring.issue.protein_deficit_medium': 'Protein deficit',
      'scoring.issue.protein_deficit_low': 'Protein slightly low',
      'scoring.issue.fat_excess': 'Fat excess',
      'scoring.issue.carbs_excess': 'Carbs excess',
      'scoring.issue.calories_over': 'Calorie exceeded',
      'scoring.issue.fiber_low': 'Fiber too low',

      // 教练提示
      'coach.suggestion.protein': 'Protein is crucial for muscle recovery',
      'coach.suggestion.balance': 'Balanced nutrition is key',
      'coach.timebound.hours': 'Within {{hours}} hours',
      'coach.nutrition.calories': '{{value}} calories',
      'coach.nutrition.protein': '{{value}}g protein',

      // 替代方案
      'alternative.reason.similar_nutrition': 'Similar nutrition value',
      'alternative.reason.lower_fat': 'Lower fat',
      'alternative.reason.higher_protein': 'Higher protein',
    },
    ja: {},
    ko: {},
    'pt-BR': {},
  };

  private readonly aliasMap: Record<string, keyof typeof this.translations> = {
    zh: 'zh',
    'zh-cn': 'zh',
    'zh-tw': 'zh',
    en: 'en',
    'en-us': 'en',
    ja: 'ja',
    'ja-jp': 'ja',
    ko: 'ko',
    'ko-kr': 'ko',
    pt: 'pt-BR',
    'pt-br': 'pt-BR',
  };

  constructor() {
    this.translations.zh = {
      ...EXTENDED_I18N_TRANSLATIONS.zh,
      ...this.translations.zh,
    };
    this.translations.en = {
      ...EXTENDED_I18N_TRANSLATIONS.en,
      ...this.translations.en,
    };
    this.translations.ja = {
      ...EXTENDED_I18N_TRANSLATIONS.ja,
      ...this.translations.ja,
    };
    this.translations.ko = {
      ...EXTENDED_I18N_TRANSLATIONS.ko,
      ...this.translations.ko,
    };
  }

  private normalizeLanguage(language?: string): keyof typeof this.translations {
    const normalized = (language || 'zh').toLowerCase();
    return this.aliasMap[normalized] || 'zh';
  }

  /**
   * 获取翻译字符串
   */
  translate(key: string, language: string = 'zh', variables?: Record<string, any>): string {
    const lang = this.translations[this.normalizeLanguage(language)] || this.translations.zh;
    let text = lang[key] || key;

    // 替换变量占位符
    if (variables) {
      Object.entries(variables).forEach(([varKey, varValue]) => {
        text = text.replace(`{{${varKey}}}`, String(varValue));
      });
    }

    return text;
  }

  /**
   * 批量翻译
   */
  translateBatch(keys: string[], language: string = 'zh'): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    keys.forEach(key => {
      result[key] = this.translate(key, language);
    });
    return result;
  }

  /**
   * 获取支持的语言列表
   */
  getSupportedLanguages(): string[] {
    return ['zh', 'en', 'ja', 'ko', 'pt-BR'];
  }
}
