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
  // ── 健康状况检查所需扩展字段 ──
  /** 饱和脂肪 (g/100g) */
  saturatedFat?: number | null;
  /** 嘌呤 (mg/100g) */
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
  /** FODMAP 等级: 'low' | 'moderate' | 'high' */
  fodmapLevel?: string | null;
  /** 食物标签数组 */
  tags?: string[];
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
 *
 * 覆盖全部 7 个枚举：
 *   vegetarian / vegan / no_beef / lactose_free / gluten_free / halal / kosher
 */
export function checkRestrictionConflict(
  foods: CheckableFoodItem[],
  ctx: Pick<UnifiedUserContext, 'dietaryRestrictions'>,
  locale?: Locale,
): CheckResult | null {
  if (!ctx.dietaryRestrictions || ctx.dietaryRestrictions.length === 0)
    return null;

  const restrictions = ctx.dietaryRestrictions.map((r) => r.toLowerCase());

  for (const food of foods) {
    const name = (food.name || '').toLowerCase();
    const cat = (food.category || '').toLowerCase();
    const allergens: string[] = (food as any).allergens || [];

    for (const r of restrictions) {
      let violated = false;

      if (r === 'vegetarian' || r === 'vegan') {
        // 素食 / 纯素：名称含肉/鱼/海鲜关键字
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
        if (meatKeywords.some((k) => name.includes(k))) violated = true;
        if (r === 'vegan') {
          // 纯素额外排除蛋奶
          if (allergens.some((a) => a === 'dairy' || a === 'egg'))
            violated = true;
          if (cat === 'dairy' || cat === 'egg') violated = true;
        }
      } else if (r === 'no_beef') {
        if (name.includes('牛') || name.includes('beef')) violated = true;
        if ((food as any).foodGroup === 'beef') violated = true;
      } else if (r === 'lactose_free') {
        if (
          allergens.some(
            (a) => a === 'dairy' || a === 'milk' || a === 'lactose',
          )
        )
          violated = true;
        if (cat === 'dairy') violated = true;
      } else if (r === 'gluten_free') {
        if (allergens.some((a) => a === 'gluten' || a === 'wheat'))
          violated = true;
      } else if (r === 'halal') {
        if (
          name.includes('猪') ||
          name.includes('pork') ||
          name.includes('bacon') ||
          name.includes('ham')
        )
          violated = true;
        if ((food as any).foodGroup === 'pork') violated = true;
      } else if (r === 'kosher') {
        if (name.includes('猪') || name.includes('pork')) violated = true;
        if ((food as any).foodGroup === 'pork') violated = true;
      }

      if (violated) {
        return {
          triggered: true,
          severity: 'critical',
          decisionOverride: 'avoid',
          reason: t('decision.context.restrictionConflict', {}, locale),
          issue: {
            category: 'restriction',
            severity: 'critical',
            message: t('decision.context.restrictionConflict', {}, locale),
            data: { restriction: r, food: food.name },
          },
        };
      }
    }
  }

  // low_sodium 单独保留（钠数值判断）
  const isLowSodium = restrictions.some((r) =>
    ['low_sodium', '低盐', '低钠'].includes(r),
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
  const totalSatFat = foods.reduce(
    (s, f) => s + (Number(f.saturatedFat) || 0),
    0,
  );
  const totalPurine = foods.reduce((s, f) => s + (Number(f.purine) || 0), 0);
  const totalPotassium = foods.reduce(
    (s, f) => s + (Number(f.potassium) || 0),
    0,
  );
  const totalPhosphorus = foods.reduce(
    (s, f) => s + (Number(f.phosphorus) || 0),
    0,
  );
  const totalCalcium = foods.reduce((s, f) => s + (Number(f.calcium) || 0), 0);
  const totalIron = foods.reduce((s, f) => s + (Number(f.iron) || 0), 0);

  const conds = (ctx.healthConditions ?? []).map((c) => c.toLowerCase());

  const hasHypertension = conds.some((c) =>
    ['高血压', 'hypertension', '高血圧'].includes(c),
  );
  // Fix B3: 使用子串匹配，兼容 'diabetes_type2' / 'diabetes_type1' 等变体
  const hasDiabetes = conds.some(
    (c) => c === '糖尿病' || c.includes('diabetes'),
  );
  // V7.9: 心血管疾病
  const hasCardiovascular = conds.some((c) =>
    ['cardiovascular', 'cardiovascular_disease', 'heart_disease'].includes(c),
  );
  const hasGout = conds.some((c) => ['痛风', 'gout', '痛風'].includes(c));
  const hasKidneyDisease = conds.some((c) =>
    ['肾病', 'kidney_disease', '腎臓病', 'chronic_kidney_disease'].includes(c),
  );
  const hasHyperlipidemia = conds.some((c) =>
    ['高血脂', 'hyperlipidemia', '高脂血症'].includes(c),
  );
  const hasFattyLiver = conds.some((c) =>
    ['脂肪肝', 'fatty_liver', '脂肪肝疾患'].includes(c),
  );
  const hasCeliac = conds.some((c) =>
    ['乳糜泻', 'celiac_disease', 'celiac', 'セリアック病'].includes(c),
  );
  const hasAnemia = conds.some((c) =>
    ['缺铁性贫血', 'iron_deficiency_anemia', 'anemia', '鉄欠乏性貧血'].includes(
      c,
    ),
  );
  const hasOsteoporosis = conds.some((c) =>
    ['骨质疏松', 'osteoporosis', '骨粗鬆症'].includes(c),
  );
  const hasIbs = conds.some((c) =>
    [
      '肠易激综合征',
      'ibs',
      'irritable_bowel_syndrome',
      '過敏性腸症候群',
    ].includes(c),
  );

  const sodiumLimit = thresholds?.sodiumLimit ?? (hasHypertension ? 800 : 2000);
  const sugarLimit = thresholds?.addedSugarLimit ?? (hasDiabetes ? 10 : 25);
  // 心血管钠限：每餐 600mg（每日 1500mg ÷ 2.5 餐）
  const cvSodiumLimit = 600;
  // 心血管饱和脂肪限：每餐 5g（每日 13g ÷ 2.5 餐）
  const cvSatFatLimit = 5;

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

  // V7.9: 心血管疾病 — 钠和饱和脂肪双维度检查
  if (hasCardiovascular) {
    if (totalSodium > cvSodiumLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.cardiovascularHighSodium',
          { sodium: String(Math.round(totalSodium)) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.cardiovascularHighSodium',
            { sodium: String(Math.round(totalSodium)) },
            locale,
          ),
          data: {
            sodium: Math.round(totalSodium),
            condition: 'cardiovascular',
          },
        },
      });
    }
    if (totalSatFat > cvSatFatLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.cardiovascularHighSatFat',
          { satFat: String(Math.round(totalSatFat * 10) / 10) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.cardiovascularHighSatFat',
            { satFat: String(Math.round(totalSatFat * 10) / 10) },
            locale,
          ),
          data: {
            saturatedFat: Math.round(totalSatFat * 10) / 10,
            condition: 'cardiovascular',
          },
        },
      });
    }
  }

  // ── 痛风：嘌呤超标 ──
  // 每餐嘌呤阈值：100mg（每日 300mg ÷ 3 餐）
  const goutPurineLimit = 100;
  if (hasGout && totalPurine > goutPurineLimit) {
    results.push({
      triggered: true,
      severity: 'warning',
      reason: t(
        'decision.context.goutHighPurine',
        { purine: String(Math.round(totalPurine)) },
        locale,
      ),
      issue: {
        category: 'health_risk',
        severity: 'warning',
        message: t(
          'decision.context.goutHighPurine',
          { purine: String(Math.round(totalPurine)) },
          locale,
        ),
        data: { purine: Math.round(totalPurine), condition: 'gout' },
      },
    });
  }

  // ── 肾病：钾/磷超标 ──
  const kidneyPotassiumLimit = 700; // mg/餐（每日 2000mg ÷ 3）
  const kidneyPhosphorusLimit = 250; // mg/餐（每日 800mg ÷ 3）
  if (hasKidneyDisease) {
    if (totalPotassium > kidneyPotassiumLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.kidneyHighPotassium',
          { potassium: String(Math.round(totalPotassium)) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.kidneyHighPotassium',
            { potassium: String(Math.round(totalPotassium)) },
            locale,
          ),
          data: {
            potassium: Math.round(totalPotassium),
            condition: 'kidney_disease',
          },
        },
      });
    }
    if (totalPhosphorus > kidneyPhosphorusLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.kidneyHighPhosphorus',
          { phosphorus: String(Math.round(totalPhosphorus)) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.kidneyHighPhosphorus',
            { phosphorus: String(Math.round(totalPhosphorus)) },
            locale,
          ),
          data: {
            phosphorus: Math.round(totalPhosphorus),
            condition: 'kidney_disease',
          },
        },
      });
    }
  }

  // ── 高血脂：饱和脂肪超标 ──
  const hyperlipidemicSatFatLimit = 5; // g/餐（每日 13g ÷ 2.5）
  if (hasHyperlipidemia && totalSatFat > hyperlipidemicSatFatLimit) {
    results.push({
      triggered: true,
      severity: 'warning',
      reason: t(
        'decision.context.hyperlipidemiaHighSatFat',
        { satFat: String(Math.round(totalSatFat * 10) / 10) },
        locale,
      ),
      issue: {
        category: 'health_risk',
        severity: 'warning',
        message: t(
          'decision.context.hyperlipidemiaHighSatFat',
          { satFat: String(Math.round(totalSatFat * 10) / 10) },
          locale,
        ),
        data: {
          saturatedFat: Math.round(totalSatFat * 10) / 10,
          condition: 'hyperlipidemia',
        },
      },
    });
  }

  // ── 脂肪肝：饱和脂肪 + 添加糖超标 ──
  const fattyLiverSatFatLimit = 6; // g/餐
  const fattyLiverSugarLimit = 8; // g/餐
  if (hasFattyLiver) {
    if (totalSatFat > fattyLiverSatFatLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.fattyLiverHighSatFat',
          { satFat: String(Math.round(totalSatFat * 10) / 10) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.fattyLiverHighSatFat',
            { satFat: String(Math.round(totalSatFat * 10) / 10) },
            locale,
          ),
          data: {
            saturatedFat: Math.round(totalSatFat * 10) / 10,
            condition: 'fatty_liver',
          },
        },
      });
    }
    if (totalAddedSugar > fattyLiverSugarLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.fattyLiverHighSugar',
          { sugar: String(Math.round(totalAddedSugar)) },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.fattyLiverHighSugar',
            { sugar: String(Math.round(totalAddedSugar)) },
            locale,
          ),
          data: {
            addedSugar: Math.round(totalAddedSugar),
            condition: 'fatty_liver',
          },
        },
      });
    }
  }

  // ── 乳糜泻：含麸质 critical veto ──
  if (hasCeliac) {
    const glutenFood = foods.find(
      (f) =>
        f.tags?.some((tag) =>
          ['gluten', 'contains_gluten', 'wheat'].includes(tag.toLowerCase()),
        ) ||
        f.allergens?.some((a) => ['gluten', 'wheat'].includes(a.toLowerCase())),
    );
    if (glutenFood) {
      results.push({
        triggered: true,
        severity: 'critical',
        decisionOverride: 'avoid',
        reason: t(
          'decision.context.celiacGluten',
          { food: glutenFood.name },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'critical',
          message: t(
            'decision.context.celiacGluten',
            { food: glutenFood.name },
            locale,
          ),
          data: { food: glutenFood.name, condition: 'celiac_disease' },
        },
      });
    }
  }

  // ── 缺铁性贫血：餐次铁摄入偏低（info 级，有助提醒） ──
  // 仅在餐次热量显著（>200kcal）且铁含量极低时提示
  const mealCalories = foods.reduce((s, f) => s + f.calories, 0);
  const anemiaIronThreshold = 2; // mg/餐，低于此值且餐次非轻食时提示
  if (
    hasAnemia &&
    mealCalories > 200 &&
    totalIron < anemiaIronThreshold &&
    totalIron >= 0
  ) {
    results.push({
      triggered: true,
      severity: 'info',
      reason: t('decision.context.anemiaLowIron', {}, locale),
      issue: {
        category: 'health_risk',
        severity: 'info',
        message: t('decision.context.anemiaLowIron', {}, locale),
        data: { iron: Math.round(totalIron * 10) / 10, condition: 'anemia' },
      },
    });
  }

  // ── 骨质疏松：餐次钙摄入偏低（info 级） ──
  const osteoporosisCalciumThreshold = 100; // mg/餐，低于此值且餐次非轻食时提示
  if (
    hasOsteoporosis &&
    mealCalories > 200 &&
    totalCalcium < osteoporosisCalciumThreshold &&
    totalCalcium >= 0
  ) {
    results.push({
      triggered: true,
      severity: 'info',
      reason: t('decision.context.osteoporosisLowCalcium', {}, locale),
      issue: {
        category: 'health_risk',
        severity: 'info',
        message: t('decision.context.osteoporosisLowCalcium', {}, locale),
        data: {
          calcium: Math.round(totalCalcium),
          condition: 'osteoporosis',
        },
      },
    });
  }

  // ── IBS：含高 FODMAP 食物 warning ──
  if (hasIbs) {
    const highFodmapFood = foods.find(
      (f) =>
        f.fodmapLevel === 'high' ||
        f.tags?.some((tag) =>
          ['high_fodmap', 'fodmap_high'].includes(tag.toLowerCase()),
        ),
    );
    if (highFodmapFood) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: t(
          'decision.context.ibsHighFodmap',
          { food: highFodmapFood.name },
          locale,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: t(
            'decision.context.ibsHighFodmap',
            { food: highFodmapFood.name },
            locale,
          ),
          data: { food: highFodmapFood.name, condition: 'ibs' },
        },
      });
    }
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
