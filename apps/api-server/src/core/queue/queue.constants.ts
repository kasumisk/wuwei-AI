/**
 * V6 Phase 1.3 — 队列名称常量
 *
 * 定义系统中所有 BullMQ 队列的名称和默认配置。
 * 统一管理避免魔法字符串，方便后续扩展。
 */

// ─── 队列名称 ───

export const QUEUE_NAMES = {
  /** 每日推荐预计算 — 凌晨批量为活跃用户生成次日推荐 */
  RECOMMENDATION_PRECOMPUTE: 'recommendation-precompute',

  /** AI 图片分析 — 长耗时异步任务 */
  FOOD_ANALYSIS: 'food-analysis',

  /** 通知推送 — FCM / 站内信 */
  NOTIFICATION: 'notification',

  /** 数据导出 — CSV / PDF 生成（Phase 3 实现 Processor） */
  EXPORT: 'export',

  /** V6.3 P2-7: AI 菜谱批量生成 */
  RECIPE_GENERATION: 'recipe-generation',

  /** V6.5 Phase 3B: 食物 Embedding 异步生成 */
  EMBEDDING_GENERATION: 'embedding-generation',

  /** V6.6: 食物数据 AI 补全回填 */
  FOOD_ENRICHMENT: 'food-enrichment',

  /** USDA 数据导入异步任务 */
  FOOD_USDA_IMPORT: 'food-usda-import',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── 队列默认配置 ───

export const QUEUE_DEFAULT_OPTIONS: Record<
  QueueName,
  {
    concurrency: number;
    maxRetries: number;
    backoffType: 'exponential' | 'fixed';
    backoffDelay: number;
  }
> = {
  [QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE]: {
    concurrency: 3,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 5000,
  },
  [QUEUE_NAMES.FOOD_ANALYSIS]: {
    concurrency: 3,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 3000,
  },
  [QUEUE_NAMES.NOTIFICATION]: {
    concurrency: 10,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 2000,
  },
  [QUEUE_NAMES.EXPORT]: {
    concurrency: 2,
    maxRetries: 1,
    backoffType: 'fixed',
    backoffDelay: 5000,
  },
  [QUEUE_NAMES.RECIPE_GENERATION]: {
    concurrency: 2,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 5000,
  },
  [QUEUE_NAMES.EMBEDDING_GENERATION]: {
    concurrency: 5,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 2000,
  },
  [QUEUE_NAMES.FOOD_ENRICHMENT]: {
    concurrency: 3,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 5000,
  },
  [QUEUE_NAMES.FOOD_USDA_IMPORT]: {
    concurrency: 1,
    maxRetries: 1,
    backoffType: 'exponential',
    backoffDelay: 5000,
  },
};
