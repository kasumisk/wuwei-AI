/**
 * V7.2 P2-B → V7.3 P2-A: 场景上下文因子
 *
 * 对应原 rankCandidates 中的 sceneBoost。
 *
 * V7.2: 基于 contextualProfile.sceneWeightModifiers 的几何均值（统一乘数）。
 * V7.3: 升级为场景化评分 — 从 SCENE_SCORING_PROFILES 加载当前场景的
 *        dimensionWeightAdjustments 和 factorStrengthOverrides，
 *        写入 ctx.sceneDimensionAdjustments 供 FoodScorer 消费，
 *        并将 factorStrengthOverrides 作为链式调整返回。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import {
  findSceneScoringProfile,
  type SceneScoringProfile,
} from '../../types/scene-scoring.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class SceneContextFactor implements ScoringFactor {
  readonly name = 'scene-context';
  readonly order = 30;

  /** V7.2 兼容: 几何均值 */
  private sceneBoost = 1.0;
  /** V7.3: 匹配到的场景评分配置 */
  private profile: SceneScoringProfile | undefined;
  /** V7.3: 该因子自身的强度覆盖乘数 */
  private selfStrength = 1.0;
  /** V7.5: 场景 boost clamp 范围 */
  private clampMin = 0.8;
  private clampMax = 1.2;

  isApplicable(ctx: PipelineContext): boolean {
    // V7.3: 有 sceneContext.sceneType 或 V7.2 兼容的 sceneWeightModifiers 即可
    return !!(
      ctx.sceneContext?.sceneType || ctx.contextualProfile?.sceneWeightModifiers
    );
  }

  init(ctx: PipelineContext): void {
    // V7.5: 从调参配置读取 clamp 范围
    this.clampMin = ctx.tuning?.sceneBoostClampMin ?? 0.8;
    this.clampMax = ctx.tuning?.sceneBoostClampMax ?? 1.2;

    // V7.3: 尝试加载场景评分配置
    const sceneType = ctx.sceneContext?.sceneType;
    if (sceneType) {
      this.profile = findSceneScoringProfile(sceneType);
    } else {
      this.profile = undefined;
    }

    if (this.profile) {
      // 将维度权重调整写入 ctx，供 FoodScorer 消费
      // 使用 any 是因为 PipelineContext 可能还未扩展此字段
      (ctx as any).sceneDimensionAdjustments =
        this.profile.dimensionWeightAdjustments;

      // 读取该因子自身的强度覆盖
      this.selfStrength =
        this.profile.factorStrengthOverrides?.['scene-context'] ?? 1.0;

      // 基于维度调整值计算整体场景乘数
      const adjustValues = Object.values(
        this.profile.dimensionWeightAdjustments,
      ).filter((v) => v !== undefined);
      if (adjustValues.length > 0) {
        const product = adjustValues.reduce((p, v) => p * v, 1.0);
        this.sceneBoost = Math.pow(product, 1 / adjustValues.length);
        this.sceneBoost = Math.max(
          this.clampMin,
          Math.min(this.clampMax, this.sceneBoost),
        );
      } else {
        this.sceneBoost = 1.0;
      }
    } else {
      // V7.2 兼容路径
      const mods = ctx.contextualProfile?.sceneWeightModifiers;
      if (!mods) {
        this.sceneBoost = 1.0;
        this.selfStrength = 1.0;
        return;
      }

      const modValues = Object.values(mods).filter((v) => v !== undefined);
      if (modValues.length > 0) {
        const product = modValues.reduce((p, v) => p * v, 1.0);
        this.sceneBoost = Math.pow(product, 1 / modValues.length);
        this.sceneBoost = Math.max(
          this.clampMin,
          Math.min(this.clampMax, this.sceneBoost),
        );
      } else {
        this.sceneBoost = 1.0;
      }
      this.selfStrength = 1.0;
    }
  }

  computeAdjustment(
    _food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    // 应用 selfStrength 到 sceneBoost
    const effectiveBoost = 1.0 + (this.sceneBoost - 1.0) * this.selfStrength;
    const clampedBoost = Math.max(
      this.clampMin,
      Math.min(this.clampMax, effectiveBoost),
    );

    if (Math.abs(clampedBoost - 1.0) < 1e-6) return null;

    return {
      factorName: this.name,
      multiplier: clampedBoost,
      additive: 0,
      explanationKey: 'sceneBoost',
      reason: this.profile
        ? `scene(${this.profile.sceneType})×${clampedBoost.toFixed(3)}`
        : `scene×${clampedBoost.toFixed(3)}`,
    };
  }
}
