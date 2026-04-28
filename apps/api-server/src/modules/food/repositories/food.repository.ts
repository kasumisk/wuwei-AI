import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FoodEmbeddingRepository } from './food-embedding.repository';
import { FoodProvenanceRepository } from './food-provenance.repository';
import {
  EmbeddingModelName,
  RECOMMENDATION_EMBEDDING_MODEL,
} from './embedding-model.constants';

/**
 * V8.2 Food 聚合仓储
 *
 * 提供"主表 + embedding + provenance"组合读取入口，避免业务代码 N 处 grep 拼装。
 *
 * 注意：本仓储**不接管**热路径（FoodPoolCacheService 内存索引、内嵌 vector-search SQL）。
 * 仅用于 admin / pipeline / 同步生成等低频场景。
 */
@Injectable()
export class FoodRepository {
  constructor(
    private readonly prisma: PrismaService,
    public readonly embeddings: FoodEmbeddingRepository,
    public readonly provenance: FoodProvenanceRepository,
  ) {}

  /** 单查食物，附加可选 embedding / provenance */
  async findOne(
    id: string,
    opts?: {
      withEmbedding?: EmbeddingModelName | true; // true → RECOMMENDATION_EMBEDDING_MODEL
      withProvenance?: boolean;
    },
  ): Promise<{
    food: Awaited<ReturnType<PrismaService['food']['findUnique']>>;
    embedding?: number[] | null;
    failedFields?: Record<string, string>;
  } | null> {
    const food = await this.prisma.food.findUnique({ where: { id } });
    if (!food) return null;

    const result: {
      food: typeof food;
      embedding?: number[] | null;
      failedFields?: Record<string, string>;
    } = { food };

    if (opts?.withEmbedding) {
      const model =
        opts.withEmbedding === true
          ? RECOMMENDATION_EMBEDDING_MODEL
          : opts.withEmbedding;
      result.embedding = await this.embeddings.readVector(id, model);
    }

    if (opts?.withProvenance) {
      const failures = await this.provenance.listFailures(id);
      result.failedFields = Object.fromEntries(
        failures.map((f) => [f.fieldName, f.failureReason ?? '']),
      );
    }

    return result;
  }
}
