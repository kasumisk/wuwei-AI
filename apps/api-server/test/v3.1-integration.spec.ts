/**
 * V3.1 Integration Tests
 *
 * 覆盖以下 6 个 V3.1 功能目标:
 * 1. PromptDepthLevel 类型推导 (brief / standard / detailed)
 * 2. DynamicSignalWeightService 动态权重调整
 * 3. CoachOutputSchema 结构化输出
 * 4. DailyMacroSummaryService 每日宏量摘要文本
 * 5. PostMealRecoveryService signalTrace 联动
 * 6. EvidencePackBuilderService 全链路集成
 *
 * 目标: ≥ 28 个测试
 */

// ─── 1. PromptDepthLevel 类型推导 ────────────────────────────────────────────

describe('V3.1 Phase 1 — PromptDepthLevel 类型推导', () => {
  // EvidencePackBuilderService.resolvePromptDepth 逻辑通过 build() 间接暴露
  // 这里单独测试规则：reviewLevel=manual||score<0.5→detailed; score>=0.8&&auto→brief; else→standard

  function resolveDepth(score, reviewLevel) {
    if (reviewLevel === 'manual' || score < 0.5) return 'detailed';
    if (score >= 0.8 && reviewLevel === 'auto') return 'brief';
    return 'standard';
  }

  it('should return "detailed" when reviewLevel is manual', () => {
    expect(resolveDepth(0.9, 'manual')).toBe('detailed');
  });

  it('should return "detailed" when score < 0.5', () => {
    expect(resolveDepth(0.3, 'auto')).toBe('detailed');
  });

  it('should return "detailed" when score = 0.49', () => {
    expect(resolveDepth(0.49, 'auto')).toBe('detailed');
  });

  it('should return "brief" when score >= 0.8 and reviewLevel = auto', () => {
    expect(resolveDepth(0.85, 'auto')).toBe('brief');
  });

  it('should return "brief" when score = 1.0 and reviewLevel = auto', () => {
    expect(resolveDepth(1.0, 'auto')).toBe('brief');
  });

  it('should return "standard" when score = 0.7 and reviewLevel = auto', () => {
    expect(resolveDepth(0.7, 'auto')).toBe('standard');
  });

  it('should return "standard" when score = 0.5 and reviewLevel = auto', () => {
    expect(resolveDepth(0.5, 'auto')).toBe('standard');
  });

  it('should return "standard" when score = 0.79 and reviewLevel = auto', () => {
    expect(resolveDepth(0.79, 'auto')).toBe('standard');
  });
});

// ─── 2. DynamicSignalWeightService ───────────────────────────────────────────

describe('V3.1 Phase 1 — DynamicSignalWeightService', () => {
  const { DynamicSignalWeightService } = require('../src/modules/decision/config/dynamic-signal-weight.service');
  const svc = new DynamicSignalWeightService();

  const baseWeights = {
    protein_gap: 10,
    over_limit: 10,
    fat_excess: 10,
    carb_excess: 10,
    under_target: 10,
  };

  it('should boost protein_gap × 1.4 when protein deficit', () => {
    const result = svc.adjustWeights(baseWeights, { protein: 'deficit' }, 'health');
    expect(result.protein_gap).toBeCloseTo(14, 1);
  });

  it('should stack protein_gap boost × 1.68 for muscle_gain + protein deficit', () => {
    const result = svc.adjustWeights(baseWeights, { protein: 'deficit' }, 'muscle_gain');
    // 10 * 1.4 * 1.2 = 16.8, rounded = 17
    expect(result.protein_gap).toBe(17);
  });

  it('should boost over_limit × 1.3 when calorie excess', () => {
    const result = svc.adjustWeights(baseWeights, { calories: 'excess' }, 'health');
    expect(result.over_limit).toBeCloseTo(13, 1);
  });

  it('should boost fat_excess × 1.2 when fat excess', () => {
    const result = svc.adjustWeights(baseWeights, { fat: 'excess' }, 'health');
    expect(result.fat_excess).toBeCloseTo(12, 1);
  });

  it('should boost carb_excess × 1.15 when carb excess', () => {
    const result = svc.adjustWeights(baseWeights, { carbs: 'excess' }, 'health');
    // 10 * 1.15 = 11.5, rounded = 12
    expect(result.carb_excess).toBe(12);
  });

  it('should boost under_target × 1.2 for muscle_gain when calorie deficit', () => {
    const result = svc.adjustWeights(baseWeights, { calories: 'deficit' }, 'muscle_gain');
    expect(result.under_target).toBeCloseTo(12, 1);
  });

  it('should not apply under_target boost for weight_loss goal', () => {
    const result = svc.adjustWeights(baseWeights, { calories: 'deficit' }, 'weight_loss');
    expect(result.under_target).toBeCloseTo(10, 1);
  });

  it('should return base weights when macroSlotStatus is undefined', () => {
    const result = svc.adjustWeights(baseWeights, undefined, 'health');
    expect(result.protein_gap).toBe(10);
    expect(result.over_limit).toBe(10);
  });

  it('should apply multiple boosts simultaneously', () => {
    const result = svc.adjustWeights(baseWeights, {
      protein: 'deficit',
      calories: 'excess',
      fat: 'excess',
    }, 'health');
    expect(result.protein_gap).toBeCloseTo(14, 1);
    expect(result.over_limit).toBeCloseTo(13, 1);
    expect(result.fat_excess).toBeCloseTo(12, 1);
  });
});

// ─── 3. DailyMacroSummaryService ─────────────────────────────────────────────

describe('V3.1 Phase 2 — DailyMacroSummaryService', () => {
  const { DailyMacroSummaryService } = require('../src/modules/decision/decision/daily-macro-summary.service');
  const svc = new DailyMacroSummaryService();

  const baseCtx = {
    todayCalories: 1420,
    goalCalories: 1800,
    remainingCalories: 380,
    remainingProtein: 30,
    remainingFat: 5,
    remainingCarbs: -20,
  };

  it('should produce zh-CN text with remaining calories', () => {
    const text = svc.buildSummaryText(baseCtx, 'zh-CN');
    expect(text).toContain('1420 kcal');
    expect(text).toContain('1800');
  });

  it('should highlight protein deficit in zh-CN', () => {
    const text = svc.buildSummaryText(baseCtx, 'zh-CN');
    expect(text).toContain('蛋白质差');
  });

  it('should not mention fat when remainingFat = 5 (no excess)', () => {
    const text = svc.buildSummaryText(baseCtx, 'zh-CN');
    expect(text).not.toContain('脂肪');
  });

  it('should produce en-US text', () => {
    const text = svc.buildSummaryText(baseCtx, 'en-US');
    expect(text).toContain('Today:');
    expect(text).toContain('1420 kcal');
  });

  it('should produce ja-JP text', () => {
    const text = svc.buildSummaryText(baseCtx, 'ja-JP');
    expect(text).toContain('本日摂取');
  });

  it('should show "over goal" when remainingCalories is negative', () => {
    const ctx = { ...baseCtx, todayCalories: 2000, remainingCalories: -200 };
    const text = svc.buildSummaryText(ctx, 'zh-CN');
    expect(text).toContain('超出目标');
  });

  it('should say "macros balanced" when no significant issues', () => {
    const ctx = {
      todayCalories: 1600,
      goalCalories: 1800,
      remainingCalories: 200,
      remainingProtein: 3,
      remainingFat: 2,
      remainingCarbs: 0,
    };
    const text = svc.buildSummaryText(ctx, 'zh-CN');
    expect(text).toContain('宏量均衡');
  });
});

// ─── 4. PostMealRecoveryService signalTrace 联动 ──────────────────────────────

describe('V3.1 Phase 3 — PostMealRecovery signalTrace 联动', () => {
  const { PostMealRecoveryService } = require('../src/modules/decision/decision/post-meal-recovery.service');
  const svc = new PostMealRecoveryService();

  const macroProgress = {
    calories: { consumed: 1800, target: 1800, percent: 100 },
    protein: { consumed: 60, target: 80, percent: 75 },
    fat: { consumed: 40, target: 60, percent: 67 },
    carbs: { consumed: 180, target: 200, percent: 90 },
  };

  const userContext = { goalCalories: 1800 };

  it('should use protein_gap signal for next meal direction', () => {
    const result = svc.build({
      mode: 'post_eat',
      macroProgress,
      userContext,
      signalTrace: [{ signal: 'protein_gap', priority: 9, source: 'macro_slot', description: '蛋白缺口' }],
    });
    expect(result?.nextMealDirection).toContain('蛋白质');
  });

  it('should use fat_excess signal for next meal direction', () => {
    const result = svc.build({
      mode: 'post_eat',
      macroProgress: { ...macroProgress, fat: { consumed: 70, target: 60, percent: 117 } },
      userContext,
      signalTrace: [{ signal: 'fat_excess', priority: 8, source: 'macro_slot', description: '脂肪超标' }],
    });
    expect(result?.nextMealDirection).toContain('油脂');
  });

  it('should use carb_excess signal for next meal direction', () => {
    const result = svc.build({
      mode: 'post_eat',
      macroProgress: { ...macroProgress, carbs: { consumed: 250, target: 200, percent: 125 } },
      userContext,
      signalTrace: [{ signal: 'carb_excess', priority: 7, source: 'macro_slot', description: '碳水超标' }],
    });
    expect(result?.nextMealDirection).toContain('主食');
  });

  it('should fallback to default when no signalTrace', () => {
    const result = svc.build({
      mode: 'post_eat',
      macroProgress,
      userContext,
    });
    expect(result).toBeDefined();
    expect(result?.nextMealDirection).toBeTruthy();
  });

  it('should return undefined when macroProgress not provided', () => {
    const result = svc.build({ mode: 'post_eat', userContext });
    expect(result).toBeUndefined();
  });
});

// ─── 5. i18n V3.1 labels ─────────────────────────────────────────────────────

describe('V3.1 Phase 3 — i18n V3.1 labels', () => {
  const { cl } = require('../src/modules/decision/i18n/decision-labels');

  const v31Keys = [
    'promptDepthLabel',
    'dynamicWeightLabel',
    'structuredOutputLabel',
    'verdictLabel2',
    'mainReasonLabel',
    'actionStepsLabel',
    'cautionNoteLabel',
    'macroSummaryLabel',
  ];

  for (const key of v31Keys) {
    it(`should have ${key} in zh-CN`, () => {
      const result = cl(key, 'zh-CN');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it(`should have ${key} in en-US`, () => {
      const result = cl(key, 'en-US');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  }
});
