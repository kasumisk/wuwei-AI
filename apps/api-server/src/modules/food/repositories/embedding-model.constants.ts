/**
 * V8.2 食物 embedding 模型枚举
 *
 * 当前共存三套模型，全部存储在 food_embeddings 表的不同行（按 model_name 区分）：
 *
 * - LEGACY_V4：旧版 Float[] 向量（vector_legacy 列）
 *   迁移自 foods.embedding 数组列。仅用于回退兼容，不再产生新写入。
 *
 * - FEATURE_V5：96 维拼接特征向量（vector 列，pgvector）
 *   computeFoodEmbedding() 拼接语义 + 营养特征产出。
 *   当前推荐系统主用模型，HNSW 索引加速 ANN 搜索。
 *
 * - OPENAI_V5：1536 维 OpenAI text-embedding-3-small（vector 列，pgvector）
 *   预留给未来真正接入 OpenAI 时使用。**当前代码未实际写入此模型**。
 */
export const EMBEDDING_MODELS = {
  LEGACY_V4: 'legacy_v4',
  FEATURE_V5: 'feature_v5',
  OPENAI_V5: 'openai_v5',
} as const;

export type EmbeddingModelName =
  (typeof EMBEDDING_MODELS)[keyof typeof EMBEDDING_MODELS];

/** 各模型预期维度。0 表示不固定（取实际数组长度） */
export const EMBEDDING_DIMENSIONS: Record<EmbeddingModelName, number> = {
  [EMBEDDING_MODELS.LEGACY_V4]: 0,
  [EMBEDDING_MODELS.FEATURE_V5]: 96,
  [EMBEDDING_MODELS.OPENAI_V5]: 1536,
};

/** 推荐系统当前默认使用的 embedding 模型 */
export const RECOMMENDATION_EMBEDDING_MODEL: EmbeddingModelName =
  EMBEDDING_MODELS.FEATURE_V5;
