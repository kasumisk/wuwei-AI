/**
 * V2.4 Decision Classifier Service
 * 
 * 职责：协调 ScoringService 与现有的决策逻辑，生成完整的 ShouldEatDecision
 */

import { Injectable } from '@nestjs/common';
import { ScoringService } from '../scoring/scoring.service';
import { ShouldEatRequest, ShouldEatDecision, DecisionReason } from './decision-engine.types';

@Injectable()
export class DecisionClassifierService {
  constructor(private readonly scoringService: ScoringService) {}

  /**
   * 基于评分生成完整决策
   */
  async classifyDecision(request: ShouldEatRequest): Promise<ShouldEatDecision> {
    // 步骤1：获取营养评分
    const score = request.currentScore || {
      remaining: { calories: 500, protein: 20, fat: 15, carbs: 50 },
      status: 'under',
      issues: [],
      confidence: 0.8,
    };

    // 步骤2：生成理由
    const reasons = this.generateReasonSet(score, request);

    // 步骤3：确定决策
    const action = this.makeDecision(score, reasons);

    // 步骤4：计算置信度
    const confidence = Math.min(1, score.confidence * 0.95);

    return {
      action: action as 'must_eat' | 'should_eat' | 'can_skip' | 'should_avoid',
      confidence,
      reasons,
      alternatives: [],
      compensationSuggestions: [],
      scoredAt: new Date(),
    };
  }

  /**
   * 生成理由集合
   */
  private generateReasonSet(score: any, request?: ShouldEatRequest): DecisionReason[] {
    const reasons: DecisionReason[] = [];

    // 如果还有热量剩余
    if (score.remaining.calories > 0) {
      // 检查是否有营养缺陷
      const hasProteinDeficit = score.issues?.some(
        i => i.type === 'protein' && i.severity === 'high',
      );
      const hasCarbDeficit = score.issues?.some(
        i => i.type === 'carbs' && i.severity === 'low',
      );

      if (hasProteinDeficit) {
        reasons.push({
          dimension: 'nutrition',
          reason_i18n: 'decision.reason.protein_deficit',
          weight: 0.5,
        });
      }
      if (hasCarbDeficit) {
        reasons.push({
          dimension: 'nutrition',
          reason_i18n: 'decision.reason.carbs_needed',
          weight: 0.3,
        });
      }
    }

    // 如果已接近热量目标
    if (score.status === 'over' || score.remaining.calories < 100) {
      reasons.push({
        dimension: 'nutrition',
        reason_i18n: 'decision.reason.calorie_limit',
        weight: 0.7,
      });
    }

    return reasons.length > 0 ? reasons : [
      {
        dimension: 'nutrition',
        reason_i18n: 'decision.reason.no_deficit',
        weight: 0.5,
      },
    ];
  }

  /**
   * 决策判断逻辑
   */
  private makeDecision(score: any, reasons: DecisionReason[]): string {
    // 如果有高权重的限制理由
    const restrictiveReasons = reasons.filter(
      r => r.reason_i18n.includes('limit') && r.weight > 0.5,
    );
    if (restrictiveReasons.length > 0) {
      return 'can_skip';
    }

    // 如果有中等权重的补充理由
    const supplementReasons = reasons.filter(
      r => (r.reason_i18n.includes('deficit') || r.reason_i18n.includes('needed')) && r.weight > 0.3,
    );
    if (supplementReasons.length > 0) {
      return 'should_eat';
    }

    return 'can_skip';
  }
}
