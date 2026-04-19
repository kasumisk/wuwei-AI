import { Injectable } from '@nestjs/common';
import { GoalType } from '../../services/nutrition-score.service';
import { HealthCondition } from '../types/recommendation.types';

// ==================== 类型 ====================

/**
 * V6.3 P1-10: 个性化营养目标
 *
 * 基于中国 DRIs 2023 + USDA DRI 计算的每日营养素推荐值。
 * 用于替代 FoodScorer / ConstraintGenerator 中的硬编码 DV 常量。
 */
export interface NutritionTargets {
  /** 膳食纤维 (g/天) */
  fiber: number;
  /** 维生素A (μg RAE/天) */
  vitaminA: number;
  /** 维生素C (mg/天) */
  vitaminC: number;
  /** 钙 (mg/天) */
  calcium: number;
  /** 铁 (mg/天) */
  iron: number;
  /** 钾 (mg/天) */
  potassium: number;
  /** 蛋白质 (g/天) — FDA DV 50g，此处可根据体重个性化 */
  protein: number;
  /** 维生素D (μg/天) */
  vitaminD: number;
  /** 维生素E (mg/天) */
  vitaminE: number;
  /** 饱和脂肪上限 (g/天) */
  saturatedFatLimit: number;
  /** 添加糖上限 (g/天) */
  addedSugarLimit: number;
  /** 钠上限 (mg/天) */
  sodiumLimit: number;
  /** V7.3 NRF11.4: 锌 (mg/天) */
  zinc: number;
  /** V7.3 NRF11.4: 镁 (mg/天) */
  magnesium: number;
  /** V7.3 NRF11.4: 反式脂肪上限 (g/天) */
  transFatLimit: number;

  // ─── V7.4 Phase 3-B: NRF13.5 可选扩展 ───
  /** V7.4: Omega-3 推荐摄入 (mg/天)，心血管用户自动升级 */
  omega3?: number;
  /** V7.4: 可溶性纤维推荐摄入 (g/天)，心血管用户自动升级 */
  solubleFiber?: number;
  /** V7.4: 是否启用 NRF13.5 模式（omega3 + solubleFiber 作为额外正向维度） */
  nrf13_5Enabled?: boolean;
}

/**
 * calculate() 的入参 — 用户画像子集
 */
export interface NutritionTargetProfile {
  gender?: string | null;
  age?: number | null;
  goal?: GoalType | string | null;
  weightKg?: number | null;
  healthConditions?: (string | HealthCondition)[];
}

// ==================== 服务 ====================

/**
 * V6.3 P1-10: NutritionTargetService
 *
 * 基于性别 + 年龄 + 目标 + 健康状况动态计算个性化营养目标，
 * 替代 FoodScorer 和 ConstraintGenerator 中的硬编码 DV 常量。
 *
 * 参考标准：
 * - 中国居民膳食营养素参考摄入量 (DRIs 2023)
 * - USDA Dietary Reference Intakes
 * - FDA Daily Values (2020)
 */
@Injectable()
export class NutritionTargetService {
  /**
   * 计算个性化每日营养目标
   *
   * 缺少性别/年龄时回退到 FDA 标准 DV（与 V5 行为一致）。
   */
  calculate(profile?: NutritionTargetProfile | null): NutritionTargets {
    const gender = profile?.gender ?? 'male';
    const age = profile?.age ?? 30; // 默认 30 岁成人
    const weightKg = profile?.weightKg ?? 65;
    const goal = (profile?.goal ?? 'health') as GoalType;
    const conditions = profile?.healthConditions ?? [];

    const base: NutritionTargets = {
      fiber: this.calcFiber(gender, age),
      vitaminA: this.calcVitaminA(gender, age),
      vitaminC: this.calcVitaminC(gender, age),
      calcium: this.calcCalcium(age),
      iron: this.calcIron(gender, age),
      potassium: 3500, // mg, 中国DRI 统一推荐
      protein: this.calcProtein(gender, weightKg, goal),
      vitaminD: this.calcVitaminD(age),
      vitaminE: 14, // mg α-TE, 中国 DRI 成人统一推荐
      saturatedFatLimit: 20, // g, FDA DV 2020
      addedSugarLimit: 50, // g, FDA DV 2020 (WHO 建议 25g 更严格)
      sodiumLimit: 2300, // mg, FDA DV
      // V7.3 NRF11.4 新增
      zinc: this.calcZinc(gender, age),
      magnesium: this.calcMagnesium(gender, age),
      transFatLimit: 2.2, // g, WHO 建议 <1% 总能量，按 2000kcal 估算约 2.2g
    };

    // 健康状况修正
    return this.applyHealthConditionAdjustments(base, conditions);
  }

  /**
   * V7.4 Phase 3-B: 判断是否应启用 NRF13.5 模式
   *
   * 触发条件：用户有心血管相关健康状况（高血脂、高血压、脂肪肝）
   * 启用后 nutrient density 评分会额外考虑 omega3 和可溶性纤维
   */
  shouldEnableNrf13_5(conditions: (string | HealthCondition)[]): boolean {
    const cardiovascularConditions = [
      HealthCondition.HYPERLIPIDEMIA,
      HealthCondition.HYPERTENSION,
      HealthCondition.FATTY_LIVER,
      HealthCondition.CARDIOVASCULAR, // V7.9: 心血管疾病也启用 NRF13.5
    ];
    return conditions.some((c) =>
      cardiovascularConditions.includes(c as HealthCondition),
    );
  }

  // ==================== 各营养素计算 ====================

  /**
   * 膳食纤维 (g/天)
   * USDA: 男 38g, 女 25g; 50+ 岁递减 10%
   * 中国 DRI 2023: 成人 25-30g（取性别差异化）
   */
  private calcFiber(gender: string, age: number): number {
    const base = gender === 'male' ? 38 : 25;
    return age >= 50 ? Math.round(base * 0.9) : base;
  }

  /**
   * 维生素A (μg RAE/天)
   * 中国 DRI: 男 800, 女 700; 50+ 递减约 5%
   */
  private calcVitaminA(gender: string, age: number): number {
    const base = gender === 'male' ? 800 : 700;
    return age >= 50 ? Math.round(base * 0.95) : base;
  }

  /**
   * 维生素C (mg/天)
   * 中国 DRI: 成人 100mg; USDA: 男 90, 女 75
   * 取中间值: 男 90, 女 80
   */
  private calcVitaminC(gender: string, age: number): number {
    const base = gender === 'male' ? 90 : 80;
    // 老年人吸收效率下降，维持原量即可
    return base;
  }

  /**
   * 钙 (mg/天)
   * 中国 DRI: 18-49 岁 800mg, 50+ 岁 1000mg
   * FDA DV: 1300mg（覆盖青少年高需求）
   */
  private calcCalcium(age: number): number {
    if (age < 18) return 1300; // 青少年
    if (age >= 50) return 1000; // 老年
    return 800; // 成人
  }

  /**
   * 铁 (mg/天)
   * 中国 DRI: 男 12mg, 育龄女性 20mg, 绝经后女性 12mg
   * FDA DV: 18mg
   */
  private calcIron(gender: string, age: number): number {
    if (gender === 'female') {
      return age >= 50 ? 12 : 20; // 50+ 视为绝经后
    }
    return 12; // 男性
  }

  /**
   * 蛋白质 (g/天)
   * 基础: 体重(kg) × 系数
   *   - 健康/习惯: 0.8 g/kg
   *   - 减脂: 1.2 g/kg（保肌肉）
   *   - 增肌: 1.6 g/kg
   * 下限 50g (FDA DV)
   */
  private calcProtein(
    gender: string,
    weightKg: number,
    goal: GoalType,
  ): number {
    const multiplier =
      goal === 'muscle_gain' ? 1.6 : goal === 'fat_loss' ? 1.2 : 0.8;
    const calculated = Math.round(weightKg * multiplier);
    return Math.max(calculated, 50); // 不低于 FDA DV
  }

  /**
   * 维生素D (μg/天)
   * 中国 DRI: 18-64 岁 10μg, 65+ 岁 15μg
   * FDA DV: 20μg
   */
  private calcVitaminD(age: number): number {
    if (age >= 65) return 15;
    return 10;
  }

  // ==================== 健康状况修正 ====================

  /**
   * V7.3 NRF11.4: 锌 (mg/天)
   * 中国 DRI 2023: 男 12.5mg, 女 7.5mg
   * FDA DV: 11mg
   */
  private calcZinc(gender: string, age: number): number {
    if (gender === 'female') return 7.5;
    return 12.5;
  }

  /**
   * V7.3 NRF11.4: 镁 (mg/天)
   * 中国 DRI 2023: 成人 330mg; USDA: 男 420mg, 女 320mg
   * 取中间值: 男 400mg, 女 330mg
   */
  private calcMagnesium(gender: string, age: number): number {
    return gender === 'male' ? 400 : 330;
  }

  /**
   * 根据健康状况调整营养目标
   * 基于临床营养指南的保守调整
   */
  private applyHealthConditionAdjustments(
    targets: NutritionTargets,
    conditions: (string | HealthCondition)[],
  ): NutritionTargets {
    const result = { ...targets };

    for (const condition of conditions) {
      switch (condition) {
        case HealthCondition.HYPERTENSION:
          // 高血压: 钠限制 1500mg（AHA 推荐），钾增加到 4700mg
          result.sodiumLimit = Math.min(result.sodiumLimit, 1500);
          result.potassium = Math.max(result.potassium, 4700);
          // V7.4 NRF13.5: 高血压也受益于 omega3
          result.nrf13_5Enabled = true;
          result.omega3 = Math.max(result.omega3 ?? 0, 1600); // AHA 推荐 1.6g/天
          result.solubleFiber = Math.max(result.solubleFiber ?? 0, 7); // 适量可溶性纤维辅助降压
          break;

        case HealthCondition.DIABETES_TYPE2:
          // 糖尿病: 添加糖上限收紧到 25g，纤维增加（有助血糖控制）
          result.addedSugarLimit = Math.min(result.addedSugarLimit, 25);
          result.fiber = Math.max(result.fiber, 30);
          break;

        case HealthCondition.KIDNEY_DISEASE:
          // 肾病: 钾限制 2000mg，蛋白质不过量
          result.potassium = Math.min(result.potassium, 2000);
          result.protein = Math.min(result.protein, 60);
          break;

        case HealthCondition.OSTEOPOROSIS:
          // 骨质疏松: 钙增加到 1200mg，维生素D增加
          result.calcium = Math.max(result.calcium, 1200);
          result.vitaminD = Math.max(result.vitaminD, 15);
          break;

        case HealthCondition.IRON_DEFICIENCY_ANEMIA:
          // 缺铁性贫血: 铁增加，维生素C增加（促进铁吸收）
          result.iron = Math.max(result.iron, 25);
          result.vitaminC = Math.max(result.vitaminC, 120);
          break;

        case HealthCondition.HYPERLIPIDEMIA:
          // 高血脂: 饱和脂肪收紧到 13g（<总热量7%，按2000kcal估算）
          result.saturatedFatLimit = Math.min(result.saturatedFatLimit, 13);
          result.fiber = Math.max(result.fiber, 30); // 纤维有助降血脂
          // V7.3: 反式脂肪收紧到 0g（高血脂应完全避免反式脂肪）
          result.transFatLimit = 0;
          // V7.4 NRF13.5: 启用 omega3 + 可溶性纤维目标
          result.nrf13_5Enabled = true;
          result.omega3 = Math.max(result.omega3 ?? 0, 2000); // AHA 推荐高血脂 2g/天
          result.solubleFiber = Math.max(result.solubleFiber ?? 0, 10); // 10g/天可溶性纤维（NCEP ATP III）
          break;

        case HealthCondition.FATTY_LIVER:
          // 脂肪肝: 添加糖收紧，饱和脂肪收紧
          result.addedSugarLimit = Math.min(result.addedSugarLimit, 25);
          result.saturatedFatLimit = Math.min(result.saturatedFatLimit, 15);
          // V7.3: 反式脂肪收紧到 0g（脂肪肝应完全避免反式脂肪）
          result.transFatLimit = 0;
          // V7.4 NRF13.5: 脂肪肝受益于 omega3
          result.nrf13_5Enabled = true;
          result.omega3 = Math.max(result.omega3 ?? 0, 1000); // 1g/天基础推荐
          result.solubleFiber = Math.max(result.solubleFiber ?? 0, 5); // 适量可溶性纤维
          break;

        case HealthCondition.CARDIOVASCULAR:
          // V7.9: 心血管疾病 — AHA/ACC 心脏健康膳食指南
          // 低钠(<1500mg)、低饱和脂肪(<13g)、零反式脂肪、高纤维(≥30g)、Omega-3 强化
          result.sodiumLimit = Math.min(result.sodiumLimit, 1500);
          result.saturatedFatLimit = Math.min(result.saturatedFatLimit, 13);
          result.transFatLimit = 0;
          result.fiber = Math.max(result.fiber, 30);
          result.nrf13_5Enabled = true;
          result.omega3 = Math.max(result.omega3 ?? 0, 2000); // AHA 心血管推荐 2g/天
          result.solubleFiber = Math.max(result.solubleFiber ?? 0, 10);
          break;

        // GOUT, CELIAC_DISEASE, IBS, OSTEOPOROSIS, THYROID: 主要通过约束标签/modifier处理，营养目标不变
        case HealthCondition.IBS:
          // IBS: 可溶性纤维目标 ≥5g/天，有助调节肠道菌群
          result.solubleFiber = Math.max(result.solubleFiber ?? 0, 5);
          break;
      }
    }

    return result;
  }
}
