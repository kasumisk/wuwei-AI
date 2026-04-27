/**
 * V6.5 Phase 3B — EmbeddingGenerationProcessor（BullMQ Worker）
 *
 * 处理 embedding 生成 job：
 * 1. 接收食物 ID 列表
 * 2. 查询食物数据
 * 3. 调用 computeFoodEmbedding() 计算 96 维向量
 * 4. 批量写入 food_embeddings (model_name='feature_v5')
 *
 * 配合 DeadLetterService：重试耗尽后存入 DLQ
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, DeadLetterService } from '../../../../../core/queue';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { computeFoodEmbedding } from '../recall/food-embedding';
import type { EmbeddingJobData } from './embedding-generation.service';

@Processor(QUEUE_NAMES.EMBEDDING_GENERATION)
export class EmbeddingGenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingGenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deadLetterService: DeadLetterService,
  ) {
    super();
  }

  /**
   * 处理 embedding 生成 job
   */
  async process(job: Job<EmbeddingJobData>): Promise<void> {
    const { foodIds, source } = job.data;
    this.logger.debug(
      `开始生成 embedding: count=${foodIds.length}, source=${source}, jobId=${job.id}`,
    );

    const startTime = Date.now();

    // 查询食物数据
    const foods = await this.prisma.food.findMany({
      where: { id: { in: foodIds } },
    });

    if (foods.length === 0) {
      this.logger.warn(
        `未找到需要生成 embedding 的食物: ids=${foodIds.join(',')}`,
      );
      return;
    }

    // 计算 embedding 并准备更新
    const embeddings = foods.map((food) => ({
      id: food.id,
      vec: computeFoodEmbedding(food as any),
    }));

    const now = new Date();

    // V8.2: 批量写入 food_embeddings(legacy_v4) — Float[] 列
    await this.prisma.$transaction(
      embeddings.map(({ id, vec }) =>
        this.prisma.$executeRaw`
          INSERT INTO "food_embeddings" ("food_id", "model_name", "vector_legacy", "dimension", "generated_at", "updated_at")
          VALUES (${id}::uuid, 'legacy_v4', ${vec}::real[], ${vec.length}, ${now}, ${now})
          ON CONFLICT ("food_id", "model_name")
          DO UPDATE SET "vector_legacy" = EXCLUDED."vector_legacy",
                        "dimension"     = EXCLUDED."dimension",
                        "updated_at"    = EXCLUDED."updated_at"
        `,
      ),
    );

    // 尝试同步写入 food_embeddings(feature_v5) — pgvector 列
    try {
      await this.prisma.$transaction(
        embeddings.map(
          ({ id, vec }) =>
            this.prisma.$executeRaw`
              INSERT INTO "food_embeddings" ("food_id", "model_name", "vector", "dimension", "generated_at", "updated_at")
              VALUES (${id}::uuid, 'feature_v5', ${`[${vec.join(',')}]`}::vector, ${vec.length}, ${now}, ${now})
              ON CONFLICT ("food_id", "model_name")
              DO UPDATE SET "vector"        = EXCLUDED."vector",
                            "model_version" = EXCLUDED."model_version",
                            "dimension"     = EXCLUDED."dimension",
                            "updated_at"    = EXCLUDED."updated_at"
            `,
        ),
      );
    } catch {
      // pgvector 不可用时跳过，不影响主流程
      this.logger.debug('pgvector embedding 写入跳过（扩展可能不可用）');
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Embedding 生成完成: processed=${embeddings.length}/${foodIds.length}, elapsed=${elapsed}ms, source=${source}`,
    );
  }

  /**
   * V6.5 Phase 2A: 重试耗尽后存入 DLQ
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<EmbeddingJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts?.attempts ?? 2;
    if (job.attemptsMade >= maxAttempts) {
      this.logger.error(
        `Embedding 生成 job 永久失败: jobId=${job.id}, foodIds=${job.data.foodIds.join(',')}, error=${error.message}`,
      );
      await this.deadLetterService.storeFailedJob(
        QUEUE_NAMES.EMBEDDING_GENERATION,
        job.id ?? 'unknown',
        job.data,
        error.message,
        job.attemptsMade,
      );
    } else {
      this.logger.warn(
        `Embedding 生成 job 重试中: jobId=${job.id}, attempt=${job.attemptsMade}/${maxAttempts}, error=${error.message}`,
      );
    }
  }
}
