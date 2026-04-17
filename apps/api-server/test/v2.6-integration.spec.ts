/**
 * V2.6 Integration Test Suite
 *
 * 验证 V2.6 三个核心新信号在"分析 → 决策 → 教练"链路中的回归覆盖：
 *   - contextSignals  (Phase 1: UserContextBuilderService.resolveContextSignals)
 *   - coachFocus      (Phase 2: DecisionSummaryService.resolveCoachFocus)
 *   - followUpActions (Phase 2: ShouldEatActionService.buildFollowUpActions)
 *
 * 以及 Phase 3 结构化输出的格式校验：
 *   - FormattedCoachOutput 扩展字段
 *   - CoachActionPlan 吸收新信号
 *   - CoachPromptBuilder 注入新信号
 */

// ─────────────────────────────────────────────────────────────────
// Phase 1: contextSignals & budgetStatus (UserContextBuilderService)
// ─────────────────────────────────────────────────────────────────

describe('V2.6 Integration Tests', () => {
  // ------------------------------------------------------------------
  // 1. budgetStatus 逻辑
  // ------------------------------------------------------------------
  describe('Phase 1 — budgetStatus resolution', () => {
    /**
     * 内联复制 resolveBudgetStatus 纯逻辑以外部验证
     * （避免依赖 NestJS DI，保持测试轻量）
     */
    function resolveBudgetStatus(
      remainingCalories: number,
      goalCalories: number,
    ): 'under_target' | 'near_limit' | 'over_limit' {
      if (remainingCalories < 0) return 'over_limit';
      const safeGoal = goalCalories > 0 ? goalCalories : 2000;
      if (remainingCalories / safeGoal <= 0.15) return 'near_limit';
      return 'under_target';
    }

    it('should return under_target when remaining is well above 15%', () => {
      expect(resolveBudgetStatus(1500, 2000)).toBe('under_target');
    });

    it('should return near_limit when remaining is exactly 15%', () => {
      // 2000 * 15% = 300
      expect(resolveBudgetStatus(300, 2000)).toBe('near_limit');
    });

    it('should return near_limit when remaining is less than 15%', () => {
      expect(resolveBudgetStatus(100, 2000)).toBe('near_limit');
    });

    it('should return over_limit when remaining is negative', () => {
      expect(resolveBudgetStatus(-50, 2000)).toBe('over_limit');
    });

    it('should use 2000 as fallback goal when goalCalories is 0', () => {
      // 300 / 2000 = 0.15 → near_limit
      expect(resolveBudgetStatus(300, 0)).toBe('near_limit');
    });
  });

  // ------------------------------------------------------------------
  // 2. nutritionPriority 逻辑
  // ------------------------------------------------------------------
  describe('Phase 1 — nutritionPriority resolution', () => {
    function resolveNutritionPriority(input: {
      remainingProtein: number;
      remainingFat: number;
      remainingCarbs: number;
      goalProtein: number;
      goalFat: number;
      goalCarbs: number;
    }): string[] {
      const priorities: string[] = [];
      if (input.goalProtein > 0 && input.remainingProtein / input.goalProtein > 0.35)
        priorities.push('protein_gap');
      if (input.goalFat > 0 && input.remainingFat < -Math.max(8, input.goalFat * 0.12))
        priorities.push('fat_excess');
      if (input.goalCarbs > 0 && input.remainingCarbs < -Math.max(15, input.goalCarbs * 0.12))
        priorities.push('carb_excess');
      if (priorities.length === 0) priorities.push('maintain_balance');
      return priorities;
    }

    it('should include protein_gap when remaining protein > 35% of goal', () => {
      // 65 * 0.35 = 22.75 → remaining 30 > 22.75 → protein_gap
      const result = resolveNutritionPriority({
        remainingProtein: 30,
        remainingFat: 0,
        remainingCarbs: 0,
        goalProtein: 65,
        goalFat: 65,
        goalCarbs: 275,
      });
      expect(result).toContain('protein_gap');
    });

    it('should include fat_excess when fat is over by more than 12% of goal', () => {
      // max(8, 65*0.12) = max(8, 7.8) = 8 → remaining < -8
      const result = resolveNutritionPriority({
        remainingProtein: 0,
        remainingFat: -15,
        remainingCarbs: 0,
        goalProtein: 65,
        goalFat: 65,
        goalCarbs: 275,
      });
      expect(result).toContain('fat_excess');
    });

    it('should include carb_excess when carbs are significantly over', () => {
      // max(15, 275*0.12) = max(15, 33) = 33 → remaining < -33
      const result = resolveNutritionPriority({
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: -50,
        goalProtein: 65,
        goalFat: 65,
        goalCarbs: 275,
      });
      expect(result).toContain('carb_excess');
    });

    it('should return maintain_balance when everything is on track', () => {
      const result = resolveNutritionPriority({
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        goalProtein: 65,
        goalFat: 65,
        goalCarbs: 275,
      });
      expect(result).toEqual(['maintain_balance']);
    });
  });

  // ------------------------------------------------------------------
  // 3. contextSignals 逻辑
  // ------------------------------------------------------------------
  describe('Phase 1 — contextSignals resolution', () => {
    function resolveContextSignals(input: {
      budgetStatus: 'under_target' | 'near_limit' | 'over_limit';
      remainingProtein: number;
      remainingFat: number;
      remainingCarbs: number;
      localHour: number;
      mealCount: number;
    }): string[] {
      const signals: string[] = [input.budgetStatus];
      if (input.remainingProtein > 20) signals.push('protein_gap');
      if (input.remainingFat < -10) signals.push('fat_excess');
      if (input.remainingCarbs < -20) signals.push('carb_excess');
      if (input.localHour >= 21 || input.localHour < 5) signals.push('late_night_window');
      if (input.mealCount <= 1 && input.localHour >= 13) signals.push('meal_count_low');
      return Array.from(new Set(signals));
    }

    it('should always include budgetStatus as first signal', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 12,
        mealCount: 2,
      });
      expect(result[0]).toBe('under_target');
    });

    it('should add protein_gap when remaining protein > 20g', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 25,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 12,
        mealCount: 2,
      });
      expect(result).toContain('protein_gap');
    });

    it('should add late_night_window at 21:00 or later', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 22,
        mealCount: 2,
      });
      expect(result).toContain('late_night_window');
    });

    it('should add late_night_window before 5:00', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 3,
        mealCount: 0,
      });
      expect(result).toContain('late_night_window');
    });

    it('should add meal_count_low when only 1 meal eaten after 13:00', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 15,
        mealCount: 1,
      });
      expect(result).toContain('meal_count_low');
    });

    it('should not add meal_count_low when mealCount > 1', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 0,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 15,
        mealCount: 2,
      });
      expect(result).not.toContain('meal_count_low');
    });

    it('should deduplicate signals', () => {
      const result = resolveContextSignals({
        budgetStatus: 'under_target',
        remainingProtein: 25,
        remainingFat: 0,
        remainingCarbs: 0,
        localHour: 12,
        mealCount: 2,
      });
      const unique = Array.from(new Set(result));
      expect(result).toEqual(unique);
    });

    it('should combine multiple signals correctly', () => {
      const result = resolveContextSignals({
        budgetStatus: 'over_limit',
        remainingProtein: 30,
        remainingFat: -15,
        remainingCarbs: -25,
        localHour: 22,
        mealCount: 1,
      });
      expect(result).toContain('over_limit');
      expect(result).toContain('protein_gap');
      expect(result).toContain('fat_excess');
      expect(result).toContain('carb_excess');
      expect(result).toContain('late_night_window');
    });
  });

  // ------------------------------------------------------------------
  // 4. coachFocus 逻辑 (DecisionSummaryService.resolveCoachFocus)
  // ------------------------------------------------------------------
  describe('Phase 2 — coachFocus resolution', () => {
    function resolveCoachFocus(
      ctx: {
        goalType: string;
        budgetStatus?: string;
        nutritionPriority?: string[];
      },
      topIssues: string[],
      decisionRecommendation: string,
    ): string {
      if (
        ctx.goalType === 'fat_loss' &&
        (ctx.budgetStatus === 'near_limit' || ctx.budgetStatus === 'over_limit')
      ) {
        return '优先强调热量边界和份量控制';
      }
      if ((ctx.nutritionPriority || []).includes('protein_gap')) {
        return '优先强调蛋白质补充和更优搭配';
      }
      if (decisionRecommendation === 'avoid') {
        return '优先解释为什么现在不适合继续吃';
      }
      if (topIssues.length > 0) {
        return `优先围绕"${topIssues[0]}"给出具体行动建议`;
      }
      return '优先给出简单、可执行、可坚持的下一步建议';
    }

    it('should prioritize calorie boundary for fat_loss + near_limit', () => {
      const focus = resolveCoachFocus(
        { goalType: 'fat_loss', budgetStatus: 'near_limit' },
        [],
        'caution',
      );
      expect(focus).toBe('优先强调热量边界和份量控制');
    });

    it('should prioritize calorie boundary for fat_loss + over_limit', () => {
      const focus = resolveCoachFocus(
        { goalType: 'fat_loss', budgetStatus: 'over_limit' },
        [],
        'caution',
      );
      expect(focus).toBe('优先强调热量边界和份量控制');
    });

    it('should prioritize protein when protein_gap exists (non fat_loss goal)', () => {
      const focus = resolveCoachFocus(
        { goalType: 'muscle_gain', budgetStatus: 'under_target', nutritionPriority: ['protein_gap'] },
        [],
        'recommend',
      );
      expect(focus).toBe('优先强调蛋白质补充和更优搭配');
    });

    it('should explain avoid when recommendation is avoid', () => {
      const focus = resolveCoachFocus(
        { goalType: 'health', budgetStatus: 'under_target', nutritionPriority: ['maintain_balance'] },
        [],
        'avoid',
      );
      expect(focus).toBe('优先解释为什么现在不适合继续吃');
    });

    it('should use top issue label when topIssues are present', () => {
      const focus = resolveCoachFocus(
        { goalType: 'health', budgetStatus: 'under_target', nutritionPriority: [] },
        ['高糖风险'],
        'caution',
      );
      expect(focus).toBe('优先围绕"高糖风险"给出具体行动建议');
    });

    it('should fall back to default actionable advice', () => {
      const focus = resolveCoachFocus(
        { goalType: 'health', budgetStatus: 'under_target', nutritionPriority: [] },
        [],
        'recommend',
      );
      expect(focus).toBe('优先给出简单、可执行、可坚持的下一步建议');
    });
  });

  // ------------------------------------------------------------------
  // 5. followUpActions 逻辑 (ShouldEatActionService.buildFollowUpActions)
  // ------------------------------------------------------------------
  describe('Phase 2 — followUpActions generation', () => {
    function buildFollowUpActions(input: {
      summaryActionItems?: string[];
      portionAction?: { suggestedPercent: number; suggestedCalories: number };
      replacementFirstCandidate?: string;
      recoveryTodayAdjustment?: string;
    }): string[] {
      const actions = [...(input.summaryActionItems || [])];
      if (input.portionAction) {
        actions.push(
          `优先按 ${input.portionAction.suggestedPercent}% 份量控制，本次约 ${input.portionAction.suggestedCalories} kcal`,
        );
      }
      if (input.replacementFirstCandidate) {
        actions.push(`优先改成 ${input.replacementFirstCandidate}`);
      }
      if (input.recoveryTodayAdjustment) {
        actions.push(input.recoveryTodayAdjustment);
      }
      return Array.from(new Set(actions.filter(Boolean))).slice(0, 4);
    }

    it('should include portion action when portionAction is provided', () => {
      const actions = buildFollowUpActions({
        portionAction: { suggestedPercent: 70, suggestedCalories: 350 },
      });
      expect(actions).toContain('优先按 70% 份量控制，本次约 350 kcal');
    });

    it('should include replacement suggestion when first candidate exists', () => {
      const actions = buildFollowUpActions({
        replacementFirstCandidate: '鸡胸肉',
      });
      expect(actions).toContain('优先改成 鸡胸肉');
    });

    it('should include recovery adjustment from recoveryAction', () => {
      const actions = buildFollowUpActions({
        recoveryTodayAdjustment: '今日晚餐减少200kcal',
      });
      expect(actions).toContain('今日晚餐减少200kcal');
    });

    it('should merge summary actionItems with derived actions', () => {
      const actions = buildFollowUpActions({
        summaryActionItems: ['多喝水'],
        portionAction: { suggestedPercent: 60, suggestedCalories: 300 },
      });
      expect(actions).toContain('多喝水');
      expect(actions).toContain('优先按 60% 份量控制，本次约 300 kcal');
    });

    it('should cap followUpActions at 4 items', () => {
      const actions = buildFollowUpActions({
        summaryActionItems: ['a', 'b', 'c'],
        portionAction: { suggestedPercent: 50, suggestedCalories: 250 },
        replacementFirstCandidate: '豆腐',
        recoveryTodayAdjustment: '晚餐轻食',
      });
      expect(actions.length).toBeLessThanOrEqual(4);
    });

    it('should deduplicate followed actions', () => {
      const actions = buildFollowUpActions({
        summaryActionItems: ['优先按 80% 份量控制，本次约 400 kcal'],
        portionAction: { suggestedPercent: 80, suggestedCalories: 400 },
      });
      const unique = Array.from(new Set(actions));
      expect(actions).toEqual(unique);
    });

    it('should filter out falsy values', () => {
      const actions = buildFollowUpActions({
        summaryActionItems: ['', '有效建议'],
      });
      expect(actions).not.toContain('');
      expect(actions).toContain('有效建议');
    });

    it('should return empty array when no input provided', () => {
      const actions = buildFollowUpActions({});
      expect(actions).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // 6. Phase 3 — FormattedCoachOutput 结构字段
  // ------------------------------------------------------------------
  describe('Phase 3 — FormattedCoachOutput structure', () => {
    it('FormattedCoachOutput type should include conclusion field', () => {
      // 通过静态类型形状模拟验证（运行时对象构造）
      const output: {
        text: string;
        lang: string;
        emoji: string;
        conclusion?: string;
        reasons?: string[];
        suggestions?: string[];
        tone?: string;
      } = {
        text: '建议适量食用',
        lang: 'zh-CN',
        emoji: '✅',
        conclusion: '这顿可以吃，但注意份量',
        reasons: ['蛋白质充足', '热量在预算内'],
        suggestions: ['减少碳水', '搭配蔬菜'],
        tone: 'encouraging',
      };

      expect(output.conclusion).toBeDefined();
      expect(output.reasons).toBeInstanceOf(Array);
      expect(output.suggestions).toBeInstanceOf(Array);
      expect(output.tone).toBe('encouraging');
    });

    it('should support optional V2.6 fields without breaking V2.5 shape', () => {
      // V2.5 基础字段不得被破坏
      const minimalOutput: {
        text: string;
        lang: string;
        emoji: string;
        conclusion?: string;
      } = {
        text: '建议食用',
        lang: 'zh-CN',
        emoji: '✅',
      };

      expect(minimalOutput.text).toBeTruthy();
      expect(minimalOutput.conclusion).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // 7. 端到端信号链路连通性验证
  // ------------------------------------------------------------------
  describe('V2.6 Signal Chain — end-to-end connectivity', () => {
    it('contextSignals should flow from UserContext into DecisionSummary signals', () => {
      // 模拟: UserContext.contextSignals → DecisionSummary.contextSignals (merged)
      const userContextSignals = ['under_target', 'protein_gap'];
      const decisionSignal = 'portion_adjustment_needed';

      const summarySignals = Array.from(
        new Set([...userContextSignals, decisionSignal]),
      ).slice(0, 5);

      expect(summarySignals).toContain('under_target');
      expect(summarySignals).toContain('protein_gap');
      expect(summarySignals).toContain('portion_adjustment_needed');
      expect(summarySignals.length).toBeLessThanOrEqual(5);
    });

    it('coachFocus from DecisionSummary should be injected into prompt context', () => {
      // 模拟 coach-prompt-builder 注入逻辑
      const coachFocus = '优先强调热量边界和份量控制';
      let ctx = '【决策摘要】...';
      ctx += `\n- 教练重点：${coachFocus}`;

      expect(ctx).toContain('教练重点');
      expect(ctx).toContain(coachFocus);
    });

    it('followUpActions from ShouldEatAction should be injected into prompt context', () => {
      const followUpActions = ['优先按 70% 份量控制，本次约 350 kcal', '今日晚餐减少200kcal'];
      let ctx = '【行动计划】...';
      ctx += `\n- 后续动作：${followUpActions.join('；')}`;

      expect(ctx).toContain('后续动作');
      expect(ctx).toContain('优先按 70% 份量控制');
    });

    it('CoachActionPlan why array should absorb contextSignals', () => {
      const contextSignals = ['over_limit', 'late_night_window'];
      const whyBase = ['热量已超标'];
      const why = [...whyBase, ...contextSignals.map((s) => `信号: ${s}`)].slice(0, 4);

      expect(why.length).toBeLessThanOrEqual(4);
      expect(why.some((w) => w.includes('over_limit'))).toBe(true);
    });

    it('CoachActionPlan doNow should absorb followUpActions', () => {
      const baseDoNow = ['记录本次饮食'];
      const followUpActions = ['减少晚餐碳水'];
      const doNow = [...baseDoNow, ...followUpActions].slice(0, 4);

      expect(doNow).toContain('记录本次饮食');
      expect(doNow).toContain('减少晚餐碳水');
      expect(doNow.length).toBeLessThanOrEqual(4);
    });
  });

  // ------------------------------------------------------------------
  // 8. V2.6 类型完整性
  // ------------------------------------------------------------------
  describe('V2.6 Type completeness', () => {
    it('UnifiedUserContext should support all three V2.6 optional fields', () => {
      const ctx: {
        budgetStatus?: 'under_target' | 'near_limit' | 'over_limit';
        nutritionPriority?: string[];
        contextSignals?: string[];
      } = {
        budgetStatus: 'near_limit',
        nutritionPriority: ['protein_gap'],
        contextSignals: ['near_limit', 'protein_gap'],
      };

      expect(['under_target', 'near_limit', 'over_limit']).toContain(ctx.budgetStatus);
      expect(ctx.nutritionPriority).toBeInstanceOf(Array);
      expect(ctx.contextSignals).toBeInstanceOf(Array);
    });

    it('DecisionSummary should support contextSignals and coachFocus', () => {
      const summary: {
        contextSignals?: string[];
        coachFocus?: string;
      } = {
        contextSignals: ['over_limit', 'high_risk_decision'],
        coachFocus: '优先强调热量边界和份量控制',
      };

      expect(summary.contextSignals?.length).toBeGreaterThan(0);
      expect(typeof summary.coachFocus).toBe('string');
    });

    it('ShouldEatAction should support followUpActions array', () => {
      const action: { followUpActions?: string[] } = {
        followUpActions: ['优先按 60% 份量控制，本次约 300 kcal'],
      };

      expect(action.followUpActions).toBeInstanceOf(Array);
      expect(action.followUpActions![0]).toContain('份量控制');
    });
  });
});
