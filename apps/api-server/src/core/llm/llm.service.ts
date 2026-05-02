/**
 * LlmService — 统一 LLM 调用入口（V7 安全基线）
 *
 * 在每次外部 LLM 调用前后强制以下不可绕过的步骤：
 *   1. 配额预扣（如果传了 userId）—— 防个人滥用
 *   2. CircuitBreaker 包裹 —— 防 OpenAI / OpenRouter 抖动击穿
 *   3. 显式 timeout —— 防请求挂死耗 socket
 *   4. 失败时退还配额、记 metric 'failed'
 *   5. 成功后 fire-and-forget 落 UsageRecords + 更新 latency histogram
 *
 * 当前提供两种模式：
 *   - chat()       非流式直连（LangChain ChatOpenAI invoke）
 *   - chatStream() 流式直连（裸 fetch SSE，breaker 仅保护连接建立）
 *
 * 路由模式（基于 client_id 走 CapabilityRouter）暂不启用，待 B2B gateway
 * 业务上线时再实现 LlmRouterService。
 *
 * 公共契约：成功返回 LlmChatResult；失败抛业务可识别的 Error
 *   - LlmQuotaExceededError  → 调用方应映射 HTTP 429
 *   - LlmUnavailableError    → 调用方应映射 HTTP 503
 *   - 其它 Error             → 调用方应映射 HTTP 500
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatOpenAI } from '@langchain/openai';
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { MetricsService } from '../metrics/metrics.service';
import { UsageQuotaService } from './usage-quota.service';
import { UsageRecorderService } from './usage-recorder.service';
import {
  LlmChatResult,
  LlmContentBlock,
  LlmDirectChatOptions,
  LlmFeature,
  LlmMessage,
  LlmProvider,
  LlmStreamChunk,
  LlmTokenUsage,
  LlmUnavailableError,
} from './llm.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TEMPERATURE = 0.7;

/**
 * 直连模式默认费率（USD per 1k tokens）
 * 调用方未传 inputCost/outputCost 时使用，仅用于 cost 入账估算。
 * 实际生产建议把价格表外置到 model_configs 表 + 走路由模式。
 */
const FALLBACK_COST_USD_PER_1K: Record<
  string,
  { input: number; output: number }
> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  'claude-3-5-sonnet': { input: 0.003, output: 0.015 },
  'deepseek-chat': { input: 0.00014, output: 0.00028 },
};

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly metrics: MetricsService,
    private readonly quota: UsageQuotaService,
    private readonly recorder: UsageRecorderService,
  ) {}

  /**
   * 直连模式 chat —— 业务模块直接传入 provider/apiKey/baseUrl/model
   *
   * 适用场景：food/coach/recipe 等模块从 ENV 读 OPENROUTER_API_KEY 直接调用。
   */
  async chat(options: LlmDirectChatOptions): Promise<LlmChatResult> {
    return this.executeChat({
      messages: options.messages,
      feature: options.feature,
      userId: options.userId,
      clientId: options.clientId,
      requestId: options.requestId ?? randomUUID(),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.maxTokens,
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      responseFormat: options.responseFormat,
      extraHeaders: options.extraHeaders,
      // 直连模式从内置 fallback 表估算成本
      inputCostPer1k: FALLBACK_COST_USD_PER_1K[options.model]?.input ?? 0,
      outputCostPer1k: FALLBACK_COST_USD_PER_1K[options.model]?.output ?? 0,
    });
  }

  /**
   * 流式 chat —— 返回 AsyncIterable 逐 token 增量
   *
   * 与 chat() 的差异：
   *   - 内部走裸 fetch SSE（绕开 LangChain，避免 stream 与 breaker.fire 交互复杂）
   *   - CircuitBreaker 仅保护「连接建立 + headers 校验」一段
   *   - 配额预扣发生在 yield 第一个 chunk 之前；流过程中失败会退款
   *   - usage 通常仅在最后一个 chunk（done=true）时填充
   *
   * 调用方负责消费完整个 AsyncIterable；中途 break 也会触发 fetch 的
   * AbortController，但 quota 不会退款（已视为成功消费）。
   */
  chatStream(options: LlmDirectChatOptions): AsyncGenerator<LlmStreamChunk> {
    return this.executeStream({
      messages: options.messages,
      feature: options.feature,
      userId: options.userId,
      clientId: options.clientId,
      requestId: options.requestId ?? randomUUID(),
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: options.maxTokens,
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      responseFormat: options.responseFormat,
      extraHeaders: options.extraHeaders,
      inputCostPer1k: FALLBACK_COST_USD_PER_1K[options.model]?.input ?? 0,
      outputCostPer1k: FALLBACK_COST_USD_PER_1K[options.model]?.output ?? 0,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 内部统一执行路径
  // ─────────────────────────────────────────────────────────────────

  private async executeChat(ctx: ExecCtx): Promise<LlmChatResult> {
    // 1. 配额预扣（仅当 userId 存在）
    if (ctx.userId) {
      await this.quota.consume(ctx.userId, ctx.feature); // 抛 LlmQuotaExceededError
    }

    const start = Date.now();
    let quotaRefunded = false;
    const refundOnce = async () => {
      if (ctx.userId && !quotaRefunded) {
        quotaRefunded = true;
        await this.quota.refund(ctx.userId, ctx.feature);
      }
    };

    try {
      // 2. CircuitBreaker 包裹（按 feature 拆分，避免一个 feature 崩了影响别的）
      const breakerKey = `llm.${ctx.feature}`;
      const breaker = this.circuitBreaker.getBreaker(breakerKey, {
        timeout: ctx.timeoutMs,
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
        volumeThreshold: 10,
      });

      const aiMessage = (await breaker.fire(() =>
        this.invokeChatModel(ctx),
      )) as AIMessage;

      const latencyMs = Date.now() - start;
      const usage = this.extractUsage(aiMessage);
      const costUsd = this.computeCost(
        usage,
        ctx.inputCostPer1k,
        ctx.outputCostPer1k,
      );

      // 3. metrics
      this.metrics.recommendationStageDuration.observe(
        { stage: `llm.${ctx.feature}` },
        latencyMs / 1000,
      );

      // 4. 异步落 UsageRecords
      this.recorder.record({
        clientId: ctx.clientId ?? '',
        userId: ctx.userId,
        requestId: ctx.requestId,
        feature: ctx.feature,
        provider: ctx.provider,
        model: ctx.model,
        status: 'success',
        usage,
        costUsd,
        responseTimeMs: latencyMs,
      });

      return {
        content: this.extractContent(aiMessage),
        provider: ctx.provider,
        model: ctx.model,
        usage,
        costUsd,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const isTimeout = this.isTimeoutError(err);
      const status = isTimeout ? 'timeout' : 'failed';

      // 失败时退还配额（业务方通常不应为不可用付费）
      await refundOnce();

      // 落失败记录（fire & forget）
      this.recorder.record({
        clientId: ctx.clientId ?? '',
        userId: ctx.userId,
        requestId: ctx.requestId,
        feature: ctx.feature,
        provider: ctx.provider,
        model: ctx.model,
        status,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        costUsd: 0,
        responseTimeMs: latencyMs,
        metadata: {
          error: (err as Error).message ?? String(err),
        },
      });

      // CircuitBreaker open 或 timeout → 转为 LlmUnavailableError
      if (isTimeout || this.isBreakerOpen(err)) {
        throw new LlmUnavailableError(ctx.feature, err);
      }
      throw err;
    }
  }

  /** 真正的 LangChain 调用 —— 在 breaker.fire 里执行 */
  private async invokeChatModel(ctx: ExecCtx): Promise<AIMessage> {
    const modelKwargs: Record<string, unknown> = {};
    if (ctx.responseFormat) {
      modelKwargs.response_format = ctx.responseFormat;
    }

    const model = new ChatOpenAI({
      apiKey: ctx.apiKey,
      model: ctx.model,
      configuration: ctx.baseUrl ? { baseURL: ctx.baseUrl } : undefined,
      temperature: ctx.temperature,
      maxTokens: ctx.maxTokens,
      // 关键：不开 streaming，breaker.fire 需要 Promise 终结
      streaming: false,
      // LangChain 自带 timeout 作为兜底（breaker timeout 已生效）
      timeout: ctx.timeoutMs,
      modelKwargs: Object.keys(modelKwargs).length ? modelKwargs : undefined,
    });

    const lcMessages = ctx.messages.map(toLangChainMessage);
    const result = await model.invoke(lcMessages);
    return result as AIMessage;
  }

  // ─────────────────────────────────────────────────────────────────
  // 流式执行路径
  // ─────────────────────────────────────────────────────────────────

  private async *executeStream(ctx: ExecCtx): AsyncGenerator<LlmStreamChunk> {
    // 1. 配额预扣
    if (ctx.userId) {
      await this.quota.consume(ctx.userId, ctx.feature);
    }

    const start = Date.now();
    let quotaRefunded = false;
    const refundOnce = async () => {
      if (ctx.userId && !quotaRefunded) {
        quotaRefunded = true;
        await this.quota.refund(ctx.userId, ctx.feature);
      }
    };

    // 2. CircuitBreaker 仅保护「打开连接 + 200 校验」
    const breakerKey = `llm.${ctx.feature}`;
    const breaker = this.circuitBreaker.getBreaker(breakerKey, {
      timeout: ctx.timeoutMs,
      errorThresholdPercentage: 50,
      resetTimeout: 30_000,
      volumeThreshold: 10,
    });

    let response: Response;
    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      ctx.timeoutMs,
    );

    try {
      response = (await breaker.fire(() =>
        this.openStream(ctx, abortController.signal),
      )) as Response;
    } catch (err) {
      clearTimeout(timeoutHandle);
      await refundOnce();
      const isTimeout = this.isTimeoutError(err);
      this.recorder.record({
        clientId: ctx.clientId ?? '',
        userId: ctx.userId,
        requestId: ctx.requestId,
        feature: ctx.feature,
        provider: ctx.provider,
        model: ctx.model,
        status: isTimeout ? 'timeout' : 'failed',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        costUsd: 0,
        responseTimeMs: Date.now() - start,
        metadata: { error: (err as Error).message ?? String(err) },
      });
      if (isTimeout || this.isBreakerOpen(err)) {
        throw new LlmUnavailableError(ctx.feature, err);
      }
      throw err;
    }

    // 3. 消费 SSE 流
    const reader = response.body;
    if (!reader) {
      clearTimeout(timeoutHandle);
      await refundOnce();
      throw new LlmUnavailableError(ctx.feature, new Error('empty SSE body'));
    }

    let usage: LlmTokenUsage | undefined;
    let totalDeltaChars = 0;
    let buffer = '';
    let streamFailed = false;

    try {
      for await (const chunk of reader as AsyncIterable<Uint8Array | string>) {
        const text =
          typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        buffer += text;

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            yield { delta: '', done: true, usage };
            clearTimeout(timeoutHandle);
            this.recordSuccess(ctx, start, usage, totalDeltaChars);
            return;
          }
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
              };
            };
            const delta = json.choices?.[0]?.delta?.content ?? '';
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              };
            }
            if (delta) {
              totalDeltaChars += delta.length;
              yield { delta, done: false };
            }
          } catch {
            // 容错：单条 SSE 行解析失败不中断整个流
          }
        }
      }
      // 正常 EOF（未见 [DONE]）也视为成功结束
      yield { delta: '', done: true, usage };
      clearTimeout(timeoutHandle);
      this.recordSuccess(ctx, start, usage, totalDeltaChars);
    } catch (err) {
      streamFailed = true;
      clearTimeout(timeoutHandle);
      // 流中途失败：退款 + 记 failed
      await refundOnce();
      this.recorder.record({
        clientId: ctx.clientId ?? '',
        userId: ctx.userId,
        requestId: ctx.requestId,
        feature: ctx.feature,
        provider: ctx.provider,
        model: ctx.model,
        status: 'failed',
        usage: usage ?? {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        },
        costUsd: 0,
        responseTimeMs: Date.now() - start,
        metadata: {
          error: (err as Error).message,
          partialChars: totalDeltaChars,
        },
      });
      throw err;
    } finally {
      if (!streamFailed) clearTimeout(timeoutHandle);
    }
  }

  /** 打开 SSE 连接 + 校验 200；用于 breaker.fire */
  private async openStream(
    ctx: ExecCtx,
    signal: AbortSignal,
  ): Promise<Response> {
    const url = `${(ctx.baseUrl ?? '').replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: ctx.messages.map(toOpenAIMessage),
      temperature: ctx.temperature,
      stream: true,
    };
    if (ctx.maxTokens) body.max_tokens = ctx.maxTokens;
    if (ctx.responseFormat) body.response_format = ctx.responseFormat;
    // OpenAI: stream_options.include_usage = true 才会在结尾返回 usage
    body.stream_options = { include_usage: true };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.apiKey}`,
        ...(ctx.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`LLM upstream ${res.status}: ${errText.slice(0, 300)}`);
    }
    return res;
  }

  private recordSuccess(
    ctx: ExecCtx,
    start: number,
    usage: LlmTokenUsage | undefined,
    deltaChars: number,
  ): void {
    const latencyMs = Date.now() - start;
    const finalUsage: LlmTokenUsage = usage ?? {
      promptTokens: 0,
      // 没拿到 usage 时按字符数粗估（极不准，仅作为上限保险）
      completionTokens: Math.ceil(deltaChars / 4),
      totalTokens: Math.ceil(deltaChars / 4),
    };
    const costUsd = this.computeCost(
      finalUsage,
      ctx.inputCostPer1k,
      ctx.outputCostPer1k,
    );
    this.metrics.recommendationStageDuration.observe(
      { stage: `llm.${ctx.feature}.stream` },
      latencyMs / 1000,
    );
    this.recorder.record({
      clientId: ctx.clientId ?? '',
      userId: ctx.userId,
      requestId: ctx.requestId,
      feature: ctx.feature,
      provider: ctx.provider,
      model: ctx.model,
      status: 'success',
      usage: finalUsage,
      costUsd,
      responseTimeMs: latencyMs,
    });
  }

  // ─── helpers ───

  private extractContent(msg: AIMessage): string {
    if (typeof msg.content === 'string') return msg.content;
    // LangChain 0.3 content 可能是 ContentBlock[]，取 text 拼接
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((b: unknown) => {
          if (typeof b === 'string') return b;
          if (
            b &&
            typeof b === 'object' &&
            'text' in (b as Record<string, unknown>)
          ) {
            return String((b as { text: unknown }).text ?? '');
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  private extractUsage(msg: AIMessage): LlmTokenUsage {
    // LangChain 0.3：usage_metadata 是统一字段
    const u = (
      msg as unknown as {
        usage_metadata?: {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
        };
      }
    ).usage_metadata;
    if (u) {
      return {
        promptTokens: u.input_tokens ?? 0,
        completionTokens: u.output_tokens ?? 0,
        totalTokens:
          u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
      };
    }
    // 老路径兜底
    const meta = (
      msg as unknown as {
        response_metadata?: {
          tokenUsage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          };
        };
      }
    ).response_metadata;
    const t = meta?.tokenUsage;
    return {
      promptTokens: t?.promptTokens ?? 0,
      completionTokens: t?.completionTokens ?? 0,
      totalTokens: t?.totalTokens ?? 0,
    };
  }

  private computeCost(
    usage: LlmTokenUsage,
    inputPer1k: number,
    outputPer1k: number,
  ): number {
    if (!inputPer1k && !outputPer1k) return 0;
    const cost =
      (usage.promptTokens / 1000) * inputPer1k +
      (usage.completionTokens / 1000) * outputPer1k;
    // 保留 6 位小数（与 schema Decimal(10,6) 对齐）
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  private isTimeoutError(err: unknown): boolean {
    const msg = (err as Error)?.message?.toLowerCase() ?? '';
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      (err as { code?: string })?.code === 'ETIMEDOUT'
    );
  }

  private isBreakerOpen(err: unknown): boolean {
    const msg = (err as Error)?.message?.toLowerCase() ?? '';
    return msg.includes('breaker is open') || msg.includes('circuit breaker');
  }
}

interface ExecCtx {
  messages: LlmMessage[];
  feature: LlmFeature;
  userId?: string;
  clientId?: string;
  requestId: string;
  timeoutMs: number;
  temperature: number;
  maxTokens?: number;
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  responseFormat?: { type: 'json_object' | 'text' };
  extraHeaders?: Record<string, string>;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

/**
 * 转 LangChain BaseMessage（非流式路径）
 *
 * - system / assistant：仅接受字符串，多模态数组会被拼成纯文本兜底
 * - user：原生支持数组形式（HumanMessage 内部透传到 OpenAI content 数组）
 */
function toLangChainMessage(m: LlmMessage): BaseMessage {
  if (m.role === 'system') {
    return new SystemMessage(coerceToText(m.content));
  }
  if (m.role === 'assistant') {
    return new AIMessage(coerceToText(m.content));
  }
  // user：直接透传字符串或多模态数组
  if (typeof m.content === 'string') {
    return new HumanMessage(m.content);
  }
  // LangChain HumanMessage 接受 MessageContentComplex[]，结构与 OpenAI content
  // 块兼容（{type:'text',text} | {type:'image_url',image_url:{url,detail}}）
  return new HumanMessage({ content: m.content as never });
}

/** 转 OpenAI Chat Completions message（流式裸 fetch 路径） */
function toOpenAIMessage(m: LlmMessage): {
  role: 'system' | 'user' | 'assistant';
  content: string | LlmContentBlock[];
} {
  if (m.role !== 'user' && Array.isArray(m.content)) {
    // system/assistant 不应带多模态；安全降级到纯文本
    return { role: m.role, content: coerceToText(m.content) };
  }
  return { role: m.role, content: m.content };
}

/** 多模态数组 → 纯文本（仅取 text 块），用于 system/assistant 兜底 */
function coerceToText(content: string | LlmContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}
