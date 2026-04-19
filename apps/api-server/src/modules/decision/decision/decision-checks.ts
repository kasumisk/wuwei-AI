/**
 * V2.2 Phase 1.5 — 共享决策检查纯函数（动态阈值版）
 *
 * V2.0 原版使用硬编码绝对值（15g 蛋白、30g 脂肪、300kcal 等），
 * V2.2 改为接收 UserThresholds 参数，所有阈值由调用方动态计算。
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
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
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
}

// ==================== 内部辅助 ====================

function buildFoodTexts(foods: CheckableFoodItem[]): string {
  return foods
    .map((f) => `${f.name} ${f.category || ''}`.toLowerCase())
    .join(' ');
}

// ==================== 检查函数 ====================

/**
 * 热量超标检查
 * V2.2: overBudgetMargin 改为动态阈值（原 -100kcal）
 */
export function checkCalorieOverrun(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'remainingCalories'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const remainingAfter = ctx.remainingCalories - totals.calories;
  const margin = thresholds?.overBudgetMargin ?? 100;

  if (remainingAfter < -margin) {
    const excess = Math.abs(Math.round(remainingAfter));
    return {
      triggered: true,
      severity: 'critical',
      reason: t(
        'decision.context.overBudget',
        { amount: String(excess) },
        locale,
      ),
      issue: {
        category: 'calorie_excess',
        severity: 'critical',
        message: t(
          'decision.context.overBudget',
          { amount: String(excess) },
          locale,
        ),
        data: {
          excess,
          mealCalories: Math.round(totals.calories),
          remaining: Math.round(ctx.remainingCalories),
        },
      },
    };
  }

  if (remainingAfter < 0) {
    return {
      triggered: true,
      severity: 'warning',
      reason: t('decision.context.nearLimit', {}, locale),
      issue: {
        category: 'calorie_excess',
        severity: 'warning',
        message: t('decision.context.nearLimit', {}, locale),
        data: {
          excess: Math.abs(Math.round(remainingAfter)),
          mealCalories: Math.round(totals.calories),
        },
      },
    };
  }

  return null;
}

/**
 * 蛋白质不足检查
 * V2.2: 15g → thresholds.lowProteinMeal, 300kcal → thresholds.significantMealCal
 */
export function checkProteinDeficit(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const lowProtein = thresholds?.lowProteinMeal ?? 15;
  const significantCal = thresholds?.significantMealCal ?? 300;

  if (
    totals.protein < lowProtein &&
    totals.calories > significantCal &&
    (ctx.goalType === 'fat_loss' || ctx.goalType === 'muscle_gain')
  ) {
    const actual = Math.round(totals.protein);
    const recommended = Math.round(lowProtein);
    // 量化：在基础 i18n 文案后附带实际值 vs 推荐值
    const quantSuffix =
      locale === 'en-US'
        ? ` (${actual}g / recommended ${recommended}g)`
        : locale === 'ja-JP'
          ? `（${actual}g / 推奨${recommended}g）`
          : `（${actual}g / 推荐${recommended}g）`;
    const msgBase = t('decision.context.lowProtein', {}, locale);
    return {
      triggered: true,
      severity: ctx.goalType === 'muscle_gain' ? 'critical' : 'warning',
      reason: msgBase + quantSuffix,
      issue: {
        category: 'protein_deficit',
        severity: ctx.goalType === 'muscle_gain' ? 'critical' : 'warning',
        message: msgBase + quantSuffix,
        data: {
          actual,
          recommended,
        },
      },
    };
  }
  return null;
}

/**
 * 脂肪超标检查
 * V2.2: 30g → thresholds.highFatMeal, 130% → thresholds.fatCriticalRatio
 */
export function checkFatExcess(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType' | 'todayFat' | 'goalFat'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const highFat = thresholds?.highFatMeal ?? 30;
  const excessRatio = (thresholds?.fatExcessRatio ?? 1.0) * 100;
  const criticalRatio = (thresholds?.fatCriticalRatio ?? 1.3) * 100;

  const projectedFatPct =
    ctx.goalFat > 0 ? ((ctx.todayFat + totals.fat) / ctx.goalFat) * 100 : 0;

  if (
    totals.fat > highFat &&
    projectedFatPct > excessRatio &&
    (ctx.goalType === 'fat_loss' || ctx.goalType === 'health')
  ) {
    return {
      triggered: true,
      severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
      reason: t(
        'decision.context.highFat',
        {
          fat: String(Math.round(totals.fat)),
          percent: String(Math.round(projectedFatPct)),
        },
        locale,
      ),
      issue: {
        category: 'fat_excess',
        severity: projectedFatPct > criticalRatio ? 'critical' : 'warning',
        message: t(
          'decision.context.highFat',
          {
            fat: String(Math.round(totals.fat)),
            percent: String(Math.round(projectedFatPct)),
          },
          locale,
        ),
        data: {
          mealFat: Math.round(totals.fat),
          projectedPercent: Math.round(projectedFatPct),
        },
      },
    };
  }
  return null;
}

/**
 * 碳水超标检查
 * V2.2: 110% → thresholds.carbExcessRatio, 130% → thresholds.carbCriticalRatio
 */
export function checkCarbExcess(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'goalType' | 'todayCarbs' | 'goalCarbs'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const excessRatio = (thresholds?.carbExcessRatio ?? 1.1) * 100;
  const criticalRatio = (thresholds?.carbCriticalRatio ?? 1.3) * 100;

  const projectedCarbsPct =
    ctx.goalCarbs > 0
      ? ((ctx.todayCarbs + totals.carbs) / ctx.goalCarbs) * 100
      : 0;

  if (projectedCarbsPct > excessRatio && ctx.goalType === 'fat_loss') {
    return {
      triggered: true,
      severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
      reason: t(
        'decision.context.highCarbs',
        { percent: String(Math.round(projectedCarbsPct)) },
        locale,
      ),
      issue: {
        category: 'carb_excess',
        severity: projectedCarbsPct > criticalRatio ? 'critical' : 'warning',
        message: t(
          'decision.context.highCarbs',
          { percent: String(Math.round(projectedCarbsPct)) },
          locale,
        ),
        data: {
          mealCarbs: Math.round(totals.carbs),
          projectedPercent: Math.round(projectedCarbsPct),
        },
      },
    };
  }
  return null;
}

/**
 * 深夜进食检查
 * V2.2: 时间边界 + 热量门槛均使用动态阈值
 */
export function checkLateNight(
  totals: NutritionTotals,
  ctx: Pick<UnifiedUserContext, 'localHour'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult | null {
  const lateStart = thresholds?.lateNightStart ?? 21;
  const lateEnd = thresholds?.lateNightEnd ?? 5;
  const significantCal = thresholds?.significantMealCal ?? 300;

  if (
    ((ctx.localHour ?? 12) >= lateStart || (ctx.localHour ?? 12) < lateEnd) &&
    totals.calories > significantCal
  ) {
    const calories = Math.round(totals.calories);
    // 量化：附带本餐实际热量，如 "深夜高热量饮食（480kcal）"
    const quantSuffix = ` (${calories}kcal)`;
    const msgBase = t('decision.context.lateNightHighCal', {}, locale);
    return {
      triggered: true,
      severity: 'warning',
      reason: msgBase + quantSuffix,
      issue: {
        category: 'late_night',
        severity: 'warning',
        message: msgBase + quantSuffix,
        data: { hour: ctx.localHour ?? 12, calories },
      },
    };
  }
  return null;
}

/**
 * 过敏原检查（可能强制 avoid）
 */

/**
 * 过敏原别名展开表（与 allergen-filter.util.ts 保持同步）
 * 将用户画像标准键 → 食物库 allergens[] 中可能出现的等价键
 */
const ALLERGEN_EXPAND_MAP: Record<string, string[]> = {
  gluten: ['gluten', 'wheat'],
  dairy: ['dairy', 'milk', 'lactose'],
  egg: ['egg', 'eggs'],
  fish: ['fish'],
  shellfish: ['shellfish', 'shrimp'],
  tree_nuts: ['tree_nuts', 'tree_nut', 'nuts'],
  peanuts: ['peanuts', 'peanut', 'nuts'],
  soy: ['soy', 'soybeans'],
  sesame: ['sesame'],
  // 兼容旧键
  peanut: ['peanuts', 'peanut', 'nuts'],
  tree_nut: ['tree_nuts', 'tree_nut', 'nuts'],
  milk: ['dairy', 'milk', 'lactose'],
  eggs: ['egg', 'eggs'],
  soybeans: ['soy', 'soybeans'],
  wheat: ['gluten', 'wheat'],
};

export function checkAllergenConflict(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'allergens'>,
  locale?: Locale,
): CheckResult | null {
  if (!ctx.allergens || ctx.allergens.length === 0) return null;

  // 仅使用食物库结构化 allergens 字段进行精确匹配
  const matchedAllergen = ctx.allergens.find((userAllergen) => {
    const expandedKeys = ALLERGEN_EXPAND_MAP[userAllergen.toLowerCase()] ?? [
      userAllergen.toLowerCase(),
    ];
    return foods.some(
      (f) =>
        Array.isArray(f.allergens) &&
        f.allergens.some((fa) => expandedKeys.includes(fa.toLowerCase())),
    );
  });

  if (matchedAllergen) {
    return {
      triggered: true,
      severity: 'critical',
      decisionOverride: 'avoid',
      reason: t(
        'decision.context.allergen',
        { allergen: matchedAllergen },
        locale,
      ),
      issue: {
        category: 'allergen',
        severity: 'critical',
        message: t(
          'decision.context.allergen',
          { allergen: matchedAllergen },
          locale,
        ),
        data: { allergen: matchedAllergen },
      },
    };
  }
  return null;
}

/**
 * 饮食限制冲突检查（可能强制 avoid）
 */
export function checkRestrictionConflict(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'dietaryRestrictions'>,
  locale?: Locale,
): CheckResult | null {
  if (!ctx.dietaryRestrictions || ctx.dietaryRestrictions.length === 0)
    return null;

  const foodTexts = buildFoodTexts(foods);
  const meatKeywords = [
    '肉',
    '鸡',
    '猪',
    '牛',
    '羊',
    '鱼',
    '虾',
    '蟹',
    'meat',
    'chicken',
    'pork',
    'beef',
    'fish',
    'shrimp',
  ];
  const isVegetarian = (ctx.dietaryRestrictions ?? []).some((r) =>
    ['素食', '纯素', 'vegetarian', 'vegan'].includes(r.toLowerCase()),
  );

  if (isVegetarian && meatKeywords.some((k) => foodTexts.includes(k))) {
    return {
      triggered: true,
      severity: 'critical',
      decisionOverride: 'avoid',
      reason: t('decision.context.restrictionConflict', {}, locale),
      issue: {
        category: 'restriction',
        severity: 'critical',
        message: t('decision.context.restrictionConflict', {}, locale),
      },
    };
  }

  // Fix B2: low_sodium 饮食限制——钠超过800mg时警告
  const isLowSodium = (ctx.dietaryRestrictions ?? []).some((r) =>
    ['low_sodium', '低盐', '低钠'].includes(r.toLowerCase()),
  );
  if (isLowSodium) {
    const totalSodium = foods.reduce((s, f) => s + (f.sodium ?? 0), 0);
    if (totalSodium > 800) {
      return {
        triggered: true,
        severity: 'warning',
        decisionOverride: 'caution',
        reason: t('decision.context.restrictionConflict', {}, locale),
        issue: {
          category: 'restriction',
          severity: 'warning',
          message: t('decision.context.restrictionConflict', {}, locale),
          data: { restriction: 'low_sodium', sodium: totalSodium },
        },
      };
    }
  }

  return null;
}

/**
 * 健康状况风险检查
 * V2.2: 钠/糖阈值使用动态阈值（高血压 600mg vs 默认 2000mg）
 */
export function checkHealthConditionRisk(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'healthConditions'>,
  locale?: Locale,
  thresholds?: UserThresholds,
): CheckResult[] {
  if (!ctx.healthConditions || ctx.healthConditions.length === 0) return [];

  const results: CheckResult[] = [];
  const totalSodium = foods.reduce((s, f) => s + (f.sodium || 0), 0);
  const totalAddedSugar = foods.reduce(
    (s, f) => s + (Number(f.addedSugar) || 0),
    0,
  );

  const hasHypertension = (ctx.healthConditions ?? []).some((c) =>
    ['高血压', 'hypertension', '高血圧'].includes(c.toLowerCase()),
  );
  // Fix B3: 使用子串匹配，兼容 'diabetes_type2' / 'diabetes_type1' 等变体
  const hasDiabetes = (ctx.healthConditions ?? []).some(
    (c) => c.toLowerCase() === '糖尿病' || c.toLowerCase().includes('diabetes'),
  );

  const sodiumLimit = thresholds?.sodiumLimit ?? (hasHypertension ? 800 : 2000);
  const sugarLimit = thresholds?.addedSugarLimit ?? (hasDiabetes ? 10 : 25);

  if (hasHypertension && totalSodium > sodiumLimit) {
    results.push({
      triggered: true,
      severity: 'critical',
      reason: t(
        'decision.context.healthHighSodium',
        { sodium: String(Math.round(totalSodium)) },
        locale,
      ),
      issue: {
        category: 'health_risk',
        severity: 'critical',
        message: t(
          'decision.context.healthHighSodium',
          { sodium: String(Math.round(totalSodium)) },
          locale,
        ),
        data: { sodium: Math.round(totalSodium), condition: 'hypertension' },
      },
    });
  }

  if (hasDiabetes && totalAddedSugar > sugarLimit) {
    results.push({
      triggered: true,
      severity: 'critical',
      reason: t(
        'decision.context.healthHighSugar',
        { sugar: String(Math.round(totalAddedSugar)) },
        locale,
      ),
      issue: {
        category: 'health_risk',
        severity: 'critical',
        message: t(
          'decision.context.healthHighSugar',
          { sugar: String(Math.round(totalAddedSugar)) },
          locale,
        ),
        data: {
          addedSugar: Math.round(totalAddedSugar),
          condition: 'diabetes',
        },
      },
    });
  }

  return results;
}

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
