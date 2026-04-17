/**
 * V2.4 Decision Classifier Service
 *
 * 职责：协调 ScoringService 与现有的决策逻辑，生成完整的 ShouldEatDecision
 */

import { Injectable } from '@nestjs/common';
import { I18nManagementService } from '../../../config/i18n-management.service';
import { ScoringService } from '../score/scoring.service';
import {
  ShouldEatRequest,
  ShouldEatDecision,
  DecisionReason,
} from './decision-engine.types';

@Injectable()
export class DecisionClassifierService {
  constructor(
    private readonly scoringService: ScoringService,
    private readonly i18nManagementService: I18nManagementService,
  ) {}

  /**
   * 基于评分生成完整决策
   */
  async classifyDecision(
    request: ShouldEatRequest,
  ): Promise<ShouldEatDecision> {
    // 步骤1：获取营养评分
    const score =
      request.currentScore ||
      this.scoringService.scoreNutrition(
        {
          nutritionTotals: request.userProfile?.todayNutrition || {
            calories: 0,
            protein: 0,
            fat: 0,
            carbs: 0,
            fiber: 0,
          },
          confidence: request.analysisConfidence || 0.8,
        },
        request.userProfile,
        request.userProfile?.nutritionGoal,
      );

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
  private generateReasonSet(
    score: any,
    request?: ShouldEatRequest,
  ): DecisionReason[] {
    const reasons: DecisionReason[] = [];
    const healthConditions = request?.userProfile?.healthConditions || [];
    const preferences = request?.userProfile?.foodPreferences || [];

    // 如果还有热量剩余
    if (score.remaining.calories > 0) {
      // 检查是否有营养缺陷
      const hasProteinDeficit = score.issues?.some(
        (i) => i.type === 'protein' && i.severity === 'high',
      );
      const hasCarbDeficit = score.issues?.some(
        (i) => i.type === 'carbs' && i.severity === 'low',
      );

      if (hasProteinDeficit) {
        reasons.push({
          dimension: 'nutrition',
          reason_i18n: 'decision.reason.protein_deficit',
          weight: 0.5,
          explanation: this.i18nManagementService.translate(
            'decision.reason.protein_deficit',
            request?.userProfile?.language || 'zh',
          ),
        });
      }
      if (hasCarbDeficit) {
        reasons.push({
          dimension: 'nutrition',
          reason_i18n: 'decision.reason.carbs_needed',
          weight: 0.3,
          explanation: this.i18nManagementService.translate(
            'decision.reason.carbs_needed',
            request?.userProfile?.language || 'zh',
          ),
        });
      }
    }

    // 如果已接近热量目标
    if (score.status === 'over' || score.remaining.calories < 100) {
      reasons.push({
        dimension: 'nutrition',
        reason_i18n: 'decision.reason.calorie_limit',
        weight: 0.7,
        explanation: this.i18nManagementService.translate(
          'decision.reason.calorie_limit',
          request?.userProfile?.language || 'zh',
        ),
      });
    }

    if (healthConditions.length > 0) {
      reasons.push({
        dimension: 'health',
        reason_i18n: 'reason.health',
        weight: 0.6,
        explanation: this.i18nManagementService.translate(
          'reason.health',
          request?.userProfile?.language || 'zh',
        ),
      });
    }

    if (preferences.length > 0) {
      reasons.push({
        dimension: 'preference',
        reason_i18n: 'decision.reason.user_preference',
        weight: 0.2,
        explanation: this.i18nManagementService.translate(
          'decision.reason.user_preference',
          request?.userProfile?.language || 'zh',
        ),
      });
    }

    return reasons.length > 0
      ? reasons
      : [
          {
            dimension: 'nutrition',
            reason_i18n: 'decision.reason.no_deficit',
            weight: 0.5,
            explanation: this.i18nManagementService.translate(
              'decision.reason.no_deficit',
              request?.userProfile?.language || 'zh',
            ),
          },
        ];
  }

  /**
   * 决策判断逻辑
   */
  private makeDecision(score: any, reasons: DecisionReason[]): string {
    // 如果有高权重的限制理由
    const restrictiveReasons = reasons.filter(
      (r) => r.reason_i18n.includes('limit') && r.weight > 0.5,
    );
    if (restrictiveReasons.length > 0) {
      return 'can_skip';
    }

    // 如果有中等权重的补充理由
    const supplementReasons = reasons.filter(
      (r) =>
        (r.reason_i18n.includes('deficit') ||
          r.reason_i18n.includes('needed')) &&
        r.weight > 0.3,
    );
    if (supplementReasons.length > 0) {
      return 'should_eat';
    }

    return 'can_skip';
  }
}
