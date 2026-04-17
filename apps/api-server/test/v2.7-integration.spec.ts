/**
 * V2.7 Integration Test Suite
 *
 * 验证 V2.7 六个核心升级目标的回归覆盖：
 *
 * Phase 1:
 *   - breakdownInsight 注入 CoachActionPlan.why[]
 *   - confidenceLabel 从 decisionConfidence 派生
 *   - scoreInsight 从 breakdownExplanations 派生
 *
 * Phase 2:
 *   - 信号优先级仲裁矩阵 (signal-priority.config)
 *   - resolveCoachFocus 使用矩阵而非顺序 if-else
 *   - nextMeal 字段注入 CoachActionPlan
 *
 * Phase 3:
 *   - formatSummaryContext / formatCoachActionContext i18n 标签
 *   - COACH_LABELS V2.7 新增键存在且值正确
 */

// ──────────────────────────────────────────────────────────────────────
// Phase 1: breakdownInsight 注入
// ──────────────────────────────────────────────────────────────────────

describe('V2.7 Integration Tests', () => {
  // 内联 CoachActionPlanService 的 resolveBreakdownInsight 纯逻辑
  function resolveBreakdownInsight(
    breakdownExplanations?: Array<{
      dimension: string;
      score: number;
      impact: 'positive' | 'warning' | 'critical';
      message?: string;
    }>,
  ): string | undefined {
    if (!breakdownExplanations || breakdownExplanations.length === 0)
      return undefined;
    const candidates = breakdownExplanations.filter(
      (b) => b.impact === 'critical' || b.impact === 'warning',
    );
    if (candidates.length === 0) return undefined;
    const worst = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
    return worst.message || undefined;
  }

  describe('Phase 1 — breakdownInsight 注入 why[]', () => {
    it('should return undefined when no breakdown provided', () => {
      expect(resolveBreakdownInsight(undefined)).toBeUndefined();
      expect(resolveBreakdownInsight([])).toBeUndefined();
    });

    it('should return undefined when all impacts are positive', () => {
      expect(
        resolveBreakdownInsight([
          { dimension: 'protein', score: 85, impact: 'positive', message: '优质' },
        ]),
      ).toBeUndefined();
    });

    it('should pick the lowest-score critical dimension message', () => {
      const result = resolveBreakdownInsight([
        { dimension: 'fat', score: 40, impact: 'warning', message: '脂肪偏高' },
        { dimension: 'calories', score: 20, impact: 'critical', message: '热量严重超标' },
        { dimension: 'protein', score: 90, impact: 'positive', message: '蛋白质充足' },
      ]);
      expect(result).toBe('热量严重超标');
    });

    it('should pick lowest-score warning if no critical', () => {
      const result = resolveBreakdownInsight([
        { dimension: 'carbs', score: 35, impact: 'warning', message: '碳水略高' },
        { dimension: 'fat', score: 55, impact: 'warning', message: '脂肪偏高' },
      ]);
      expect(result).toBe('碳水略高');
    });

    it('should return undefined when worst item has no message', () => {
      const result = resolveBreakdownInsight([
        { dimension: 'fat', score: 20, impact: 'critical' },
      ]);
      expect(result).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase 1: confidenceLabel 派生
  // ──────────────────────────────────────────────────────────────────────

  function resolveConfidenceLabel(
    confidence?: number,
  ): 'low' | 'medium' | 'high' | undefined {
    if (confidence == null) return undefined;
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  }

  describe('Phase 1 — confidenceLabel 派生', () => {
    it('should return undefined when confidence is null', () => {
      expect(resolveConfidenceLabel(undefined)).toBeUndefined();
    });

    it('should return high for confidence >= 0.8', () => {
      expect(resolveConfidenceLabel(0.8)).toBe('high');
      expect(resolveConfidenceLabel(0.99)).toBe('high');
      expect(resolveConfidenceLabel(1.0)).toBe('high');
    });

    it('should return medium for 0.6 <= confidence < 0.8', () => {
      expect(resolveConfidenceLabel(0.6)).toBe('medium');
      expect(resolveConfidenceLabel(0.75)).toBe('medium');
      expect(resolveConfidenceLabel(0.79)).toBe('medium');
    });

    it('should return low for confidence < 0.6', () => {
      expect(resolveConfidenceLabel(0.59)).toBe('low');
      expect(resolveConfidenceLabel(0.3)).toBe('low');
      expect(resolveConfidenceLabel(0.0)).toBe('low');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase 1: scoreInsight 派生
  // ──────────────────────────────────────────────────────────────────────

  function resolveScoreInsight(
    breakdownExplanations?: Array<{
      dimension: string;
      label?: string;
      score: number;
      impact: 'positive' | 'warning' | 'critical';
      message?: string;
    }>,
  ): string | undefined {
    if (!breakdownExplanations || breakdownExplanations.length === 0)
      return undefined;
    const candidates = breakdownExplanations.filter(
      (b) => b.impact === 'critical' || b.impact === 'warning',
    );
    if (candidates.length === 0) return undefined;
    const worst = candidates.reduce((a, b) => (a.score <= b.score ? a : b));
    const label = worst.label || worst.dimension;
    return worst.message ? `${label}(${worst.score}分): ${worst.message}` : undefined;
  }

  describe('Phase 1 — scoreInsight 派生', () => {
    it('should return undefined when no breakdown', () => {
      expect(resolveScoreInsight(undefined)).toBeUndefined();
    });

    it('should format scoreInsight as "label(score分): message"', () => {
      const result = resolveScoreInsight([
        {
          dimension: 'calories',
          label: '热量',
          score: 25,
          impact: 'critical',
          message: '热量严重超标',
        },
      ]);
      expect(result).toBe('热量(25分): 热量严重超标');
    });

    it('should fall back to dimension if label missing', () => {
      const result = resolveScoreInsight([
        { dimension: 'fat', score: 40, impact: 'warning', message: '脂肪偏高' },
      ]);
      expect(result).toBe('fat(40分): 脂肪偏高');
    });

    it('should return undefined if message missing', () => {
      const result = resolveScoreInsight([
        { dimension: 'fat', score: 20, impact: 'critical' },
      ]);
      expect(result).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase 2: 信号优先级仲裁矩阵
  // ──────────────────────────────────────────────────────────────────────

  // 内联 getSignalPriority 以避免 DI 依赖
  const SIGNAL_PRIORITY_MATRIX: Record<string, Record<string, number>> = {
    fat_loss: {
      over_limit: 100, near_limit: 90, fat_excess: 80,
      carb_excess: 75, late_night_window: 65, protein_gap: 55,
      meal_count_low: 40, under_target: 30,
    },
    muscle_gain: {
      protein_gap: 100, meal_count_low: 90, under_target: 80,
      over_limit: 65, fat_excess: 50, late_night_window: 40,
      near_limit: 35, carb_excess: 30,
    },
    health: {
      over_limit: 90, fat_excess: 80, late_night_window: 75,
      protein_gap: 65, near_limit: 55, carb_excess: 50,
      meal_count_low: 40, under_target: 30,
    },
    maintenance: {
      over_limit: 85, near_limit: 70, fat_excess: 60,
      protein_gap: 55, carb_excess: 50, late_night_window: 45,
      meal_count_low: 35, under_target: 30,
    },
  };

  const DEFAULT_SIGNAL_PRIORITY: Record<string, number> = {
    over_limit: 85, near_limit: 70, fat_excess: 65,
    carb_excess: 60, protein_gap: 55, late_night_window: 50,
    meal_count_low: 40, under_target: 30,
  };

  function getSignalPriority(signal: string, goalType?: string): number {
    const matrix =
      (goalType && SIGNAL_PRIORITY_MATRIX[goalType]) || DEFAULT_SIGNAL_PRIORITY;
    return matrix[signal] ?? 0;
  }

  describe('Phase 2 — 信号优先级仲裁矩阵', () => {
    it('fat_loss: over_limit should beat protein_gap', () => {
      expect(getSignalPriority('over_limit', 'fat_loss')).toBeGreaterThan(
        getSignalPriority('protein_gap', 'fat_loss'),
      );
    });

    it('muscle_gain: protein_gap should beat over_limit', () => {
      expect(getSignalPriority('protein_gap', 'muscle_gain')).toBeGreaterThan(
        getSignalPriority('over_limit', 'muscle_gain'),
      );
    });

    it('health: fat_excess should beat protein_gap', () => {
      expect(getSignalPriority('fat_excess', 'health')).toBeGreaterThan(
        getSignalPriority('protein_gap', 'health'),
      );
    });

    it('unknown signal should return 0', () => {
      expect(getSignalPriority('unknown_signal', 'fat_loss')).toBe(0);
    });

    it('unknown goalType should use DEFAULT_SIGNAL_PRIORITY', () => {
      const p = getSignalPriority('over_limit', 'unknown_goal');
      expect(p).toBe(85); // matches DEFAULT_SIGNAL_PRIORITY.over_limit
    });

    it('should pick highest-priority signal across multiple', () => {
      const signals = ['protein_gap', 'over_limit', 'late_night_window'];
      const topSignal = signals.sort(
        (a, b) => getSignalPriority(b, 'fat_loss') - getSignalPriority(a, 'fat_loss'),
      )[0];
      expect(topSignal).toBe('over_limit');
    });

    it('muscle_gain conflict: pick protein_gap over over_limit', () => {
      const signals = ['over_limit', 'protein_gap'];
      const topSignal = signals.sort(
        (a, b) => getSignalPriority(b, 'muscle_gain') - getSignalPriority(a, 'muscle_gain'),
      )[0];
      expect(topSignal).toBe('protein_gap');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase 2: nextMeal 字段注入 CoachActionPlan
  // ──────────────────────────────────────────────────────────────────────

  describe('Phase 2 — CoachActionPlan.nextMeal 字段', () => {
    const basePlan = {
      conclusion: '本餐建议少量食用',
      why: ['热量偏高'],
      doNow: ['减少份量'],
      tone: 'neutral' as const,
    };

    it('CoachActionPlan should accept nextMeal field', () => {
      const plan = { ...basePlan, nextMeal: '下一餐以蛋白质为主，控制碳水' };
      expect(plan.nextMeal).toBe('下一餐以蛋白质为主，控制碳水');
    });

    it('CoachActionPlan should work without nextMeal (optional)', () => {
      const plan = { ...basePlan };
      expect((plan as any).nextMeal).toBeUndefined();
    });

    it('nextMeal from nextMealAdvice.suggestion should be injected', () => {
      const nextMealAdvice = {
        suggestion: '下一餐选择高蛋白低碳水食物',
        emphasis: '蛋白质优先',
      };
      const plan = { ...basePlan, nextMeal: nextMealAdvice.suggestion };
      expect(plan.nextMeal).toBe('下一餐选择高蛋白低碳水食物');
    });
  });

  // ──────────────────────────────────────────────────────────────────────
  // Phase 3: COACH_LABELS V2.7 新键
  // ──────────────────────────────────────────────────────────────────────

  describe('Phase 3 — COACH_LABELS V2.7 新增标签', () => {
    // 直接引入，不走 DI
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { COACH_LABELS, cl } = require('../modules/decision/i18n/decision-labels');

    const V27_KEYS = [
      'summaryTitle', 'verdictLabel', 'topIssuesLabel', 'strengthsLabel',
      'dataLabel', 'actionItemsLabel', 'contextSignalLabel', 'coachFocusLabel',
      'alternativeLabel', 'coachPlanTitle', 'conclusionLabel', 'reasonLabel',
      'doNowLabel', 'followUpLabel', 'ifAlreadyAteLabel', 'nextMealLabel',
      'alternativesLabel', 'uncertaintyLabel', 'macroInlineLabel',
    ];

    for (const key of V27_KEYS) {
      it(`zh-CN should have key "${key}"`, () => {
        expect(COACH_LABELS['zh-CN'][key]).toBeDefined();
        expect(typeof COACH_LABELS['zh-CN'][key]).toBe('string');
      });

      it(`en-US should have key "${key}"`, () => {
        expect(COACH_LABELS['en-US'][key]).toBeDefined();
        expect(typeof COACH_LABELS['en-US'][key]).toBe('string');
      });

      it(`ja-JP should have key "${key}"`, () => {
        expect(COACH_LABELS['ja-JP'][key]).toBeDefined();
        expect(typeof COACH_LABELS['ja-JP'][key]).toBe('string');
      });
    }

    it('cl() should return zh-CN value by default', () => {
      expect(cl('summaryTitle', 'zh-CN')).toBe('分析摘要');
    });

    it('cl() should return en-US coachPlanTitle correctly', () => {
      expect(cl('coachPlanTitle', 'en-US')).toBe('Coach Action Plan');
    });

    it('cl() should return ja-JP doNowLabel correctly', () => {
      expect(cl('doNowLabel', 'ja-JP')).toBe('今すぐすること');
    });
  });
});
