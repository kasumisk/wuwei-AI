/**
 * V6.2 Phase 3.2 — 评分权重运行时配置
 *
 * 将 SCORE_WEIGHTS 从硬编码改为可通过环境变量 / 配置文件覆盖。
 *
 * 配置优先级（从高到低）：
 * 1. rankPolicy（策略引擎，per-user）
 * 2. baseOverrides（A/B 实验组）
 * 3. 运行时配置（本文件，env/config 驱动）
 * 4. 硬编码默认（SCORE_WEIGHTS）
 *
 * 环境变量格式：
 *   SCORING_WEIGHTS_FAT_LOSS=0.19,0.18,0.08,0.06,0.06,0.07,0.12,0.10,0.08,0.06
 *   SCORING_WEIGHTS_MUSCLE_GAIN=0.18,0.23,0.13,0.06,0.06,0.05,0.10,0.09,0.06,0.04
 *   SCORING_WEIGHTS_HEALTH=0.08,0.06,0.05,0.05,0.17,0.08,0.12,0.19,0.12,0.08
 *   SCORING_WEIGHTS_HABIT=0.13,0.11,0.06,0.06,0.16,0.14,0.10,0.10,0.09,0.05
 *
 * 未配置的 goalType 回退到 SCORE_WEIGHTS 硬编码默认值。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SCORE_WEIGHTS, SCORE_DIMENSIONS } from '../types/recommendation.types';
import { GoalType } from '../../services/nutrition-score.service';

/** 运行时权重配置（按 goalType） */
export type RuntimeWeightConfig = Record<string, number[]>;

@Injectable()
export class RecommendationConfigService implements OnModuleInit {
  private readonly logger = new Logger(RecommendationConfigService.name);
  /** 运行时覆盖的权重，key = goalType */
  private runtimeWeights: RuntimeWeightConfig = {};

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.loadWeightsFromEnv();
  }

  /**
   * 获取 goalType 对应的基础权重
   * 优先返回运行时配置，否则回退到硬编码默认
   */
  getBaseWeights(goalType: GoalType | string): number[] {
    return (
      this.runtimeWeights[goalType] ||
      SCORE_WEIGHTS[goalType as GoalType] ||
      SCORE_WEIGHTS.health
    );
  }

  /**
   * 运行时更新权重（可由 Admin API 调用）
   * 会验证数组长度和归一化
   */
  updateWeights(goalType: string, weights: number[]): void {
    if (weights.length !== SCORE_DIMENSIONS.length) {
      throw new Error(
        `权重数组长度必须为 ${SCORE_DIMENSIONS.length}（当前 ${weights.length}）`,
      );
    }
    // 归一化
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum <= 0) {
      throw new Error('权重总和必须大于 0');
    }
    this.runtimeWeights[goalType] = weights.map((w) => w / sum);
    this.logger.log(`评分权重已更新: goalType=${goalType}`);
  }

  /**
   * 获取当前所有运行时权重配置（监控/调试用）
   */
  getAllWeights(): Record<string, number[]> {
    return {
      ...SCORE_WEIGHTS,
      ...this.runtimeWeights,
    };
  }

  /**
   * 从环境变量加载权重配置
   * 格式: SCORING_WEIGHTS_{GOAL_TYPE}=w1,w2,...,w10
   */
  private loadWeightsFromEnv(): void {
    const goalTypes = ['fat_loss', 'muscle_gain', 'health', 'habit'];
    let loaded = 0;

    for (const goalType of goalTypes) {
      const envKey = `SCORING_WEIGHTS_${goalType.toUpperCase()}`;
      const envVal = this.configService.get<string>(envKey);
      if (!envVal) continue;

      try {
        const weights = envVal.split(',').map((s) => parseFloat(s.trim()));
        if (weights.length !== SCORE_DIMENSIONS.length) {
          this.logger.warn(
            `${envKey}: 期望 ${SCORE_DIMENSIONS.length} 个权重，实际 ${weights.length}，忽略`,
          );
          continue;
        }
        if (weights.some(isNaN)) {
          this.logger.warn(`${envKey}: 包含非数字值，忽略`);
          continue;
        }
        // 归一化
        const sum = weights.reduce((s, w) => s + w, 0);
        this.runtimeWeights[goalType] = weights.map((w) => w / sum);
        loaded++;
        this.logger.log(
          `从环境变量加载评分权重: ${envKey} → [${this.runtimeWeights[goalType].map((w) => w.toFixed(3)).join(', ')}]`,
        );
      } catch (err) {
        this.logger.warn(`解析 ${envKey} 失败: ${err.message}`);
      }
    }

    if (loaded > 0) {
      this.logger.log(`共加载 ${loaded} 个目标类型的运行时权重配置`);
    }
  }
}
