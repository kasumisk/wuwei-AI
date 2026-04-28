/**
 * V6.2 Phase 3.8 — 目标达成事件监听器
 *
 * 监听 GOAL_ACHIEVED 事件，处理：
 * - 记录成就日志到 user_inferred_profiles
 * - 更新连续达成天数
 * - 日志记录
 *
 * 所有操作异步执行，不阻塞主流程。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  GoalAchievedEvent,
} from '../../../../core/events/domain-events';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  getInferred,
  updateInferred,
} from '../../user-profile-merge.helper';

@Injectable()
export class GoalAchievedListener {
  private readonly logger = new Logger(GoalAchievedListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(DomainEvents.GOAL_ACHIEVED, { async: true })
  async handleGoalAchieved(event: GoalAchievedEvent): Promise<void> {
    try {
      this.logger.log(
        `用户 ${event.userId} 达成目标: ${event.goalType} - ${event.description}`,
      );

      // 更新推断画像中的成就记录
      const userProfile = await this.prisma.userProfiles.findUnique({
        where: { userId: event.userId },
      });

      if (userProfile) {
        const inferred = getInferred(userProfile);
        const achievements = ((inferred.confidenceScores as any)
          ?._achievements || []) as Array<{
          goalType: string;
          description: string;
          achievedAt: string;
        }>;

        achievements.push({
          goalType: event.goalType,
          description: event.description,
          achievedAt: event.timestamp.toISOString(),
        });

        // 只保留最近 50 条成就记录
        const recentAchievements = achievements.slice(-50);

        await updateInferred(this.prisma, event.userId, {
          confidenceScores: {
            ...((inferred.confidenceScores as any) || {}),
            _achievements: recentAchievements,
            _lastGoalAchievedAt: event.timestamp.toISOString(),
          },
          lastComputedAt: new Date(),
        });
      }
    } catch (err) {
      this.logger.error(
        `处理目标达成事件失败: userId=${event.userId}, error=${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
