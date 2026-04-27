/**
 * V8.0 P1-02: 推荐结果后处理器
 *
 * 从 RecommendationEngineService.recommendMealFromPool 中提取后处理逻辑：
 * - 模板填充（MealTemplateService）
 * - 份量调整（MealAssembler.adjustPortions）
 * - 结果聚合（MealAssembler.aggregateMealResult）
 * - 整餐组合评分（MealCompositionScorer）
 * - 降级记录附加
 * - 菜谱组装（RecipeAssembler）
 * - 结构化洞察生成（InsightGenerator）
 *
 * 职责边界：
 * - 接收管道执行完成后的 picks + allCandidates + degradations
 * - 返回完整的 MealRecommendation
 * - 不涉及 Trace 持久化（由调用方处理）
 */
import { Injectable, Logger } from '@nestjs/common';
import { MealAssemblerService } from '../recommendation/meal/meal-assembler.service';
import { MealCompositionScorer } from '../recommendation/meal/meal-composition-scorer.service';
import { MealTemplateService } from '../recommendation/meal/meal-template.service';
import { RecipeAssemblerService } from '../recommendation/meal/recipe-assembler.service';
import { InsightGeneratorService } from '../recommendation/explanation/insight-generator.service';
import type {
  ScoredFood,
  MealRecommendation,
  MealTarget,
  PipelineDegradation,
  CrossMealAdjustment,
} from '../recommendation/types/recommendation.types';
import type { UserProfileConstraints } from '../recommendation/types/pipeline.types';
import type { SceneContext } from '../recommendation/types/scene.types';
import type { MealTemplate } from '../recommendation/types/meal-template.types';
import type { InsightContext } from '../recommendation/types/insight.types';
import type { EffectiveGoal } from '../../../user/app/services/goal/goal-phase.service';
import type { GoalProgress } from '../../../user/app/services/goal/goal-tracker.service';
import type { DailyPlanState } from '../recommendation/types/meal.types';
import { RequestContextService } from '../../../../core/context/request-context.service';
import type { Locale } from '../recommendation/utils/i18n-messages';

/** 后处理所需的上下文参数 */
export interface ResultProcessingParams {
  /** 管道最终选出的食物 */
  finalPicks: ScoredFood[];
  /** 管道全部候选池 */
  allCandidates: ScoredFood[];
  /** 管道降级记录 */
  degradations: PipelineDegradation[];
  /** 餐次类型 */
  mealType: string;
  /** 目标类型 */
  goalType: string;
  /** 本餐营养目标 */
  target: MealTarget;
  /** 用户画像约束 */
  userProfile?: UserProfileConstraints;
  /** 匹配到的餐食模板（可选） */
  matchedTemplate?: MealTemplate | null;
  /** 场景上下文（用于菜谱组装） */
  sceneContext?: SceneContext;
  /** 用户 ID（日志用） */
  userId?: string;
  /** 有效目标（洞察生成用） */
  effectiveGoal?: EffectiveGoal;
  /** 目标进度（洞察生成用） */
  goalProgress?: GoalProgress | null;
  /** 跨餐营养补偿（洞察生成用） */
  crossMealAdjustment?: CrossMealAdjustment;
  /** 高频替换模式（洞察生成用） */
  substitutions?: Array<{
    fromFoodId: string;
    fromFoodName: string;
    toFoodId: string;
    toFoodName: string;
    frequency: number;
  }>;
  /** 日计划状态（洞察生成用） */
  dailyPlanState?: DailyPlanState;
}

@Injectable()
export class RecommendationResultProcessor {
  private readonly logger = new Logger(RecommendationResultProcessor.name);

  constructor(
    private readonly mealAssembler: MealAssemblerService,
    private readonly mealCompositionScorer: MealCompositionScorer,
    private readonly mealTemplateService: MealTemplateService,
    private readonly recipeAssembler: RecipeAssemblerService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly requestCtx: RequestContextService,
  ) {}

  /**
   * 对管道输出进行后处理，返回完整的 MealRecommendation
   *
   * 处理流程：
   * 1. 模板填充（如果匹配到模板）
   * 2. 份量调整
   * 3. 结果聚合（tip + 汇总营养）
   * 4. 附加候选池 / 组合评分 / 降级记录 / 模板 ID
   * 5. 菜谱组装（如果有场景上下文）
   * 6. 结构化洞察生成
   */
  async process(params: ResultProcessingParams): Promise<MealRecommendation> {
    const {
      finalPicks,
      allCandidates,
      degradations,
      mealType,
      goalType,
      target,
      userProfile,
      matchedTemplate,
      sceneContext,
      userId,
      effectiveGoal,
      goalProgress,
      crossMealAdjustment,
      substitutions,
      dailyPlanState,
    } = params;

    // ── Step 1: 模板填充 ──
    let templateFilledPicks = finalPicks;
    let templateId: string | undefined;
    if (matchedTemplate && allCandidates.length > 0) {
      try {
        const templateResult = this.mealTemplateService.fillTemplate(
          matchedTemplate,
          allCandidates,
          target.calories,
        );
        // #fix Bug30: 模板填充只有在产出 ≥ pipeline picks 数量时才应用，
        // 否则会丢弃 pipeline 选出的食物，导致热量严重不足。
        if (
          templateResult.coverageScore >= 0.5 &&
          templateResult.filledSlots.length > 0 &&
          templateResult.filledSlots.length >= finalPicks.length
        ) {
          templateFilledPicks = templateResult.filledSlots.map(
            (slot) => slot.food,
          );
          templateId = templateResult.templateId;
          this.logger.debug(
            `Template ${templateResult.templateId} applied: ${templateResult.filledSlots.length} slots, ` +
              `coverage=${templateResult.coverageScore.toFixed(2)}, match=${templateResult.templateMatchScore.toFixed(2)}`,
          );
        } else if (
          templateResult.filledSlots.length > 0 &&
          templateResult.filledSlots.length < finalPicks.length
        ) {
          this.logger.debug(
            `Template ${templateResult.templateId} skipped: template slots (${templateResult.filledSlots.length}) < pipeline picks (${finalPicks.length})`,
          );
        }
      } catch (err) {
        this.logger.debug(
          `Template filling failed for ${matchedTemplate.id}, falling back to role pipeline: ${(err as Error).message}`,
        );
      }
    }

    // ── Step 2: 份量调整 ──
    const adjustedPicks = this.mealAssembler.adjustPortions(
      templateFilledPicks,
      target.calories,
      userProfile?.portionTendency,
    );

    const toppedUpPicks = this.mealAssembler.ensureMinimumCalorieCoverage(
      adjustedPicks,
      allCandidates,
      target.calories,
      0.7,
      1.1,
    );

    const finalizedPicks =
      toppedUpPicks.length === adjustedPicks.length
        ? adjustedPicks
        : this.mealAssembler.adjustPortions(
            toppedUpPicks,
            target.calories,
            userProfile?.portionTendency,
          );

    // ── Step 3: 结果聚合 ──
    const tip = this.mealAssembler.buildTip(
      mealType,
      goalType,
      target,
      finalizedPicks.reduce((s, p) => s + p.servingCalories, 0),
      this.getCurrentLocale(),
    );
    const result = this.mealAssembler.aggregateMealResult(
      finalizedPicks,
      tip,
      goalType,
      userProfile,
    );

    // ── Step 4: 附加元数据 ──
    result.candidates = allCandidates;

    if (finalizedPicks.length >= 2) {
      result.compositionScore =
        this.mealCompositionScorer.scoreMealComposition(finalizedPicks);
    }

    if (degradations.length > 0) {
      result.degradations = degradations;
    }

    if (templateId) {
      result.templateId = templateId;
    }

    // ── Step 5: 菜谱组装 ──
    if (sceneContext) {
      try {
        const { recipes, planTheme, executionDifficulty } =
          await this.recipeAssembler.assembleRecipes(
            finalizedPicks,
            sceneContext,
            mealType,
          );
        if (recipes.length > 0) {
          result.recipes = recipes;
          result.planTheme = planTheme;
          result.executionDifficulty = executionDifficulty;
        }
      } catch (err) {
        this.logger.warn(
          `RecipeAssembler failed for user ${userId ?? 'anonymous'}, meal ${mealType}: ${(err as Error).message}`,
        );
      }
    }

    // ── Step 6: 结构化洞察 ──
    try {
      const insightCtx: InsightContext = {
        foods: finalizedPicks,
        target,
        sceneContext: sceneContext ?? null,
        dailyPlan: dailyPlanState ?? null,
        effectiveGoal,
        goalProgress: goalProgress ?? null,
        crossMealAdjustment,
        substitutions: substitutions ?? null,
      };
      const insights = this.insightGenerator.generate(insightCtx);
      if (insights.length > 0) {
        result.insights = insights;
      }
    } catch (err) {
      this.logger.debug(
        `InsightGenerator.generate failed for user ${userId ?? 'anonymous'}: ${(err as Error).message}`,
      );
    }

    return result;
  }

  private getCurrentLocale(): Locale {
    const locale = this.requestCtx.locale;
    return locale === 'en-US' || locale === 'ja-JP' || locale === 'zh-CN'
      ? locale
      : 'zh-CN';
  }
}
