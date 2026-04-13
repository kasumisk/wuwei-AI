/**
 * V6.2 Phase 2.3 — 分析保存事件监听器
 *
 * 监听 ANALYSIS_SAVED_TO_RECORD 事件（用户将分析结果保存为饮食记录时触发）。
 *
 * 职责:
 * - 更新涉及食物的 popularity 计数（提升搜索排名）
 * - 记录分析→记录的关联日志（用于数据质量追踪）
 *
 * 与 AnalysisIngestionService 的区别:
 * - AnalysisIngestionService 在 ANALYSIS_COMPLETED 时建立 analysis_food_link（食物匹配）
 * - 本 Listener 在用户确认保存时更新食物热度（用户行为信号）
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  AnalysisSavedToRecordEvent,
} from '../../../../core/events/domain-events';
import { PrismaService } from '../../../../core/prisma/prisma.service';

@Injectable()
export class AnalysisSaveListener {
  private readonly logger = new Logger(AnalysisSaveListener.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 处理分析保存事件
   *
   * 当用户将 AI 分析结果保存为饮食记录时:
   * 1. 根据食物名称查找标准食物库中的匹配项
   * 2. 对匹配到的食物 +1 popularity（提升搜索权重）
   * 3. 记录结构化日志
   */
  @OnEvent(DomainEvents.ANALYSIS_SAVED_TO_RECORD, { async: true })
  async handleAnalysisSaved(event: AnalysisSavedToRecordEvent): Promise<void> {
    try {
      this.logger.log(
        `分析保存: userId=${event.userId}, analysisId=${event.analysisId}, ` +
          `recordId=${event.foodRecordId}, type=${event.inputType}, ` +
          `foods=[${event.foodNames.join(', ')}], calories=${event.totalCalories}`,
      );

      // 更新涉及食物的 popularity
      if (event.foodNames.length > 0) {
        await this.updateFoodPopularity(event.foodNames);
      }
    } catch (err) {
      // 事件处理失败不影响主流程
      this.logger.warn(
        `分析保存事件处理失败: analysisId=${event.analysisId}, ${(err as Error).message}`,
      );
    }
  }

  /**
   * 批量更新食物 popularity
   * 对在标准食物库中匹配到的食物 popularity +1
   */
  private async updateFoodPopularity(foodNames: string[]): Promise<void> {
    const result = await this.prisma.foods.updateMany({
      where: {
        name: { in: foodNames },
        status: 'active',
      },
      data: {
        popularity: { increment: 1 },
      },
    });

    if (result.count > 0) {
      this.logger.debug(`食物热度更新: ${result.count} 个食物 popularity +1`);
    }
  }
}
