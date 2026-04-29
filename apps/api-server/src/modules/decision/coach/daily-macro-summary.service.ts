/**
 * V3.1 Phase 2 — 每日宏量摘要文本服务
 *
 * 基于 UnifiedUserContext 的宏量数据，生成自然语言摘要文本。
 * 直接嵌入 coach prompt，减少 AI 自推断误差。
 *
 * 设计原则:
 * - 纯函数，无 IO
 * - 支持 zh-CN / en-US / ja-JP
 * - 文本精简（≤ 2 句），不超过 60 token
 *
 * V4.2 P3.3: 迁移到 ci(this.i18n, ) i18n 系统
 */

import { Injectable } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { UnifiedUserContext } from '../types/analysis-result.types';
import { I18nService } from '../../../core/i18n';
import { ci, CoachLocale } from './coach-i18n';

type SummaryLocale = 'zh-CN' | 'en-US' | 'ja-JP';

const LOCALE_TO_COACH: Record<SummaryLocale, CoachLocale> = {
  'zh-CN': 'zh',
  'en-US': 'en',
  'ja-JP': 'ja',
};

function resolveSummaryLocale(locale?: SummaryLocale): SummaryLocale {
  if (locale === 'en-US' || locale === 'zh-CN' || locale === 'ja-JP') {
    return locale;
  }

  try {
    const raw = ClsServiceManager.getClsService()?.get('locale');
    if (raw === 'en-US' || raw === 'zh-CN' || raw === 'ja-JP') {
      return raw;
    }
  } catch {
    // Ignore missing CLS context and fallback below.
  }

  return 'zh-CN';
}

@Injectable()
export class DailyMacroSummaryService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 生成一段自然语言宏量摘要
   * @example zh-CN: "今天已摄入 1420 kcal（目标 1800），蛋白质差 28g，脂肪略超 8g。"
   */
  buildSummaryText(ctx: UnifiedUserContext, locale?: SummaryLocale): string {
    const cal = Math.round(ctx.todayCalories);
    const goalCal = Math.round(ctx.goalCalories);
    const remCal = Math.round(ctx.remainingCalories);

    const proteinDiff = Math.round(ctx.remainingProtein);
    const fatDiff = Math.round(ctx.remainingFat);
    const carbDiff = Math.round(ctx.remainingCarbs);

    const lang = LOCALE_TO_COACH[resolveSummaryLocale(locale)] ?? 'zh';

    const calPart =
      remCal >= 0
        ? ci(this.i18n, 'macro.calRemaining', lang, {
            cal,
            goal: goalCal,
            rem: remCal,
          })
        : ci(this.i18n, 'macro.calOver', lang, { cal, over: Math.abs(remCal) });

    const issues: string[] = [];
    if (proteinDiff > 5)
      issues.push(
        ci(this.i18n, 'macro.proteinShort', lang, { val: proteinDiff }),
      );
    else if (proteinDiff < -5)
      issues.push(
        ci(this.i18n, 'macro.proteinOver', lang, {
          val: Math.abs(proteinDiff),
        }),
      );
    if (fatDiff < -5)
      issues.push(
        ci(this.i18n, 'macro.fatOver', lang, { val: Math.abs(fatDiff) }),
      );
    if (carbDiff < -5)
      issues.push(
        ci(this.i18n, 'macro.carbsOver', lang, { val: Math.abs(carbDiff) }),
      );

    const sep = lang === 'en' ? '; ' : '，';
    const end = lang === 'en' ? '.' : '。';

    return issues.length > 0
      ? `${calPart}${sep}${issues.join(lang === 'en' ? ', ' : '，')}${end}`
      : `${calPart}${sep}${ci(this.i18n, 'macro.balanced', lang)}${end}`;
  }
}
