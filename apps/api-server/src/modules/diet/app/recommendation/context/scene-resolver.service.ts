import { Injectable, Logger } from '@nestjs/common';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import {
  AcquisitionChannel,
  SceneContext,
  SceneConstraints,
  SceneType,
} from '../types/recommendation.types';
import type { KitchenProfile } from '../../../../user/user.types';
import {
  CookingMethod,
  EQUIPMENT_COOKING_MAP,
  STOVE_REQUIRED_METHODS,
} from '../../../../food/cooking-method.constants';

/**
 * V6.9 Phase 1-A: 场景解析器
 *
 * 职责：根据多层优先级推断当前用餐场景（SceneContext），供下游管道使用。
 *
 * 4 层优先级：
 * 1. 用户显式指定（客户端 explicitChannel / explicitRealism）
 * 2. 行为学习（Redis 中 dayOfWeek × mealType 的历史渠道偏好）
 * 3. 规则推断（增强版 inferAcquisitionChannel，吸收上下文+声明画像）
 * 4. 默认（general 场景）
 *
 * V7.1 Phase 2-D: 行为学习时间衰减
 * - recordChannelUsage() 升级为按天粒度追加记录
 * - learnFromHistory() 对每条记录应用指数衰减 exp(-λ × daysSince)
 *
 * V7.1 Phase 2-E: KitchenProfile 接入
 * - resolve() 接收 kitchenProfile 参数
 * - home_cooking 场景约束中注入设备限制
 *
 * 替代关系：
 * - V6.8 的 inferAcquisitionChannel() 保留不删除（向后兼容）
 * - 推荐管道中由本服务取代，返回更丰富的 SceneContext
 */

/** V7.1 P2-D: 时间衰减半衰期（天） */
const DECAY_HALF_LIFE_DAYS = 14;
/** V7.1 P2-D: 衰减系数 λ = ln(2) / halfLife */
const DECAY_LAMBDA = Math.LN2 / DECAY_HALF_LIFE_DAYS;

/** V7.1 P2-E: 设备→烹饪方式映射 — 引用自 cooking-method.constants */
const EQUIPMENT_MAP = EQUIPMENT_COOKING_MAP;

/** V7.1 P2-E: KitchenProfile 字段→设备 key 映射 */
const KITCHEN_EQUIPMENT_KEYS: {
  field: keyof KitchenProfile;
  equipment: string;
}[] = [
  { field: 'hasOven', equipment: 'oven' },
  { field: 'hasMicrowave', equipment: 'microwave' },
  { field: 'hasAirFryer', equipment: 'air_fryer' },
  { field: 'hasSteamer', equipment: 'steamer' },
  { field: 'hasRiceCooker', equipment: 'rice_cooker' },
];
@Injectable()
export class SceneResolverService {
  private readonly logger = new Logger(SceneResolverService.name);

  /** Redis key 前缀：用户场景行为模式 */
  private static readonly PATTERN_KEY_PREFIX = 'scene:user:';
  /** Redis key 后缀 */
  private static readonly PATTERN_KEY_SUFFIX = ':patterns';
  /** 行为模式 TTL: 30 天 */
  private static readonly PATTERN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  /** 行为学习采用阈值：confidence >= 此值时采用行为学习结果 */
  private static readonly BEHAVIOR_CONFIDENCE_THRESHOLD = 0.6;

  constructor(private readonly redis: RedisCacheService) {}

  // ==================== 公开方法 ====================

  /**
   * 解析当前用餐场景
   *
   * @param userId            用户 ID
   * @param mealType          餐次类型 (breakfast/lunch/dinner/snack)
   * @param explicitChannel   客户端显式指定的渠道
   * @param explicitRealism   客户端显式指定的现实性级别
   * @param contextualProfile 上下文画像（场景/日类型）
   * @param declaredProfile   声明画像（烹饪能力/外卖频率等）
   * @param kitchenProfile    V7.1 P2-E: 厨房设备画像（可选）
   * @returns SceneContext
   */
  async resolve(
    userId: string | undefined | null,
    mealType: string,
    explicitChannel?: string | null,
    explicitRealism?: 'strict' | 'normal' | 'relaxed' | null,
    contextualProfile?: { scene?: string; dayType?: string } | null,
    declaredProfile?: {
      canCook?: boolean;
      takeoutFrequency?: string;
      primaryEatingLocation?: string | null;
    } | null,
    kitchenProfile?: KitchenProfile | null,
  ): Promise<SceneContext> {
    // Layer 1: 用户显式指定
    if (explicitChannel || explicitRealism) {
      const scene = this.buildExplicitScene(
        mealType,
        explicitChannel,
        explicitRealism,
      );
      return this.applyKitchenConstraints(scene, kitchenProfile);
    }

    // Layer 2: 行为学习（需要 userId）
    let behaviorScene: SceneContext | null = null;
    if (userId) {
      behaviorScene = await this.learnFromHistory(userId, mealType);
    }

    // Layer 3: 规则推断
    const ruleScene = this.inferByRules(
      mealType,
      contextualProfile,
      declaredProfile,
    );

    // Layer 4: 合并 / 默认
    let result: SceneContext;
    if (
      behaviorScene &&
      behaviorScene.confidence >=
        SceneResolverService.BEHAVIOR_CONFIDENCE_THRESHOLD
    ) {
      result = behaviorScene;
    } else if (behaviorScene && ruleScene) {
      result = this.mergeScenes(behaviorScene, ruleScene);
    } else {
      result = ruleScene ?? this.buildDefaultScene(mealType);
    }

    // V7.1 P2-E: 注入设备约束
    return this.applyKitchenConstraints(result, kitchenProfile);
  }

  /**
   * 记录用户实际使用的渠道（用于行为学习）
   *
   * V7.1 P2-D: 升级为按天粒度追加，支持时间衰减。
   * 存储格式从 `{ channel, count }[]` 升级为 `{ channel, records: { date, count }[] }[]`。
   */
  async recordChannelUsage(
    userId: string,
    mealType: string,
    channel: AcquisitionChannel,
  ): Promise<void> {
    if (!this.redis.isConnected) return;

    const key = this.buildPatternKey(userId);
    const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat
    const slotKey = `${dayOfWeek}_${mealType}`;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    try {
      type DateRecord = { date: string; count: number };
      type ChannelEntry = { channel: string; records: DateRecord[] };
      // V7.1: 新格式
      type V71PatternMap = Record<string, ChannelEntry[]>;
      // V6.9 旧格式（向前兼容读取）
      type V69PatternMap = Record<string, { channel: string; count: number }[]>;

      const raw = await this.redis.get<V71PatternMap | V69PatternMap>(key);
      const patterns: V71PatternMap = {};

      // 迁移旧格式
      if (raw) {
        for (const [sk, entries] of Object.entries(raw)) {
          if (!entries || entries.length === 0) {
            patterns[sk] = [];
            continue;
          }
          // 检查是否是旧格式（有 count 但无 records）
          const first = entries[0] as {
            channel: string;
            count?: number;
            records?: DateRecord[];
          };
          if (first.records) {
            // 新格式
            patterns[sk] = entries as ChannelEntry[];
          } else {
            // 旧格式：将 count 转为 15 天前的单条记录（兼容处理）
            patterns[sk] = (
              entries as { channel: string; count: number }[]
            ).map((e) => ({
              channel: e.channel,
              records: [
                {
                  date: new Date(Date.now() - 15 * 86400000)
                    .toISOString()
                    .slice(0, 10),
                  count: e.count,
                },
              ],
            }));
          }
        }
      }

      const slot = patterns[slotKey] ?? [];
      const channelEntry = slot.find((s) => s.channel === channel);
      if (channelEntry) {
        const todayRecord = channelEntry.records.find((r) => r.date === today);
        if (todayRecord) {
          todayRecord.count += 1;
        } else {
          channelEntry.records.push({ date: today, count: 1 });
        }
      } else {
        slot.push({ channel, records: [{ date: today, count: 1 }] });
      }
      patterns[slotKey] = slot;

      await this.redis.set(key, patterns, SceneResolverService.PATTERN_TTL_MS);
    } catch (err) {
      this.logger.warn(
        `Failed to record channel usage for user ${userId}: ${err}`,
      );
    }
  }

  // ==================== 私有方法 ====================

  /**
   * Layer 1: 构建用户显式指定的场景
   */
  private buildExplicitScene(
    mealType: string,
    explicitChannel?: string | null,
    explicitRealism?: 'strict' | 'normal' | 'relaxed' | null,
  ): SceneContext {
    const channel = this.parseChannel(explicitChannel);
    const sceneType = this.channelToSceneType(channel, mealType);
    return {
      channel,
      sceneType,
      realismLevel: explicitRealism ?? 'normal',
      confidence: 1.0,
      source: 'user_explicit',
      sceneConstraints: this.getDefaultConstraints(sceneType),
    };
  }

  /**
   * Layer 2: 从 Redis 行为历史学习场景偏好
   *
   * V7.1 P2-D: 对每条记录应用指数衰减 exp(-λ × daysSince)，
   * 近期行为权重更大，远期行为逐渐淡化。
   * 兼容旧格式（无 records 字段时按 15 天前处理）。
   */
  private async learnFromHistory(
    userId: string,
    mealType: string,
  ): Promise<SceneContext | null> {
    if (!this.redis.isConnected) return null;

    const key = this.buildPatternKey(userId);

    try {
      type DateRecord = { date: string; count: number };
      type ChannelEntry = {
        channel: string;
        records?: DateRecord[];
        count?: number;
      };
      type PatternMap = Record<string, ChannelEntry[]>;
      const patterns = await this.redis.get<PatternMap>(key);
      if (!patterns) return null;

      const dayOfWeek = new Date().getDay();
      const slotKey = `${dayOfWeek}_${mealType}`;
      const slot = patterns[slotKey];
      if (!slot || slot.length === 0) return null;

      const now = Date.now();

      // 计算每个渠道的衰减加权总分
      const channelScores: { channel: string; weightedCount: number }[] = [];
      let totalWeightedCount = 0;

      for (const entry of slot) {
        let weightedCount = 0;

        if (entry.records && entry.records.length > 0) {
          // V7.1 新格式：逐条应用衰减
          for (const record of entry.records) {
            const recordTime = new Date(record.date).getTime();
            const daysSince = Math.max(0, (now - recordTime) / 86400000);
            const decayFactor = Math.exp(-DECAY_LAMBDA * daysSince);
            weightedCount += record.count * decayFactor;
          }
        } else if (entry.count !== undefined) {
          // V6.9 旧格式兼容：按 15 天前处理
          const decayFactor = Math.exp(-DECAY_LAMBDA * 15);
          weightedCount = entry.count * decayFactor;
        }

        channelScores.push({ channel: entry.channel, weightedCount });
        totalWeightedCount += weightedCount;
      }

      if (totalWeightedCount === 0) return null;

      // 找出最高衰减加权分的渠道
      const top = channelScores.reduce((best, s) =>
        s.weightedCount > best.weightedCount ? s : best,
      );

      const confidence = top.weightedCount / totalWeightedCount;
      const channel = this.parseChannel(top.channel);
      const sceneType = this.channelToSceneType(channel, mealType);

      return {
        channel,
        sceneType,
        realismLevel: 'normal',
        confidence,
        source: 'behavior_learned',
        sceneConstraints: this.getDefaultConstraints(sceneType),
      };
    } catch (err) {
      this.logger.warn(
        `Failed to read behavior patterns for user ${userId}: ${err}`,
      );
      return null;
    }
  }

  /**
   * Layer 3: 增强版规则推断
   *
   * 吸收了 V6.8 inferAcquisitionChannel() 的全部逻辑，并扩展：
   * - 时段推断（当前小时）
   * - 上下文画像
   * - 声明画像
   */
  private inferByRules(
    mealType: string,
    contextualProfile?: { scene?: string; dayType?: string } | null,
    declaredProfile?: {
      canCook?: boolean;
      takeoutFrequency?: string;
      primaryEatingLocation?: string | null;
    } | null,
  ): SceneContext {
    const hour = new Date().getHours();

    // 食堂场景（声明优先）
    if (declaredProfile?.primaryEatingLocation === 'canteen') {
      return this.buildRuleScene(AcquisitionChannel.CANTEEN, mealType, 0.8);
    }

    // 上下文场景推断
    if (contextualProfile) {
      const { scene, dayType } = contextualProfile;
      const isWeekend = dayType === 'weekend';

      // 深夜场景 → 便利店/即食
      if (scene === 'late_night') {
        return this.buildRuleScene(
          AcquisitionChannel.CONVENIENCE,
          mealType,
          0.7,
        );
      }

      // 运动后场景
      if (scene === 'post_workout') {
        const sceneCtx = this.buildRuleScene(
          AcquisitionChannel.CONVENIENCE,
          mealType,
          0.7,
        );
        sceneCtx.sceneType = 'post_workout';
        sceneCtx.sceneConstraints = this.getDefaultConstraints('post_workout');
        return sceneCtx;
      }

      // 工作日午/晚餐 → 外卖
      if (!isWeekend && (mealType === 'lunch' || mealType === 'dinner')) {
        if (scene === 'working') {
          return this.buildRuleScene(
            AcquisitionChannel.DELIVERY,
            mealType,
            0.65,
          );
        }
      }

      // 周末正餐 → 在家烹饪
      if (
        isWeekend &&
        (mealType === 'breakfast' ||
          mealType === 'lunch' ||
          mealType === 'dinner')
      ) {
        return this.buildRuleScene(AcquisitionChannel.HOME_COOK, mealType, 0.6);
      }
    }

    // 声明画像推断
    if (declaredProfile) {
      const { canCook, takeoutFrequency } = declaredProfile;
      if (canCook === false) {
        return this.buildRuleScene(AcquisitionChannel.DELIVERY, mealType, 0.55);
      }
      if (takeoutFrequency === 'always' || takeoutFrequency === 'often') {
        return this.buildRuleScene(AcquisitionChannel.DELIVERY, mealType, 0.5);
      }
      if (
        canCook &&
        (takeoutFrequency === 'rarely' || takeoutFrequency === 'never')
      ) {
        return this.buildRuleScene(AcquisitionChannel.HOME_COOK, mealType, 0.5);
      }
    }

    // 时段兜底推断
    if (mealType === 'breakfast' && hour >= 5 && hour < 9) {
      return this.buildRuleScene(AcquisitionChannel.HOME_COOK, mealType, 0.4);
    }
    if (mealType === 'snack' && hour >= 22) {
      return this.buildRuleScene(AcquisitionChannel.CONVENIENCE, mealType, 0.4);
    }

    // 默认
    return this.buildDefaultScene(mealType);
  }

  /**
   * 合并行为学习结果与规则推断结果
   *
   * 当行为学习置信度 < threshold 时，与规则推断加权合并：
   * - 如果两者渠道一致 → 提升置信度
   * - 如果不一致 → 取规则推断（更稳定），但保留行为学习的场景信息
   */
  private mergeScenes(
    behavior: SceneContext,
    rule: SceneContext,
  ): SceneContext {
    if (behavior.channel === rule.channel) {
      // 渠道一致，取行为学习结果但提升置信度
      return {
        ...behavior,
        confidence: Math.min(
          1.0,
          behavior.confidence * 0.6 + rule.confidence * 0.4,
        ),
        source: 'behavior_learned',
      };
    }

    // 渠道不一致，取规则推断（更稳定）
    return {
      ...rule,
      confidence: rule.confidence * 0.8,
      source: 'rule_inferred',
    };
  }

  /**
   * 构建规则推断的 SceneContext
   */
  private buildRuleScene(
    channel: AcquisitionChannel,
    mealType: string,
    confidence: number,
  ): SceneContext {
    const sceneType = this.channelToSceneType(channel, mealType);
    return {
      channel,
      sceneType,
      realismLevel: 'normal',
      confidence,
      source: 'rule_inferred',
      sceneConstraints: this.getDefaultConstraints(sceneType),
    };
  }

  /**
   * 构建默认场景
   */
  private buildDefaultScene(mealType: string): SceneContext {
    const sceneType = this.mealTypeToDefaultScene(mealType) || 'general';
    return {
      channel: AcquisitionChannel.UNKNOWN,
      sceneType,
      realismLevel: 'normal',
      confidence: 0,
      source: 'default',
      sceneConstraints: this.getDefaultConstraints(sceneType),
    };
  }

  /**
   * 餐次 → 默认 SceneType（无渠道信息时使用）
   */
  private mealTypeToDefaultScene(mealType: string): SceneType | undefined {
    const map: Record<string, SceneType> = {
      breakfast: 'quick_breakfast',
      lunch: 'home_cooking',
      dinner: 'home_cooking',
      snack: 'convenience_meal',
    };
    return map[mealType];
  }

  /**
   * 渠道 + 餐次 → SceneType 映射表
   *
   * 映射规则来自 V6.9 设计文档（Step 4.1）。
   */
  private channelToSceneType(
    channel: AcquisitionChannel,
    mealType: string,
  ): SceneType {
    const map: Record<string, Record<string, SceneType>> = {
      [AcquisitionChannel.HOME_COOK]: {
        breakfast: 'quick_breakfast',
        lunch: 'home_cooking',
        dinner: 'home_cooking',
        snack: 'convenience_meal',
      },
      [AcquisitionChannel.DELIVERY]: {
        breakfast: 'quick_breakfast',
        lunch: 'office_lunch',
        dinner: 'eating_out',
        snack: 'convenience_meal',
      },
      [AcquisitionChannel.CANTEEN]: {
        breakfast: 'canteen_meal',
        lunch: 'canteen_meal',
        dinner: 'canteen_meal',
        snack: 'convenience_meal',
      },
      [AcquisitionChannel.CONVENIENCE]: {
        breakfast: 'convenience_meal',
        lunch: 'convenience_meal',
        dinner: 'convenience_meal',
        snack: 'convenience_meal',
      },
      [AcquisitionChannel.RESTAURANT]: {
        breakfast: 'eating_out',
        lunch: 'eating_out',
        dinner: 'eating_out',
        snack: 'eating_out',
      },
    };

    return map[channel]?.[mealType] ?? 'general';
  }

  /**
   * 12 种场景类型的默认约束配置
   *
   * 数值来源：V6.9 设计文档（Step 4.1, getDefaultConstraints 表格）。
   * 可被 ScoringConfigSnapshot 中的场景参数覆盖（Phase 2-D）。
   */
  private getDefaultConstraints(sceneType: SceneType): SceneConstraints {
    switch (sceneType) {
      case 'quick_breakfast':
        return {
          maxPrepTime: 10,
          maxCookTime: 15,
          preferredTags: ['breakfast', 'easy_digest', 'quick'],
        };
      case 'leisurely_brunch':
        return {
          maxPrepTime: null,
          maxCookTime: null,
          servingCount: 2,
        };
      case 'office_lunch':
        return {
          maxPrepTime: 0,
          maxCookTime: 0,
          portable: true,
          preferredTags: ['balanced', 'delivery_friendly'],
        };
      case 'home_cooking':
        return {
          maxPrepTime: 30,
          maxCookTime: 60,
          preferredCookingMethods: [CookingMethod.STIR_FRY, CookingMethod.STEAM, CookingMethod.BOIL, CookingMethod.BRAISE],
        };
      case 'eating_out':
        return {
          maxPrepTime: 0,
          maxCookTime: 0,
          preferredTags: ['restaurant'],
        };
      case 'convenience_meal':
        return {
          maxPrepTime: 5,
          maxCookTime: 5,
          preferredTags: ['convenience', 'ready_to_eat', 'snack'],
        };
      case 'canteen_meal':
        return {
          maxPrepTime: 0,
          maxCookTime: 0,
          preferredTags: ['canteen', 'common'],
        };
      case 'post_workout':
        return {
          maxPrepTime: 10,
          maxCookTime: 0,
          preferredTags: ['high_protein', 'quick', 'recovery'],
        };
      case 'late_night_snack':
        return {
          maxPrepTime: 5,
          maxCookTime: 10,
          preferredTags: ['low_calorie', 'light', 'easy_digest'],
          excludedTags: ['heavy_flavor', 'fried', 'high_fat'],
        };
      case 'family_dinner':
        return {
          maxPrepTime: null,
          maxCookTime: null,
          servingCount: 3,
          preferredCookingMethods: [CookingMethod.STIR_FRY, CookingMethod.STEAM, CookingMethod.BRAISE, CookingMethod.STEW],
        };
      case 'meal_prep':
        return {
          maxPrepTime: null,
          maxCookTime: null,
          servingCount: 5,
          preferredTags: ['meal_prep', 'batch_cook', 'freezer_friendly'],
        };
      case 'general':
      default:
        return {};
    }
  }

  /**
   * 解析渠道字符串为 AcquisitionChannel 枚举
   */
  private parseChannel(raw?: string | null): AcquisitionChannel {
    if (!raw) return AcquisitionChannel.UNKNOWN;
    const values = Object.values(AcquisitionChannel) as string[];
    return values.includes(raw)
      ? (raw as AcquisitionChannel)
      : AcquisitionChannel.UNKNOWN;
  }

  /**
   * V7.1 P2-E: 将 KitchenProfile 约束注入到场景约束
   *
   * 仅对 home_cooking 类场景生效：
   * - 将用户没有的设备对应的烹饪方式加入 excludedCookingMethods
   * - 如果用户无灶具（primaryStove='none'），排除需要炒锅的方式
   */
  private applyKitchenConstraints(
    scene: SceneContext,
    kitchenProfile?: KitchenProfile | null,
  ): SceneContext {
    // 仅对自炊场景生效
    if (!kitchenProfile || scene.channel !== AcquisitionChannel.HOME_COOK) {
      return scene;
    }

    const unavailableMethods =
      this.getUnavailableCookingMethods(kitchenProfile);
    if (unavailableMethods.length === 0) return scene;

    // 将不可用的烹饪方式加入排除列表
    const constraints = { ...scene.sceneConstraints };
    const existing = constraints.excludedTags ?? [];
    const newExcluded = [
      ...existing,
      ...unavailableMethods.map((m) => `cooking_${m}`),
    ];
    constraints.excludedTags = [...new Set(newExcluded)];

    // 同时更新 preferredCookingMethods，去掉不可用的
    if (constraints.preferredCookingMethods) {
      constraints.preferredCookingMethods =
        constraints.preferredCookingMethods.filter(
          (m) => !unavailableMethods.includes(m),
        );
    }

    return { ...scene, sceneConstraints: constraints };
  }

  /**
   * V7.1 P2-E: 根据 KitchenProfile 计算不可用的烹饪方式
   */
  getUnavailableCookingMethods(kitchenProfile: KitchenProfile): string[] {
    const unavailable: string[] = [];

    for (const { field, equipment } of KITCHEN_EQUIPMENT_KEYS) {
      if (!kitchenProfile[field]) {
        const methods = EQUIPMENT_MAP[equipment];
        if (methods) unavailable.push(...methods);
      }
    }

    // 无灶具 → 排除需要炒锅/明火的烹饪方式
    if (kitchenProfile.primaryStove === 'none') {
      unavailable.push(...STOVE_REQUIRED_METHODS);
    }

    return [...new Set(unavailable)];
  }

  /**
   * 构建 Redis pattern key
   */
  private buildPatternKey(userId: string): string {
    return `${SceneResolverService.PATTERN_KEY_PREFIX}${userId}${SceneResolverService.PATTERN_KEY_SUFFIX}`;
  }
}
