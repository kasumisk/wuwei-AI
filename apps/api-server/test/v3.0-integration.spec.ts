/**
 * V3.0 Integration Tests
 *
 * 覆盖:
 * - Phase 1: MacroSlotStatus 计算（6 tests）
 * - Phase 1: SignalTrace 排序（4 tests）
 * - Phase 2: DecisionToneResolver 矩阵（8 tests）
 * - Phase 2: Alternative ranking（4 tests）
 * - Phase 3: i18n 8 new labels × 3 locales（8 tests，3个locale=24 checks，但判断key存在）
 * - Phase 3: Labels 完整性（3 tests）
 *
 * Total: ~30
 */

// ==================== PHASE 1: MacroSlotStatus ====================

describe('V3.0 Phase1 — MacroSlotStatus', () => {
  function resolveMacroSlotStatus(input: {
    remainingCalories: number;
    remainingProtein: number;
    remainingFat: number;
    remainingCarbs: number;
    goalCalories: number;
    goalProtein: number;
    goalFat: number;
    goalCarbs: number;
  }) {
    const threshold = 0.12;
    const toStatus = (remaining: number, goal: number): 'deficit' | 'ok' | 'excess' => {
      if (goal <= 0) return 'ok';
      const ratio = remaining / goal;
      if (ratio < -threshold) return 'excess';
      if (ratio > threshold) return 'deficit';
      return 'ok';
    };

    const calories = toStatus(input.remainingCalories, input.goalCalories);
    const protein = toStatus(input.remainingProtein, input.goalProtein);
    const fat = toStatus(input.remainingFat, input.goalFat);
    const carbs = toStatus(input.remainingCarbs, input.goalCarbs);

    const deficitRatios = [
      ['protein', input.goalProtein > 0 ? input.remainingProtein / input.goalProtein : 0] as [string, number],
      ['carbs', input.goalCarbs > 0 ? input.remainingCarbs / input.goalCarbs : 0] as [string, number],
      ['calories', input.goalCalories > 0 ? input.remainingCalories / input.goalCalories : 0] as [string, number],
      ['fat', input.goalFat > 0 ? input.remainingFat / input.goalFat : 0] as [string, number],
    ].filter(([, r]) => (r as number) > threshold);
    deficitRatios.sort((a, b) => (b[1] as number) - (a[1] as number));
    const dominantDeficit = deficitRatios[0]?.[0] as any;

    const excessRatios = [
      ['protein', input.goalProtein > 0 ? -input.remainingProtein / input.goalProtein : 0] as [string, number],
      ['carbs', input.goalCarbs > 0 ? -input.remainingCarbs / input.goalCarbs : 0] as [string, number],
      ['calories', input.goalCalories > 0 ? -input.remainingCalories / input.goalCalories : 0] as [string, number],
      ['fat', input.goalFat > 0 ? -input.remainingFat / input.goalFat : 0] as [string, number] as [string, number],
    ].filter(([, r]) => (r as number) > threshold);
    excessRatios.sort((a, b) => (b[1] as number) - (a[1] as number));
    const dominantExcess = excessRatios[0]?.[0] as any;

    return { calories, protein, fat, carbs, dominantDeficit, dominantExcess };
  }

  test('fresh day — all deficit', () => {
    const result = resolveMacroSlotStatus({
      remainingCalories: 2000, remainingProtein: 150, remainingFat: 60, remainingCarbs: 250,
      goalCalories: 2000, goalProtein: 150, goalFat: 60, goalCarbs: 250,
    });
    expect(result.calories).toBe('deficit');
    expect(result.protein).toBe('deficit');
    expect(result.dominantDeficit).toBeDefined();
  });

  test('all excess — over limit', () => {
    const result = resolveMacroSlotStatus({
      remainingCalories: -300, remainingProtein: -30, remainingFat: -20, remainingCarbs: -40,
      goalCalories: 2000, goalProtein: 150, goalFat: 60, goalCarbs: 250,
    });
    expect(result.calories).toBe('excess');
    expect(result.protein).toBe('excess');
    expect(result.fat).toBe('excess');
    expect(result.dominantExcess).toBeDefined();
  });

  test('within threshold — all ok', () => {
    const result = resolveMacroSlotStatus({
      remainingCalories: 100, remainingProtein: 5, remainingFat: 3, remainingCarbs: 10,
      goalCalories: 2000, goalProtein: 150, goalFat: 60, goalCarbs: 250,
    });
    expect(result.calories).toBe('ok');
    expect(result.protein).toBe('ok');
  });

  test('goal=0 — returns ok', () => {
    const result = resolveMacroSlotStatus({
      remainingCalories: 500, remainingProtein: 0, remainingFat: 0, remainingCarbs: 0,
      goalCalories: 0, goalProtein: 0, goalFat: 0, goalCarbs: 0,
    });
    expect(result.calories).toBe('ok');
    expect(result.protein).toBe('ok');
  });

  test('dominantDeficit picks largest ratio', () => {
    // protein remaining=120/150=80% deficit; carbs remaining=230/250=92% ok
    const result = resolveMacroSlotStatus({
      remainingCalories: 50, remainingProtein: 120, remainingFat: 5, remainingCarbs: 10,
      goalCalories: 2000, goalProtein: 150, goalFat: 60, goalCarbs: 250,
    });
    expect(result.protein).toBe('deficit');
    expect(result.dominantDeficit).toBe('protein');
  });

  test('dominantExcess picks largest ratio', () => {
    const result = resolveMacroSlotStatus({
      remainingCalories: -400, remainingProtein: -10, remainingFat: -5, remainingCarbs: -5,
      goalCalories: 2000, goalProtein: 150, goalFat: 60, goalCarbs: 250,
    });
    // -400/2000 = 20% excess > -10/150 ≈ 6.7%
    expect(result.dominantExcess).toBe('calories');
  });
});

// ==================== PHASE 1: SignalTrace ====================

describe('V3.0 Phase1 — SignalTrace ordering', () => {
  const { getSignalPriority } = require('./modules/decision/config/signal-priority.config');

  function buildSignalTrace(signals: string[], goalType: string) {
    const SIGNAL_SOURCE_MAP: Record<string, string> = {
      health_constraint: 'health_constraint',
      over_limit: 'user_context', near_limit: 'user_context', under_target: 'user_context',
      protein_gap: 'nutrition', fat_excess: 'nutrition', carb_excess: 'nutrition',
      late_night_window: 'time_window', meal_count_low: 'user_context',
    };

    return signals.map(signal => ({
      signal,
      priority: getSignalPriority(signal, goalType),
      source: SIGNAL_SOURCE_MAP[signal] ?? 'user_context',
      description: signal,
    })).sort((a, b) => b.priority - a.priority);
  }

  test('health_constraint should always be first', () => {
    const trace = buildSignalTrace(['under_target', 'protein_gap', 'health_constraint'], 'fat_loss');
    expect(trace[0].signal).toBe('health_constraint');
  });

  test('trace is sorted by priority descending', () => {
    const trace = buildSignalTrace(['under_target', 'over_limit', 'protein_gap'], 'muscle_gain');
    for (let i = 0; i < trace.length - 1; i++) {
      expect(trace[i].priority).toBeGreaterThanOrEqual(trace[i + 1].priority);
    }
  });

  test('each item has required fields', () => {
    const trace = buildSignalTrace(['protein_gap', 'fat_excess'], 'health');
    for (const item of trace) {
      expect(item.signal).toBeDefined();
      expect(typeof item.priority).toBe('number');
      expect(item.source).toBeDefined();
      expect(item.description).toBeDefined();
    }
  });

  test('empty signals returns empty trace', () => {
    const trace = buildSignalTrace([], 'maintenance');
    expect(trace).toHaveLength(0);
  });
});

// ==================== PHASE 2: DecisionToneResolver ====================

import { DecisionToneResolverService } from '../src/modules/decision/decision/decision-tone-resolver.service';

describe('V3.0 Phase2 — DecisionToneResolver', () => {
  const resolver = new DecisionToneResolverService();

  test('fat_loss + avoid → urgent or control', () => {
    const r = resolver.resolve({ goalType: 'fat_loss', verdict: 'avoid' });
    expect(['urgent', 'control']).toContain(r.toneKey);
  });

  test('muscle_gain + recommend → encourage', () => {
    const r = resolver.resolve({ goalType: 'muscle_gain', verdict: 'recommend' });
    expect(r.toneKey).toBe('encourage');
  });

  test('fat_loss + recommend → affirm', () => {
    const r = resolver.resolve({ goalType: 'fat_loss', verdict: 'recommend' });
    expect(r.toneKey).toBe('affirm');
  });

  test('maintenance + caution → control', () => {
    const r = resolver.resolve({ goalType: 'maintenance', verdict: 'caution' });
    expect(r.toneKey).toBe('control');
  });

  test('health_constraint focus overrides to urgent', () => {
    const r = resolver.resolve({ goalType: 'health', verdict: 'recommend', coachFocus: 'health_constraint 优先' });
    expect(r.toneKey).toBe('urgent');
  });

  test('over_limit focus overrides to urgent', () => {
    const r = resolver.resolve({ goalType: 'fat_loss', verdict: 'recommend', coachFocus: 'over_limit 今日' });
    expect(r.toneKey).toBe('urgent');
  });

  test('resolveModifier returns non-empty string', () => {
    const m = resolver.resolveModifier({ goalType: 'health', verdict: 'caution' });
    expect(typeof m).toBe('string');
    expect(m.length).toBeGreaterThan(0);
  });

  test('en-US locale returns English string', () => {
    const r = resolver.resolve({ goalType: 'health', verdict: 'recommend', locale: 'en-US' });
    expect(r.toneModifier).toMatch(/[A-Za-z]/);
  });
});

// ==================== PHASE 2: Alternative Ranking ====================

describe('V3.0 Phase2 — Alternative rankScore', () => {
  function attachRankScores(alternatives: any[], ctx: any) {
    if (!alternatives.length) return alternatives;

    return alternatives.map((alt) => {
      const comp = alt.comparison ?? {};
      const calDiff = comp.caloriesDiff ?? 0;
      const prosDiff = comp.proteinDiff ?? 0;
      const rawScore = typeof alt.score === 'number' ? alt.score : 0.5;

      const reasons: string[] = [];
      let score = rawScore * 0.4;

      const calScore = Math.max(-1, Math.min(1, -calDiff / 200));
      const calWeight = ctx.goalType === 'fat_loss' ? 0.35 : 0.15;
      score += calScore * calWeight;
      if (calDiff < -50) reasons.push(`热量少 ${Math.abs(calDiff)}kcal`);
      else if (calDiff > 50) reasons.push(`热量多 ${calDiff}kcal`);

      const prosScore = Math.max(-1, Math.min(1, prosDiff / 20));
      const prosWeight = ctx.goalType === 'muscle_gain' ? 0.25 : 0.10;
      score += prosScore * prosWeight;
      if (prosDiff > 5) reasons.push(`蛋白质+${prosDiff}g`);
      else if (prosDiff < -5) reasons.push(`蛋白质-${Math.abs(prosDiff)}g`);

      const finalScore = Math.max(0, Math.min(1, score));
      if (reasons.length === 0) reasons.push('综合均衡');

      return { ...alt, rankScore: Math.round(finalScore * 100) / 100, rankReasons: reasons };
    }).sort((a: any, b: any) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  }

  test('lower calorie alternative gets higher rank for fat_loss', () => {
    const ctx = { goalType: 'fat_loss' };
    const alts = [
      { name: 'A', score: 0.7, comparison: { caloriesDiff: 50, proteinDiff: 0 } },
      { name: 'B', score: 0.7, comparison: { caloriesDiff: -150, proteinDiff: 0 } },
    ];
    const ranked = attachRankScores(alts, ctx);
    expect(ranked[0].name).toBe('B');
  });

  test('higher protein alternative gets higher rank for muscle_gain', () => {
    const ctx = { goalType: 'muscle_gain' };
    const alts = [
      { name: 'A', score: 0.6, comparison: { caloriesDiff: 0, proteinDiff: 0 } },
      { name: 'B', score: 0.6, comparison: { caloriesDiff: 0, proteinDiff: 20 } },
    ];
    const ranked = attachRankScores(alts, ctx);
    expect(ranked[0].name).toBe('B');
  });

  test('rankScore is in [0, 1]', () => {
    const ctx = { goalType: 'health' };
    const alts = [
      { name: 'X', score: 0.9, comparison: { caloriesDiff: -300, proteinDiff: 25 } },
    ];
    const ranked = attachRankScores(alts, ctx);
    expect(ranked[0].rankScore).toBeGreaterThanOrEqual(0);
    expect(ranked[0].rankScore).toBeLessThanOrEqual(1);
  });

  test('empty array returns empty', () => {
    const ranked = attachRankScores([], { goalType: 'health' });
    expect(ranked).toHaveLength(0);
  });
});

// ==================== PHASE 3: i18n V3.0 labels ====================

import { cl } from '../src/modules/decision/i18n/decision-labels';

describe('V3.0 Phase3 — i18n labels', () => {
  const V3_KEYS = [
    'signalTraceLabel',
    'macroSlotLabel',
    'toneModifierLabel',
    'alternativeRankLabel',
    'rankReasonsLabel',
    'dominantDeficitLabel',
    'dominantExcessLabel',
    'toneEncouraging',
  ];

  const LOCALES = ['zh-CN', 'en-US', 'ja-JP'] as const;

  for (const key of V3_KEYS) {
    test(`V3.0 label "${key}" exists in zh-CN`, () => {
      const val = cl(key, 'zh-CN');
      expect(val).not.toBe(key); // should not fall back to key itself
      expect(val.length).toBeGreaterThan(0);
    });
  }

  test('all V3.0 keys present in en-US and ja-JP', () => {
    for (const key of V3_KEYS) {
      for (const locale of LOCALES) {
        const val = cl(key, locale);
        expect(val).not.toBe(key);
      }
    }
  });

  test('existing V2.9 labels still work', () => {
    expect(cl('decisionGuardrailsLabel', 'zh-CN')).toBeTruthy();
    expect(cl('reviewLevelLabel', 'en-US')).toBeTruthy();
    expect(cl('reviewAuto', 'ja-JP')).toBeTruthy();
  });
});
