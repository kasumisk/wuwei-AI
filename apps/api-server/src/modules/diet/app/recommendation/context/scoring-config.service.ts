import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import {
  ScoringConfigSnapshot,
  RecommendationTuningConfig,
} from '../types/recommendation.types';
import { GoalType } from '../../../app/services/nutrition-score.service';

/**
 * V7.0: 评分配置分片键
 *
 * 允许按目标/上下文加载不同的配置组。
 * 配置存储在 feature_flag 表中，key 格式: scoring_config_shard:{shardKey}
 * 例如: scoring_config_shard:fat_loss, scoring_config_shard:summer, scoring_config_shard:weekend
 */
export interface ConfigShardKey {
  goalType?: GoalType;
  season?: string;
  dayType?: string;
}

/**
 * V6.7 Phase 1-B / V6.8 Phase 1-A / V7.0 Phase 2-D: 评分参数中心化管理
 *
 * ═══════════════════════════════════════════════════════════
 *  评分参数三层优先级体系（高 → 低）
 * ═══════════════════════════════════════════════════════════
 *
 *  Layer 1: StrategyConfig.rank（策略层）
 *    - 来源: strategy 表 config JSONB → rank 字段
 *    - 职责: 按策略/用户群/上下文覆盖的评分权重（baseWeights、mealModifiers、statusModifiers）
 *    - 粒度: 可按 GoalType 独立配置 14 维权重数组
 *    - 生效: 当用户匹配到某策略时，策略层权重整体替换系统默认权重
 *    - 管理: Admin API → StrategyManagementService
 *
 *  Layer 2: ScoringConfigSnapshot（本服务管理的运行时配置）
 *    - 来源: feature_flag 表 scoring_config_v68 记录（JSONB），含 tuning 子对象
 *    - 职责: 42+ 评分相关参数（各因子系数、阈值、归一化参数等）
 *    - 含义: 不涉及权重分配，而是控制各评分维度内部的计算行为
 *    - 实时修改: Admin API → updateConfig()，写入 DB + Redis + 内存
 *    - 分片: 支持按 goalType/season/dayType 加载覆盖分片
 *
 *  Layer 3: 硬编码默认值（代码中的常量）
 *    - 来源: scoring.types.ts 中的 SCORE_WEIGHTS、MACRO_RANGES、MEAL_RATIOS 等
 *    - 职责: Layer 1/2 均未配置时的终极兜底
 *    - 修改方式: 仅通过代码变更
 *
 *  合并规则:
 *  - computeWeights(goalType, rankPolicy, ...) 中，若 rankPolicy.baseWeights 存在则
 *    整体替换该 GoalType 的默认权重数组（Layer 1 > Layer 3）
 *  - ScoringConfigSnapshot 中的参数独立于权重数组，由各 Factor/Scorer 直接读取
 *  - Layer 2 的 tuning 子对象 = 原 RecommendationTuningConfig 的运行时版本
 *
 * ═══════════════════════════════════════════════════════════
 *
 * 数据流：
 * 1. onModuleInit → 从 Redis 缓存 / feature_flag 表加载配置
 * 2. getConfig(shard?) → 返回内存缓存的 ScoringConfigSnapshot（热路径零 IO）
 *    - 无 shard → 返回全局配置
 *    - 有 shard → 全局配置 + shard 覆盖（深度合并）
 * 3. updateConfig() → Admin API 调用，写入 DB + 刷新 Redis + 更新内存
 *
 * 降级策略：
 * - Redis 不可用 → 直接读 DB
 * - DB 中无记录 → 返回硬编码默认值（等价于升级前行为）
 * - 分片配置不存在 → 回退到全局配置（零影响）
 */
@Injectable()
export class ScoringConfigService implements OnModuleInit {
  private readonly logger = new Logger(ScoringConfigService.name);
  private config: ScoringConfigSnapshot | null = null;
  /** V7.0: 分片配置内存缓存 */
  private readonly shardCache = new Map<string, ScoringConfigSnapshot>();
  private readonly CACHE_KEY = 'scoring_config:snapshot';
  private readonly CACHE_TTL_MS = 300_000; // 5 分钟
  private readonly SHARD_CACHE_TTL_MS = 600_000; // 10 分钟

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.loadConfig();
      this.logger.log(
        'ScoringConfigService initialized — config loaded successfully',
      );
    } catch (err) {
      this.logger.warn(
        `Failed to load scoring config on init, using defaults: ${err}`,
      );
      this.config = this.getDefaults();
    }
  }

  /**
   * 获取当前配置快照（热路径，内存返回）
   *
   * V7.0: 支持可选的分片键。当提供 shard 时：
   * 1. 先获取全局配置
   * 2. 按 shard key 查找覆盖配置
   * 3. 深度合并返回
   * 无 shard 或 shard 不存在时返回全局配置（零退化）。
   */
  async getConfig(shard?: ConfigShardKey): Promise<ScoringConfigSnapshot> {
    // 无分片 → 返回全局
    if (!shard || (!shard.goalType && !shard.season && !shard.dayType)) {
      if (this.config) return this.config;
      return this.loadConfig();
    }

    // 有分片 → 检查内存缓存
    const shardKeyStr = this.buildShardKeyString(shard);
    const cachedShard = this.shardCache.get(shardKeyStr);
    if (cachedShard) return cachedShard;

    // 加载全局配置
    const globalConfig = this.config ?? (await this.loadConfig());

    // 加载分片覆盖
    const shardOverride = await this.loadShardConfig(shard);
    if (!shardOverride) {
      return globalConfig;
    }

    // 深度合并
    const merged = this.mergeWithDefaults({
      ...globalConfig,
      ...shardOverride,
    });
    this.shardCache.set(shardKeyStr, merged);

    // 定时清除分片缓存
    setTimeout(() => {
      this.shardCache.delete(shardKeyStr);
    }, this.SHARD_CACHE_TTL_MS);

    return merged;
  }

  /**
   * V7.5: 快捷获取调参配置（同步，热路径零 IO）
   *
   * 从已加载的全局配置中提取 tuning 部分。
   * 如果全局配置尚未加载，返回默认值。
   */
  getTuning(): Required<RecommendationTuningConfig> {
    const tuning = this.config?.tuning ?? {};
    return { ...this.getTuningDefaults(), ...tuning };
  }

  /**
   * V7.5: 调参配置默认值
   */
  getTuningDefaults(): Required<RecommendationTuningConfig> {
    return {
      // ── MealAssembler ──
      similarityWeights: {
        category: 0.3,
        mainIngredient: 0.5,
        subCategory: 0.2,
        tagOverlap: 0.05,
      },
      diversitySimilarityPenalty: 0.3,
      compatibilityGoodBonus: 0.05,
      compatibilityBadPenalty: -0.1,
      compatibilityClampMin: -0.15,
      compatibilityClampMax: 0.15,

      // ── PipelineBuilder ──
      optimizerCandidateLimit: 8,
      diversityHighMultiplier: 1.5,
      diversityLowMultiplier: 0.5,
      baseExplorationRate: 0.15,
      dishPriorityDivisorScene: 500,
      dishPriorityDivisorNormal: 1000,
      semiPreparedMultiplierScene: 1.08,
      semiPreparedMultiplierNormal: 1.03,
      ingredientMultiplierScene: 0.9,
      ingredientMultiplierNormal: 0.85,
      conflictMaxRounds: 3,
      ingredientDiversityThreshold: 60,
      cookingMethodDiversityThreshold: 50,

      // ── ConstraintGenerator ──
      proteinGapThreshold: 30,
      calorieGapThreshold: 300,
      calorieCeilingMultiplier: 1.15,
      bingeRiskCalorieMultiplier: 0.98,
      minProteinRatio: 0.5,

      // ── SceneContextFactor ──
      sceneBoostClampMin: 0.8,
      sceneBoostClampMax: 1.2,

      // ── AnalysisProfileFactor ──
      categoryInterestPerCount: 0.02,
      categoryInterestCap: 0.08,
      riskFoodPenalty: 0.7,

      // ── PreferenceSignalFactor ──
      declaredPrefPerMatch: 0.05,
      declaredPrefCap: 0.15,

      // ── LifestyleBoostFactor ──
      factorWaterHighThreshold: 80,
      nutrientBoostClampMin: 0.85,
      nutrientBoostClampMax: 1.15,
      nutrientBoostDeltaMultiplier: 0.05,

      // ── ShortTermProfileFactor ──
      shortTermMinInteractions: 3,

      // ── PopularityFactor ──
      popularityNormalizationDivisor: 100,

      // ── FoodScorer 残余 ──
      cuisineWeightBoostCoeff: 0.2,
      channelMatchBonus: 0.1,
      acquisitionScoreMap: {
        1: 1.0,
        2: 0.85,
        3: 0.65,
        4: 0.4,
        5: 0.15,
      },
    };
  }

  /**
   * 从 Redis 缓存 / DB 加载配置
   */
  private async loadConfig(): Promise<ScoringConfigSnapshot> {
    // 1. 尝试 Redis 缓存
    try {
      const cached = await this.redis.get<ScoringConfigSnapshot>(
        this.CACHE_KEY,
      );
      if (cached) {
        this.config = this.mergeWithDefaults(cached);
        return this.config;
      }
    } catch {
      // Redis 不可用，降级到 DB
    }

    // 2. 从 feature_flag 表读取配置（V6.8: 先读 v68，fallback 读 v67）
    try {
      let flag = await this.prisma.featureFlag.findUnique({
        where: { key: 'scoring_config_v68' },
      });

      // V6.8: fallback 到 v67 配置
      if (!flag?.config) {
        flag = await this.prisma.featureFlag.findUnique({
          where: { key: 'scoring_config_v67' },
        });
      }

      if (flag?.config && typeof flag.config === 'object') {
        this.config = this.mergeWithDefaults(
          flag.config as Partial<ScoringConfigSnapshot>,
        );
      } else {
        this.config = this.getDefaults();
      }
    } catch {
      // DB 不可用，使用默认值
      this.config = this.getDefaults();
    }

    // 回写 Redis 缓存（fire-and-forget）
    this.redis.set(this.CACHE_KEY, this.config, this.CACHE_TTL_MS).catch(() => {
      /* ignore */
    });

    return this.config;
  }

  /**
   * Admin API 调用此方法更新配置
   *
   * 流程：partial merge → 写 DB(upsert) → 刷新 Redis → 更新内存
   */
  async updateConfig(
    partial: Partial<ScoringConfigSnapshot>,
  ): Promise<ScoringConfigSnapshot> {
    const merged = this.mergeWithDefaults(partial);

    await this.prisma.featureFlag.upsert({
      where: { key: 'scoring_config_v68' },
      update: {
        config: merged as any,
        updatedAt: new Date(),
      },
      create: {
        key: 'scoring_config_v68',
        name: 'V6.8 Scoring Config',
        type: 'boolean',
        enabled: true,
        config: merged as any,
      },
    });

    this.config = merged;
    this.shardCache.clear(); // V7.0: 清除分片缓存
    await this.redis.set(this.CACHE_KEY, merged, this.CACHE_TTL_MS);

    this.logger.log('Scoring config updated via Admin API');
    return merged;
  }

  // ─── V7.0: 分片配置加载 ───

  /**
   * V7.0: 加载分片覆盖配置
   *
   * 按优先级尝试加载分片（最具体的优先）:
   * 1. scoring_config_shard_{goalType}_{season}_{dayType} （三维）
   * 2. scoring_config_shard_{goalType}_{season}           （二维）
   * 3. scoring_config_shard_{goalType}                    （一维）
   * 4. scoring_config_shard_{season}                      （一维）
   * 5. scoring_config_shard_{dayType}                     （一维）
   *
   * 第一个存在的配置胜出。全部不存在时返回 null。
   */
  private async loadShardConfig(
    shard: ConfigShardKey,
  ): Promise<Partial<ScoringConfigSnapshot> | null> {
    const candidates = this.buildShardCandidateKeys(shard);

    for (const key of candidates) {
      const redisCacheKey = `scoring_config:shard:${key}`;

      try {
        const cached =
          await this.redis.get<Partial<ScoringConfigSnapshot>>(redisCacheKey);
        if (cached) return cached;
      } catch {
        // Redis 不可用，继续尝试 DB
      }

      try {
        const flag = await this.prisma.featureFlag.findUnique({
          where: { key: `scoring_config_shard_${key}` },
        });

        if (flag?.config && typeof flag.config === 'object') {
          const config = flag.config as Partial<ScoringConfigSnapshot>;
          this.redis
            .set(redisCacheKey, config, this.SHARD_CACHE_TTL_MS)
            .catch(() => {});
          return config;
        }
      } catch {
        // DB 查询失败，继续下一个候选
      }
    }

    return null;
  }

  /**
   * V7.0: 构建分片候选 key 列表（按优先级降序）
   */
  private buildShardCandidateKeys(shard: ConfigShardKey): string[] {
    const keys: string[] = [];
    const { goalType, season, dayType } = shard;

    if (goalType && season && dayType) {
      keys.push(`${goalType}_${season}_${dayType}`);
    }
    if (goalType && season) keys.push(`${goalType}_${season}`);
    if (goalType && dayType) keys.push(`${goalType}_${dayType}`);
    if (season && dayType) keys.push(`${season}_${dayType}`);
    if (goalType) keys.push(goalType);
    if (season) keys.push(season);
    if (dayType) keys.push(dayType);

    return keys;
  }

  /**
   * V7.0: 构建分片缓存 key 字符串（内存缓存用）
   */
  private buildShardKeyString(shard: ConfigShardKey): string {
    const parts: string[] = [];
    if (shard.goalType) parts.push(`g:${shard.goalType}`);
    if (shard.season) parts.push(`s:${shard.season}`);
    if (shard.dayType) parts.push(`d:${shard.dayType}`);
    return parts.join('|');
  }

  /**
   * V7.0: 清除所有分片缓存（外部调用）
   */
  clearShardCache(): void {
    this.shardCache.clear();
  }

  /**
   * 硬编码默认值 — 与升级前各 service 中的魔法数字完全一致
   * V6.8: 扩展到 90+ 参数，覆盖 food-scorer.service.ts 中全部常量
   */
  getDefaults(): ScoringConfigSnapshot {
    return {
      // ── FoodScorer（V6.7 原有） ──
      executabilitySubWeights: {
        commonality: 0.35,
        cost: 0.25,
        cookTime: 0.25,
        skill: 0.15,
      },
      nrf93SigmoidCenter: 150,
      nrf93SigmoidSlope: 0.01,
      inflammationCenter: 20,
      inflammationSlope: 0.08,
      addedSugarPenaltyPerGrams: 10,
      confidenceFloor: 0.7,
      novaBase: [1.0, 1.0, 1.0, 0.85, 0.55],
      energySigmaRatios: {
        fat_loss: 0.12,
        muscle_gain: 0.2,
        health: 0.15,
        habit: 0.25,
      },

      // ── RecallMerger ──
      semanticOnlyWeight: 0.7,
      cfOnlyWeight: 0.6,
      maxCandidatesPerCategoryForNonRule: 5,

      // ── RealisticFilter ──
      minCandidates: 5,
      canteenCommonalityThreshold: 60,

      // ── MealComposition ──
      compositionWeights: {
        ingredientDiversity: 0.25,
        cookingMethodDiversity: 0.15,
        flavorHarmony: 0.2,
        nutritionComplementarity: 0.2,
        textureDiversity: 0.2,
      },

      // ── ReplacementFeedback ──
      replacedFromMultiplier: 0.8,
      replacedToMultiplier: 1.12,
      replacementDecayDays: 30,
      replacementMinFrequency: 2,

      // ── CF ──
      cfUserBasedWeight: 0.4,
      cfItemBasedWeight: 0.6,

      // ── Lifestyle ──
      lifestyleSleepPoorTryptophanBoost: 0.15,
      lifestyleSleepPoorMagnesiumBoost: 0.1,
      lifestyleStressHighVitCBoost: 0.12,

      // ────────────────────────────────────────────────────
      // V6.8 新增参数
      // ────────────────────────────────────────────────────

      // ── 蛋白质评分 ──
      proteinRangeByGoal: {
        fat_loss: [0.25, 0.35],
        muscle_gain: [0.25, 0.4],
        health: [0.15, 0.25],
        habit: [0.12, 0.3],
      },
      proteinBelowRangeCoeff: 0.3,
      proteinBelowRangeBase: 0.7,
      proteinAboveRangeDecay: 0.5,
      proteinAboveRangeDiv: 0.15,

      // ── 能量评分 ──
      energyFatLossPenalty: 0.85,
      energyMuscleGainPenalty: 0.9,
      energyDefaultScore: 0.8,
      proteinDefaultScore: 0.8,

      // ── GI/GL ──
      giDefaultScore: 0.75,
      glSigmoidSlope: 0.3,
      glSigmoidCenter: 15,
      categoryGiMap: {
        grain: 70,
        veggie: 35,
        protein: 40,
        fruit: 45,
        dairy: 35,
        fat: 25,
        beverage: 55,
        snack: 65,
        composite: 60,
        soup: 40,
      },
      giFallback: 55,
      giProcessingStep: 5,
      giFiberReduction: 2,
      giFiberReductionCap: 15,

      // ── NRF Gap ──
      nrfGapThreshold: 15,
      nrfGapMaxBonus: 20,
      nrfGapTotalCap: 80,
      nrfGapContinuous: true,

      // ── NOVA 微调 ──
      novaHighFiberThreshold: 3,
      novaHighFiberRelief: 0.05,
      novaLowSugarThreshold: 5,
      novaLowSugarRelief: 0.05,
      novaLowSatFatThreshold: 3,
      novaLowSatFatRelief: 0.05,
      novaHighSodiumThreshold: 800,
      novaHighSodiumPenalty: 0.05,
      novaClampMin: [0.75, 0.45],
      novaClampMax: [0.95, 0.7],

      // ── 炎症公式 ──
      inflammTransFatDiv: 2,
      inflammTransFatMax: 50,
      inflammSatFatDiv: 10,
      inflammSatFatMax: 30,
      inflammFiberDiv: 5,
      inflammFiberMax: 40,

      // ── 烹饪便利 ──
      cookTimeQuick: 15,
      cookTimeQuickScore: 1.0,
      cookTimeMedium: 30,
      cookTimeMediumScore: 0.8,
      cookTimeLong: 60,
      cookTimeLongScore: 0.5,
      cookTimeZeroScore: 0.8,

      // ── 品类含水量 ──
      categoryWaterMap: {
        veggie: 90,
        fruit: 85,
        beverage: 95,
        dairy: 87,
        protein: 65,
        grain: 12,
        composite: 55,
        snack: 5,
        fat: 0,
        condiment: 50,
      },

      // ── Lifestyle 调整 ──
      lifestyleWaterHighThreshold: 80,
      lifestyleWaterHighMultiplier: 0.8,
      lifestyleWaterMedThreshold: 60,
      lifestyleWaterMedMultiplier: 0.4,
      lifestyleTryptophanTags: [
        'poultry',
        'dairy',
        'banana',
        'oats',
        'eggs',
        'seeds',
        'nuts',
        'turkey',
      ],

      // ── 替换营养接近度 ──
      substitutionWeights: {
        calories: 0.25,
        protein: 0.2,
        fat: 0.15,
        carbs: 0.15,
        gi: 0.15,
        micronutrients: 0.1,
      },

      // ── 杂项 ──
      defaultQualityScore: 5,
      defaultSatietyScore: 4,
      defaultMealCalorieTarget: 400,
      defaultCarbFatScore: 0.5,
      defaultConfidence: 0.5,
      maxAddedSugarPenalty: -15,
      rangeOutPenaltySteepness: 2,

      // ── V7.5: 推荐调参配置 ──
      tuning: this.getTuningDefaults(),
    };
  }

  /**
   * 深度合并：partial 覆盖 defaults，支持嵌套对象
   * V6.8: 新增 proteinRangeByGoal, categoryGiMap, categoryWaterMap, substitutionWeights 深度合并
   */
  private mergeWithDefaults(
    partial: Partial<ScoringConfigSnapshot>,
  ): ScoringConfigSnapshot {
    const defaults = this.getDefaults();
    return {
      ...defaults,
      ...partial,
      // 嵌套对象需要深度合并，防止 partial 只提供部分子字段导致丢失
      executabilitySubWeights: {
        ...defaults.executabilitySubWeights,
        ...(partial.executabilitySubWeights ?? {}),
      },
      compositionWeights: {
        ...defaults.compositionWeights,
        ...(partial.compositionWeights ?? {}),
      },
      energySigmaRatios: {
        ...defaults.energySigmaRatios,
        ...(partial.energySigmaRatios ?? {}),
      },
      // V6.8 新增嵌套对象深度合并
      proteinRangeByGoal: {
        ...defaults.proteinRangeByGoal,
        ...(partial.proteinRangeByGoal ?? {}),
      },
      categoryGiMap: {
        ...defaults.categoryGiMap,
        ...(partial.categoryGiMap ?? {}),
      },
      categoryWaterMap: {
        ...defaults.categoryWaterMap,
        ...(partial.categoryWaterMap ?? {}),
      },
      substitutionWeights: {
        ...defaults.substitutionWeights!,
        ...(partial.substitutionWeights ?? {}),
      },
      // V7.5: tuning 深度合并
      tuning: {
        ...defaults.tuning!,
        ...(partial.tuning ?? {}),
        similarityWeights: {
          ...defaults.tuning!.similarityWeights!,
          ...(partial.tuning?.similarityWeights ?? {}),
        },
        acquisitionScoreMap: {
          ...defaults.tuning!.acquisitionScoreMap!,
          ...(partial.tuning?.acquisitionScoreMap ?? {}),
        },
      },
    };
  }
}
