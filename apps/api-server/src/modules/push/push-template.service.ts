import { Injectable } from '@nestjs/common';
import { PushNotificationType } from './push.types';

interface PushTemplate {
  title: string;
  body: string;
}

@Injectable()
export class PushTemplateService {
  render(type: PushNotificationType, locale = 'en'): PushTemplate {
    const language = locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    return language === 'zh' ? this.renderZh(type) : this.renderEn(type);
  }

  private renderEn(type: PushNotificationType): PushTemplate {
    switch (type) {
      case PushNotificationType.DAILY_CHECK_IN:
        return {
          title: 'Ready for today?',
          body: 'Smarter food choices, every day. Log your first meal when you are ready.',
        };
      case PushNotificationType.NO_ANALYSIS_TODAY:
        return {
          title: 'A quick food check can help',
          body: 'No analysis yet today. EatCheck can help you compare choices before your next meal.',
        };
      case PushNotificationType.WEEKLY_REPORT_READY:
        return {
          title: 'Your weekly food insights are ready',
          body: 'See patterns from your week and plan the next small improvement.',
        };
      case PushNotificationType.ANALYSIS_FOLLOW_UP:
        return {
          title: 'Follow up on your food analysis',
          body: 'Review the result and save what you actually ate to keep your insights accurate.',
        };
      case PushNotificationType.PREMIUM_UPGRADE_HINT:
        return {
          title: 'Unlock deeper food insights',
          body: 'Premium adds advanced analysis and history to support better everyday choices.',
        };
    }
  }

  private renderZh(type: PushNotificationType): PushTemplate {
    switch (type) {
      case PushNotificationType.DAILY_CHECK_IN:
        return {
          title: '今天准备好了吗？',
          body: 'Smarter food choices, every day. 记录第一餐，开启今天的饮食洞察。',
        };
      case PushNotificationType.NO_ANALYSIS_TODAY:
        return {
          title: '餐前快速分析一下',
          body: '今天还没有分析记录。EatCheck 可以帮你在下一餐前比较选择。',
        };
      case PushNotificationType.WEEKLY_REPORT_READY:
        return {
          title: '你的每周饮食洞察已生成',
          body: '查看本周饮食模式，为下一步小改进做计划。',
        };
      case PushNotificationType.ANALYSIS_FOLLOW_UP:
        return {
          title: '回顾你的饮食分析',
          body: '查看结果并保存实际进食记录，让后续洞察更准确。',
        };
      case PushNotificationType.PREMIUM_UPGRADE_HINT:
        return {
          title: '解锁更深入的饮食洞察',
          body: 'Premium 提供高级分析与完整历史，帮助你做出更好的日常选择。',
        };
    }
  }
}
