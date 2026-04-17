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
 */

import { Injectable } from '@nestjs/common';
import { UnifiedUserContext } from '../types/analysis-result.types';

type SummaryLocale = 'zh-CN' | 'en-US' | 'ja-JP';

@Injectable()
export class DailyMacroSummaryService {
  /**
   * 生成一段自然语言宏量摘要
   * @example zh-CN: "今天已摄入 1420 kcal（目标 1800），蛋白质差 28g，脂肪略超 8g。"
   */
  buildSummaryText(
    ctx: UnifiedUserContext,
    locale: SummaryLocale = 'zh-CN',
  ): string {
    const cal = Math.round(ctx.todayCalories);
    const goalCal = Math.round(ctx.goalCalories);
    const remCal = Math.round(ctx.remainingCalories);

    const proteinDiff = Math.round(ctx.remainingProtein);
    const fatDiff = Math.round(ctx.remainingFat);
    const carbDiff = Math.round(ctx.remainingCarbs);

    if (locale === 'en-US') {
      return this.buildEnglish(
        cal,
        goalCal,
        remCal,
        proteinDiff,
        fatDiff,
        carbDiff,
      );
    }
    if (locale === 'ja-JP') {
      return this.buildJapanese(
        cal,
        goalCal,
        remCal,
        proteinDiff,
        fatDiff,
        carbDiff,
      );
    }
    return this.buildChinese(
      cal,
      goalCal,
      remCal,
      proteinDiff,
      fatDiff,
      carbDiff,
    );
  }

  private buildChinese(
    cal: number,
    goalCal: number,
    remCal: number,
    proteinDiff: number,
    fatDiff: number,
    carbDiff: number,
  ): string {
    const calPart =
      remCal >= 0
        ? `今天已摄入 ${cal} kcal（目标 ${goalCal}），还剩 ${remCal} kcal`
        : `今天已摄入 ${cal} kcal，超出目标 ${Math.abs(remCal)} kcal`;

    const issues: string[] = [];
    if (proteinDiff > 5) issues.push(`蛋白质差 ${proteinDiff}g`);
    else if (proteinDiff < -5)
      issues.push(`蛋白质超 ${Math.abs(proteinDiff)}g`);
    if (fatDiff < -5) issues.push(`脂肪超 ${Math.abs(fatDiff)}g`);
    if (carbDiff < -5) issues.push(`碳水超 ${Math.abs(carbDiff)}g`);

    return issues.length > 0
      ? `${calPart}，${issues.join('，')}。`
      : `${calPart}，宏量均衡。`;
  }

  private buildEnglish(
    cal: number,
    goalCal: number,
    remCal: number,
    proteinDiff: number,
    fatDiff: number,
    carbDiff: number,
  ): string {
    const calPart =
      remCal >= 0
        ? `Today: ${cal} kcal consumed (goal ${goalCal}), ${remCal} kcal remaining`
        : `Today: ${cal} kcal consumed, ${Math.abs(remCal)} kcal over goal`;

    const issues: string[] = [];
    if (proteinDiff > 5) issues.push(`protein short ${proteinDiff}g`);
    else if (proteinDiff < -5)
      issues.push(`protein over ${Math.abs(proteinDiff)}g`);
    if (fatDiff < -5) issues.push(`fat over ${Math.abs(fatDiff)}g`);
    if (carbDiff < -5) issues.push(`carbs over ${Math.abs(carbDiff)}g`);

    return issues.length > 0
      ? `${calPart}; ${issues.join(', ')}.`
      : `${calPart}; macros balanced.`;
  }

  private buildJapanese(
    cal: number,
    goalCal: number,
    remCal: number,
    proteinDiff: number,
    fatDiff: number,
    carbDiff: number,
  ): string {
    const calPart =
      remCal >= 0
        ? `本日摂取 ${cal} kcal（目標 ${goalCal}）、残り ${remCal} kcal`
        : `本日摂取 ${cal} kcal、目標超過 ${Math.abs(remCal)} kcal`;

    const issues: string[] = [];
    if (proteinDiff > 5) issues.push(`たんぱく質 ${proteinDiff}g 不足`);
    else if (proteinDiff < -5)
      issues.push(`たんぱく質 ${Math.abs(proteinDiff)}g 超過`);
    if (fatDiff < -5) issues.push(`脂質 ${Math.abs(fatDiff)}g 超過`);
    if (carbDiff < -5) issues.push(`炭水化物 ${Math.abs(carbDiff)}g 超過`);

    return issues.length > 0
      ? `${calPart}、${issues.join('、')}。`
      : `${calPart}、マクロバランス良好。`;
  }
}
