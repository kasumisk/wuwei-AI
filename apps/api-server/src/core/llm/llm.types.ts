/**
 * core/llm — 统一 LLM 调用层
 *
 * 设计目标（参见审查报告 §6）：
 *  1. 所有 LLM 调用必须经过 CircuitBreaker（之前裸跑）
 *  2. 所有调用必须有显式 timeout（默认 30s）
 *  3. 所有用户级调用必须先扣配额（防止个人账号被滥刷）
 *  4. 所有调用必须落 UsageRecords（成本可观测）
 *  5. 渐进式迁移：先收编 LangChain/RAG，业务模块下一轮再迁
 *
 * 公共类型，独立成文件以便客户模块只 import 类型不引入实现。
 */

/**
 * LLM 功能枚举 — 与配额表 (`usage_quota.feature`) 对齐
 *
 * 当前主要消费者：
 *   - FoodText / FoodImage：食物分析系统（同步 + 异步队列）
 *   - FoodEnrichment：食物库补全系统（内部 cron / job）
 *   - CoachChat / RecipeGeneration：辅助功能
 *
 * 新增 feature 时需要：
 *   1. 在此处加常量
 *   2. 在 UsageQuotaService.DEFAULT_QUOTA 中给出默认上限
 */
export enum LlmFeature {
  /** 食物文本分析（同步路径） */
  FoodText = 'food.text',
  /** 食物图片分析（异步队列路径） */
  FoodImage = 'food.image',
  /** 食物库 enrichment（系统级补全任务，不计用户配额） */
  FoodEnrichment = 'food.enrichment',
  /** 教练对话 */
  CoachChat = 'coach.chat',
  /** 食谱生成 */
  RecipeGeneration = 'recipe.generation',
}

/** Provider 标识 — 写入 UsageRecords.provider，与 capability-router 解析结果一致 */
export type LlmProvider =
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'anthropic'
  | 'qwen'
  | string; // 允许自定义 provider，避免新增 provider 时强行改类型

/**
 * 内容块（多模态），与 OpenAI Chat Completions 的 content 数组兼容。
 *
 * 仅 user 消息会用到 image_url；system/assistant 仍只能传字符串。
 * 当 content 为字符串时为纯文本消息（最常见路径）。
 */
export type LlmContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: {
        /** http(s):// 或 data:image/...;base64,... */
        url: string;
        /** OpenAI vision detail 提示，默认由 provider 决定 */
        detail?: 'auto' | 'low' | 'high';
      };
    };

/** 单条消息（与 LangChain `BaseMessage` 兼容的最小子集） */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  /**
   * 字符串：纯文本消息
   * 数组：多模态（仅 user 角色应使用）
   */
  content: string | LlmContentBlock[];
}

/** Token 用量 */
export interface LlmTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** chat / chatViaRouter 公共选项 */
export interface LlmChatOptionsBase {
  /** 业务功能标识，用于配额、断路器命名、metric 标签 */
  feature: LlmFeature;
  /** 用户 ID（扣配额）；为空时不扣配额，仅做 client/系统调用 */
  userId?: string;
  /** 客户端 ID（B2B 网关客户端）；走 capability-router 时必填 */
  clientId?: string;
  /** 请求追踪 ID；不传则随机生成 */
  requestId?: string;
  /** 单次调用超时（ms）；默认 30000 */
  timeoutMs?: number;
  /** 取消前最大重试，BullMQ 路径请勿在此重试，交给队列处理 */
  // 注：本服务自身不做重试，重试策略由调用方（队列 / fallback 链）决定
  /** 透传 LangChain ChatModel 的额外参数 */
  temperature?: number;
  maxTokens?: number;
}

/** 直连模式 chat 选项（业务模块直接指定 provider/key/model） */
export interface LlmDirectChatOptions extends LlmChatOptionsBase {
  provider: LlmProvider;
  /** API Key（敏感，禁止落日志） */
  apiKey: string;
  /** API Base URL，例如 https://openrouter.ai/api/v1 */
  baseUrl?: string;
  /** 模型名 */
  model: string;
  /** 消息体 */
  messages: LlmMessage[];
  /**
   * 透传到 OpenAI 兼容 API 的 response_format。
   * 例如 { type: 'json_object' } 强制 JSON 模式。
   */
  responseFormat?: { type: 'json_object' | 'text' };
  /**
   * 透传额外 HTTP headers（例如 OpenRouter 要求的 HTTP-Referer / X-Title）。
   * 仅在 chatStream 路径生效；非流式路径走 LangChain SDK，无法塞 headers，
   * 调用方如需 OpenRouter 归因可改用 chatStream，或忽略此字段。
   */
  extraHeaders?: Record<string, string>;
}

export interface LlmChatResult {
  content: string;
  provider: LlmProvider;
  model: string;
  usage: LlmTokenUsage;
  costUsd: number;
  latencyMs: number;
  /** 透传原始 response_metadata（调试用，生产慎用） */
  metadata?: Record<string, unknown>;
}

/**
 * 流式增量块。
 * - delta：本次 token 增量（可能为空字符串，调用方应自行容错）
 * - done：true 表示流结束，此时 usage 才会被填充（部分 provider 才有）
 */
export interface LlmStreamChunk {
  delta: string;
  done: boolean;
  usage?: LlmTokenUsage;
}

/** 抛出此错误时表示用户配额耗尽，HTTP 层应返回 429 */
export class LlmQuotaExceededError extends Error {
  constructor(
    public readonly userId: string,
    public readonly feature: LlmFeature,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(
      `Quota exceeded for user ${userId} on feature ${feature}: ${used}/${limit}`,
    );
    this.name = 'LlmQuotaExceededError';
  }
}

/** Circuit breaker 打开时抛出，HTTP 层应返回 503 */
export class LlmUnavailableError extends Error {
  constructor(
    public readonly feature: LlmFeature,
    cause?: unknown,
  ) {
    super(
      `LLM service unavailable for ${feature}${cause ? `: ${(cause as Error).message ?? cause}` : ''}`,
    );
    this.name = 'LlmUnavailableError';
  }
}
