import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';
import {
  HealthCondition,
  normalizeHealthConditions,
} from './recommendation.types';
import { matchAllergens } from './allergen-filter.util';

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

// ==================== Service ====================

/**
 * 健康修正引擎（V5 2.8: 由 PenaltyEngineService 重命名）
 *
 * 五层管道:
 * 1. 一票否决（过敏原/反式脂肪/麸质+乳糜泻）
 * 2. 重度惩罚（油炸/高钠）
 * 3. 目标相关惩罚（减脂高糖/增肌低蛋白）
 * 4. 健康状况惩罚（糖尿病/高血压/高血脂/痛风/肾病/脂肪肝/IBS/贫血）
 * 5. 正向健康增益（高血脂+Omega3/糖尿病+低GI/高血压+高钾低钠/贫血+高铁/骨质疏松+高钙）
 */
@Injectable()
export class HealthModifierEngineService {
  /**
   * 对单个食物执行健康修正管道
   * 返回最终乘数、结构化修正项列表和否决标志
   * finalMultiplier = 0 表示一票否决，该食物不应被推荐
   */
  evaluate(
    food: FoodLibrary,
    context?: HealthModifierContext,
  ): HealthModifierResult {
    const modifiers: HealthModifier[] = [];
    let multiplier = 1.0;

    // ── 第一层: 一票否决（硬约束） ──

    // 过敏原匹配 → 直接否决 — 统一使用 allergen-filter.util (V4 A6)
    if (context?.allergens?.length) {
      const matched = matchAllergens(food, context.allergens);
      if (matched.length > 0) {
        const reason = `过敏原匹配: ${matched.join(', ')}`;
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
      const reason = `反式脂肪严重超标: ${transFat}g/100g`;
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
      modifiers.push({ multiplier: 0.92, reason: '油炸食品', type: 'penalty' });
    }

    // 高钠 (>600mg/100g)
    const sodium = Number(food.sodium) || 0;
    if (sodium > 600) {
      // 根据超标程度梯度惩罚
      if (sodium > 1200) {
        multiplier *= 0.88;
        modifiers.push({
          multiplier: 0.88,
          reason: `高钠: ${sodium}mg/100g (严重超标)`,
          type: 'penalty',
        });
      } else {
        multiplier *= 0.94;
        modifiers.push({
          multiplier: 0.94,
          reason: `高钠: ${sodium}mg/100g`,
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
      const healthResult = this.applyHealthPenalties(
        food,
        context.healthConditions,
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
      const bonusMods = this.applyHealthBonuses(food, context.healthConditions);
      for (const m of bonusMods) {
        multiplier *= m.multiplier;
      }
      modifiers.push(...bonusMods);
    }

    return {
      finalMultiplier: Math.max(0, multiplier),
      modifiers,
      isVetoed: false,
    };
  }

  /**
   * 批量评估 — 返回非否决食物列表及其修正因子
   */
  evaluateBatch(
    foods: FoodLibrary[],
    context?: HealthModifierContext,
  ): Array<{ food: FoodLibrary; penalty: HealthModifierResult }> {
    return foods
      .map((food) => ({ food, penalty: this.evaluate(food, context) }))
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
          reason: `减脂目标: 高糖 ${sugar}g/100g`,
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
          reason: '增肌目标: 蛋白含量极低',
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
  ): { modifiers: HealthModifier[]; vetoed: boolean } {
    const mods: HealthModifier[] = [];

    // V5 2.8: 解析条件和严重度
    const parsed = this.parseConditions(conditions);
    // V4: 标准化健康状况命名，兼容旧值 (修复 B5)
    const conditionNames = normalizeHealthConditions(
      parsed.map((p) => p.condition),
    );
    // 构建条件→严重度映射
    const severityMap = new Map<string, HealthSeverity>();
    for (const p of parsed) {
      // 标准化后查找对应条件
      const normalized = normalizeHealthConditions([p.condition]);
      if (normalized.length > 0) {
        severityMap.set(normalized[0], p.severity);
      }
    }

    // 糖尿病: 高GI食物惩罚
    if (conditionNames.includes(HealthCondition.DIABETES_TYPE2)) {
      const severity =
        severityMap.get(HealthCondition.DIABETES_TYPE2) || 'moderate';
      const gi = Number(food.glycemicIndex) || 0;
      if (gi > 70) {
        mods.push({
          multiplier: this.applySeverity(0.8, severity),
          reason: `糖尿病: 高GI食物 (${gi})`,
          type: 'penalty',
        });
      } else if (gi > 55) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: `糖尿病: 中GI食物 (${gi})`,
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
          reason: `高血压: 钠含量偏高 (${sodium}mg)`,
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
          reason: `高血脂: 高饱和脂肪 (${satFat}g)`,
          type: 'penalty',
        });
      }
      if (cholesterol > 100) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: `高血脂: 高胆固醇 (${cholesterol}mg)`,
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
          reason: `痛风: 极高嘌呤 (${purine}mg/100g) — 禁用`,
          type: 'penalty',
        });
        return { modifiers: mods, vetoed: true };
      } else if (purine > 150) {
        mods.push({
          multiplier: this.applySeverity(0.7, severity),
          reason: `痛风: 高嘌呤 (${purine}mg/100g)`,
          type: 'penalty',
        });
      } else if (purine > 50) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: `痛风: 中嘌呤 (${purine}mg/100g)`,
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
          reason: `肾病: 高磷 (${phosphorus}mg/100g)`,
          type: 'penalty',
        });
      } else if (phosphorus > 150) {
        mods.push({
          multiplier: this.applySeverity(0.9, severity),
          reason: `肾病: 中磷 (${phosphorus}mg/100g)`,
          type: 'penalty',
        });
      }

      if (potassium > 400) {
        mods.push({
          multiplier: this.applySeverity(0.8, severity),
          reason: `肾病: 高钾 (${potassium}mg/100g)`,
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
          reason: `脂肪肝: 高饱和脂肪 (${satFat}g/100g)`,
          type: 'penalty',
        });
      }
      if (sugar > 10) {
        mods.push({
          multiplier: this.applySeverity(0.88, severity),
          reason: `脂肪肝: 高糖 (${sugar}g/100g)`,
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
          reason: '乳糜泻: 含麸质 — 禁用',
          type: 'penalty',
        });
        return { modifiers: mods, vetoed: true };
      }
    }

    // V5 2.8: 肠易激综合征 — 高 FODMAP 食物惩罚
    // 通过 tags 判断（high_fodmap / fodmap_high）
    if (conditionNames.includes(HealthCondition.IBS)) {
      const severity = severityMap.get(HealthCondition.IBS) || 'moderate';
      const tags = food.tags || [];
      if (tags.includes('high_fodmap') || tags.includes('fodmap_high')) {
        mods.push({
          multiplier: this.applySeverity(0.75, severity),
          reason: 'IBS: 高FODMAP食物',
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
          reason: '贫血: 茶/咖啡抑制铁吸收',
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
  ): HealthModifier[] {
    const mods: HealthModifier[] = [];

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
          reason: '高血脂: Omega-3丰富，有益血脂',
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
          reason: `糖尿病: 低GI食物 (${gi})，有益血糖控制`,
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
          reason: `高血压: 高钾(${potassium}mg)+低钠(${sodium}mg)，有益血压`,
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
          reason: `贫血: 高铁食物 (${iron}mg/100g)，有益补铁`,
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
          reason: `骨质疏松: 高钙食物 (${calcium}mg/100g)，有益骨骼`,
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
