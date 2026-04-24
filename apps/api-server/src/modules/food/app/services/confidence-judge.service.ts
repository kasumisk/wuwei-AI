import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AnalyzedFoodItemLite,
  AnalysisConfidenceLevel,
} from './analysis-session.service';
import { AnalysisResult } from './analyze.service';

/**
 * 置信度驱动的饮食图片分析 V1
 * 置信度融合判定服务
 *
 * 关联设计文档：docs/CONFIDENCE_DRIVEN_FOOD_ANALYSIS_V1.md §6.2
 *
 * 输入：Vision 原始 AnalysisResult
 * 输出：overallConfidence ∈ [0,1]、level、reasons、lite foods
 *
 * 算法（多信号加权）：
 * 1. per-item confidence 按 estimatedWeightGrams 加权平均
 * 2. 未命中食物库的比例惩罚（0.85×）
 * 3. 食物数量过多惩罚（>6 项时 0.9×）
 * 4. 环境变量阈值（默认 0.75）
 */
export interface ConfidenceJudgement {
  overallConfidence: number;
  level: AnalysisConfidenceLevel;
  threshold: number;
  reasons: string[];
  liteFoods: AnalyzedFoodItemLite[];
}

const DEFAULT_THRESHOLD = 0.75;

@Injectable()
export class ConfidenceJudgeService {
  private readonly logger = new Logger(ConfidenceJudgeService.name);
  private readonly threshold: number;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.threshold = Number(
      this.config.get('CONFIDENCE_HIGH_THRESHOLD') ?? DEFAULT_THRESHOLD,
    );
    const flag = this.config.get<string>('ENABLE_CONFIDENCE_DRIVEN_ANALYSIS');
    this.enabled = flag === undefined ? true : flag !== 'false';
    this.logger.log(
      `ConfidenceJudgeService ready: enabled=${this.enabled}, threshold=${this.threshold}`,
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getThreshold(): number {
    return this.threshold;
  }

  /**
   * 基于 Vision 输出判定置信度等级。
   * 仅使用已解析的 AnalysisResult.foods 字段（不再次调用模型）。
   */
  judge(result: AnalysisResult): ConfidenceJudgement {
    const foods = result.foods ?? [];
    const liteFoods: AnalyzedFoodItemLite[] = foods.map((f, idx) => {
      const conf = clamp01((f as any).confidence ?? 0.6);
      return {
        id: `f_${String(idx + 1).padStart(2, '0')}`,
        name: f.name,
        quantity: f.quantity ?? '',
        estimatedWeightGrams: parseWeightFromQuantity(f.quantity),
        confidence: conf,
        uncertaintyHints: collectItemHints(f as any),
      };
    });

    if (liteFoods.length === 0) {
      return {
        overallConfidence: 0,
        level: 'low',
        threshold: this.threshold,
        reasons: ['no_food_detected'],
        liteFoods,
      };
    }

    // 1) 加权平均（按估计重量作为权重，未知重量回退 100g）
    const totalWeight = liteFoods.reduce(
      (s, f) => s + (f.estimatedWeightGrams ?? 100),
      0,
    );
    const weightedConf = liteFoods.reduce(
      (s, f) =>
        s +
        f.confidence * ((f.estimatedWeightGrams ?? 100) / (totalWeight || 1)),
      0,
    );

    // 2) 食物库命中率惩罚（AnalysisResult.foods[i].estimated=true 通常表示未命中库）
    const matchedCount = foods.filter(
      (f) => f.estimated === false || f.estimated === undefined,
    ).length;
    const matchRate = matchedCount / foods.length;
    const matchPenalty = matchRate < 0.5 ? 0.85 : 1.0;

    // 3) 食物数量过多惩罚
    const countPenalty = liteFoods.length > 6 ? 0.9 : 1.0;

    const overall = clamp01(weightedConf * matchPenalty * countPenalty);
    const level: AnalysisConfidenceLevel =
      overall >= this.threshold ? 'high' : 'low';

    const reasons: string[] = [];
    if (matchRate < 0.5) reasons.push('low_food_library_match');
    if (liteFoods.length > 6) reasons.push('too_many_items');
    const minItemConf = Math.min(...liteFoods.map((f) => f.confidence));
    if (minItemConf < 0.4) reasons.push('low_item_confidence');
    if (overall < this.threshold && reasons.length === 0) {
      reasons.push('ai_self_confidence_low');
    }

    return {
      overallConfidence: round2(overall),
      level,
      threshold: this.threshold,
      reasons,
      liteFoods,
    };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 从 quantity 字符串粗粒度提取克数。
 * 识别 "100g" / "100 克" / "200克" 等常见格式；无则返回 null。
 */
function parseWeightFromQuantity(q?: string): number | null {
  if (!q) return null;
  const m = q.match(/(\d+(?:\.\d+)?)\s*(克|g|G)\b/);
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }
  return null;
}

function collectItemHints(f: {
  confidence?: number;
  estimated?: boolean;
}): string[] | undefined {
  const hints: string[] = [];
  if (typeof f.confidence === 'number' && f.confidence < 0.5) {
    hints.push('identification_uncertain');
  }
  if (f.estimated) {
    hints.push('nutrition_estimated');
  }
  return hints.length ? hints : undefined;
}
