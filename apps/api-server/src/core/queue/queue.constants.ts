/**
 * V6 Phase 1.3 — 队列名称常量
 *
 * 定义系统中所有 BullMQ 队列的名称和默认配置。
 * 统一管理避免魔法字符串，方便后续扩展。
 */

// ─── 队列名称 ───

export const QUEUE_NAMES = {
  /** 画像实时更新 — 反馈/行为 → 短期画像更新 */
  PROFILE_UPDATE: 'profile-update',

  /** 每日推荐预计算 — 凌晨批量为活跃用户生成次日推荐 */
  RECOMMENDATION_PRECOMPUTE: 'recommendation-precompute',

  /** 反馈处理 — 权重学习 + 画像更新 */
  FEEDBACK_PROCESS: 'feedback-process',

  /** AI 图片分析 — 长耗时异步任务 */
  FOOD_ANALYSIS: 'food-analysis',

  /** 通知推送 — FCM / 站内信 */
  NOTIFICATION: 'notification',

  /** 数据导出 — CSV / PDF 生成 */
  EXPORT: 'export',
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
  [QUEUE_NAMES.PROFILE_UPDATE]: {
    concurrency: 5,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 1000,
  },
  [QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE]: {
    concurrency: 3,
    maxRetries: 2,
    backoffType: 'exponential',
    backoffDelay: 5000,
  },
  [QUEUE_NAMES.FEEDBACK_PROCESS]: {
    concurrency: 10,
    maxRetries: 3,
    backoffType: 'exponential',
    backoffDelay: 1000,
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
};
