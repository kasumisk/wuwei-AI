/**
 * V5.0 P3.2 — Decision Coach i18n (thin wrapper over cl())
 *
 * All translations now live in labels-zh/en/ja.ts under the `coach.*` namespace.
 * This file retains the CoachLocale type, CoachI18nStrings interface, ci() helper,
 * and toCoachLocale() for backward compatibility — but ci() delegates to cl().
 */

import { cl } from '../i18n/decision-labels';

// ── Types ──

export type CoachLocale = 'zh' | 'en' | 'ja';

export interface CoachI18nStrings {
  // ── Headlines ──
  'headline.balanced': string;
  'headline.minor_adjust': string;
  'headline.balanced.strict': string;
  'headline.balanced.encouraging': string;
  'headline.minor_adjust.strict': string;
  'headline.minor_adjust.encouraging': string;
  'headline.protein_deficit': string;
  'headline.carb_excess': string;
  'headline.sodium_excess': string;
  'headline.fiber_deficit': string;
  'headline.sugar_excess': string;
  'headline.fat_excess': string;
  'headline.calorie_excess': string;
  'headline.generic': string;
  // ── Issue explanations ({metric} {threshold}) ──
  'explain.protein_deficit': string;
  'explain.carb_excess': string;
  'explain.sodium_excess': string;
  'explain.fiber_deficit': string;
  'explain.sugar_excess': string;
  'explain.fat_excess': string;
  'explain.calorie_excess': string;
  // ── Action suggestions ──
  'action.protein_deficit': string;
  'action.carb_excess': string;
  'action.sodium_excess': string;
  'action.fiber_deficit': string;
  'action.sugar_excess': string;
  'action.fat_excess': string;
  'action.calorie_excess': string;
  'action.generic': string;
  // ── Status summary ({protein} {carbs} {fat} {issueCount}) ──
  'summary.template': string;
  'summary.no_slots': string;
  // ── General guidance ──
  'guidance.base': string;
  'guidance.protein': string;
  'guidance.carbs': string;
  'guidance.fat': string;
  'guidance.close': string;
  'guidance.close.strict': string;
  'guidance.close.encouraging': string;
  // ── Education ──
  'edu.protein.topic': string;
  'edu.protein.why': string;
  'edu.protein.fix': string;
  'edu.fiber.topic': string;
  'edu.fiber.why': string;
  'edu.fiber.fix': string;
  'edu.sugar.topic': string;
  'edu.sugar.why': string;
  'edu.sugar.fix': string;
  'edu.balanced.topic': string;
  'edu.balanced.why': string;
  'edu.balanced.fix': string;
  // CoachFormat
  'format.reason.pushOverload': string;
  'format.reason.noSignal': string;
  'format.suggestion.switchLighter': string;
  'format.suggestion.reduceFirst': string;
  'format.suggestion.observeHunger': string;
  'format.suggestion.nextMealProtein': string;
  'format.suggestion.keepPace': string;
  'format.suggestion.addProtein': string;
  'format.encouragement.strict': string;
  'format.encouragement.friendly': string;
  'format.encouragement.data': string;
  'format.scoreInsight': string;
  // ContextualModifier
  'modifier.cumulativeSaturation': string;
  'modifier.lateNightRisk': string;
  'modifier.multiDayExcess': string;
  'modifier.healthyStreak': string;
  'modifier.bingeRisk': string;
  'modifier.bingeRiskReason': string;
  'modifier.lowConfidence': string;
  'modifier.bingeRiskHour': string;
  'modifier.trendIncreasing': string;
  // Coach Insight
  'insight.slot.protein.deficit': string;
  'insight.slot.protein.normal': string;
  'insight.slot.protein.excess': string;
  'insight.slot.carbs.deficit': string;
  'insight.slot.carbs.normal': string;
  'insight.slot.carbs.excess': string;
  'insight.slot.fat.deficit': string;
  'insight.slot.fat.normal': string;
  'insight.slot.fat.excess': string;
  'insight.trendPrefix': string;
  'insight.goal.fat_loss': string;
  'insight.goal.muscle_gain': string;
  'insight.goal.maintenance': string;
  'insight.goal.maintain': string;
  'insight.goal.health': string;
  'insight.goal.habit': string;
  'insight.timing.morning': string;
  'insight.timing.lunch': string;
  'insight.timing.afternoon': string;
  'insight.timing.evening': string;
  'insight.timing.late_night': string;
  // DailyMacroSummary
  'macro.calRemaining': string;
  'macro.calOver': string;
  'macro.proteinShort': string;
  'macro.proteinOver': string;
  'macro.fatOver': string;
  'macro.carbsOver': string;
  'macro.balanced': string;
  // ActionPlan
  'actionPlan.immediate.avoid': string;
  'actionPlan.immediate.caution': string;
  'actionPlan.immediate.recommend': string;
  'actionPlan.nextMeal.fat_loss': string;
  'actionPlan.nextMeal.muscle_gain': string;
  'actionPlan.nextMeal.health': string;
  'actionPlan.nextMeal.maintain': string;
  'actionPlan.nextMeal.habit': string;
  'actionPlan.nextMeal.default': string;
  'actionPlan.longTerm.fat_loss': string;
  'actionPlan.longTerm.muscle_gain': string;
  'actionPlan.longTerm.health': string;
  'actionPlan.longTerm.maintain': string;
  'actionPlan.longTerm.habit': string;
  'actionPlan.longTerm.default': string;
  // V4.6: Health risk
  'headline.health_risk': string;
  'explain.health_risk': string;
  'action.health_risk': string;
  'edu.gout.topic': string;
  'edu.gout.why': string;
  'edu.gout.fix': string;
  'edu.ibs.topic': string;
  'edu.ibs.why': string;
  'edu.ibs.fix': string;
  'edu.kidneyStone.topic': string;
  'edu.kidneyStone.why': string;
  'edu.kidneyStone.fix': string;
  'edu.transFat.topic': string;
  'edu.transFat.why': string;
  'edu.transFat.fix': string;
  'edu.cholesterol.topic': string;
  'edu.cholesterol.why': string;
  'edu.cholesterol.fix': string;
  'edu.glycemicLoad.topic': string;
  'edu.glycemicLoad.why': string;
  'edu.glycemicLoad.fix': string;
  'actionPlan.trendUp.immediate': string;
  'actionPlan.lowExecution.longTerm': string;
  'insight.healthRiskPrefix': string;
}

// ── BCP-47 locale mapping ──

const COACH_LOCALE_BCP47: Record<CoachLocale, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
};

/**
 * Coach i18n helper — thin wrapper over cl().
 * Prefixes key with `coach.`, maps CoachLocale → BCP-47, then delegates to cl().
 */
export function ci(
  key: keyof CoachI18nStrings,
  locale: CoachLocale = 'zh',
  vars?: Record<string, string | number>,
): string {
  const bcp47 = COACH_LOCALE_BCP47[locale] ?? 'zh-CN';
  let text = cl(`coach.${key}`, bcp47 as any);

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

/**
 * Map Locale (from i18n-messages) to CoachLocale.
 */
export function toCoachLocale(locale?: string): CoachLocale {
  if (locale === 'en' || locale === 'en-US') return 'en';
  if (locale === 'ja' || locale === 'ja-JP') return 'ja';
  if (locale === 'zh' || locale === 'zh-CN') return 'zh';
  return 'zh';
}
