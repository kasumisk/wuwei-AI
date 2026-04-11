-- V6.5 Phase 3C — pgvector HNSW 索引创建
--
-- 前置条件：
--   1. PostgreSQL 已安装 pgvector 扩展: CREATE EXTENSION IF NOT EXISTS vector;
--   2. foods.embedding_v5 列已存在（vector(96) 类型）
--   3. 已有部分食物数据写入了 embedding_v5
--
-- 两种索引策略（二选一，推荐 HNSW）：
--
-- HNSW（推荐）：
--   - 更高搜索精度（recall > 99%）
--   - 构建速度慢、占更多内存
--   - 适合食物库规模 < 100K
--
-- IVFFlat（备选）：
--   - 构建速度快、占内存少
--   - 精度稍低（recall ~95%，依赖 lists 参数）
--   - 适合食物库规模 > 100K
--
-- 参数说明：
--   m = 16          : 每节点最大邻居数（越大精度越高，内存越多）
--   ef_construction = 64 : 构建时搜索宽度（越大索引质量越高，构建越慢）
--   运行时 ef_search 由 VectorSearchService 通过 SET LOCAL hnsw.ef_search 控制
--

-- 确保 pgvector 扩展存在
CREATE EXTENSION IF NOT EXISTS vector;

-- 创建 HNSW 索引（余弦距离操作符类）
-- 注意：CREATE INDEX 是阻塞操作，在大表上建议使用 CONCURRENTLY
-- 对于 < 10K 行的食物表，直接创建即可
CREATE INDEX IF NOT EXISTS idx_foods_embedding_v5_hnsw
  ON foods USING hnsw (embedding_v5 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 验证索引已创建
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'foods' AND indexname LIKE '%embedding%';

-- ──────────────────────────────────────────────
-- 备选：IVFFlat 索引（食物库 > 100K 时使用）
-- lists 参数建议设置为 sqrt(总行数)
-- ──────────────────────────────────────────────
-- CREATE INDEX IF NOT EXISTS idx_foods_embedding_v5_ivfflat
--   ON foods USING ivfflat (embedding_v5 vector_cosine_ops)
--   WITH (lists = 100);
