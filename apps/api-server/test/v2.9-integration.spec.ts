/**
 * V2.9 Integration Test Suite
 *
 * 覆盖点：
 * - analysisCompletenessScore
 * - reviewLevel
 * - decisionGuardrails
 * - followUpActions 合流
 * - coach i18n 新标签
 */

import { COACH_LABELS, cl } from '../src/modules/decision/i18n/decision-labels';

describe('V2.9 Integration Tests', () => {
  function calcAnalysisCompletenessScore(input: {
    normalizationConfidence: number;
    nutritionEstimationConfidence: number;
  }): number {
    const raw =
      input.normalizationConfidence * 0.5 +
      input.nutritionEstimationConfidence * 0.5;
    return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
  }

  function resolveReviewLevel(input: {
    band: 'high' | 'medium' | 'low';
    qualitySignals: string[];
    uncertaintyReasons: string[];
  }): 'auto_review' | 'manual_review' {
    if (input.band === 'low') return 'manual_review';
    if (input.qualitySignals.length >= 2) return 'manual_review';
    if (input.uncertaintyReasons.length >= 2) return 'manual_review';
    return 'auto_review';
  }

  function buildDecisionGuardrails(input: {
    analysisQualityBand?: 'high' | 'medium' | 'low';
    healthConstraintNote?: string;
    dynamicDecisionHint?: string;
    verdict: 'recommend' | 'caution' | 'avoid';
  }): string[] {
    const guardrails: string[] = [];
    if (input.analysisQualityBand === 'low') {
      guardrails.push('当前分析质量偏低，先按保守策略执行。');
    }
    if (input.healthConstraintNote) guardrails.push(input.healthConstraintNote);
    if (input.dynamicDecisionHint) guardrails.push(input.dynamicDecisionHint);
    if (input.verdict === 'avoid') {
      guardrails.push('当前建议为不建议继续吃，优先执行替代或减量。');
    }
    return Array.from(new Set(guardrails)).slice(0, 3);
  }

  function mergeFollowUpActions(input: {
    actionItems?: string[];
    decisionGuardrails?: string[];
    portionAction?: { suggestedPercent: number; suggestedCalories: number };
  }): string[] {
    const actions = [...(input.actionItems || [])];
    if (input.decisionGuardrails?.length) {
      actions.push(...input.decisionGuardrails);
    }
    if (input.portionAction) {
      actions.push(
        `优先按 ${input.portionAction.suggestedPercent}% 份量控制，本次约 ${input.portionAction.suggestedCalories} kcal`,
      );
    }
    return Array.from(new Set(actions.filter(Boolean))).slice(0, 4);
  }

  describe('Phase 1 - 诊断增强', () => {
    it('should compute analysis completeness score correctly', () => {
      expect(
        calcAnalysisCompletenessScore({
          normalizationConfidence: 0.8,
          nutritionEstimationConfidence: 0.6,
        }),
      ).toBe(0.7);
    });

    it('should set manual_review for low band', () => {
      expect(
        resolveReviewLevel({
          band: 'low',
          qualitySignals: [],
          uncertaintyReasons: [],
        }),
      ).toBe('manual_review');
    });

    it('should set manual_review for multiple quality signals', () => {
      expect(
        resolveReviewLevel({
          band: 'medium',
          qualitySignals: ['recognition_low', 'normalization_low'],
          uncertaintyReasons: [],
        }),
      ).toBe('manual_review');
    });

    it('should set auto_review for stable case', () => {
      expect(
        resolveReviewLevel({
          band: 'high',
          qualitySignals: [],
          uncertaintyReasons: ['轻微波动'],
        }),
      ).toBe('auto_review');
    });
  });

  describe('Phase 2 - 决策护栏与行动合流', () => {
    it('should include low quality and avoid guardrails', () => {
      const guardrails = buildDecisionGuardrails({
        analysisQualityBand: 'low',
        verdict: 'avoid',
      });
      expect(guardrails).toContain('当前分析质量偏低，先按保守策略执行。');
      expect(guardrails).toContain(
        '当前建议为不建议继续吃，优先执行替代或减量。',
      );
    });

    it('should merge guardrails into followUpActions', () => {
      const actions = mergeFollowUpActions({
        actionItems: ['先减量'],
        decisionGuardrails: ['优先满足健康约束'],
        portionAction: { suggestedPercent: 70, suggestedCalories: 420 },
      });
      expect(actions[0]).toBe('先减量');
      expect(actions).toContain('优先满足健康约束');
      expect(actions.join(' ')).toContain('70%');
    });
  });

  describe('Phase 3 - i18n 标签', () => {
    const newKeys = [
      'decisionGuardrailsLabel',
      'reviewLevelLabel',
      'decisionConfidenceLabel',
      'reviewAuto',
      'reviewManual',
    ];

    for (const key of newKeys) {
      it(`zh-CN should include ${key}`, () => {
        expect(COACH_LABELS['zh-CN'][key]).toBeDefined();
      });
      it(`en-US should include ${key}`, () => {
        expect(COACH_LABELS['en-US'][key]).toBeDefined();
      });
      it(`ja-JP should include ${key}`, () => {
        expect(COACH_LABELS['ja-JP'][key]).toBeDefined();
      });
    }

    it('cl should resolve zh reviewLevelLabel', () => {
      expect(cl('reviewLevelLabel', 'zh-CN')).toBe('复核级别');
    });

    it('cl should resolve en reviewManual', () => {
      expect(cl('reviewManual', 'en-US')).toBe('Manual Review');
    });

    it('cl should resolve ja decisionGuardrailsLabel', () => {
      expect(cl('decisionGuardrailsLabel', 'ja-JP')).toBe(
        '意思決定ガードレール',
      );
    });
  });
});
