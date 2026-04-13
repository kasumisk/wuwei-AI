/**
 * V7.6 P1-C: StrategyResolverFacade — 策略解析 Facade
 *
 * 将 RecommendationEngineService 中的 resolveStrategyForUser() 私有方法
 * 整体提取为独立 service，同时聚合 2 个策略相关 DI。
 *
 * 聚合的 DI：
 * - StrategyResolver（全局策略解析）
 * - ABTestingService（A/B 实验策略叠加）
 * - ProfileAggregatorService.getRecommendationPreferences（用户偏好覆盖层）
 *
 * 策略合并优先级（从低到高）：
 *   1. 系统硬编码默认值
 *   2. 全局默认策略
 *   3. 目标类型策略
 *   4. A/B 实验组策略
 *   5. 用户级手动分配策略
 *   6. 用户推荐偏好覆盖（realism 层）
 */
import { Injectable, Logger } from '@nestjs/common';
import { StrategyResolver } from '../../../../strategy/app/strategy-resolver.service';
import { ResolvedStrategy } from '../../../../strategy/strategy.types';
import { ABTestingService } from '../experiment/ab-testing.service';
import { ProfileAggregatorService } from '../profile/profile-aggregator.service';
import { UserProfileService } from '../../../../user/app/services/profile/user-profile.service';

@Injectable()
export class StrategyResolverFacade {
  private readonly logger = new Logger(StrategyResolverFacade.name);

  constructor(
    private readonly strategyResolver: StrategyResolver,
    private readonly abTestingService: ABTestingService,
    private readonly profileAggregator: ProfileAggregatorService,
  ) {}

  /**
   * 安全地解析用户策略 — 从 Engine.resolveStrategyForUser() 整体迁移。
   *
   * 合并链路：
   *   base strategy → A/B experiment overlay → user preferences overlay
   *
   * 策略解析失败不阻断推荐流程，返回 null 回退到系统默认。
   */
  async resolveStrategyForUser(
    userId: string,
    goalType: string,
  ): Promise<ResolvedStrategy | null> {
    try {
      // 1. 从 StrategyResolver 获取基础策略（已合并 global → goal_type → user）
      let resolved = await this.strategyResolver.resolve(userId, goalType);

      // 2. 叠加 A/B 实验策略层
      try {
        const experimentResult =
          await this.abTestingService.resolveExperimentStrategy(
            userId,
            goalType,
          );
        if (experimentResult) {
          const source = `experiment:${experimentResult.experimentId}/${experimentResult.groupName}`;
          resolved = this.strategyResolver.mergeConfigOverride(
            resolved,
            experimentResult.config,
            source,
          );
          this.logger.debug(
            `用户 ${userId} 命中实验 ${experimentResult.experimentId}, 组=${experimentResult.groupName}`,
          );
        }
      } catch (expErr) {
        this.logger.warn(`A/B 实验策略解析失败 (user=${userId}): ${expErr}`);
      }

      // 3. 叠加用户推荐偏好覆盖（最高优先级 realism 层）
      try {
        const recPrefs =
          await this.profileAggregator.getRecommendationPreferences(userId);
        if (
          recPrefs.popularityPreference ||
          recPrefs.cookingEffort ||
          recPrefs.budgetSensitivity ||
          recPrefs.realismLevel
        ) {
          const realismOverride =
            UserProfileService.toRealismOverride(recPrefs);
          if (Object.keys(realismOverride).length > 0) {
            resolved = this.strategyResolver.mergeConfigOverride(
              resolved,
              { realism: realismOverride },
              'user_recommendation_preferences',
            );
            this.logger.debug(
              `用户 ${userId} 推荐偏好覆盖: ${JSON.stringify(realismOverride)}`,
            );
          }
        }
      } catch (prefErr) {
        this.logger.warn(`用户推荐偏好加载失败 (user=${userId}): ${prefErr}`);
      }

      return resolved;
    } catch (err) {
      this.logger.warn(
        `策略解析失败 (user=${userId}, goal=${goalType}), 回退到系统默认: ${err}`,
      );
      return null;
    }
  }
}
