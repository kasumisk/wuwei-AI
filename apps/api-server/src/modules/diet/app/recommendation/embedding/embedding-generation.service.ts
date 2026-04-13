/**
 * V6.5 Phase 3B — EmbeddingGenerationService
 *
 * 职责：
 * - 监听食物入库/晋升事件，异步触发 embedding 生成
 * - 提供批量重新生成 embedding 的管理 API
 * - 通过 BullMQ 队列异步执行，避免阻塞主流程
 *
 * 事件驱动流程（§4.5.3）：
 *   食物晋升/创建 → emit CANDIDATE_PROMOTED
 *     → EmbeddingGenerationService.onFoodPromoted()
 *       → safeEnqueue('embedding-generation', { foodIds: [...] })
 *         → EmbeddingGenerationProcessor.process()
 *           → computeFoodEmbedding() → 写入 foods.embedding + embedding_v5
 *
 * 批量 API 流程：
 *   Admin 调用 regenerateAll()
 *     → 查询所有缺 embedding 的食物
 *     → 分批入队（每批 50 个）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { QUEUE_NAMES, QueueResilienceService } from '../../../../../core/queue';
import {
  DomainEvents,
  CandidatePromotedEvent,
} from '../../../../../core/events/domain-events';
import { computeFoodEmbedding } from '../recall/food-embedding';

/** Embedding 生成 job 数据 */
export interface EmbeddingJobData {
  /** 需要生成 embedding 的食物 ID 列表 */
  foodIds: string[];
  /** 触发来源：event / admin / sync */
  source: 'event' | 'admin' | 'sync';
}

/** 批量重新生成的结果 */
export interface RegenerateResult {
  /** 入队的 job 数量 */
  jobsEnqueued: number;
  /** 需要处理的食物总数 */
  totalFoods: number;
  /** 每批大小 */
  batchSize: number;
}

@Injectable()
export class EmbeddingGenerationService {
  private readonly logger = new Logger(EmbeddingGenerationService.name);

  /** 批量处理每批大小 */
  private static readonly BATCH_SIZE = 50;

  constructor(
    @InjectQueue(QUEUE_NAMES.EMBEDDING_GENERATION)
    private readonly embeddingQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly resilience: QueueResilienceService,
  ) {}

  // ─── 事件驱动：食物晋升时自动触发 embedding 生成 ───

  /**
   * 监听 CANDIDATE_PROMOTED 事件
   * 新晋升的食物需要计算 embedding 以参与语义召回
   */
  @OnEvent(DomainEvents.CANDIDATE_PROMOTED, { async: true })
  async onFoodPromoted(event: CandidatePromotedEvent): Promise<void> {
    try {
      await this.enqueueGeneration([event.promotedFoodId], 'event');
      this.logger.log(
        `食物晋升 embedding 生成已入队: foodId=${event.promotedFoodId}, name=${event.foodName}`,
      );
    } catch (err) {
      this.logger.error(
        `食物晋升 embedding 入队失败: foodId=${event.promotedFoodId}, error=${(err as Error).message}`,
      );
    }
  }

  // ─── 管理 API ───

  /**
   * 为指定食物生成 embedding（入队异步处理）
   */
  async generateForFoods(foodIds: string[]): Promise<{ jobsEnqueued: number }> {
    if (foodIds.length === 0) return { jobsEnqueued: 0 };

    let jobsEnqueued = 0;
    for (
      let i = 0;
      i < foodIds.length;
      i += EmbeddingGenerationService.BATCH_SIZE
    ) {
      const batch = foodIds.slice(i, i + EmbeddingGenerationService.BATCH_SIZE);
      await this.enqueueGeneration(batch, 'admin');
      jobsEnqueued++;
    }

    return { jobsEnqueued };
  }

  /**
   * 重新生成所有缺少 embedding 的食物
   * Admin 管理端调用，分批入队
   */
  async regenerateAll(): Promise<RegenerateResult> {
    // 查询所有缺 embedding 的活跃食物 ID
    const foods = await this.prisma.foods.findMany({
      where: {
        OR: [{ embedding: { isEmpty: true } }, { embedding: { equals: [] } }],
        status: 'active',
      },
      select: { id: true },
    });

    if (foods.length === 0) {
      return {
        jobsEnqueued: 0,
        totalFoods: 0,
        batchSize: EmbeddingGenerationService.BATCH_SIZE,
      };
    }

    const foodIds = foods.map((f) => f.id);
    let jobsEnqueued = 0;

    for (
      let i = 0;
      i < foodIds.length;
      i += EmbeddingGenerationService.BATCH_SIZE
    ) {
      const batch = foodIds.slice(i, i + EmbeddingGenerationService.BATCH_SIZE);
      await this.enqueueGeneration(batch, 'sync');
      jobsEnqueued++;
    }

    this.logger.log(
      `批量 embedding 生成已入队: totalFoods=${foodIds.length}, jobs=${jobsEnqueued}`,
    );

    return {
      jobsEnqueued,
      totalFoods: foodIds.length,
      batchSize: EmbeddingGenerationService.BATCH_SIZE,
    };
  }

  /**
   * 同步为单个食物生成 embedding（不经过队列）
   * 用于 QueueResilienceService 降级时的同步回退
   */
  async generateSync(foodId: string): Promise<boolean> {
    try {
      const food = await this.prisma.foods.findUnique({
        where: { id: foodId },
      });
      if (!food) return false;

      const vec = computeFoodEmbedding(food as any);

      // 写入 embedding 字段
      await this.prisma.foods.update({
        where: { id: foodId },
        data: {
          embedding: vec,
          embeddingUpdatedAt: new Date(),
        },
      });

      // 尝试写入 pgvector 列（失败不阻塞）
      try {
        await this.prisma
          .$queryRaw`UPDATE "foods" SET "embedding_v5" = ${`[${vec.join(',')}]`}::vector WHERE "id" = ${foodId}`;
      } catch {
        // pgvector 不可用时忽略
      }

      return true;
    } catch (err) {
      this.logger.error(
        `同步 embedding 生成失败: foodId=${foodId}, error=${(err as Error).message}`,
      );
      return false;
    }
  }

  // ─── 私有方法 ───

  /**
   * 入队 embedding 生成 job，带弹性降级
   */
  private async enqueueGeneration(
    foodIds: string[],
    source: EmbeddingJobData['source'],
  ): Promise<void> {
    const data: EmbeddingJobData = { foodIds, source };
    const result = await this.resilience.safeEnqueue(
      this.embeddingQueue,
      'generate-embeddings',
      data,
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    if (result.mode === 'sync') {
      // 队列不可用，降级为同步处理
      this.logger.warn(
        `Embedding 队列不可用，降级同步处理 ${foodIds.length} 个食物`,
      );
      for (const id of foodIds) {
        await this.generateSync(id);
      }
    }
  }
}
