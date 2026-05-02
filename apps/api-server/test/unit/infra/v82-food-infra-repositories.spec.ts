/**
 * V8.2 Repository 层冒烟测试
 *
 * 不连真 PG。只验证：
 *   - SQL 字符串包含正确的列名 / model_name 标识
 *   - Prisma client 调用路径正确（upsert / findUnique / groupBy）
 *
 * 真 PG 集成测试请单独 docker-compose 起 pgvector 后跑 *.integration.spec.ts。
 */
import { FoodEmbeddingRepository } from '../../../src/modules/food/repositories/food-embedding.repository';
import { FoodProvenanceRepository } from '../../../src/modules/food/repositories/food-provenance.repository';
import { FoodRepository } from '../../../src/modules/food/repositories/food.repository';
import {
  EMBEDDING_MODELS,
  EMBEDDING_DIMENSIONS,
  RECOMMENDATION_EMBEDDING_MODEL,
} from '../../../src/modules/food/repositories/embedding-model.constants';

describe('V8.2 FoodInfra Repository 冒烟', () => {
  describe('embedding-model.constants', () => {
    it('应导出 3 个模型枚举', () => {
      expect(Object.values(EMBEDDING_MODELS).sort()).toEqual([
        'feature_v5',
        'legacy_v4',
        'openai_v5',
      ]);
    });

    it('FEATURE_V5 维度应为 96，OPENAI_V5 为 1536', () => {
      expect(EMBEDDING_DIMENSIONS[EMBEDDING_MODELS.FEATURE_V5]).toBe(96);
      expect(EMBEDDING_DIMENSIONS[EMBEDDING_MODELS.OPENAI_V5]).toBe(1536);
    });

    it('推荐系统默认模型应为 FEATURE_V5', () => {
      expect(RECOMMENDATION_EMBEDDING_MODEL).toBe(EMBEDDING_MODELS.FEATURE_V5);
    });
  });

  describe('FoodEmbeddingRepository', () => {
    let prisma: any;
    let repo: FoodEmbeddingRepository;

    beforeEach(() => {
      prisma = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        $executeRaw: jest.fn().mockResolvedValue(1),
        $queryRaw: jest.fn().mockResolvedValue([{ vec: '[0.1,0.2,0.3]' }]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          { foodId: 'a', distance: 0.01 },
        ]),
        foodEmbedding: {
          findUnique: jest.fn().mockResolvedValue({
            foodId: 'a',
            modelName: 'feature_v5',
            dimension: 96,
          }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      repo = new FoodEmbeddingRepository(prisma);
    });

    it('upsertVector: 列名应为 model_name + dimension（V8.2 schema）', async () => {
      await repo.upsertVector({
        foodId: '00000000-0000-0000-0000-000000000001',
        modelName: 'feature_v5',
        vector: new Array(96).fill(0.1),
      });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
      const sql = (prisma.$executeRawUnsafe.mock.calls[0][0] as string);
      expect(sql).toContain('"model_name"');
      expect(sql).toContain('"dimension"');
      // 不能是被弃用的列名 "dim"（V8.2 重命名为 dimension）
      expect(sql).not.toMatch(/"dim"\s*[,)=]/);
      expect(sql).toContain('ON CONFLICT ("food_id", "model_name")');
    });

    it('upsertVectorLegacy: 应使用 vector_legacy + model_name=legacy_v4', async () => {
      await repo.upsertVectorLegacy({
        foodId: '00000000-0000-0000-0000-000000000001',
        vector: [0.1, 0.2, 0.3],
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('readVector: 解析 pgvector 文本为数组', async () => {
      const v = await repo.readVector(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(v).toEqual([0.1, 0.2, 0.3]);
    });

    it('readVector: pgvector 不可用时应返回 null（不抛异常）', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(
        new Error('pgvector type "vector" does not exist'),
      );
      const v = await repo.readVector(
        '00000000-0000-0000-0000-000000000001',
      );
      expect(v).toBeNull();
    });

    it('searchByVector: 使用 <=> 距离运算符与 model_name 过滤', async () => {
      await repo.searchByVector({
        queryVector: [0.1, 0.2],
        limit: 10,
      });
      const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sql).toContain('fe.vector <=> $1::vector');
      expect(sql).toContain('fe.model_name = $2');
      expect(sql).toContain('LIMIT 10');
    });

    it('searchByVector: limit 应被夹紧到 [1, 1000]', async () => {
      await repo.searchByVector({
        queryVector: [0.1],
        limit: 99999,
      });
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('LIMIT 1000');

      await repo.searchByVector({
        queryVector: [0.1],
        limit: -5,
      });
      expect(prisma.$queryRawUnsafe.mock.calls[1][0]).toContain('LIMIT 1');
    });

    it('searchByVector: 含 foodIdFilter 时使用 ANY uuid[]', async () => {
      await repo.searchByVector({
        queryVector: [0.1],
        foodIdFilter: ['id-1', 'id-2'],
      });
      const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
      expect(sql).toContain('fe.food_id = ANY($3::uuid[])');
    });

    it('findByFood: 走 Prisma client 复合唯一键', async () => {
      await repo.findByFood('id-1', 'feature_v5');
      expect(prisma.foodEmbedding.findUnique).toHaveBeenCalledWith({
        where: {
          foodId_modelName: { foodId: 'id-1', modelName: 'feature_v5' },
        },
      });
    });
  });

  describe('FoodProvenanceRepository', () => {
    let prisma: any;
    let repo: FoodProvenanceRepository;

    beforeEach(() => {
      prisma = {
        foodFieldProvenance: {
          upsert: jest.fn().mockResolvedValue({}),
          findMany: jest.fn().mockResolvedValue([
            {
              foodId: 'a',
              fieldName: 'protein',
              source: 'ai',
              status: 'failed',
              failureReason: 'parse error',
            },
          ]),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          groupBy: jest.fn().mockResolvedValue([
            { fieldName: 'protein', _count: { fieldName: 5 } },
            { fieldName: 'fat', _count: { fieldName: 3 } },
          ]),
        },
      };
      repo = new FoodProvenanceRepository(prisma);
    });

    it('recordSuccess: 走 upsert，status=success', async () => {
      await repo.recordSuccess({
        foodId: 'a',
        fieldName: 'protein',
        source: 'usda',
        confidence: 0.9,
      });
      expect(prisma.foodFieldProvenance.upsert).toHaveBeenCalledTimes(1);
      const args = prisma.foodFieldProvenance.upsert.mock.calls[0][0];
      expect(args.where.foodId_fieldName_source).toEqual({
        foodId: 'a',
        fieldName: 'protein',
        source: 'usda',
      });
      expect(args.update.status).toBe('success');
      expect(args.update.failureReason).toBeNull();
      expect(args.create.status).toBe('success');
    });

    it('recordFailure: status=failed + failureReason 必填', async () => {
      await repo.recordFailure({
        foodId: 'a',
        fieldName: 'protein',
        source: 'ai_enrichment',
        reason: 'JSON parse error',
      });
      const args = prisma.foodFieldProvenance.upsert.mock.calls[0][0];
      expect(args.update.status).toBe('failed');
      expect(args.update.failureReason).toBe('JSON parse error');
    });

    it('listFailures: where 过滤 status=failed', async () => {
      const rows = await repo.listFailures('a');
      expect(prisma.foodFieldProvenance.findMany).toHaveBeenCalledWith({
        where: { foodId: 'a', status: 'failed' },
      });
      expect(rows).toHaveLength(1);
    });

    it('clearFailuresForField: 仅删除 failed 行', async () => {
      await repo.clearFailuresForField('a', 'protein');
      expect(prisma.foodFieldProvenance.deleteMany).toHaveBeenCalledWith({
        where: { foodId: 'a', fieldName: 'protein', status: 'failed' },
      });
    });

    it('topFailedFields: 走 groupBy 聚合', async () => {
      const rows = await repo.topFailedFields(10);
      expect(prisma.foodFieldProvenance.groupBy).toHaveBeenCalledWith({
        by: ['fieldName'],
        where: { status: 'failed' },
        _count: { fieldName: true },
        orderBy: { _count: { fieldName: 'desc' } },
        take: 10,
      });
      expect(rows).toEqual([
        { fieldName: 'protein', count: 5 },
        { fieldName: 'fat', count: 3 },
      ]);
    });
  });

  describe('FoodRepository (聚合层)', () => {
    let prisma: any;
    let embeddings: jest.Mocked<FoodEmbeddingRepository>;
    let provenance: jest.Mocked<FoodProvenanceRepository>;
    let repo: FoodRepository;

    beforeEach(() => {
      prisma = {
        food: {
          findUnique: jest.fn().mockResolvedValue({ id: 'a', name: 'Apple' }),
        },
      };
      embeddings = {
        readVector: jest.fn().mockResolvedValue([0.1, 0.2]),
      } as any;
      provenance = {
        listFailures: jest.fn().mockResolvedValue([
          { fieldName: 'protein', failureReason: 'unknown' },
          { fieldName: 'fat', failureReason: null },
        ]),
      } as any;
      repo = new FoodRepository(prisma, embeddings, provenance);
    });

    it('findOne: 食物不存在返回 null', async () => {
      prisma.food.findUnique.mockResolvedValueOnce(null);
      expect(await repo.findOne('not-exist')).toBeNull();
    });

    it('findOne: 默认不查 embedding/provenance', async () => {
      const r = await repo.findOne('a');
      expect(r?.food?.id).toBe('a');
      expect(r?.embedding).toBeUndefined();
      expect(r?.failedFields).toBeUndefined();
      expect(embeddings.readVector).not.toHaveBeenCalled();
      expect(provenance.listFailures).not.toHaveBeenCalled();
    });

    it('findOne: withEmbedding=true 走默认推荐模型', async () => {
      const r = await repo.findOne('a', { withEmbedding: true });
      expect(embeddings.readVector).toHaveBeenCalledWith(
        'a',
        RECOMMENDATION_EMBEDDING_MODEL,
      );
      expect(r?.embedding).toEqual([0.1, 0.2]);
    });

    it('findOne: withProvenance 把失败字段拍平为 record', async () => {
      const r = await repo.findOne('a', { withProvenance: true });
      expect(r?.failedFields).toEqual({
        protein: 'unknown',
        fat: '',
      });
    });
  });
});
