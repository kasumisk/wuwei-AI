/**
 * V4.7 P2.1 — 健康状况风险检查
 *
 * 从 decision-checks.ts 拆分：12+ 种健康状况的营养风险检测
 */
import { cl } from '../../i18n/decision-labels';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { UserThresholds } from '../dynamic-thresholds.service';
import type { CheckResult, CheckableFoodItem } from '../decision-checks';
import type { UnifiedUserContext } from '../../types/analysis-result.types';
import { hasCondition } from '../condition-aliases';

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

  const hasHypertension = hasCondition(conds, 'hypertension');
  const hasDiabetes = hasCondition(conds, 'diabetes');
  const hasCardiovascular = hasCondition(conds, 'cardiovascular');
  const hasGout = hasCondition(conds, 'gout');
  const hasKidneyDisease = hasCondition(conds, 'kidney_disease');
  const hasHyperlipidemia = hasCondition(conds, 'hyperlipidemia');
  const hasFattyLiver = hasCondition(conds, 'fatty_liver');
  const hasCeliac = hasCondition(conds, 'celiac');
  const hasAnemia = hasCondition(conds, 'anemia');
  const hasOsteoporosis = hasCondition(conds, 'osteoporosis');
  const hasIbs = hasCondition(conds, 'ibs');

  const sodiumLimit = thresholds?.sodiumLimit ?? (hasHypertension ? 800 : 2000);
  const sugarLimit = thresholds?.addedSugarLimit ?? (hasDiabetes ? 10 : 25);
  const cvSodiumLimit = 600;
  const cvSatFatLimit = 5;

  if (hasHypertension && totalSodium > sodiumLimit) {
    results.push({
      triggered: true,
      severity: 'critical',
      reason: cl('check.healthHighSodium', locale).replace(
        '{sodium}',
        String(Math.round(totalSodium)),
      ),
      issue: {
        category: 'health_risk',
        severity: 'critical',
        message: cl('check.healthHighSodium', locale).replace(
          '{sodium}',
          String(Math.round(totalSodium)),
        ),
        data: { sodium: Math.round(totalSodium), condition: 'hypertension' },
      },
    });
  }

  if (hasDiabetes && totalAddedSugar > sugarLimit) {
    results.push({
      triggered: true,
      severity: 'critical',
      reason: cl('check.healthHighSugar', locale).replace(
        '{sugar}',
        String(Math.round(totalAddedSugar)),
      ),
      issue: {
        category: 'health_risk',
        severity: 'critical',
        message: cl('check.healthHighSugar', locale).replace(
          '{sugar}',
          String(Math.round(totalAddedSugar)),
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
        reason: cl('check.cardiovascularHighSodium', locale).replace(
          '{sodium}',
          String(Math.round(totalSodium)),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.cardiovascularHighSodium', locale).replace(
            '{sodium}',
            String(Math.round(totalSodium)),
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
        reason: cl('check.cardiovascularHighSatFat', locale).replace(
          '{satFat}',
          String(Math.round(totalSatFat * 10) / 10),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.cardiovascularHighSatFat', locale).replace(
            '{satFat}',
            String(Math.round(totalSatFat * 10) / 10),
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
  const goutPurineLimit = 100;
  if (hasGout && totalPurine > goutPurineLimit) {
    results.push({
      triggered: true,
      severity: 'warning',
      reason: cl('check.goutHighPurine', locale).replace(
        '{purine}',
        String(Math.round(totalPurine)),
      ),
      issue: {
        category: 'health_risk',
        severity: 'warning',
        message: cl('check.goutHighPurine', locale).replace(
          '{purine}',
          String(Math.round(totalPurine)),
        ),
        data: { purine: Math.round(totalPurine), condition: 'gout' },
      },
    });
  }

  // ── 肾病：钾/磷超标 ──
  const kidneyPotassiumLimit = 700;
  const kidneyPhosphorusLimit = 250;
  if (hasKidneyDisease) {
    if (totalPotassium > kidneyPotassiumLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: cl('check.kidneyHighPotassium', locale).replace(
          '{potassium}',
          String(Math.round(totalPotassium)),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.kidneyHighPotassium', locale).replace(
            '{potassium}',
            String(Math.round(totalPotassium)),
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
        reason: cl('check.kidneyHighPhosphorus', locale).replace(
          '{phosphorus}',
          String(Math.round(totalPhosphorus)),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.kidneyHighPhosphorus', locale).replace(
            '{phosphorus}',
            String(Math.round(totalPhosphorus)),
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
  const hyperlipidemicSatFatLimit = 5;
  if (hasHyperlipidemia && totalSatFat > hyperlipidemicSatFatLimit) {
    results.push({
      triggered: true,
      severity: 'warning',
      reason: cl('check.hyperlipidemiaHighSatFat', locale).replace(
        '{satFat}',
        String(Math.round(totalSatFat * 10) / 10),
      ),
      issue: {
        category: 'health_risk',
        severity: 'warning',
        message: cl('check.hyperlipidemiaHighSatFat', locale).replace(
          '{satFat}',
          String(Math.round(totalSatFat * 10) / 10),
        ),
        data: {
          saturatedFat: Math.round(totalSatFat * 10) / 10,
          condition: 'hyperlipidemia',
        },
      },
    });
  }

  // ── 脂肪肝：饱和脂肪 + 添加糖超标 ──
  const fattyLiverSatFatLimit = 6;
  const fattyLiverSugarLimit = 8;
  if (hasFattyLiver) {
    if (totalSatFat > fattyLiverSatFatLimit) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: cl('check.fattyLiverHighSatFat', locale).replace(
          '{satFat}',
          String(Math.round(totalSatFat * 10) / 10),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.fattyLiverHighSatFat', locale).replace(
            '{satFat}',
            String(Math.round(totalSatFat * 10) / 10),
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
        reason: cl('check.fattyLiverHighSugar', locale).replace(
          '{sugar}',
          String(Math.round(totalAddedSugar)),
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.fattyLiverHighSugar', locale).replace(
            '{sugar}',
            String(Math.round(totalAddedSugar)),
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
        reason: cl('check.celiacGluten', locale).replace(
          '{food}',
          glutenFood.name,
        ),
        issue: {
          category: 'health_risk',
          severity: 'critical',
          message: cl('check.celiacGluten', locale).replace(
            '{food}',
            glutenFood.name,
          ),
          data: { food: glutenFood.name, condition: 'celiac_disease' },
        },
      });
    }
  }

  // ── 缺铁性贫血：餐次铁摄入偏低 ──
  const mealCalories = foods.reduce((s, f) => s + f.calories, 0);
  const anemiaIronThreshold = 2;
  if (
    hasAnemia &&
    mealCalories > 200 &&
    totalIron < anemiaIronThreshold &&
    totalIron >= 0
  ) {
    results.push({
      triggered: true,
      severity: 'info',
      reason: cl('check.anemiaLowIron', locale),
      issue: {
        category: 'health_risk',
        severity: 'info',
        message: cl('check.anemiaLowIron', locale),
        data: { iron: Math.round(totalIron * 10) / 10, condition: 'anemia' },
      },
    });
  }

  // ── 骨质疏松：餐次钙摄入偏低 ──
  const osteoporosisCalciumThreshold = 100;
  if (
    hasOsteoporosis &&
    mealCalories > 200 &&
    totalCalcium < osteoporosisCalciumThreshold &&
    totalCalcium >= 0
  ) {
    results.push({
      triggered: true,
      severity: 'info',
      reason: cl('check.osteoporosisLowCalcium', locale),
      issue: {
        category: 'health_risk',
        severity: 'info',
        message: cl('check.osteoporosisLowCalcium', locale),
        data: {
          calcium: Math.round(totalCalcium),
          condition: 'osteoporosis',
        },
      },
    });
  }

  // ── IBS：含高 FODMAP 食物 ──
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
        reason: cl('check.ibsHighFodmap', locale).replace(
          '{food}',
          highFodmapFood.name,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.ibsHighFodmap', locale).replace(
            '{food}',
            highFodmapFood.name,
          ),
          data: { food: highFodmapFood.name, condition: 'ibs' },
        },
      });
    }
  }

  // ── V4.6: 痛风嘌呤等级检查（枚举型补充） ──
  if (hasGout && totalPurine <= goutPurineLimit) {
    const highPurineFood = foods.find(
      (f) => f.purineLevel === 'high' || (f as any).purine === 'high',
    );
    if (highPurineFood) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: cl('check.goutHighPurineLevel', locale).replace(
          '{food}',
          highPurineFood.name,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.goutHighPurineLevel', locale).replace(
            '{food}',
            highPurineFood.name,
          ),
          data: { food: highPurineFood.name, condition: 'gout' },
        },
      });
    }
  }

  // ── V4.6: 肾结石风险 — 高草酸食物 ──
  const hasKidneyStone =
    hasCondition(conds, 'kidney_disease') ||
    conds.some((c) => c.includes('kidney_stone') || c.includes('oxalate'));
  if (hasKidneyStone) {
    const highOxalateFood = foods.find((f) => f.oxalateLevel === 'high');
    if (highOxalateFood) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: cl('check.kidneyStoneHighOxalate', locale).replace(
          '{food}',
          highOxalateFood.name,
        ),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.kidneyStoneHighOxalate', locale).replace(
            '{food}',
            highOxalateFood.name,
          ),
          data: { food: highOxalateFood.name, condition: 'kidney_stone' },
        },
      });
    }
  }

  // ── V4.6: 高胆固醇风险（心血管/高血脂） ──
  const totalCholesterol = foods.reduce(
    (s, f) => s + (Number(f.cholesterol) || 0),
    0,
  );
  const cholesterolLimit = 100;
  if (
    (hasCardiovascular || hasHyperlipidemia) &&
    totalCholesterol > cholesterolLimit
  ) {
    results.push({
      triggered: true,
      severity: 'warning',
      reason: cl('check.highCholesterol', locale).replace(
        '{cholesterol}',
        String(Math.round(totalCholesterol)),
      ),
      issue: {
        category: 'health_risk',
        severity: 'warning',
        message: cl('check.highCholesterol', locale).replace(
          '{cholesterol}',
          String(Math.round(totalCholesterol)),
        ),
        data: {
          cholesterol: Math.round(totalCholesterol),
          condition: hasCardiovascular ? 'cardiovascular' : 'hyperlipidemia',
        },
      },
    });
  }

  // ── V4.6: 反式脂肪风险（所有心血管相关） ──
  const totalTransFat = foods.reduce(
    (s, f) => s + (Number(f.transFat) || 0),
    0,
  );
  const transFatLimit = 0.5;
  if (totalTransFat > transFatLimit) {
    const severity =
      hasCardiovascular || hasHyperlipidemia ? 'critical' : 'warning';
    results.push({
      triggered: true,
      severity,
      reason: cl('check.highTransFat', locale).replace(
        '{transFat}',
        String(Math.round(totalTransFat * 10) / 10),
      ),
      issue: {
        category: 'health_risk',
        severity,
        message: cl('check.highTransFat', locale).replace(
          '{transFat}',
          String(Math.round(totalTransFat * 10) / 10),
        ),
        data: {
          transFat: Math.round(totalTransFat * 10) / 10,
          condition: hasCardiovascular
            ? 'cardiovascular'
            : hasHyperlipidemia
              ? 'hyperlipidemia'
              : 'general',
        },
      },
    });
  }

  // ── V4.6: 糖尿病血糖负荷检查 ──
  if (hasDiabetes) {
    const highGlFood = foods.find(
      (f) => f.glycemicLoad != null && f.glycemicLoad > 20,
    );
    if (highGlFood) {
      results.push({
        triggered: true,
        severity: 'warning',
        reason: cl('check.diabetesHighGL', locale)
          .replace('{food}', highGlFood.name)
          .replace('{gl}', String(Math.round(highGlFood.glycemicLoad!))),
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message: cl('check.diabetesHighGL', locale)
            .replace('{food}', highGlFood.name)
            .replace('{gl}', String(Math.round(highGlFood.glycemicLoad!))),
          data: {
            food: highGlFood.name,
            glycemicLoad: Math.round(highGlFood.glycemicLoad!),
            condition: 'diabetes',
          },
        },
      });
    }
  }

  return results;
}
