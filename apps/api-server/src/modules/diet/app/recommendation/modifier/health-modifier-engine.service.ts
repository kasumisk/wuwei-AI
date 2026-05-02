import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { FoodLibrary } from '../../../../food/food.types';
import {
  HealthCondition,
  normalizeHealthConditions,
} from '../types/recommendation.types';
import { matchAllergens } from '../filter/allergen-filter.util';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import { MetricsService } from '../../../../../core/metrics/metrics.service';
import { t } from '../utils/i18n-messages';

// ==================== 类型 ====================

/**
 * V5 2.8: 单个健康修正项
 * 每条规则触发后生成一个 HealthModifier，记录类型（惩罚/增益）和具体乘数
 */
export interface HealthModifier {
  /** 乘数因子 (<1 为惩罚, >1 为增益, 0 为否决) */
  multiplier: number;
  /** 触发原因描述 */
  reason: string;
  /** 修正类型: penalty=惩罚, bonus=正向增益 */
  type: 'penalty' | 'bonus';
}

/**
 * 健康修正结果（V5 2.8: 由 PenaltyResult 演进）
 * 包含最终乘数、结构化修正项列表和否决标志
 */
export interface HealthModifierResult {
  /** 最终乘数因子 (0+, 0=一票否决, >1 表示有正向增益) */
  finalMultiplier: number;
  /** 触发的所有修正项（结构化） */
  modifiers: HealthModifier[];
  /** 是否被一票否决 */
  isVetoed: boolean;
}

/**
 * 健康修正上下文（V5 2.8: 由 PenaltyContext 重命名）
 * 传入用户过敏原、健康状况和目标类型
 */
export interface HealthModifierContext {
  /** 用户过敏原列表 */
  allergens?: string[];
  /**
   * 用户健康状况列表
   * 支持两种格式：
   * - 纯字符串: 使用默认 moderate 严重度
   * - HealthConditionWithSeverity: 带严重度的健康条件
   */
  healthConditions?: Array<string | HealthConditionWithSeverity>;
  /** 目标类型 */
  goalType?: string;
}

/** V5 2.8: 严重度等级 */
export type HealthSeverity = 'mild' | 'moderate' | 'severe';

/**
 * V5 2.8: 带严重度的健康条件
 * 允许按条件粒度指定严重程度，影响惩罚/增益的强度
 */
export interface HealthConditionWithSeverity {
  condition: string;
  severity: HealthSeverity;
}

/**
 * V7.9 P3-04: 健康条件预计算结果
 * 将 parseConditions + normalizeHealthConditions + severityMap 构建
 * 提取为一次性预计算，避免对每个候选食物重复执行。
 */
interface PrecomputedConditions {
  conditionNames: string[];
  severityMap: Map<string, HealthSeverity>;
}

// ==================== Service ====================

/** L2 缓存 TTL（2 小时），食物营养数据变化低频，缓存窗口可以较长 */
const L2_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

/** L2 缓存 key 前缀 */
const L2_KEY_PREFIX = 'health_mod';

/**
 * 健康修正引擎（V5 2.8: 由 PenaltyEngineService 重命名）
 *
 * 五层管道:
 * 1. 一票否决（过敏原/反式脂肪/麸质+乳糜泻）
 * 2. 重度惩罚（油炸/高钠）
 * 3. 目标相关惩罚（减脂高糖/增肌低蛋白）
 * 4. 健康状况惩罚（糖尿病/高血压/高血脂/痛风/肾病/脂肪肝/乳糜泻/IBS+fodmapLevel/贫血/骨质疏松/心血管/甲状腺）
 * 5. 正向健康增益（高血脂+Omega3/糖尿病+低GI/高血压+高钾低钠/贫血+高铁/骨质疏松+高钙/心血管+Omega3+高纤维）
 *
 * V6.4: 二级缓存架构
 * - L1: 请求级内存 Map（同一请求内 context 固定，key=foodId）
 * - L2: Redis 缓存（跨请求复用，key=contextHash:foodId，TTL=2h）
 * - Redis 不可用时自动降级为仅 L1
 */
@Injectable()
export class HealthModifierEngineService {
  private readonly logger = new Logger(HealthModifierEngineService.name);

  constructor(
    private readonly redis: RedisCacheService,
    private readonly metrics: MetricsService,
  ) {}

  // ── 上下文哈希（L2 缓存 key 的一部分） ──

  /**
   * 将 HealthModifierContext 哈希为短字符串，用于 L2 缓存 key。
   * 相同的过敏原 + 健康状况 + 目标类型 → 相同的 hash。
   * 生成 8 字节 hex（16 字符），碰撞概率可忽略。
   */
  hashContext(context?: HealthModifierContext): string {
    if (!context) return 'none';

    // 排序保证顺序无关
    const allergens = (context.allergens || []).slice().sort().join(',');
    const conditions = (context.healthConditions || [])
      .map((c) => (typeof c === 'string' ? c : `${c.condition}:${c.severity}`))
      .sort()
      .join(',');
    const goal = context.goalType || '';

    const raw = `${allergens}|${conditions}|${goal}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /**
   * 构建 L2 缓存 key
   * 格式: health_mod:{contextHash}:{foodId}
   */
  private buildL2Key(contextHash: string, foodId: string): string {
    return this.redis.buildKey(L2_KEY_PREFIX, contextHash, foodId);
  }

  // ── 缓存失效 ──

  /**
   * 当用户健康档案变更（过敏原/健康状况/目标）时调用，
   * 清除该 context 对应的所有 L2 缓存。
   *
   * 由调用方（如 UserProfileService）在更新用户档案后触发。
   *
   * @param context 旧的或新的健康上下文（两者都应清除）
   * @returns 清除的 key 数量
   */
  async invalidateL2Cache(context?: HealthModifierContext): Promise<number> {
    const contextHash = this.hashContext(context);
    const prefix = this.redis.buildKey(L2_KEY_PREFIX, contextHash) + ':';
    const deleted = await this.redis.delByPrefix(prefix);
    if (deleted > 0) {
      this.logger.log(
        `Invalidated ${deleted} L2 cache entries for context hash ${contextHash}`,
      );
    }
    return deleted;
  }

  // ── 评估入口 ──

  /**
   * 对单个食物执行健康修正管道（同步）
   * 返回最终乘数、结构化修正项列表和否决标志
   * finalMultiplier = 0 表示一票否决，该食物不应被推荐
   *
   * V6.4: L1 请求级缓存（同步查找），L2 Redis 由 preloadL2Cache / flushToL2 处理
   *
   * @param food    食物数据
   * @param context 健康修正上下文（过敏原、健康状况、目标）
   * @param cache   V6.3 P1-8: 请求级缓存（L1），key=foodId
   */
  evaluate(
    food: FoodLibrary,
    context?: HealthModifierContext,
    cache?: Map<string, HealthModifierResult>,
    precomputed?: PrecomputedConditions,
  ): HealthModifierResult {
    const foodId = food.id;

    // ── L1: 请求级内存缓存 ──
    if (cache && foodId) {
      const l1Hit = cache.get(foodId);
      if (l1Hit) {
        this.metrics.cacheOperations.inc({
          tier: 'l1',
          operation: 'get',
          result: 'hit',
        });
        return l1Hit;
      }
      this.metrics.cacheOperations.inc({
        tier: 'l1',
        operation: 'get',
        result: 'miss',
      });
    }

    // ── 计算 ──
    const result = this.evaluateInternal(food, context, precomputed);

    // ── 写入 L1 ──
    if (cache && foodId) {
      cache.set(foodId, result);
    }

    return result;
  }

  // ── L2 Redis 批量预热 & 回写（异步，由调用方在评分管道前后调用） ──

  /**
   * V6.4: 批量预热 L2 缓存 → L1 Map
   *
   * 在推荐管道开始前调用，将候选食物的 L2 缓存批量加载到 L1 Map 中。
   * 使用 Redis MGET 减少 RTT。
   *
   * @param foodIds   候选食物 ID 列表
   * @param context   健康修正上下文
   * @param cache     L1 请求级缓存（会被 mutate 填充）
   * @returns         L2 命中数量
   */
  async preloadL2Cache(
    foodIds: string[],
    context: HealthModifierContext | undefined,
    cache: Map<string, HealthModifierResult>,
  ): Promise<number> {
    if (foodIds.length === 0) return 0;

    const contextHash = this.hashContext(context);
    const l2Keys = foodIds.map((id) => this.buildL2Key(contextHash, id));
    const results = await this.redis.mget<HealthModifierResult>(l2Keys);

    let hitCount = 0;
    for (let i = 0; i < foodIds.length; i++) {
      const val = results[i];
      if (val !== null) {
        cache.set(foodIds[i], val);
        hitCount++;
      }
    }

    this.metrics.cacheOperations.inc(
      { tier: 'l2', operation: 'get', result: 'hit' },
      hitCount,
    );
    this.metrics.cacheOperations.inc(
      { tier: 'l2', operation: 'get', result: 'miss' },
      foodIds.length - hitCount,
    );

    if (hitCount > 0) {
      this.logger.debug(
        `L2 preload: ${hitCount}/${foodIds.length} hits for context ${contextHash}`,
      );
    }

    return hitCount;
  }

  /**
   * V6.4: 将 L1 缓存中新计算的结果批量写入 L2（异步，fire-and-forget）
   *
   * 在推荐管道完成后调用。对比 L1 Map 中哪些 key 是新计算的（即 preload 时不在 L2 中），
   * 将它们批量写入 Redis。
   *
   * @param cache        L1 请求级缓存
   * @param preloadedIds 预热阶段命中的 foodId 集合（这些不需要回写）
   * @param context      健康修正上下文
   */
  flushToL2(
    cache: Map<string, HealthModifierResult>,
    preloadedIds: Set<string>,
    context?: HealthModifierContext,
  ): void {
    const contextHash = this.hashContext(context);
    let writeCount = 0;

    for (const [foodId, result] of cache) {
      if (preloadedIds.has(foodId)) continue; // 已在 L2 中，不需要回写
      const l2Key = this.buildL2Key(contextHash, foodId);
      this.redis.set(l2Key, result, L2_CACHE_TTL_MS).catch(() => {
        // RedisCacheService 内部已有日志
      });
      writeCount++;
    }

    if (writeCount > 0) {
      this.logger.debug(
        `L2 flush: wrote ${writeCount} new entries for context ${contextHash}`,
      );
    }
  }

  /**
   * 内部评估逻辑（从 evaluate 分离以支持缓存）
   * V7.9 P3-04: 接受可选的预计算健康条件，避免每个候选食物重复解析
   */
  private evaluateInternal(
    food: FoodLibrary,
    context?: HealthModifierContext,
    precomputed?: PrecomputedConditions,
  ): HealthModifierResult {
    const modifiers: HealthModifier[] = [];
    let multiplier = 1.0;

    // ── 第一层: 一票否决（硬约束） ──

    // 过敏原匹配 → 直接否决 — 统一使用 allergen-filter.util (V4 A6)
    if (context?.allergens?.length) {
      const matched = matchAllergens(food, context.allergens);
      if (matched.length > 0) {
        const reason = t('health.veto.allergen', {
          matched: matched.join(', '),
        });
        return {
          finalMultiplier: 0,
          modifiers: [{ multiplier: 0, reason, type: 'penalty' }],
          isVetoed: true,
        };
      }
    }

    // 反式脂肪超标 → 否决（每100g超过2g反式脂肪属于严重健康风险）
    const transFat = Number(food.transFat) || 0;
    if (transFat > 2) {
      const reason = t('health.veto.transFat', { amount: String(transFat) });
      return {
        finalMultiplier: 0,
        modifiers: [{ multiplier: 0, reason, type: 'penalty' }],
        isVetoed: true,
      };
    }

    // ── 第二层: 重度惩罚 ──

    // 油炸食品
    if (food.isFried) {
      multiplier *= 0.92;
      modifiers.push({
        multiplier: 0.92,
        reason: t('health.penalty.fried'),
        type: 'penalty',
      });
    }

    // 高钠 (>600mg/100g)
    const sodium = Number(food.sodium) || 0;
    if (sodium > 600) {
      // 根据超标程度梯度惩罚
      if (sodium > 1200) {
        multiplier *= 0.88;
        modifiers.push({
          multiplier: 0.88,
          reason: t('health.penalty.highSodiumSevere', {
            amount: String(sodium),
          }),
          type: 'penalty',
        });
      } else {
        multiplier *= 0.94;
        modifiers.push({
          multiplier: 0.94,
          reason: t('health.penalty.highSodium', { amount: String(sodium) }),
          type: 'penalty',
        });
      }
    }

    // ── 第三层: 目标相关惩罚 ──

    if (context?.goalType) {
      const goalMods = this.applyGoalPenalties(food, context.goalType);
      for (const m of goalMods) {
        multiplier *= m.multiplier;
      }
      modifiers.push(...goalMods);
    }

    // ── 第四层: 健康状况相关惩罚 + 正向增益 ──

    if (context?.healthConditions?.length) {
      // V7.9 P3-04: 复用预计算结果，避免每个食物重复解析
      const pc =
        precomputed ?? this.precomputeConditions(context.healthConditions);

      const healthResult = this.applyHealthPenalties(
        food,
        context.healthConditions,
        pc,
      );
      // V4 Phase 4.6: 健康状况惩罚支持一票否决（如极高嘌呤+痛风、麸质+乳糜泻）
      if (healthResult.vetoed) {
        modifiers.push(...healthResult.modifiers);
        return {
          finalMultiplier: 0,
          modifiers,
          isVetoed: true,
        };
      }
      for (const m of healthResult.modifiers) {
        multiplier *= m.multiplier;
      }
      modifiers.push(...healthResult.modifiers);

      // V5 2.8: 正向健康增益（第五层）
      const bonusMods = this.applyHealthBonuses(
        food,
        context.healthConditions,
        pc,
      );
      for (const m of bonusMods) {
        multiplier *= m.multiplier;
      }
      modifiers.push(...bonusMods);
    }

    // L11-fix: 对任何严重（severe）健康条件，强制 finalMultiplier ≤ 0.5，
    //          防止高 preference 信号"覆盖"健康约束，导致危险食物仍出现在
    //          推荐靠前位置。否决已在上方单独处理（return 0），此处仅处理
    //          未否决但存在 severe 条件的场景（如糖尿病 severe + 高 preference food）。
    const SEVERE_HEALTH_CLAMP = 0.5;
    let finalMultiplier = Math.max(0, multiplier);

    if (context?.healthConditions?.length) {
      const pc =
        precomputed ?? this.precomputeConditions(context.healthConditions);
      const hasSevereCondition =
        pc.severityMap.size > 0 &&
        [...pc.severityMap.values()].some((s) => s === 'severe');
      if (hasSevereCondition && finalMultiplier > SEVERE_HEALTH_CLAMP) {
        finalMultiplier = SEVERE_HEALTH_CLAMP;
      }
    }

    return {
      finalMultiplier,
      modifiers,
      isVetoed: false,
    };
  }

  /**
   * 批量评估 — 返回非否决食物列表及其修正因子
   *
   * V6.4: 支持 L2 缓存预热 + 回写。
   * 如需 L2 缓存，调用方应在调用前先执行 preloadL2Cache，调用后执行 flushToL2。
   *
   * V7.9 P3-04: 在批量入口预计算一次健康条件，传入各食物评估复用。
   *
   * @param cache V6.3 P1-8: 请求级缓存（L1）
   */
  evaluateBatch(
    foods: FoodLibrary[],
    context?: HealthModifierContext,
    cache?: Map<string, HealthModifierResult>,
  ): Array<{ food: FoodLibrary; penalty: HealthModifierResult }> {
    // V7.9 P3-04: 预计算健康条件（仅一次）
    const precomputed = context?.healthConditions?.length
      ? this.precomputeConditions(context.healthConditions)
      : undefined;

    return foods
      .map((food) => ({
        food,
        penalty: this.evaluate(food, context, cache, precomputed),
      }))
      .filter(({ penalty }) => !penalty.isVetoed);
  }

  // ── 目标相关惩罚 ──

  private applyGoalPenalties(
    food: FoodLibrary,
    goalType: string,
  ): HealthModifier[] {
    const mods: HealthModifier[] = [];

    if (goalType === 'fat_loss') {
      // 减脂目标: 高糖食物惩罚
      const sugar = Number(food.sugar) || 0;
      if (sugar > 15) {
        mods.push({
          multiplier: 0.9,
          reason: t('health.goal.fatLossHighSugar', { amount: String(sugar) }),
          type: 'penalty',
        });
      }
    }

    if (goalType === 'muscle_gain') {
      // 增肌目标: 极低蛋白惩罚
      const protein = Number(food.protein) || 0;
      const calories = Number(food.calories) || 1;
      if (calories > 100 && (protein * 4) / calories < 0.05) {
        mods.push({
          multiplier: 0.9,
          reason: t('health.goal.muscleGainLowProtein'),
          type: 'penalty',
        });
      }
    }

    return mods;
  }

  // ── 健康状况惩罚 ──

  private applyHealthPenalties(
    food: FoodLibrary,
    conditions: Array<string | HealthConditionWithSeverity>,
    precomputed?: PrecomputedConditions,
  ): { modifiers: HealthModifier[]; vetoed: boolean } {
    const mods: HealthModifier[] = [];

    // V7.9 P3-04: 复用预计算结果
    const { conditionNames, severityMap } =
      precomputed ?? this.precomputeConditions(conditions);

    // 糖尿病: 高GI食物惩罚
    if (conditionNames.includes(HealthCondition.DIABETES_TYPE2)) {
      const severity =
        severityMap.get(HealthCondition.DIABETES_TYPE2) || 'moderate';
      const gi = Number(food.glycemicIndex) || 0;
      if (gi > 70) {
        mods.push({
          multiplier: this.applySeverity(0.8, severity),
          reason: t('health.condition.diabetesHighGI', { value: String(gi) }),
          type: 'penalty',
        });
      } else if (gi > 55) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.diabetesMidGI', { value: String(gi) }),
          type: 'penalty',
        });
      }
    }

    // 高血压: 高钠惩罚加重
    if (conditionNames.includes(HealthCondition.HYPERTENSION)) {
      const severity =
        severityMap.get(HealthCondition.HYPERTENSION) || 'moderate';
      const sodium = Number(food.sodium) || 0;
      if (sodium > 400) {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.hypertensionSodium', {
            amount: String(sodium),
          }),
          type: 'penalty',
        });
      }
    }

    // 高血脂: 高饱和脂肪+高胆固醇惩罚
    if (conditionNames.includes(HealthCondition.HYPERLIPIDEMIA)) {
      const severity =
        severityMap.get(HealthCondition.HYPERLIPIDEMIA) || 'moderate';
      const satFat = Number(food.saturatedFat) || 0;
      const cholesterol = Number(food.cholesterol) || 0;
      if (satFat > 5) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.hyperlipidemiaHighSatFat', {
            amount: String(satFat),
          }),
          type: 'penalty',
        });
      }
      if (cholesterol > 100) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.hyperlipidemiaHighChol', {
            amount: String(cholesterol),
          }),
          type: 'penalty',
        });
      }
    }

    // V4 Phase 4.6: 痛风 — 嘌呤梯度惩罚
    // 参考：中国痛风膳食指南
    //   低嘌呤 <50mg/100g — 无惩罚
    //   中嘌呤 50-150mg/100g — 轻度惩罚
    //   高嘌呤 150-300mg/100g — 重度惩罚
    //   极高嘌呤 >300mg/100g — 一票否决（不受 severity 影响）
    if (conditionNames.includes(HealthCondition.GOUT)) {
      const severity = severityMap.get(HealthCondition.GOUT) || 'moderate';
      const purine = Number(food.purine) || 0;
      if (purine > 300) {
        // 一票否决不受严重度影响
        mods.push({
          multiplier: 0,
          reason: t('health.veto.goutExtremePurine', {
            amount: String(purine),
          }),
          type: 'penalty',
        });
        return { modifiers: mods, vetoed: true };
      } else if (purine > 150) {
        mods.push({
          multiplier: this.applySeverity(0.7, severity),
          reason: t('health.condition.goutHighPurine', {
            amount: String(purine),
          }),
          type: 'penalty',
        });
      } else if (purine > 50) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.goutMidPurine', {
            amount: String(purine),
          }),
          type: 'penalty',
        });
      }
    }

    // V4 Phase 4.6: 肾病 — 磷+钾梯度惩罚
    // 参考：KDOQI 营养指南
    //   磷 >250mg/100g — 重度惩罚
    //   磷 >150mg/100g — 轻度惩罚
    //   钾 >400mg/100g — 重度惩罚（已有 high_potassium tag 约束，此处量化增强）
    if (conditionNames.includes(HealthCondition.KIDNEY_DISEASE)) {
      const severity =
        severityMap.get(HealthCondition.KIDNEY_DISEASE) || 'moderate';
      const phosphorus = Number(food.phosphorus) || 0;
      const potassium = Number(food.potassium) || 0;

      if (phosphorus > 250) {
        mods.push({
          multiplier: this.applySeverity(0.75, severity),
          reason: t('health.condition.kidneyHighPhos', {
            amount: String(phosphorus),
          }),
          type: 'penalty',
        });
      } else if (phosphorus > 150) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.kidneyMidPhos', {
            amount: String(phosphorus),
          }),
          type: 'penalty',
        });
      }

      if (potassium > 400) {
        mods.push({
          multiplier: this.applySeverity(0.8, severity),
          reason: t('health.condition.kidneyHighK', {
            amount: String(potassium),
          }),
          type: 'penalty',
        });
      }
    }

    // V5 2.8: 脂肪肝 — 高脂/高糖惩罚
    // 参考：NAFLD 膳食指南
    //   饱和脂肪 >5g/100g — 惩罚
    //   糖 >10g/100g — 惩罚
    if (conditionNames.includes(HealthCondition.FATTY_LIVER)) {
      const severity =
        severityMap.get(HealthCondition.FATTY_LIVER) || 'moderate';
      const satFat = Number(food.saturatedFat) || 0;
      const sugar = Number(food.sugar) || 0;

      if (satFat > 5) {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.fattyLiverHighSatFat', {
            amount: String(satFat),
          }),
          type: 'penalty',
        });
      }
      if (sugar > 10) {
        mods.push({
          multiplier: this.applySeverity(0.88, severity),
          reason: t('health.condition.fattyLiverHighSugar', {
            amount: String(sugar),
          }),
          type: 'penalty',
        });
      }
    }

    // V5 2.8: 乳糜泻 — 麸质硬否决
    // 含 gluten 过敏原的食物直接否决
    if (conditionNames.includes(HealthCondition.CELIAC_DISEASE)) {
      const allergens = food.allergens || [];
      const tags = food.tags || [];
      if (
        allergens.includes('gluten') ||
        tags.includes('gluten') ||
        tags.includes('contains_gluten')
      ) {
        mods.push({
          multiplier: 0,
          reason: t('health.veto.celiacGluten'),
          type: 'penalty',
        });
        return { modifiers: mods, vetoed: true };
      }
    }

    // V5 2.8: 肠易激综合征 — 高 FODMAP 食物惩罚
    // V7.9: 同时检查 tags（high_fodmap/fodmap_high）和 fodmapLevel 字段（'high'/'moderate'）
    if (conditionNames.includes(HealthCondition.IBS)) {
      const severity = severityMap.get(HealthCondition.IBS) || 'moderate';
      const tags = food.tags || [];
      const fodmapLevel = (food as any).fodmapLevel as string | undefined;
      if (
        tags.includes('high_fodmap') ||
        tags.includes('fodmap_high') ||
        fodmapLevel === 'high'
      ) {
        mods.push({
          multiplier: this.applySeverity(0.75, severity),
          reason: t('health.condition.ibsHighFODMAP'),
          type: 'penalty',
        });
      } else if (fodmapLevel === 'moderate') {
        // 中等 FODMAP 轻度惩罚
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.ibsFodmapLevel'),
          type: 'penalty',
        });
      }
    }

    // V5 2.8: 缺铁性贫血 — 茶/咖啡惩罚（抑制铁吸收）
    if (conditionNames.includes(HealthCondition.IRON_DEFICIENCY_ANEMIA)) {
      const severity =
        severityMap.get(HealthCondition.IRON_DEFICIENCY_ANEMIA) || 'moderate';
      const tags = food.tags || [];
      const name = (food.name || '').toLowerCase();
      if (
        tags.includes('tea') ||
        tags.includes('coffee') ||
        name.includes('茶') ||
        name.includes('咖啡')
      ) {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.anemiaTeaCoffee'),
          type: 'penalty',
        });
      }
    }

    // V7.9: 骨质疏松 — 高草酸/高钠惩罚（新增）
    // 高草酸食物（菠菜/苋菜/巧克力等）与钙结合，降低肠道钙吸收率
    // 高钠加速尿钙排出，加重骨质流失
    if (conditionNames.includes(HealthCondition.OSTEOPOROSIS)) {
      const severity =
        severityMap.get(HealthCondition.OSTEOPOROSIS) || 'moderate';
      const foodSodiumOsteo = Number(food.sodium) || 0;
      const oxalateLevel = (food as any).oxalateLevel as string | undefined;

      if (oxalateLevel === 'high') {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.osteoHighOxalate'),
          type: 'penalty',
        });
      }
      if (foodSodiumOsteo > 400) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.osteoHighSodium', {
            amount: String(foodSodiumOsteo),
          }),
          type: 'penalty',
        });
      }
    }

    // V7.9: 心血管疾病 — 高饱和脂肪/高胆固醇/高钠/反式脂肪惩罚
    // 参考：AHA/ACC 心血管膳食指南
    if (conditionNames.includes(HealthCondition.CARDIOVASCULAR)) {
      const severity =
        severityMap.get(HealthCondition.CARDIOVASCULAR) || 'moderate';
      const satFat = Number(food.saturatedFat) || 0;
      const cholesterol = Number(food.cholesterol) || 0;
      const foodSodium = Number(food.sodium) || 0;
      const foodTransFat = Number(food.transFat) || 0;

      if (satFat > 5) {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.cardiovascularHighSatFat', {
            amount: String(satFat),
          }),
          type: 'penalty',
        });
      }
      if (cholesterol > 100) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: t('health.condition.cardiovascularHighChol', {
            amount: String(cholesterol),
          }),
          type: 'penalty',
        });
      }
      if (foodSodium > 400) {
        mods.push({
          multiplier: this.applySeverity(0.85, severity),
          reason: t('health.condition.cardiovascularSodium', {
            amount: String(foodSodium),
          }),
          type: 'penalty',
        });
      }
      // 含任何反式脂肪即重度惩罚（心血管患者 transFat 应趋近 0）
      if (foodTransFat > 0) {
        mods.push({
          multiplier: this.applySeverity(0.7, severity),
          reason: t('health.condition.cardiovascularTransFat', {
            amount: String(foodTransFat),
          }),
          type: 'penalty',
        });
      }
    }

    // V7.9: 甲状腺疾病 — 高碘食物保守惩罚
    // 注：甲亢需限碘，甲减高碘亦有争议；通用 thyroid 采用回避极端高碘策略
    // food.tags 中的 high_iodine tag 匹配（食物库 iodineLevel 字段暂未建模）
    if (conditionNames.includes(HealthCondition.THYROID)) {
      const severity = severityMap.get(HealthCondition.THYROID) || 'moderate';
      const tags = food.tags || [];
      if (tags.includes('high_iodine') || tags.includes('iodine_rich')) {
        mods.push({
          multiplier: this.applySeverity(0.8, severity),
          reason: t('health.condition.thyroidHighIodine'),
          type: 'penalty',
        });
      }
    }

    return { modifiers: mods, vetoed: false };
  }

  // ── V5 2.8: 正向健康增益 ──

  /**
   * 根据健康状况对有益食物给予正向增益
   * 增益乘数 > 1.0，也受 severity 影响
   * 公式: adjustedBonus = 1 + (bonus - 1) * severityFactor
   */
  private applyHealthBonuses(
    food: FoodLibrary,
    conditions: Array<string | HealthConditionWithSeverity>,
    precomputed?: PrecomputedConditions,
  ): HealthModifier[] {
    const mods: HealthModifier[] = [];

    // V7.9 P3-04: 复用预计算结果
    const { conditionNames, severityMap } =
      precomputed ?? this.precomputeConditions(conditions);

    // 高血脂 + Omega-3 丰富: 1.15x bonus
    // 判断标准: tags 包含 omega3_rich / high_omega3，或 category=protein 且 tags 包含 seafood/fish
    if (conditionNames.includes(HealthCondition.HYPERLIPIDEMIA)) {
      const severity =
        severityMap.get(HealthCondition.HYPERLIPIDEMIA) || 'moderate';
      const tags = food.tags || [];
      const isOmega3Rich =
        tags.includes('omega3_rich') ||
        tags.includes('high_omega3') ||
        (food.category === 'protein' &&
          (tags.includes('fish') || tags.includes('seafood')));
      if (isOmega3Rich) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.15, severity),
          reason: t('health.bonus.hyperlipidemiaOmega3'),
          type: 'bonus',
        });
      }
    }

    // 糖尿病 + 低GI (<40): 1.10x bonus
    if (conditionNames.includes(HealthCondition.DIABETES_TYPE2)) {
      const severity =
        severityMap.get(HealthCondition.DIABETES_TYPE2) || 'moderate';
      const gi = Number(food.glycemicIndex) || 0;
      if (gi > 0 && gi < 40) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.1, severity),
          reason: t('health.bonus.diabetesLowGI', { value: String(gi) }),
          type: 'bonus',
        });
      }
    }

    // 高血压 + 高钾(>300mg) + 低钠(<200mg): 1.12x bonus
    if (conditionNames.includes(HealthCondition.HYPERTENSION)) {
      const severity =
        severityMap.get(HealthCondition.HYPERTENSION) || 'moderate';
      const potassium = Number(food.potassium) || 0;
      const sodium = Number(food.sodium) || 0;
      if (potassium > 300 && sodium < 200) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.12, severity),
          reason: t('health.bonus.hypertensionHighKLowNa', {
            potassium: String(potassium),
            sodium: String(sodium),
          }),
          type: 'bonus',
        });
      }
    }

    // 缺铁性贫血 + 高铁(>3mg/100g): 1.10x bonus
    if (conditionNames.includes(HealthCondition.IRON_DEFICIENCY_ANEMIA)) {
      const severity =
        severityMap.get(HealthCondition.IRON_DEFICIENCY_ANEMIA) || 'moderate';
      const iron = Number(food.iron) || 0;
      if (iron > 3) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.1, severity),
          reason: t('health.bonus.anemiaHighIron', { amount: String(iron) }),
          type: 'bonus',
        });
      }
    }

    // 骨质疏松 + 高钙(>100mg/100g): 1.10x bonus
    if (conditionNames.includes(HealthCondition.OSTEOPOROSIS)) {
      const severity =
        severityMap.get(HealthCondition.OSTEOPOROSIS) || 'moderate';
      const calcium = Number(food.calcium) || 0;
      if (calcium > 100) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.1, severity),
          reason: t('health.bonus.osteoHighCalcium', {
            amount: String(calcium),
          }),
          type: 'bonus',
        });
      }
    }

    // V7.9: 心血管疾病 + Omega-3 丰富: 1.15x bonus
    // 与高血脂 Omega-3 bonus 逻辑一致
    if (conditionNames.includes(HealthCondition.CARDIOVASCULAR)) {
      const severity =
        severityMap.get(HealthCondition.CARDIOVASCULAR) || 'moderate';
      const tags = food.tags || [];
      const isOmega3Rich =
        tags.includes('omega3_rich') ||
        tags.includes('high_omega3') ||
        (food.category === 'protein' &&
          (tags.includes('fish') || tags.includes('seafood')));
      if (isOmega3Rich) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.15, severity),
          reason: t('health.bonus.cardiovascularOmega3'),
          type: 'bonus',
        });
      }
      // 高纤维食物: 1.10x bonus（有助降低心血管风险）
      const fiber = Number(food.fiber) || 0;
      if (fiber > 5 || tags.includes('high_fiber')) {
        mods.push({
          multiplier: this.applyBonusSeverity(1.1, severity),
          reason: t('health.bonus.cardiovascularFiber'),
          type: 'bonus',
        });
      }
    }

    return mods;
  }

  // ── V5 2.8: 严重度相关辅助方法 ──

  /**
   * 解析健康条件列表，支持纯字符串和带严重度的对象混合
   * 纯字符串默认 moderate 严重度
   */
  private parseConditions(
    conditions: Array<string | HealthConditionWithSeverity>,
  ): Array<{ condition: string; severity: HealthSeverity }> {
    return conditions.map((c) => {
      if (typeof c === 'string') {
        return { condition: c, severity: 'moderate' as HealthSeverity };
      }
      return { condition: c.condition, severity: c.severity };
    });
  }

  /**
   * V7.9 P3-04: 预计算健康条件 — 将 parseConditions + normalizeHealthConditions + severityMap 构建
   * 合并为一次调用，在批量评估入口执行一次，传入各评估方法复用。
   */
  private precomputeConditions(
    conditions: Array<string | HealthConditionWithSeverity>,
  ): PrecomputedConditions {
    const parsed = this.parseConditions(conditions);
    const conditionNames = normalizeHealthConditions(
      parsed.map((p) => p.condition),
    );
    const severityMap = new Map<string, HealthSeverity>();
    for (const p of parsed) {
      const normalized = normalizeHealthConditions([p.condition]);
      if (normalized.length > 0) {
        severityMap.set(normalized[0], p.severity);
      }
    }
    return { conditionNames, severityMap };
  }

  /**
   * 获取严重度因子
   * mild=0.6（惩罚打 6 折）, moderate=1.0（标准）, severe=1.3（惩罚加 30%）
   */
  private getSeverityFactor(severity: HealthSeverity): number {
    switch (severity) {
      case 'mild':
        return 0.6;
      case 'moderate':
        return 1.0;
      case 'severe':
        return 1.3;
    }
  }

  /**
   * 对基础惩罚乘数应用严重度调整
   * 公式: adjusted = 1 - (1 - base) * severityFactor
   * 例: base=0.8, mild → 1-(1-0.8)*0.6=0.88
   * 例: base=0.8, severe → 1-(1-0.8)*1.3=0.74
   * clamp 到 [0, 1] 区间
   */
  private applySeverity(
    baseMultiplier: number,
    severity: HealthSeverity,
  ): number {
    const factor = this.getSeverityFactor(severity);
    const penaltyAmount = 1 - baseMultiplier; // 惩罚量（正数）
    const adjusted = 1 - penaltyAmount * factor;
    return Math.max(0, Math.min(1, adjusted));
  }

  /**
   * V5 2.8: 对基础增益乘数应用严重度调整
   * 公式: adjusted = 1 + (base - 1) * severityFactor
   * 例: base=1.15, mild → 1+(1.15-1)*0.6=1.09
   * 例: base=1.15, severe → 1+(1.15-1)*1.3=1.195
   * 下限 clamp 到 1.0（增益不会变成惩罚）
   */
  private applyBonusSeverity(
    baseMultiplier: number,
    severity: HealthSeverity,
  ): number {
    const factor = this.getSeverityFactor(severity);
    const bonusAmount = baseMultiplier - 1; // 增益量（正数）
    const adjusted = 1 + bonusAmount * factor;
    return Math.max(1, adjusted);
  }
}
