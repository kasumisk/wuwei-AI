/**
 * V6.1 Phase 3.1 — DataQualityService
 *
 * 为分析结果打数据质量分（0-100），用于后续入库管道决策。
 *
 * 评分因子（来自设计文档 Section 10.4）:
 *   1. 输入清晰度 — 文本长度/图片有效性
 *   2. 匹配完整度 — 识别出的食物中有多少命中了标准库
 *   3. 营养字段完整度 — 核心营养字段（热量/蛋白质/脂肪/碳水）的填充率
 *   4. 识别置信度 — 各食物项的平均 confidence
 *   5. 是否被用户确认 — 用户是否已将该分析结果保存到饮食记录
 *   6. 是否与已有高质量数据冲突 — 同名食物在标准库中的营养差异
 *
 * 质量阈值:
 *   >= 85: 可自动关联标准食物（auto_link）
 *   70-84: 创建候选，等待更多样本（create_candidate）
 *   50-69: 仅保留分析记录（record_only）
 *   < 50:  标记低质量，不参与候选聚合（low_quality）
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from './analysis-result.types';

// ==================== 质量等级 ====================

/**
 * 数据质量等级 — 决定入库管道的后续行为
 */
export enum QualityTier {
  /** >= 85: 可自动关联标准食物 */
  AUTO_LINK = 'auto_link',
  /** 70-84: 创建候选，等待更多样本 */
  CREATE_CANDIDATE = 'create_candidate',
  /** 50-69: 仅保留分析记录 */
  RECORD_ONLY = 'record_only',
  /** < 50: 标记低质量，不参与候选聚合 */
  LOW_QUALITY = 'low_quality',
}

// ==================== 评分结果 ====================

/**
 * 单项因子评分明细
 */
export interface QualityFactorDetail {
  /** 因子名称 */
  factor: string;
  /** 该因子原始分（0-100） */
  rawScore: number;
  /** 权重（0-1） */
  weight: number;
  /** 加权后得分 = rawScore * weight */
  weightedScore: number;
}

/**
 * DataQualityService 的完整评分结果
 */
export interface QualityScoreResult {
  /** 综合质量分（0-100） */
  totalScore: number;
  /** 对应的质量等级 */
  tier: QualityTier;
  /** 各因子评分明细 */
  factors: QualityFactorDetail[];
}

// ==================== 评分上下文 ====================

/**
 * 评分上下文 — 调用方可以补充额外信息
 */
export interface QualityScoreContext {
  /** 分析结果 */
  result: FoodAnalysisResultV61;
  /** 用户是否已确认（保存到饮食记录） */
  userConfirmed?: boolean;
  /** 匹配到的标准食物（由调用方提前查询好传入，避免重复查库） */
  matchedLibraryFoods?: any[];
}

// ==================== 评分因子权重配置 ====================

/**
 * 各因子权重，总和 = 1.0
 *
 * 权重设计思路:
 * - 识别置信度权重最高（0.25），因为它是 AI 分析的核心可靠性指标
 * - 营养字段完整度次之（0.20），直接影响入库后的数据可用性
 * - 匹配完整度也较高（0.20），命中标准库说明数据可校验
 * - 输入清晰度（0.15），输入质量决定分析上限
 * - 用户确认（0.10），用户行为是有力的正向信号
 * - 数据冲突检查（0.10），保证与已有高质量数据一致
 */
const FACTOR_WEIGHTS = {
  inputClarity: 0.15,
  matchCompleteness: 0.2,
  nutritionCompleteness: 0.2,
  recognitionConfidence: 0.25,
  userConfirmed: 0.1,
  dataConflict: 0.1,
} as const;

// ==================== 阈值常量 ====================

/** 自动关联标准食物的最低分 */
const THRESHOLD_AUTO_LINK = 85;
/** 创建候选的最低分 */
const THRESHOLD_CANDIDATE = 70;
/** 保留分析记录的最低分 */
const THRESHOLD_RECORD_ONLY = 50;

/** 营养差异超过此比例视为冲突 */
const CALORIE_CONFLICT_RATIO = 0.3;

@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 公共 API ====================

  /**
   * 计算分析结果的数据质量分
   *
   * @param context 评分上下文
   * @returns 质量评分结果（总分 + 等级 + 各因子明细）
   */
  async score(context: QualityScoreContext): Promise<QualityScoreResult> {
    const { result, userConfirmed = false } = context;

    // 如果调用方没传入已匹配的标准食物，按名称批量查一次
    const matchedLibraryFoods =
      context.matchedLibraryFoods ??
      ((await this.batchFindByNames(result.foods)) as any[]);

    // 计算各因子
    const factors: QualityFactorDetail[] = [
      this.scoreInputClarity(result),
      this.scoreMatchCompleteness(result.foods, matchedLibraryFoods),
      this.scoreNutritionCompleteness(result.foods),
      this.scoreRecognitionConfidence(result),
      this.scoreUserConfirmed(userConfirmed),
      this.scoreDataConflict(result.foods, matchedLibraryFoods),
    ];

    // 加权求和
    const totalScore = Math.round(
      factors.reduce((sum, f) => sum + f.weightedScore, 0),
    );

    // 限制在 0-100
    const clampedScore = Math.max(0, Math.min(100, totalScore));
    const tier = this.resolveTier(clampedScore);

    this.logger.debug(
      `质量评分: analysisId=${result.analysisId}, score=${clampedScore}, tier=${tier}`,
    );

    return {
      totalScore: clampedScore,
      tier,
      factors,
    };
  }

  // ==================== 各因子评分逻辑 ====================

  /**
   * 因子 1: 输入清晰度
   *
   * 文本链路: 文本长度越长（合理范围内）越好，太短信息不足
   * 图片链路: 有图片 URL 且识别出食物即给基础分
   */
  private scoreInputClarity(
    result: FoodAnalysisResultV61,
  ): QualityFactorDetail {
    let rawScore = 0;

    if (result.inputType === 'text') {
      const textLen = result.inputSnapshot.rawText?.length ?? 0;
      if (textLen >= 10) {
        // 10 字以上给基础 60 分，每多 10 字加 5 分，上限 100
        rawScore = Math.min(100, 60 + Math.floor((textLen - 10) / 10) * 5);
      } else if (textLen > 0) {
        // 1-9 字，信息可能不足
        rawScore = textLen * 5; // 5-45 分
      }
    } else {
      // 图片链路: 有 URL 且识别出 >= 1 个食物给 80 分
      const hasImage = !!result.inputSnapshot.imageUrl;
      const hasFoods = result.foods.length > 0;
      rawScore = hasImage && hasFoods ? 80 : hasImage ? 40 : 0;
    }

    return this.buildFactor(
      'inputClarity',
      rawScore,
      FACTOR_WEIGHTS.inputClarity,
    );
  }

  /**
   * 因子 2: 匹配完整度
   *
   * 识别出的食物中有多少命中了标准库（foodLibraryId 不为空或在传入的匹配结果中）
   */
  private scoreMatchCompleteness(
    foods: AnalyzedFoodItem[],
    matchedLibraryFoods: any[],
  ): QualityFactorDetail {
    if (foods.length === 0) {
      return this.buildFactor(
        'matchCompleteness',
        0,
        FACTOR_WEIGHTS.matchCompleteness,
      );
    }

    const matchedNames = new Set(
      matchedLibraryFoods.map((f: any) => (f.name as string).toLowerCase()),
    );

    // 统计已有 foodLibraryId 或名称命中标准库的食物数
    const matchedCount = foods.filter(
      (f) =>
        f.foodLibraryId ||
        matchedNames.has(f.name.toLowerCase()) ||
        (f.normalizedName && matchedNames.has(f.normalizedName.toLowerCase())),
    ).length;

    const ratio = matchedCount / foods.length;
    // 全部命中 = 100，部分命中按比例
    const rawScore = Math.round(ratio * 100);

    return this.buildFactor(
      'matchCompleteness',
      rawScore,
      FACTOR_WEIGHTS.matchCompleteness,
    );
  }

  /**
   * 因子 3: 营养字段完整度
   *
   * 核心字段: calories, protein, fat, carbs（4 个）
   * 附加字段: fiber, sodium（2 个，权重较低）
   */
  private scoreNutritionCompleteness(
    foods: AnalyzedFoodItem[],
  ): QualityFactorDetail {
    if (foods.length === 0) {
      return this.buildFactor(
        'nutritionCompleteness',
        0,
        FACTOR_WEIGHTS.nutritionCompleteness,
      );
    }

    let totalFieldScore = 0;

    for (const food of foods) {
      // 核心字段（每个值 20 分，4 个 = 80 分上限）
      let coreScore = 0;
      if (food.calories != null && food.calories > 0) coreScore += 20;
      if (food.protein != null && food.protein >= 0) coreScore += 20;
      if (food.fat != null && food.fat >= 0) coreScore += 20;
      if (food.carbs != null && food.carbs >= 0) coreScore += 20;

      // 附加字段（每个值 10 分，2 个 = 20 分上限）
      let extraScore = 0;
      if (food.fiber != null && food.fiber >= 0) extraScore += 10;
      if (food.sodium != null && food.sodium >= 0) extraScore += 10;

      totalFieldScore += coreScore + extraScore;
    }

    // 取所有食物的平均完整度
    const rawScore = Math.round(totalFieldScore / foods.length);

    return this.buildFactor(
      'nutritionCompleteness',
      rawScore,
      FACTOR_WEIGHTS.nutritionCompleteness,
    );
  }

  /**
   * 因子 4: 识别置信度
   *
   * 取所有食物项 confidence 的加权平均值，confidence 范围 0-1，映射到 0-100
   */
  private scoreRecognitionConfidence(
    result: FoodAnalysisResultV61,
  ): QualityFactorDetail {
    const foods = result.foods;
    if (foods.length === 0) {
      return this.buildFactor(
        'recognitionConfidence',
        0,
        FACTOR_WEIGHTS.recognitionConfidence,
      );
    }

    // 也参考综合 confidenceScore（如果有的话）
    const avgItemConfidence =
      foods.reduce((sum, f) => sum + (f.confidence ?? 0), 0) / foods.length;

    // 综合评分中的置信度分（0-100 范围）
    const overallConfidence = result.score?.confidenceScore ?? 0;

    // 两者加权: 单项 70% + 综合 30%
    const blended = avgItemConfidence * 100 * 0.7 + overallConfidence * 0.3;
    const rawScore = Math.round(Math.min(100, blended));

    return this.buildFactor(
      'recognitionConfidence',
      rawScore,
      FACTOR_WEIGHTS.recognitionConfidence,
    );
  }

  /**
   * 因子 5: 用户确认
   *
   * 如果用户已将分析结果保存为饮食记录，给 100 分；否则 0 分。
   * 这是一个二元因子，但权重较低（0.10）。
   */
  private scoreUserConfirmed(confirmed: boolean): QualityFactorDetail {
    const rawScore = confirmed ? 100 : 0;
    return this.buildFactor(
      'userConfirmed',
      rawScore,
      FACTOR_WEIGHTS.userConfirmed,
    );
  }

  /**
   * 因子 6: 数据冲突检查
   *
   * 对于命中标准库的食物，比较分析结果的热量与标准库的热量。
   * 如果差异超过 30%，视为冲突，扣分。
   * 未命中标准库的食物不参与冲突检查（给中间分）。
   */
  private scoreDataConflict(
    foods: AnalyzedFoodItem[],
    matchedLibraryFoods: any[],
  ): QualityFactorDetail {
    if (foods.length === 0 || matchedLibraryFoods.length === 0) {
      // 无法做冲突检查时给默认中间分（不惩罚也不加分）
      return this.buildFactor('dataConflict', 70, FACTOR_WEIGHTS.dataConflict);
    }

    // 按名称建立标准库食物索引
    const libraryMap = new Map<string, any>();
    for (const lib of matchedLibraryFoods) {
      libraryMap.set((lib.name as string).toLowerCase(), lib);
    }

    let conflictCount = 0;
    let comparedCount = 0;

    for (const food of foods) {
      const libFood =
        libraryMap.get(food.name.toLowerCase()) ||
        (food.normalizedName
          ? libraryMap.get(food.normalizedName.toLowerCase())
          : undefined);

      if (!libFood) continue;

      comparedCount++;

      // 比较热量差异
      // 注意: 标准库是 per 100g，分析结果是实际份量的热量
      // 这里做简化比较 — 如果分析结果有 estimatedWeightGrams，折算到 per 100g 再比
      const analysisCal = food.estimatedWeightGrams
        ? (food.calories / food.estimatedWeightGrams) * 100
        : food.calories; // 无重量信息时直接用原始值（粗略）

      const libCal = Number(libFood.calories);
      if (libCal > 0) {
        const diff = Math.abs(analysisCal - libCal) / libCal;
        if (diff > CALORIE_CONFLICT_RATIO) {
          conflictCount++;
        }
      }
    }

    if (comparedCount === 0) {
      // 没有可比较的食物，给中间分
      return this.buildFactor('dataConflict', 70, FACTOR_WEIGHTS.dataConflict);
    }

    // 无冲突 = 100，全冲突 = 0
    const conflictRatio = conflictCount / comparedCount;
    const rawScore = Math.round((1 - conflictRatio) * 100);

    return this.buildFactor(
      'dataConflict',
      rawScore,
      FACTOR_WEIGHTS.dataConflict,
    );
  }

  // ==================== 辅助方法 ====================

  /**
   * 根据总分确定质量等级
   */
  private resolveTier(score: number): QualityTier {
    if (score >= THRESHOLD_AUTO_LINK) return QualityTier.AUTO_LINK;
    if (score >= THRESHOLD_CANDIDATE) return QualityTier.CREATE_CANDIDATE;
    if (score >= THRESHOLD_RECORD_ONLY) return QualityTier.RECORD_ONLY;
    return QualityTier.LOW_QUALITY;
  }

  /**
   * 构建单个因子评分明细
   */
  private buildFactor(
    factor: string,
    rawScore: number,
    weight: number,
  ): QualityFactorDetail {
    return {
      factor,
      rawScore,
      weight,
      weightedScore: rawScore * weight,
    };
  }

  /**
   * 按名称批量查找标准库食物
   *
   * 用于调用方没有预查询时的兜底
   */
  private async batchFindByNames(foods: AnalyzedFoodItem[]) {
    if (foods.length === 0) return [];

    // 收集所有需要查询的名称（原始名 + 标准化名）
    const names = new Set<string>();
    for (const food of foods) {
      if (food.name) names.add(food.name);
      if (food.normalizedName) names.add(food.normalizedName);
    }

    if (names.size === 0) return [];

    const lowerNames = Array.from(names).map((n) => n.toLowerCase());

    // 使用 raw query for LOWER() comparison
    return this.prisma.$queryRawUnsafe(
      `SELECT * FROM foods WHERE LOWER(name) IN (${lowerNames.map((_, i) => `$${i + 1}`).join(', ')})`,
      ...lowerNames,
    );
  }
}
