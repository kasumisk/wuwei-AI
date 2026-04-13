/**
 * V6.2 Phase 2.5 — 分析提交行为追踪监听器
 *
 * 监听 ANALYSIS_SUBMITTED 事件（用户提交食物分析请求时触发）。
 *
 * 职责:
 * - 记录用户的分析行为到行为画像（分析频次、偏好的分析类型）
 * - 更新 user_behavior_profiles 中的活跃度指标
 *
 * 与 AnalysisEventListener 的区别:
 * - AnalysisEventListener 监听 ANALYSIS_COMPLETED（分析完成后联动画像+推荐）
 * - 本 Listener 监听 ANALYSIS_SUBMITTED（分析提交时记录行为信号）
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  AnalysisSubmittedEvent,
} from '../../../../core/events/domain-events';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class AnalysisTrackingListener {
  private readonly logger = new Logger(AnalysisTrackingListener.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 处理分析提交事件
   *
   * 更新行为画像中的分析行为统计:
   * - analysis_count: 总分析次数 +1
   * - 在 engagement_metrics 中记录最近分析时间和类型分布
   */
  @OnEvent(DomainEvents.ANALYSIS_SUBMITTED, { async: true })
  async handleAnalysisSubmitted(event: AnalysisSubmittedEvent): Promise<void> {
    try {
      this.logger.debug(
        `分析提交: userId=${event.userId}, type=${event.inputType}, ` +
          `requestId=${event.requestId}`,
      );

      await this.updateBehaviorProfile(event);
    } catch (err) {
      // 行为追踪失败不应影响分析主流程
      this.logger.warn(
        `分析行为追踪失败: userId=${event.userId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * 更新行为画像中的分析统计
   *
   * 在 engagement_metrics JSON 字段中增量更新:
   * - analysisCount: 总次数
   * - lastAnalysisAt: 最近分析时间
   * - analysisTypeDistribution: 按类型(text/image)分布
   */
  private async updateBehaviorProfile(
    event: AnalysisSubmittedEvent,
  ): Promise<void> {
    const profile = await this.prisma.userBehaviorProfiles.findUnique({
      where: { userId: event.userId },
    });

    if (!profile) {
      this.logger.debug(`用户 ${event.userId} 无行为画像，跳过分析追踪`);
      return;
    }

    // 读取现有 engagement_metrics（存储在 replacement_patterns JSON 的 _engagement 子键中）
    // 注意：V6.2 暂借用 replacement_patterns JSON 字段，未来迁移后移至独立列
    const replacementData =
      (profile.replacementPatterns as Record<string, unknown>) ?? {};
    const metrics =
      (replacementData._engagement as Record<string, unknown>) ?? {};
    const analysisCount = ((metrics.analysisCount as number) ?? 0) + 1;
    const typeDistribution =
      (metrics.analysisTypeDistribution as Record<string, number>) ?? {};
    typeDistribution[event.inputType] =
      (typeDistribution[event.inputType] ?? 0) + 1;

    // 更新
    await this.prisma.userBehaviorProfiles.update({
      where: { userId: event.userId },
      data: {
        replacementPatterns: {
          ...(replacementData as object),
          _engagement: {
            analysisCount,
            lastAnalysisAt: new Date().toISOString(),
            analysisTypeDistribution: typeDistribution,
          },
        },
      },
    });

    this.logger.debug(
      `行为画像更新: userId=${event.userId}, analysisCount=${analysisCount}`,
    );
  }
}
