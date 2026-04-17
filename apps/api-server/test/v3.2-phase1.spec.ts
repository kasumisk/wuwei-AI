/**
 * V3.2 Phase 1 集成测试
 *
 * 验证：
 * 1. AnalysisAccuracyService：精度评估逻辑
 * 2. NutritionIssueDetector：问题识别
 * 3. AnalysisContextService：上下文组装
 *
 * 覆盖场景：
 * - 完全达成、缺/超场景
 * - 多宏量同时存在缺/超
 * - 推荐系统条件生成
 */

import { Test, TestingModule } from '@nestjs/testing';
import { I18nService } from '../src/config/i18n.service';
import { I18nManagementService } from '../src/config/i18n-management.service';
import { AnalysisAccuracyService } from '../src/modules/decision/analyze/analysis-accuracy.service';
import { NutritionIssueDetector } from '../src/modules/decision/analyze/nutrition-issue-detector.service';
import { AnalysisContextService } from '../src/modules/decision/analyze/analysis-context.service';
import {
  MacroSlotStatus,
  UnifiedUserContext,
} from '../src/modules/decision/types/analysis-result.types';

describe('V3.2 Phase 1 - Analysis Data Pipeline', () => {
  let module: TestingModule;
  let accuracyService: AnalysisAccuracyService;
  let issueDetector: NutritionIssueDetector;
  let contextService: AnalysisContextService;
  let i18nService: I18nService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        AnalysisAccuracyService,
        NutritionIssueDetector,
        AnalysisContextService,
        {
          provide: I18nService,
          useValue: {
            translate: (key: string) => key,
            getCurrentLanguage: () => 'en',
          },
        },
        {
          provide: I18nManagementService,
          useValue: {},
        },
      ],
    }).compile();

    accuracyService = module.get<AnalysisAccuracyService>(
      AnalysisAccuracyService,
    );
    issueDetector = module.get<NutritionIssueDetector>(NutritionIssueDetector);
    contextService = module.get<AnalysisContextService>(AnalysisContextService);
    i18nService = module.get<I18nService>(I18nService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe('AnalysisAccuracyService', () => {
    it('should evaluate accuracy correctly when all slots are ok', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'ok',
        fat: 'ok',
        carbs: 'ok',
      };

      const result = accuracyService.evaluate(macroSlot);

      expect(result.overallAccuracy).toBe(100);
      expect(result.slotAccuracies.calories).toBe(100);
    });

    it('should penalize for deficit slots', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'deficit',
        fat: 'ok',
        carbs: 'ok',
      };

      const result = accuracyService.evaluate(macroSlot);

      expect(result.overallAccuracy).toBeLessThan(100);
      expect(result.slotAccuracies.protein).toBeLessThan(100);
    });

    it('should penalize for excess slots', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'ok',
        fat: 'excess',
        carbs: 'ok',
      };

      const result = accuracyService.evaluate(macroSlot);

      expect(result.overallAccuracy).toBeLessThan(100);
      expect(result.slotAccuracies.fat).toBeLessThan(100);
    });

    it('should handle multiple problems', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'deficit',
        protein: 'deficit',
        fat: 'excess',
        carbs: 'ok',
      };

      const result = accuracyService.evaluate(macroSlot);

      expect(result.overallAccuracy).toBeLessThan(100);
      expect(result.slotAccuracies.calories).toBeLessThan(100);
      expect(result.slotAccuracies.protein).toBeLessThan(100);
      expect(result.slotAccuracies.fat).toBeLessThan(100);
    });
  });

  describe('NutritionIssueDetector', () => {
    it('should identify no issues when all slots are ok', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'ok',
        fat: 'ok',
        carbs: 'ok',
      };

      const progress: any = {
        consumed: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
        remaining: { calories: 0, protein: 0, fat: 0, carbs: 0 },
        goals: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
      };

      const issues = issueDetector.detectIssues(macroSlot, progress);

      // 应该只有低严重程度的问题（如 fiber_deficit）
      const highPriorityIssues = issues.filter((i) => i.severity !== 'low');
      expect(highPriorityIssues).toHaveLength(0);
    });

    it('should identify protein deficit issue', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'deficit',
        fat: 'ok',
        carbs: 'ok',
      };

      const progress: any = {
        consumed: { calories: 2000, protein: 80, fat: 60, carbs: 250 },
        remaining: { calories: 0, protein: 20, fat: 0, carbs: 0 },
        goals: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
      };

      const issues = issueDetector.detectIssues(macroSlot, progress);

      expect(issues).toContainEqual(
        expect.objectContaining({
          type: expect.stringMatching(/protein.*deficit/i),
        }),
      );
    });

    it('should identify carb excess issue', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'ok',
        protein: 'ok',
        fat: 'ok',
        carbs: 'excess',
      };

      const progress: any = {
        consumed: { calories: 2000, protein: 100, fat: 60, carbs: 350 },
        remaining: { calories: 0, protein: 0, fat: 0, carbs: -50 },
        goals: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
      };

      const issues = issueDetector.detectIssues(macroSlot, progress);

      expect(issues).toContainEqual(
        expect.objectContaining({
          type: expect.stringMatching(/carb.*excess/i),
        }),
      );
    });

    it('should prioritize issues by severity', () => {
      const macroSlot: MacroSlotStatus = {
        calories: 'deficit',
        protein: 'deficit',
        fat: 'ok',
        carbs: 'ok',
      };

      const progress: any = {
        consumed: { calories: 1800, protein: 80, fat: 60, carbs: 200 },
        remaining: { calories: 200, protein: 20, fat: 0, carbs: 0 },
        goals: { calories: 2000, protein: 100, fat: 60, carbs: 250 },
      };

      const issues = issueDetector.detectIssues(macroSlot, progress);

      expect(issues.length).toBeGreaterThan(0);
      // 应该包含 calorie 和 protein deficit
      const types = issues.map((i) => i.type);
      expect(types.toString()).toMatch(/calorie.*deficit|deficit.*calorie/i);
      expect(types.toString()).toMatch(/protein.*deficit|deficit.*protein/i);
    });
  });

  describe('AnalysisContextService', () => {
    it('should build complete context from user data', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1800,
        todayProtein: 90,
        todayFat: 60,
        todayCarbs: 200,
        remainingCalories: 200,
        remainingProtein: 10,
        remainingFat: 5,
        remainingCarbs: 50,
      };

      const analysis = contextService.buildContextualAnalysis(userCtx);

      expect(analysis).toBeDefined();
      expect(analysis.macroSlotStatus).toBeDefined();
      expect(analysis.macroProgress).toBeDefined();
      expect(analysis.identifiedIssues).toBeDefined();
      expect(analysis.recommendationContext).toBeDefined();
    });

    it('should infer macro slot status correctly', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1800,
        todayProtein: 90,
        todayFat: 60,
        todayCarbs: 200,
        remainingCalories: 200,
        remainingProtein: 10,
        remainingFat: 5,
        remainingCarbs: 50,
      };

      const analysis = contextService.buildContextualAnalysis(userCtx);

      // 1800/2000 = 90% → ok
      expect(analysis.macroSlotStatus.calories).toBe('ok');
      // 90/100 = 90% → ok
      expect(analysis.macroSlotStatus.protein).toBe('ok');
    });

    it('should populate recommendation context correctly', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1800,
        todayProtein: 90,
        todayFat: 60,
        todayCarbs: 200,
        remainingCalories: 200,
        remainingProtein: 10,
        remainingFat: 5,
        remainingCarbs: 50,
      };

      const analysis = contextService.buildContextualAnalysis(userCtx);

      expect(analysis.recommendationContext.remainingCalories).toBe(200);
      expect(analysis.recommendationContext.targetMacros.protein).toBe(10);
      expect(analysis.recommendationContext.targetMacros.fat).toBe(5);
      expect(analysis.recommendationContext.targetMacros.carbs).toBe(50);
    });

    it('should exclude foods from recommendation context', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1800,
        todayProtein: 90,
        todayFat: 60,
        todayCarbs: 200,
        remainingCalories: 200,
        remainingProtein: 10,
        remainingFat: 5,
        remainingCarbs: 50,
      };

      let analysis = contextService.buildContextualAnalysis(userCtx);

      expect(analysis.recommendationContext.excludeFoods).toEqual([]);

      analysis = contextService.excludeFoodsFromRecommendation(analysis, [
        'apple',
        'banana',
      ]);

      expect(analysis.recommendationContext.excludeFoods).toContain('apple');
      expect(analysis.recommendationContext.excludeFoods).toContain('banana');
    });

    it('should handle deficit scenario', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1500,
        todayProtein: 70,
        todayFat: 40,
        todayCarbs: 150,
        remainingCalories: 500,
        remainingProtein: 30,
        remainingFat: 25,
        remainingCarbs: 100,
      };

      const analysis = contextService.buildContextualAnalysis(userCtx);

      // 1500/2000 = 75% < 90% → deficit
      expect(analysis.macroSlotStatus.calories).toBe('deficit');
      expect(analysis.identifiedIssues.length).toBeGreaterThan(0);
    });

    it('should handle excess scenario', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 2300,
        todayProtein: 110,
        todayFat: 75,
        todayCarbs: 280,
        remainingCalories: -300,
        remainingProtein: -10,
        remainingFat: -10,
        remainingCarbs: -30,
      };

      const analysis = contextService.buildContextualAnalysis(userCtx);

      // 2300/2000 = 115% > 110% → excess
      expect(analysis.macroSlotStatus.calories).toBe('excess');
      expect(analysis.identifiedIssues.length).toBeGreaterThan(0);
    });
  });

  describe('Integration: Accuracy + Issues + Context', () => {
    it('should produce complete analysis pipeline output', () => {
      const userCtx: UnifiedUserContext = {
        userId: 'user123',
        goalCalories: 2000,
        goalProtein: 100,
        goalFat: 65,
        goalCarbs: 250,
        todayCalories: 1800,
        todayProtein: 85,
        todayFat: 60,
        todayCarbs: 200,
        remainingCalories: 200,
        remainingProtein: 15,
        remainingFat: 5,
        remainingCarbs: 50,
      };

      // Step 1: Build context
      const analysis = contextService.buildContextualAnalysis(userCtx);

      // Step 2: Evaluate accuracy
      const accuracy = accuracyService.evaluate(analysis.macroSlotStatus);

      // Step 3: Verify consistency
      expect(analysis.macroSlotStatus).toBeDefined();
      expect(accuracy.overallAccuracy).toBeGreaterThanOrEqual(0);
      expect(accuracy.overallAccuracy).toBeLessThanOrEqual(100);

      // Step 4: Verify issues are identified correctly
      expect(analysis.identifiedIssues).toBeDefined();
      expect(Array.isArray(analysis.identifiedIssues)).toBe(true);
    });
  });
});
