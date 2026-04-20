/**
 * V2.2 Phase 1.5 — 共享决策检查纯函数（动态阈值版）
 *
 * V4.7 P2.1: 按职责拆分为 4 个子文件，本文件作为聚合入口 barrel re-export。
 *
 * 设计原则:
 * - 每个检查函数返回 CheckResult | null（null = 未触发）
 * - 纯函数，无副作用，可独立测试
 * - computeDecision 和 identifyIssues 都调用这些函数，消除重复
 */
import {
  DietIssue,
  NutritionTotals,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { UserThresholds } from '../config/dynamic-thresholds.service';

// ==================== 输出类型 ====================

export interface CheckResult {
  /** 是否触发 */
  triggered: boolean;
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 如果需要覆盖决策（仅 allergen/restriction 使用） */
  decisionOverride?: 'avoid' | 'caution';
  /** 对应的 DietIssue */
  issue?: DietIssue;
  /** 上下文原因文本（追加到 contextReasons） */
  reason?: string;
}

// ==================== 食物项最小接口 ====================

export interface CheckableFoodItem {
  name: string;
  category?: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sodium?: number;
  addedSugar?: number | null;
  /** 食物库过敏原字段（优先用于过敏原判断，无此字段时退化到名称关键字匹配） */
  allergens?: string[];
  // ── 健康状况检查所需扩展字段 ──
  /** 饱和脂肪 (g/100g) */
  saturatedFat?: number | null;
  /** 嘌呤 (mg/100g) — 数值型，旧路径 */
  purine?: number | null;
  /** 钾 (mg/100g) */
  potassium?: number | null;
  /** 磷 (mg/100g) */
  phosphorus?: number | null;
  /** 膳食纤维 (g/100g) */
  fiber?: number | null;
  /** 钙 (mg/100g) */
  calcium?: number | null;
  /** 铁 (mg/100g) */
  iron?: number | null;
  /** 血糖指数 */
  glycemicIndex?: number | null;
  /** FODMAP 等级: 'low' | 'medium' | 'high' */
  fodmapLevel?: 'low' | 'medium' | 'high' | null;
  /** 食物标签数组 */
  tags?: string[];

  // ── V4.6: 新增风险标记字段 ──
  /** V4.6: 反式脂肪 (g) */
  transFat?: number | null;
  /** V4.6: 胆固醇 (mg) */
  cholesterol?: number | null;
  /** V4.6: 草酸等级（肾结石风险） */
  oxalateLevel?: 'low' | 'medium' | 'high' | null;
  /** V4.6: 嘌呤等级（痛风风险，V4.6 枚举型，优先于数值型 purine） */
  purineLevel?: 'low' | 'medium' | 'high' | null;
  /** V4.6: 血糖负荷 */
  glycemicLoad?: number | null;
}

// ==================== V4.7 P2.1: 从子文件 re-export ====================

export {
  checkCalorieOverrun,
  checkProteinDeficit,
  checkFatExcess,
  checkCarbExcess,
  checkLateNight,
} from './checks/budget-timing-checks';

export {
  checkAllergenConflict,
  ALLERGEN_EXPAND,
  matchAllergenInFoods,
} from './checks/allergen-checks';

export { checkRestrictionConflict } from './checks/restriction-checks';

export { checkHealthConditionRisk } from './checks/health-condition-checks';

// V4.7 P2.4: buildConflictReport 提取为独立文件
export { buildConflictReport } from './conflict-report-builder';

// ==================== 聚合运行器 ====================

// 延迟导入以避免循环依赖
import {
  checkCalorieOverrun,
  checkProteinDeficit,
  checkFatExcess,
  checkCarbExcess,
  checkLateNight,
} from './checks/budget-timing-checks';
import { checkAllergenConflict } from './checks/allergen-checks';
import { checkRestrictionConflict } from './checks/restriction-checks';
import { checkHealthConditionRisk } from './checks/health-condition-checks';

/**
 * 运行所有检查并收集结果
 * V2.2: 传递 UserThresholds
 */
export function runAllChecks(
  foods: CheckableFoodItem[],
  totals: NutritionTotals,
  ctx: UnifiedUserContext,
  locale?: Locale,
  thresholds?: UserThresholds,
): { issues: DietIssue[]; reasons: string[] } {
  const issues: DietIssue[] = [];
  const reasons: string[] = [];

  const checks: Array<CheckResult | null> = [
    checkCalorieOverrun(totals, ctx, locale, thresholds),
    checkProteinDeficit(totals, ctx, locale, thresholds),
    checkFatExcess(totals, ctx, locale, thresholds),
    checkCarbExcess(totals, ctx, locale, thresholds),
    checkLateNight(totals, ctx, locale, thresholds),
    checkAllergenConflict(foods, ctx, locale),
    checkRestrictionConflict(foods, ctx, locale),
  ];

  // Health condition checks return array
  const healthChecks = checkHealthConditionRisk(foods, ctx, locale, thresholds);

  for (const check of [...checks, ...healthChecks]) {
    if (check?.triggered) {
      if (check.issue) issues.push(check.issue);
      if (check.reason) reasons.push(check.reason);
    }
  }

  return { issues, reasons };
}
