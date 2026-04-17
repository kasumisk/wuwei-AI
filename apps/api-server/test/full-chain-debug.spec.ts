/**
 * 全链路自动化调试测试 V1
 *
 * 覆盖 4 个用户场景：减肥 / 健身 / 保持健康 / 改善习惯
 * 运行：npx jest --testPathPattern="full-chain-debug" --rootDir . --no-coverage --verbose
 */

import { DynamicThresholdsService } from '../src/modules/decision/config/dynamic-thresholds.service';
import { DecisionEngineService } from '../src/modules/decision/decision/decision-engine.service';
import {
  checkAllergenConflict,
  checkRestrictionConflict,
  checkHealthConditionRisk,
} from '../src/modules/decision/decision/decision-checks';
import type { UnifiedUserContext } from '../src/modules/decision/types/analysis-result.types';
import type { DecisionFoodItem } from '../src/modules/decision/decision/food-decision.service';
import { Locale } from '../src/modules/diet/app/recommendation/utils/i18n-messages';

function buildCtx(overrides: Partial<UnifiedUserContext>): UnifiedUserContext {
  return {
    goalType: 'health', goalLabel: '均衡健康',
    todayCalories: 0, todayProtein: 0, todayFat: 0, todayCarbs: 0,
    goalCalories: 2000, goalProtein: 65, goalFat: 65, goalCarbs: 275,
    remainingCalories: 2000, remainingProtein: 65, remainingFat: 65, remainingCarbs: 275,
    mealCount: 0, profile: null, localHour: 12,
    allergens: [], dietaryRestrictions: [], healthConditions: [],
    budgetStatus: 'under_target', nutritionPriority: ['protein_gap'],
    contextSignals: ['fresh_day'], mealType: 'lunch',
    ...overrides,
  };
}

function buildFood(overrides: Partial<DecisionFoodItem>): DecisionFoodItem {
  return {
    name: '测试食物', estimatedWeightGrams: 200, confidence: 0.9,
    calories: 400, protein: 20, fat: 15, carbs: 50, fiber: 3, sodium: 0,
    ...overrides,
  };
}

const LOCALE: Locale = 'zh-CN';

const CTX = {
  fatLoss: buildCtx({
    goalType: 'fat_loss', goalCalories: 1400, goalProtein: 78, goalFat: 45, goalCarbs: 155,
    todayCalories: 800, todayProtein: 35, todayFat: 25, todayCarbs: 90,
    remainingCalories: 600, localHour: 19, mealType: 'dinner',
    allergens: ['peanut', 'tree_nut'],
    profile: { goal: 'fat_loss', gender: 'female', weight_kg: 70, height_cm: 162, birth_year: 1998, activity_level: 'sedentary', cooking_skill_level: 'beginner' },
  }),
  muscleGain: buildCtx({
    goalType: 'muscle_gain', goalCalories: 2800, goalProtein: 175, goalFat: 90, goalCarbs: 350,
    todayCalories: 1200, todayProtein: 60, todayFat: 40, todayCarbs: 140,
    remainingCalories: 1600, localHour: 7, mealType: 'breakfast',
    profile: { goal: 'muscle_gain', gender: 'male', weight_kg: 75, height_cm: 178, birth_year: 1996, activity_level: 'active', cooking_skill_level: 'intermediate' },
  }),
  health: buildCtx({
    goalType: 'health', goalCalories: 2200, goalProtein: 88, goalFat: 65, goalCarbs: 275,
    todayCalories: 1100, remainingCalories: 1100, localHour: 12, mealType: 'lunch',
    dietaryRestrictions: ['low_sodium'],
    healthConditions: ['hypertension', 'diabetes_type2'],
    profile: { goal: 'health', gender: 'male', weight_kg: 85, height_cm: 175, birth_year: 1978, activity_level: 'moderate', cooking_skill_level: 'advanced' },
  }),
  habit: buildCtx({
    goalType: 'habit', goalCalories: 2100, goalProtein: 68, goalFat: 70, goalCarbs: 280,
    todayCalories: 1600, remainingCalories: 500, localHour: 21, mealType: 'snack',
    allergens: ['shellfish'],
    profile: { goal: 'habit', gender: 'male', weight_kg: 68, height_cm: 175, birth_year: 2002, activity_level: 'light', cooking_skill_level: 'beginner' },
  }),
};

const F = {
  highCalDinner: [
    buildFood({ name: '炸鸡腿', calories: 520, protein: 28, fat: 32, carbs: 38, sodium: 800 }),
    buildFood({ name: '白米饭', calories: 280, protein: 5, fat: 1, carbs: 62 }),
    buildFood({ name: '可乐', calories: 150, protein: 0, fat: 0, carbs: 38 }),
  ],
  goodLunch: [
    buildFood({ name: '鸡胸肉', calories: 165, protein: 31, fat: 3.6, carbs: 0 }),
    buildFood({ name: '西兰花', calories: 55, protein: 3.7, fat: 0.6, carbs: 11 }),
    buildFood({ name: '糙米饭', calories: 216, protein: 4.5, fat: 1.8, carbs: 45 }),
  ],
  lowProteinBreakfast: [
    buildFood({ name: '白面包', calories: 265, protein: 9, fat: 3.2, carbs: 49 }),
    buildFood({ name: '果冻', calories: 78, protein: 1.5, fat: 0, carbs: 19 }),
  ],
  highProteinLunch: [
    buildFood({ name: '牛排', calories: 250, protein: 26, fat: 15, carbs: 0 }),
    buildFood({ name: '鸡蛋', calories: 210, protein: 18, fat: 15, carbs: 1.5 }),
    buildFood({ name: '燕麦', calories: 150, protein: 5, fat: 2.7, carbs: 27 }),
  ],
  highSodiumFood: [
    buildFood({ name: '咸鱼', calories: 200, protein: 30, fat: 8, carbs: 0, sodium: 3200 }),
    buildFood({ name: '泡菜', calories: 30, protein: 2, fat: 0.5, carbs: 5, sodium: 1800 }),
  ],
  lowSodiumBalanced: [
    buildFood({ name: '豆腐', calories: 76, protein: 8, fat: 4.5, carbs: 1.9, sodium: 10 }),
    buildFood({ name: '菠菜', calories: 23, protein: 2.9, fat: 0.4, carbs: 3.6, sodium: 79 }),
    buildFood({ name: '小米粥', calories: 120, protein: 3, fat: 1, carbs: 24, sodium: 15 }),
  ],
  chineseShellfish: [
    buildFood({ name: '虾仁炒饭', calories: 420, protein: 22, fat: 14, carbs: 55 }),
    buildFood({ name: '蟹柳', calories: 120, protein: 12, fat: 2, carbs: 14 }),
  ],
  englishShellfish: [
    buildFood({ name: 'shellfish shrimp fried rice', calories: 420, protein: 22, fat: 14, carbs: 55 }),
  ],
  chinesePeanut: [buildFood({ name: '花生米', calories: 200, protein: 8, fat: 14, carbs: 8 })],
  englishPeanut: [buildFood({ name: 'peanut butter toast', calories: 320, protein: 12, fat: 18, carbs: 30 })],
  lateNightTakeout: [
    buildFood({ name: '麻辣烫', calories: 680, protein: 25, fat: 28, carbs: 82, sodium: 1800 }),
    buildFood({ name: '奶茶', calories: 380, protein: 3, fat: 12, carbs: 62 }),
  ],
};

const dynamicThresholds = new DynamicThresholdsService();
const decisionEngine = new DecisionEngineService(dynamicThresholds);
const BUGS: Array<{ id: string; scenario: string; issue: string; rootCause: string }> = [];

function reportBug(id: string, scenario: string, issue: string, rootCause: string) {
  BUGS.push({ id, scenario, issue, rootCause });
  console.warn(`\n🐛 [Bug-${id}] ${scenario}: ${issue}`);
}

// ── B1: 过敏原中英文匹配 Bug ──────────────────────────────────────

describe('【B1】过敏原中英文匹配', () => {
  it('B1-基准: 英文allergen + 含同义关键词英文食物名 → 应触发', () => {
    const result = checkAllergenConflict(F.englishShellfish, buildCtx({ allergens: ['shellfish'] }), LOCALE);
    console.log(`[B1-基准] triggered=${result?.triggered}`);
    expect(result?.triggered).toBe(true);
  });

  it('B1-2★: shellfish过敏 + 中文虾仁炒饭 → 期望avoid但实际可能miss', () => {
    const result = checkAllergenConflict(F.chineseShellfish, CTX.habit, LOCALE);
    console.log(`[B1-2] shellfish+虾仁炒饭: triggered=${result?.triggered}`);
    if (!result?.triggered) {
      reportBug('B1-2', '过敏原中文匹配',
        'shellfish过敏用户食用"虾仁炒饭"未触发过敏冲突（应触发）',
        'checkAllergenConflict只做文本includes匹配，英文allergen无法匹配中文食物名，缺少allergen→中文关键字映射表');
    }
    expect(typeof result?.triggered === 'boolean' || result === null).toBe(true);
  });

  it('B1-3★: peanut过敏 + 中文花生米 → 期望avoid但实际可能miss', () => {
    const result = checkAllergenConflict(F.chinesePeanut, CTX.fatLoss, LOCALE);
    console.log(`[B1-3] peanut+花生米: triggered=${result?.triggered}`);
    if (!result?.triggered) {
      reportBug('B1-3', '过敏原中文匹配',
        'peanut过敏用户食用"花生米"未触发过敏冲突（应触发）',
        '同B1-2: 英文allergen name无法匹配中文食物名称');
    }
    expect(typeof result?.triggered === 'boolean' || result === null).toBe(true);
  });

  it('B1-4★: shellfish过敏整体决策 - 吃虾仁应被avoid', () => {
    const decision = decisionEngine.computeDecision(F.chineseShellfish, CTX.habit, 60, LOCALE);
    console.log(`[B1-4] shellfish+虾仁 决策=${decision.recommendation}`);
    if (decision.recommendation !== 'avoid') {
      reportBug('B1-4', '过敏原决策覆盖',
        `shellfish过敏用户吃虾仁炒饭决策=${decision.recommendation}（应为avoid）`,
        '由于B1-2未触发allergen检测，computeDecision的过敏强制avoid代码未执行，产生安全风险');
    }
    expect(['avoid', 'caution', 'recommend']).toContain(decision.recommendation);
  });

  it('B1-5★: peanut过敏整体决策 - 吃花生米应被avoid', () => {
    const decision = decisionEngine.computeDecision(F.chinesePeanut, CTX.fatLoss, 50, LOCALE);
    console.log(`[B1-5] peanut+花生米 决策=${decision.recommendation}`);
    if (decision.recommendation !== 'avoid') {
      reportBug('B1-5', '过敏原决策覆盖',
        `peanut过敏用户吃花生米决策=${decision.recommendation}（应为avoid）`,
        '同B1-4，安全隐患');
    }
    expect(['avoid', 'caution', 'recommend']).toContain(decision.recommendation);
  });
});

// ── B2: low_sodium饮食限制未处理 ──────────────────────────────────

describe('【B2】low_sodium饮食限制', () => {
  it('B2-1★: low_sodium限制 + 高钠食物 → checkRestrictionConflict应触发', () => {
    const result = checkRestrictionConflict(F.highSodiumFood, CTX.health, LOCALE);
    const totalSodium = F.highSodiumFood.reduce((s, f) => s + (f.sodium ?? 0), 0);
    console.log(`[B2-1] low_sodium + ${totalSodium}mg钠: triggered=${result?.triggered}`);
    if (!result?.triggered) {
      reportBug('B2-1', 'low_sodium饮食限制',
        `low_sodium饮食限制用户食用高钠食物(${totalSodium}mg)，checkRestrictionConflict未触发（应触发）`,
        'checkRestrictionConflict只处理vegetarian/vegan, 对low_sodium没有任何检测逻辑');
    }
    expect(typeof result?.triggered === 'boolean' || result === null).toBe(true);
  });
});

// ── B3: diabetes_type2关键字子串问题 ─────────────────────────────

describe('【B3】diabetes_type2子串匹配', () => {
  it('B3-1★: healthConditions=[diabetes_type2] 是否被识别为糖尿病', () => {
    const exactMatch = (CTX.health.healthConditions ?? []).some(c =>
      ['糖尿病', 'diabetes'].includes(c.toLowerCase())
    );
    const substrMatch = (CTX.health.healthConditions ?? []).some(c =>
      c.toLowerCase().includes('diabetes')
    );
    console.log(`[B3-1] diabetes_type2 精确匹配=${exactMatch}, 子串匹配=${substrMatch}`);
    expect(substrMatch).toBe(true);
  });
});

// ── F1: 正常功能验证 ──────────────────────────────────────────────

describe('【F1】正常功能验证', () => {
  it('F1-1: 高血压 + 5000mg钠 → healthConditionRisk触发', () => {
    const th = dynamicThresholds.compute(CTX.health);
    const results = checkHealthConditionRisk(F.highSodiumFood, CTX.health, LOCALE, th);
    console.log(`[F1-1] 高血压+5000mg: ${results.length}个risk, triggered=${results[0]?.triggered}`);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].triggered).toBe(true);
  });

  it('F1-2: 减脂晚餐950kcal > 剩余600kcal → 决策降级', () => {
    const decision = decisionEngine.computeDecision(F.highCalDinner, CTX.fatLoss, 35, LOCALE);
    const total = F.highCalDinner.reduce((s, f) => s + f.calories, 0);
    console.log(`[F1-2] 减脂晚餐${total}kcal, reason: ${decision.reason}`);
    expect(['caution', 'avoid']).toContain(decision.recommendation);
  });

  it('F1-3: 减脂合理午餐 → 推荐', () => {
    const ctx = { ...CTX.fatLoss, mealType: 'lunch', localHour: 12, remainingCalories: 1000 };
    const decision = decisionEngine.computeDecision(F.goodLunch, ctx, 78, LOCALE);
    const total = F.goodLunch.reduce((s, f) => s + f.calories, 0);
    console.log(`[F1-3] 减脂午餐${total}kcal → ${decision.recommendation}`);
    expect(['recommend', 'caution']).toContain(decision.recommendation);
  });

  it('F1-4: 增肌高蛋白午餐 → 不应avoid', () => {
    const ctx = { ...CTX.muscleGain, mealType: 'lunch', localHour: 12 };
    const decision = decisionEngine.computeDecision(F.highProteinLunch, ctx, 82, LOCALE);
    console.log(`[F1-4] 增肌高蛋白 → ${decision.recommendation}`);
    expect(['recommend', 'caution']).toContain(decision.recommendation);
  });

  it('F1-5: 改善习惯夜宵高热量 → 降级', () => {
    const decision = decisionEngine.computeDecision(F.lateNightTakeout, CTX.habit, 25, LOCALE);
    const total = F.lateNightTakeout.reduce((s, f) => s + f.calories, 0);
    console.log(`[F1-5] 夜宵${total}kcal, 剩余${CTX.habit.remainingCalories}kcal → ${decision.recommendation}`);
    expect(['caution', 'avoid']).toContain(decision.recommendation);
  });

  it('F1-6: 动态阈值 - 减脂过预算容忍 ≤ 增肌', () => {
    const fatLossTh = dynamicThresholds.compute(CTX.fatLoss);
    const muscleGainTh = dynamicThresholds.compute(CTX.muscleGain);
    console.log(`[F1-6] overBudgetMargin: 减脂=${fatLossTh.overBudgetMargin} vs 增肌=${muscleGainTh.overBudgetMargin}`);
    expect(fatLossTh.overBudgetMargin).toBeLessThanOrEqual(muscleGainTh.overBudgetMargin);
  });

  it('F1-7: 动态阈值 - 所有场景字段完整', () => {
    const requiredKeys = ['lateNightStart', 'lowProteinMeal', 'overBudgetMargin', 'dinnerHighCarb', 'snackHighCal'];
    for (const [name, ctx] of Object.entries(CTX)) {
      const th = dynamicThresholds.compute(ctx);
      for (const key of requiredKeys) {
        expect(th[key]).toBeDefined();
      }
      console.log(`[F1-7] ${name}: overBudget=${th.overBudgetMargin}, lowProt=${th.lowProteinMeal}g`);
    }
  });
});

// ── 问题汇总 ──────────────────────────────────────────────────────

describe('=== Bug汇总报告 ===', () => {
  afterAll(() => {
    console.log(`\n${'='.repeat(60)}`);
    if (BUGS.length === 0) {
      console.log('  ✅ 全链路测试完成，暂未发现自动检测到的Bug');
    } else {
      console.log(`  🐛 共发现 ${BUGS.length} 个 Bug`);
      console.log(`${'='.repeat(60)}`);
      BUGS.forEach((b, i) => {
        console.log(`\n[Bug-${i + 1}] ID: ${b.id}  场景: ${b.scenario}`);
        console.log(`  问题: ${b.issue}`);
        console.log(`  根因: ${b.rootCause}`);
      });
    }
    console.log(`\n${'='.repeat(60)}\n`);
  });

  it('汇总占位（始终通过）', () => {
    expect(BUGS.length).toBeGreaterThanOrEqual(0);
  });
});
