/**
 * Phase 12 — 健康状况风险检查 Service
 *
 * 从 config/checks/health-condition-checks.ts 迁移：保持函数行为不变，
 * 改造为 @Injectable() 通过注入 I18nService 替代 cl()。
 *
 * 12+ 种健康状况的营养风险检测，返回 CheckResult[]（可多条）。
 */
import { Injectable } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import { UserThresholds } from '../config/dynamic-thresholds.service';
import type {
  CheckResult,
  CheckableFoodItem,
} from '../config/decision-checks';
import type { UnifiedUserContext } from '../types/analysis-result.types';
import { hasCondition } from '../config/condition-aliases';

@Injectable()
export class HealthConditionChecksService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 健康状况风险检查
   * V2.2: 钠/糖阈值使用动态阈值（高血压 600mg vs 默认 2000mg）
   */
  check(
    foods: CheckableFoodItem[],
    ctx: Pick<UnifiedUserContext, 'healthConditions'>,
    locale?: I18nLocale,
    thresholds?: UserThresholds,
  ): CheckResult[] {
    if (!ctx.healthConditions || ctx.healthConditions.length === 0) return [];

    const loc = locale ?? this.i18n.currentLocale();
    const t = (key: string, vars?: Record<string, string | number>) =>
      this.i18n.t(`decision.${key}`, loc, vars);

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
    const totalCalcium = foods.reduce(
      (s, f) => s + (Number(f.calcium) || 0),
      0,
    );
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

    const sodiumLimit =
      thresholds?.sodiumLimit ?? (hasHypertension ? 800 : 2000);
    const sugarLimit = thresholds?.addedSugarLimit ?? (hasDiabetes ? 10 : 25);
    const cvSodiumLimit = 600;
    const cvSatFatLimit = 5;

    if (hasHypertension && totalSodium > sodiumLimit) {
      const message = t('check.healthHighSodium', {
        sodium: Math.round(totalSodium),
      });
      results.push({
        triggered: true,
        severity: 'critical',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'critical',
          message,
          data: { sodium: Math.round(totalSodium), condition: 'hypertension' },
        },
      });
    }

    if (hasDiabetes && totalAddedSugar > sugarLimit) {
      const message = t('check.healthHighSugar', {
        sugar: Math.round(totalAddedSugar),
      });
      results.push({
        triggered: true,
        severity: 'critical',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'critical',
          message,
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
        const message = t('check.cardiovascularHighSodium', {
          sodium: Math.round(totalSodium),
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
            data: {
              sodium: Math.round(totalSodium),
              condition: 'cardiovascular',
            },
          },
        });
      }
      if (totalSatFat > cvSatFatLimit) {
        const message = t('check.cardiovascularHighSatFat', {
          satFat: Math.round(totalSatFat * 10) / 10,
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
      const message = t('check.goutHighPurine', {
        purine: Math.round(totalPurine),
      });
      results.push({
        triggered: true,
        severity: 'warning',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message,
          data: { purine: Math.round(totalPurine), condition: 'gout' },
        },
      });
    }

    // ── 肾病：钾/磷超标 ──
    const kidneyPotassiumLimit = 700;
    const kidneyPhosphorusLimit = 250;
    if (hasKidneyDisease) {
      if (totalPotassium > kidneyPotassiumLimit) {
        const message = t('check.kidneyHighPotassium', {
          potassium: Math.round(totalPotassium),
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
            data: {
              potassium: Math.round(totalPotassium),
              condition: 'kidney_disease',
            },
          },
        });
      }
      if (totalPhosphorus > kidneyPhosphorusLimit) {
        const message = t('check.kidneyHighPhosphorus', {
          phosphorus: Math.round(totalPhosphorus),
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
            data: {
              phosphorus: Math.round(totalPhosphorus),
              condition: 'kidney_disease',
            },
          },
        });
      }
    }

    // ── 高血脂:饱和脂肪超标 ──
    const hyperlipidemicSatFatLimit = 5;
    if (hasHyperlipidemia && totalSatFat > hyperlipidemicSatFatLimit) {
      const message = t('check.hyperlipidemiaHighSatFat', {
        satFat: Math.round(totalSatFat * 10) / 10,
      });
      results.push({
        triggered: true,
        severity: 'warning',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message,
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
        const message = t('check.fattyLiverHighSatFat', {
          satFat: Math.round(totalSatFat * 10) / 10,
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
            data: {
              saturatedFat: Math.round(totalSatFat * 10) / 10,
              condition: 'fatty_liver',
            },
          },
        });
      }
      if (totalAddedSugar > fattyLiverSugarLimit) {
        const message = t('check.fattyLiverHighSugar', {
          sugar: Math.round(totalAddedSugar),
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
          f.allergens?.some((a) =>
            ['gluten', 'wheat'].includes(a.toLowerCase()),
          ),
      );
      if (glutenFood) {
        const message = t('check.celiacGluten', { food: glutenFood.name });
        results.push({
          triggered: true,
          severity: 'critical',
          decisionOverride: 'avoid',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'critical',
            message,
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
      const message = t('check.anemiaLowIron');
      results.push({
        triggered: true,
        severity: 'info',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'info',
          message,
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
      const message = t('check.osteoporosisLowCalcium');
      results.push({
        triggered: true,
        severity: 'info',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'info',
          message,
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
        const message = t('check.ibsHighFodmap', {
          food: highFodmapFood.name,
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
        const message = t('check.goutHighPurineLevel', {
          food: highPurineFood.name,
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
        const message = t('check.kidneyStoneHighOxalate', {
          food: highOxalateFood.name,
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
      const message = t('check.highCholesterol', {
        cholesterol: Math.round(totalCholesterol),
      });
      results.push({
        triggered: true,
        severity: 'warning',
        reason: message,
        issue: {
          category: 'health_risk',
          severity: 'warning',
          message,
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
      const message = t('check.highTransFat', {
        transFat: Math.round(totalTransFat * 10) / 10,
      });
      results.push({
        triggered: true,
        severity,
        reason: message,
        issue: {
          category: 'health_risk',
          severity,
          message,
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
        const message = t('check.diabetesHighGL', {
          food: highGlFood.name,
          gl: Math.round(highGlFood.glycemicLoad!),
        });
        results.push({
          triggered: true,
          severity: 'warning',
          reason: message,
          issue: {
            category: 'health_risk',
            severity: 'warning',
            message,
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
}
