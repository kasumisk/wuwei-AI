import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import {
  UserPreferenceProfile,
  FoodFeedbackStats,
  PreferenceSignal,
} from '../types/recommendation.types';
import { FoodLibrary } from '../../../../food/food.types';
import { PreferencesProfile } from '../../../../user/domain/preferences-profile';
import { SubstitutionPattern } from '../feedback/execution-tracker.service';

/**
 * 用户偏好画像服务 (V4 Phase 2.2 — 从 RecommendationEngineService 提取)
 *
 * 职责:
 * - 构建用户偏好画像: getUserPreferenceProfile()
 * - 获取地区感知偏移: getRegionalBoostMap()
 * - 获取近期食物名: getRecentFoodNames()
 * - V7.1 P2-G: 计算统一偏好信号: computePreferenceSignal()
 *
 * V7.2 P2-H: 缓存从内存 Map 迁移到 Redis（RedisCacheService）
 * - Redis 不可用时自动降级为直接查询（RedisCacheService 内置优雅降级）
 * - TTL 5 分钟不变，但缓存现在跨进程/实例共享
 */
@Injectable()
export class PreferenceProfileService {
  private readonly logger = new Logger(PreferenceProfileService.name);

  /** 5 分钟 TTL — 与原内存缓存一致 */
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  /** Redis key 命名空间 */
  private static readonly NS_PREFERENCE = 'pref_profile';
  private static readonly NS_REGIONAL = 'regional_boost';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 构建用户偏好画像 — 从反馈记录按 category/mainIngredient/foodGroup 聚合
   * 返回三维偏好乘数：接受率高 → >1.0（最高1.3），接受率低 → <1.0（最低0.3）
   * 至少需要3条反馈才纳入统计，避免小样本噪声
   */
  async getUserPreferenceProfile(
    userId: string,
  ): Promise<UserPreferenceProfile> {
    const cacheKey = this.redis.buildKey(
      PreferenceProfileService.NS_PREFERENCE,
      userId,
    );

    const empty: UserPreferenceProfile = {
      categoryWeights: {},
      ingredientWeights: {},
      foodGroupWeights: {},
      foodNameWeights: {},
    };

    return this.redis.getOrSet<UserPreferenceProfile>(
      cacheKey,
      PreferenceProfileService.CACHE_TTL_MS,
      async () => {
        try {
          return await this.buildPreferenceProfile(userId);
        } catch (err) {
          this.logger.warn(`构建偏好画像失败: ${err}`);
          return empty;
        }
      },
    );
  }

  /**
   * 内部方法：从 DB 构建偏好画像
   */
  private async buildPreferenceProfile(
    userId: string,
  ): Promise<UserPreferenceProfile> {
    const empty: UserPreferenceProfile = {
      categoryWeights: {},
      ingredientWeights: {},
      foodGroupWeights: {},
      foodNameWeights: {},
    };

    const since = new Date();
    since.setDate(since.getDate() - 60); // 60天窗口

    // JOIN 反馈表和食物库，获取分类维度
    const rows: Array<{
      action: string;
      category: string;
      mainIngredient: string;
      foodGroup: string;
      foodName: string;
      createdAt: Date | string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT rf.action, rf.food_name, rf.created_at,
              fl.category, fl.main_ingredient, fl.food_group
       FROM recommendation_feedbacks rf
       LEFT JOIN foods fl ON fl.id = rf.food_id
       WHERE rf.user_id = $1
         AND rf.created_at >= $2`,
      userId,
      since,
    );

    if (rows.length < 3) return empty;

    // 按维度聚合统计
    const aggregate = (
      keyFn: (r: (typeof rows)[0]) => string,
    ): Record<string, number> => {
      const stats: Record<string, { accepted: number; total: number }> = {};
      for (const row of rows) {
        const key = keyFn(row);
        if (!key) continue;
        if (!stats[key]) stats[key] = { accepted: 0, total: 0 };
        stats[key].total++;
        if (row.action === 'accepted') stats[key].accepted++;
      }

      const result: Record<string, number> = {};
      for (const [key, s] of Object.entries(stats)) {
        if (s.total < 3) continue; // 至少3条数据
        const rate = s.accepted / s.total;
        // 映射到 0.3~1.3: rate=0 → 0.3, rate=0.5 → 0.8, rate=1 → 1.3
        result[key] = 0.3 + rate * 1.0;
      }
      return result;
    };

    // 按食物名构建偏好 — 指数衰减加权，映射到 0.7~1.2
    // 比 category 范围窄，避免食物名级别过拟合
    const foodNameWeights: Record<string, number> = {};
    const now = Date.now();
    const nameStats: Record<
      string,
      { weightedAccepted: number; weightedTotal: number }
    > = {};

    for (const row of rows) {
      const name = row.foodName;
      if (!name) continue;
      if (!nameStats[name])
        nameStats[name] = { weightedAccepted: 0, weightedTotal: 0 };

      // 计算反馈距今天数，应用指数衰减 e^(-0.05 × days)
      const createdAt =
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      const daysSince = Math.floor(
        (now - createdAt.getTime()) / (1000 * 60 * 60 * 24),
      );
      const decayWeight = Math.exp(-0.05 * daysSince);

      nameStats[name].weightedTotal += decayWeight;
      if (row.action === 'accepted') {
        nameStats[name].weightedAccepted += decayWeight;
      }
    }

    for (const [name, s] of Object.entries(nameStats)) {
      if (s.weightedTotal < 1.5) continue; // 至少约2条有效数据
      const rate = s.weightedAccepted / s.weightedTotal;
      // 映射到 0.7~1.2: rate=0 → 0.7, rate=0.5 → 0.95, rate=1 → 1.2
      foodNameWeights[name] = 0.7 + rate * 0.5;
    }

    return {
      categoryWeights: aggregate((r) => r.category),
      ingredientWeights: aggregate((r) => r.mainIngredient),
      foodGroupWeights: aggregate((r) => r.foodGroup),
      foodNameWeights,
    };
  }

  /**
   * 获取指定地区的食物评分偏移映射
   * 返回 foodId → 乘数 (0.70 ~ 1.20)
   *   common + 高流行度 → 1.10~1.20（本地常见食物加分）
   *   common → 1.05（可获得但流行度一般）
   *   seasonal → 0.90（季节性，获取不稳定）
   *   rare → 0.70（当地罕见，获取困难）
   *   无数据 → 不在映射中（×1.0 不调整）
   */
  async getRegionalBoostMap(region: string): Promise<Record<string, number>> {
    const cacheKey = this.redis.buildKey(
      PreferenceProfileService.NS_REGIONAL,
      region,
    );

    return this.redis.getOrSet<Record<string, number>>(
      cacheKey,
      PreferenceProfileService.CACHE_TTL_MS,
      async () => {
        const boostMap: Record<string, number> = {};
        try {
          const infos = await this.prisma.foodRegionalInfo.findMany({
            where: { region },
          });

          for (const info of infos) {
            let boost = 1.0;
            switch (info.availability) {
              case 'common':
                // 高流行度的常见食物额外加分（范围扩大: 1.08→1.20, 1.02→1.05）
                boost = (info.localPopularity ?? 0) > 50 ? 1.2 : 1.05;
                break;
              case 'seasonal':
                boost = 0.9;
                break;
              case 'rare':
                // 罕见食物惩罚加大（0.85→0.70）
                boost = 0.7;
                break;
            }
            if (boost !== 1.0) {
              boostMap[info.foodId] = boost;
            }
          }
        } catch (err) {
          this.logger.warn(`加载地区信息失败 [${region}]: ${err}`);
        }
        return boostMap;
      },
    );
  }

  /**
   * 获取用户近期记录的食物名（用于多样性去重）
   */
  async getRecentFoodNames(userId: string, days: number): Promise<string[]> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const records: Array<{ name: string }> =
        await this.prisma.$queryRawUnsafe(
          `SELECT DISTINCT food_item->>'name' AS name
           FROM food_records fr
           CROSS JOIN LATERAL jsonb_array_elements(fr.foods) AS food_item
           WHERE fr.user_id = $1
             AND fr.recorded_at >= $2`,
          userId,
          since,
        );

      return records.map((r) => r.name);
    } catch {
      return [];
    }
  }

  // ==================== V7.1 P2-G: 统一偏好信号 ====================

  /**
   * V7.1 P2-G: 计算统一偏好信号
   *
   * 将多个独立的偏好机制统一为 PreferenceSignal：
   * 1. Thompson Sampling 探索系数（Beta 分布采样）
   * 2. 品类偏好 boost（来自 UserPreferenceProfile）
   * 3. 食材偏好 boost（来自 UserPreferenceProfile）
   * 4. 替换模式 boost（来自 ExecutionTracker 的高频替换对）
   * 5. 菜系偏好 boost（来自 PreferencesProfile.cuisineWeights）
   *
   * combined = explorationMultiplier × (加权合成各 boost)
   *
   * @param food 被评分的食物
   * @param feedbackStats 该食物的反馈统计（accepted/rejected 次数）
   * @param preferenceProfile 用户偏好画像（品类/食材/食物组 乘数）
   * @param preferencesProfile 用户偏好领域实体（含 cuisineWeights）
   * @param substitutions 用户高频替换模式列表
   * @param explorationRange Thompson Sampling 映射范围 [min, max]
   * @returns PreferenceSignal 统一信号
   */
  computePreferenceSignal(
    food: FoodLibrary,
    feedbackStats?: FoodFeedbackStats | null,
    preferenceProfile?: UserPreferenceProfile | null,
    preferencesProfile?: PreferencesProfile | null,
    substitutions?: SubstitutionPattern[] | null,
    explorationRange?: [number, number],
  ): PreferenceSignal {
    // ── 1. Thompson Sampling 探索系数 ──
    const [minMult, maxMult] = explorationRange ?? [0.5, 1.5];
    const alpha = (feedbackStats?.accepted ?? 0) + 1;
    const beta = (feedbackStats?.rejected ?? 0) + 1;
    const sample = this.sampleBeta(alpha, beta);
    const explorationMultiplier = minMult + sample * (maxMult - minMult);

    // ── 2. 品类偏好 boost ──
    // 从 UserPreferenceProfile.categoryWeights 读取，范围 0.3~1.3
    // 无数据时为 1.0（中性）
    const categoryBoost =
      preferenceProfile?.categoryWeights?.[food.category] ?? 1.0;

    // ── 3. 食材偏好 boost ──
    // 从 UserPreferenceProfile.ingredientWeights 读取，范围 0.3~1.3
    const ingredientBoost =
      (food.mainIngredient
        ? preferenceProfile?.ingredientWeights?.[food.mainIngredient]
        : undefined) ?? 1.0;

    // ── 4. 替换模式 boost ──
    // 如果该食物作为 toFood 出现在高频替换对中，给予 +5% boost（每对）
    // 最高累积到 +10%（2对），避免替换 boost 主导
    let substitutionBoost = 0;
    if (substitutions && substitutions.length > 0) {
      let matchCount = 0;
      for (const sub of substitutions) {
        if (sub.toFoodId === food.id || sub.toFoodName === food.name) {
          matchCount++;
          if (matchCount >= 2) break; // 最多计 2 对
        }
      }
      substitutionBoost = matchCount * 0.05; // 每对 +5%，最高 +10%
    }

    // ── 5. 菜系偏好 boost ──
    // 从 PreferencesProfile.cuisineWeights 读取，权重 [0,1] → boost [-0.1, +0.1]
    let cuisineBoost = 0;
    if (preferencesProfile?.cuisineWeights && food.cuisine) {
      const cuisineWeight = preferencesProfile.cuisineWeights[food.cuisine];
      if (cuisineWeight !== undefined) {
        cuisineBoost = (cuisineWeight - 0.5) * 0.2;
      }
    }

    // ── 6. 合成 combined 乘数 ──
    // 利用信号（category/ingredient）作为乘数叠加
    // 替换和菜系作为加法 boost
    // 最终乘以探索系数
    const utilityMultiplier =
      categoryBoost * ingredientBoost * (1 + substitutionBoost + cuisineBoost);
    const combined = explorationMultiplier * utilityMultiplier;

    return {
      explorationMultiplier,
      categoryBoost,
      ingredientBoost,
      substitutionBoost,
      cuisineBoost,
      combined,
    };
  }

  // ==================== Beta/Gamma 采样工具方法 ====================

  /**
   * Beta 分布采样 — Gamma-ratio 方法
   *
   * 从 MealAssemblerService 迁移（V7.1 P2-G）。
   * 对于 α,β 均较小的场景（典型反馈次数 <100），该算法高效且精确。
   */
  sampleBeta(alpha: number, beta: number): number {
    // 特殊情况: Beta(1,1) = Uniform(0,1)
    if (alpha === 1 && beta === 1) return Math.random();

    const gammaA = this.sampleGamma(alpha);
    const gammaB = this.sampleGamma(beta);
    const sum = gammaA + gammaB;
    if (sum === 0) return 0.5;
    return gammaA / sum;
  }

  /**
   * Gamma 分布采样 — Marsaglia & Tsang's method
   * 用于通过 Gamma 采样构造 Beta 分布: Beta(a,b) = Ga(a) / (Ga(a) + Ga(b))
   */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      const g = this.sampleGamma(shape + 1);
      return g * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.sampleStdNormal();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Box-Muller 标准正态分布采样 */
  private sampleStdNormal(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
