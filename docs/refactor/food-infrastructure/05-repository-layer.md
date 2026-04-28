# 05 · Repository 抽象层设计

## 目标

将 113 处 `prisma.foods.*` + 30 处 raw SQL 收口到一个明确的边界，避免后续每次拆表都要 grep 全仓。

## 不做什么

- **不**强制所有现有调用迁移到 Repository（churn 太大，本期不接受）
- **不**做 generic Repository 抽象（不引入 BaseRepository 父类）
- **不**接管 enrichment 写路径的事务编排（保留在 service 层）

## 做什么

只在以下三类场景中使用 Repository：

1. 多表组装 `FoodLibrary`（主表 + embedding + provenance）
2. embedding CRUD（替换原本写 `foods.embedding_v5` 的位置）
3. provenance 写入（replace `failed_fields` jsonb 操作）

---

## 文件结构

```
apps/api-server/src/modules/food/
├── repositories/
│   ├── food.repository.ts          # 主入口
│   ├── food-embedding.repository.ts
│   └── food-provenance.repository.ts
└── embedding-model.constants.ts    # 模型枚举
```

---

## `embedding-model.constants.ts`

```ts
export const EMBEDDING_MODELS = {
  LEGACY_V4: 'legacy_v4',           // 旧 Float[]
  OPENAI_V5: 'openai_v5',           // 新 vector(1536), text-embedding-3-small
} as const;

export type EmbeddingModelName = (typeof EMBEDDING_MODELS)[keyof typeof EMBEDDING_MODELS];

export const EMBEDDING_DIMENSIONS: Record<EmbeddingModelName, number> = {
  [EMBEDDING_MODELS.LEGACY_V4]: 0,   // legacy 维度不固定，存数组长度
  [EMBEDDING_MODELS.OPENAI_V5]: 1536,
};

// 推荐排序当前使用的模型
export const RECOMMENDATION_EMBEDDING_MODEL: EmbeddingModelName = EMBEDDING_MODELS.OPENAI_V5;
```

---

## `food-embedding.repository.ts`

```ts
@Injectable()
export class FoodEmbeddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsertVector(params: {
    foodId: string;
    modelName: EmbeddingModelName;
    modelVersion?: string;
    vector: number[];
  }): Promise<void> {
    const { foodId, modelName, modelVersion, vector } = params;
    const dimension = vector.length;

    if (modelName === EMBEDDING_MODELS.OPENAI_V5) {
      // pgvector 写入
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO food_embeddings (id, food_id, model_name, model_version, vector, dimension, generated_at, updated_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4::vector, $5, NOW(), NOW())
        ON CONFLICT (food_id, model_name)
        DO UPDATE SET vector = EXCLUDED.vector,
                      model_version = EXCLUDED.model_version,
                      dimension = EXCLUDED.dimension,
                      updated_at = NOW()
      `, foodId, modelName, modelVersion ?? null, `[${vector.join(',')}]`, dimension);
    } else {
      // legacy Float[]
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO food_embeddings (id, food_id, model_name, vector_legacy, dimension, generated_at, updated_at)
        VALUES (gen_random_uuid()::text, $1, $2, $3::float8[], $4, NOW(), NOW())
        ON CONFLICT (food_id, model_name)
        DO UPDATE SET vector_legacy = EXCLUDED.vector_legacy,
                      dimension = EXCLUDED.dimension,
                      updated_at = NOW()
      `, foodId, modelName, vector, dimension);
    }
  }

  async findByFood(foodId: string, modelName: EmbeddingModelName) {
    return this.prisma.foodEmbedding.findUnique({
      where: { foodId_modelName: { foodId, modelName } },
    });
  }

  async deleteByFood(foodId: string): Promise<void> {
    await this.prisma.foodEmbedding.deleteMany({ where: { foodId } });
  }

  /**
   * pgvector 向量召回（替换原 vector-search.service.ts 中的 raw SQL）
   * @returns [{ foodId, distance }]
   */
  async searchByVector(params: {
    queryVector: number[];
    modelName?: EmbeddingModelName;
    limit?: number;
    foodIdFilter?: string[];
  }): Promise<Array<{ foodId: string; distance: number }>> {
    const {
      queryVector,
      modelName = RECOMMENDATION_EMBEDDING_MODEL,
      limit = 100,
      foodIdFilter,
    } = params;

    const filterClause = foodIdFilter?.length
      ? `AND fe.food_id = ANY($3::text[])`
      : '';
    const sql = `
      SELECT fe.food_id AS "foodId",
             fe.vector <=> $1::vector AS distance
        FROM food_embeddings fe
       WHERE fe.model_name = $2
         AND fe.vector IS NOT NULL
         ${filterClause}
       ORDER BY fe.vector <=> $1::vector
       LIMIT ${Number(limit)}
    `;
    const args: unknown[] = [`[${queryVector.join(',')}]`, modelName];
    if (foodIdFilter?.length) args.push(foodIdFilter);
    return this.prisma.$queryRawUnsafe(sql, ...args);
  }
}
```

---

## `food-provenance.repository.ts`

```ts
@Injectable()
export class FoodProvenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordSuccess(params: {
    foodId: string; fieldName: string; source: string; confidence?: number;
  }): Promise<void> {
    const { foodId, fieldName, source, confidence } = params;
    await this.prisma.foodFieldProvenance.upsert({
      where: { foodId_fieldName_source: { foodId, fieldName, source } },
      update: { confidence, status: 'success', failureReason: null, updatedAt: new Date() },
      create: { id: randomUUID(), foodId, fieldName, source, confidence, status: 'success' },
    });
  }

  async recordFailure(params: {
    foodId: string; fieldName: string; source: string; reason: string;
  }): Promise<void> {
    const { foodId, fieldName, source, reason } = params;
    await this.prisma.foodFieldProvenance.upsert({
      where: { foodId_fieldName_source: { foodId, fieldName, source } },
      update: { status: 'failed', failureReason: reason, updatedAt: new Date() },
      create: { id: randomUUID(), foodId, fieldName, source, status: 'failed', failureReason: reason },
    });
  }

  async listFailures(foodId: string) {
    return this.prisma.foodFieldProvenance.findMany({
      where: { foodId, status: 'failed' },
    });
  }

  async clearFailuresForField(foodId: string, fieldName: string): Promise<void> {
    await this.prisma.foodFieldProvenance.deleteMany({
      where: { foodId, fieldName, status: 'failed' },
    });
  }
}
```

---

## `food.repository.ts`（聚合层）

```ts
@Injectable()
export class FoodRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: FoodEmbeddingRepository,
    private readonly provenance: FoodProvenanceRepository,
  ) {}

  /**
   * 单查 + 按需附加 embedding/provenance
   * 推荐流走 food-pool-cache（不走这里），不影响热路径。
   */
  async findOne(id: string, opts?: {
    withEmbedding?: EmbeddingModelName;
    withProvenance?: boolean;
  }): Promise<FoodLibrary | null> {
    const food = await this.prisma.food.findUnique({ where: { id } });
    if (!food) return null;

    let embedding: number[] | undefined;
    if (opts?.withEmbedding) {
      const row = await this.embeddings.findByFood(id, opts.withEmbedding);
      embedding = row?.vector ?? row?.vectorLegacy ?? undefined;
    }

    let failedFields: Record<string, string> | undefined;
    if (opts?.withProvenance) {
      const failures = await this.provenance.listFailures(id);
      failedFields = Object.fromEntries(failures.map(f => [f.fieldName, f.failureReason ?? '']));
    }

    return mapFoodToLibrary(food, { embedding, failedFields });
  }
}
```

---

## 模块装配

`food.module.ts`：

```ts
@Module({
  providers: [
    FoodRepository,
    FoodEmbeddingRepository,
    FoodProvenanceRepository,
  ],
  exports: [
    FoodRepository,
    FoodEmbeddingRepository,
    FoodProvenanceRepository,
  ],
})
export class FoodModule {}
```

被 `DietRecommendationModule` / `FoodPipelineModule` 注入使用。

---

## 迁移策略（不强制）

本期范围只在以下位置接入：

- ✅ `embedding-generation.service.ts` 改为调用 `FoodEmbeddingRepository.upsertVector`
- ✅ `vector-search.service.ts` 改为调用 `FoodEmbeddingRepository.searchByVector`
- ✅ `semantic-recall.service.ts` 同上
- ✅ `food-enrichment.service.ts` 中失败 / 成功记录改为调用 `FoodProvenanceRepository`
- ⏸ 其余 `prisma.foods` 调用：本期只做 model 重命名 (`prisma.food`)，**不**强制走 Repository

---

## 测试

新建 `apps/api-server/test/integration/food.repository.spec.ts`，覆盖：

- upsert embedding 双模型路径
- vector search 召回顺序
- provenance 成功/失败/清理流转

不写 unit mock，全部跑真实 PG（需 docker-compose pg + pgvector）。
