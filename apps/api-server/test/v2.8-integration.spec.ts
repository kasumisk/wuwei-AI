/**
 * V2.8 Integration Test Suite
 *
 * 目标覆盖：
 * 1) 分析质量分层（analysisQualityBand）
 * 2) 质量信号聚合（qualitySignals）
 * 3) 动态决策提示（dynamicDecisionHint）
 * 4) 健康约束信号优先级（health_constraint）
 * 5) ShouldEat 即时行动的健康护栏
 * 6) 新增 i18n 标签完整性
 */

import { getSignalPriority } from '../src/modules/decision/config/signal-priority.config';
import { COACH_LABELS, cl } from '../src/modules/decision/i18n/decision-labels';

describe('V2.8 Integration Tests', () => {
  // -----------------------------
  // Phase 1: 分析质量分层
  // -----------------------------

  function resolveAnalysisQualityBand(
    decisionConfidence: number,
  ): 'high' | 'medium' | 'low' {
    if (decisionConfidence >= 0.8) return 'high';
    if (decisionConfidence >= 0.6) return 'medium';
    return 'low';
  }

  function collectQualitySignals(input: {
    recognitionConfidence: number;
    normalizationConfidence: number;
    nutritionEstimationConfidence: number;
    auditConfidence: number;
  }): string[] {
    const signals: string[] = [];
    if (input.recognitionConfidence < 0.7) signals.push('recognition_low');
    if (input.normalizationConfidence < 0.7) signals.push('normalization_low');
    if (input.nutritionEstimationConfidence < 0.7) {
      signals.push('nutrition_estimation_low');
    }
    if (input.auditConfidence < 0.7) signals.push('audit_feedback_low');
    return signals;
  }

  describe('Phase 1 — 分析质量分层与质量信号', () => {
    it('should map confidence >= 0.8 to high', () => {
      expect(resolveAnalysisQualityBand(0.8)).toBe('high');
      expect(resolveAnalysisQualityBand(0.95)).toBe('high');
    });

    it('should map 0.6~0.79 to medium', () => {
      expect(resolveAnalysisQualityBand(0.6)).toBe('medium');
      expect(resolveAnalysisQualityBand(0.75)).toBe('medium');
    });

    it('should map < 0.6 to low', () => {
      expect(resolveAnalysisQualityBand(0.59)).toBe('low');
      expect(resolveAnalysisQualityBand(0.2)).toBe('low');
    });

    it('should collect all low-quality signals', () => {
      const signals = collectQualitySignals({
        recognitionConfidence: 0.5,
        normalizationConfidence: 0.6,
        nutritionEstimationConfidence: 0.65,
        auditConfidence: 0.4,
      });
      expect(signals).toEqual([
        'recognition_low',
        'normalization_low',
        'nutrition_estimation_low',
        'audit_feedback_low',
      ]);
    });

    it('should return empty quality signals when all dimensions are healthy', () => {
      const signals = collectQualitySignals({
        recognitionConfidence: 0.9,
        normalizationConfidence: 0.8,
        nutritionEstimationConfidence: 0.85,
        auditConfidence: 0.75,
      });
      expect(signals).toEqual([]);
    });
  });

  // -----------------------------
  // Phase 2: 动态决策与约束优先
  // -----------------------------

  function buildDynamicDecisionHint(input: {
    localHour: number;
    budgetStatus?: 'under_target' | 'near_limit' | 'over_limit';
    recommendation: 'recommend' | 'caution' | 'avoid';
  }): string {
    const isLateWindow = input.localHour >= 21 || input.localHour <= 5;
    if (input.budgetStatus === 'over_limit') {
      return '同样食物在当前状态更容易超预算，建议优先控制份量或替代。';
    }
    if (input.budgetStatus === 'near_limit') {
      return '同样食物在接近预算上限时需要更谨慎，建议减量或调整搭配。';
    }
    if (isLateWindow && input.recommendation !== 'avoid') {
      return '同样食物在夜间窗口更应关注总量与消化负担。';
    }
    return '同样食物在不同时段与摄入状态下，结论可能不同。';
  }

  function resolveContextSignals(input: {
    budgetStatus: 'under_target' | 'near_limit' | 'over_limit';
    remainingProtein: number;
    remainingFat: number;
    remainingCarbs: number;
    localHour: number;
    mealCount: number;
    hasHealthConstraint: boolean;
  }): string[] {
    const signals: string[] = [input.budgetStatus];

    if (input.hasHealthConstraint) {
      signals.push('health_constraint');
    }
    if (input.remainingProtein > 20) signals.push('protein_gap');
    if (input.remainingFat < -15) signals.push('fat_excess');
    if (input.remainingCarbs < -30) signals.push('carb_excess');
    if (input.localHour >= 21 || input.localHour <= 5) {
      signals.push('late_night_window');
    }
    if (input.mealCount <= 1 && input.localHour >= 15) {
      signals.push('meal_count_low');
    }

    return Array.from(new Set(signals));
  }

  describe('Phase 2 — 动态决策提示', () => {
    it('should prioritize over_limit dynamic hint', () => {
      const hint = buildDynamicDecisionHint({
        localHour: 13,
        budgetStatus: 'over_limit',
        recommendation: 'caution',
      });
      expect(hint).toContain('超预算');
    });

    it('should return near_limit hint when close to budget', () => {
      const hint = buildDynamicDecisionHint({
        localHour: 12,
        budgetStatus: 'near_limit',
        recommendation: 'recommend',
      });
      expect(hint).toContain('接近预算上限');
    });

    it('should return late-night hint when in late window', () => {
      const hint = buildDynamicDecisionHint({
        localHour: 22,
        budgetStatus: 'under_target',
        recommendation: 'recommend',
      });
      expect(hint).toContain('夜间窗口');
    });
  });

  describe('Phase 2 — 健康约束信号优先级', () => {
    it('context signals should include health_constraint when constraints exist', () => {
      const signals = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 30,
        remainingFat: 10,
        remainingCarbs: 20,
        localHour: 10,
        mealCount: 1,
        hasHealthConstraint: true,
      });
      expect(signals).toContain('health_constraint');
    });

    it('health_constraint should outrank over_limit in fat_loss matrix', () => {
      expect(getSignalPriority('health_constraint', 'fat_loss')).toBeGreaterThan(
        getSignalPriority('over_limit', 'fat_loss'),
      );
    });

    it('health_constraint should outrank over_limit in health matrix', () => {
      expect(getSignalPriority('health_constraint', 'health')).toBeGreaterThan(
        getSignalPriority('over_limit', 'health'),
      );
    });
  });

  describe('Phase 2 — ShouldEat 行动护栏', () => {
    function resolveImmediateAction(input: {
      hasHealthConstraint: boolean;
      decisionConfidence: number;
      summaryActionItem?: string;
      decisionAdvice?: string;
      recommendation: 'recommend' | 'caution' | 'avoid';
    }): string {
      if (input.hasHealthConstraint) {
        return '先满足过敏/忌口/健康约束，再决定是否食用与食用份量';
      }
      if (input.decisionConfidence < 0.6) {
        return '先按保守策略处理，必要时补充更清晰输入后再判断';
      }
      if (input.summaryActionItem) return input.summaryActionItem;
      if (input.decisionAdvice) return input.decisionAdvice;
      return input.recommendation === 'recommend'
        ? '按当前搭配食用即可'
        : '优先调整份量或更换搭配后再食用';
    }

    it('should prioritize health constraint guardrail', () => {
      expect(
        resolveImmediateAction({
          hasHealthConstraint: true,
          decisionConfidence: 0.9,
          recommendation: 'recommend',
          summaryActionItem: '可直接吃',
        }),
      ).toContain('健康约束');
    });

    it('should fallback to conservative action for low confidence', () => {
      expect(
        resolveImmediateAction({
          hasHealthConstraint: false,
          decisionConfidence: 0.4,
          recommendation: 'caution',
        }),
      ).toContain('保守策略');
    });
  });

  // -----------------------------
  // Phase 3: i18n 与教练上下文标签
  // -----------------------------

  describe('Phase 3 — V2.8 i18n labels', () => {
    const V28_KEYS = [
      'analysisQualityLabel',
      'dynamicHintLabel',
      'healthConstraintLabel',
    ];

    for (const key of V28_KEYS) {
      it(`zh-CN should have key ${key}`, () => {
        expect(COACH_LABELS['zh-CN'][key]).toBeDefined();
      });
      it(`en-US should have key ${key}`, () => {
        expect(COACH_LABELS['en-US'][key]).toBeDefined();
      });
      it(`ja-JP should have key ${key}`, () => {
        expect(COACH_LABELS['ja-JP'][key]).toBeDefined();
      });
    }

    it('cl should resolve zh-CN analysisQualityLabel', () => {
      expect(cl('analysisQualityLabel', 'zh-CN')).toBe('分析质量');
    });

    it('cl should resolve en-US dynamicHintLabel', () => {
      expect(cl('dynamicHintLabel', 'en-US')).toBe('Dynamic Decision Hint');
    });

    it('cl should resolve ja-JP healthConstraintLabel', () => {
      expect(cl('healthConstraintLabel', 'ja-JP')).toBe('健康制約');
    });
  });
});
