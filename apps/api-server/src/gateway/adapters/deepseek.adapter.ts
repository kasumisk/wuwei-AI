import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import axios, { AxiosInstance } from 'axios';
import {
  BaseCapabilityAdapter,
  GenerateTextRequest,
  GenerateTextResponse,
  StreamChunk,
} from './base.adapter';

/**
 * DeepSeek 适配器
 * 支持 DeepSeek-V3.2-Exp 模型（deepseek-chat 和 deepseek-reasoner）
 * API 完全兼容 OpenAI 格式
 */
@Injectable()
export class DeepSeekAdapter extends BaseCapabilityAdapter {
  readonly provider = 'deepseek';
  readonly defaultModel = 'deepseek-chat';

  private readonly logger = new Logger(DeepSeekAdapter.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  // 定价表 (USD per 1M tokens)
  private readonly pricing = {
    'deepseek-chat': {
      input: 0.28, // 缓存未命中
      inputCacheHit: 0.028, // 缓存命中
      output: 0.42,
    },
    'deepseek-reasoner': {
      input: 0.28,
      inputCacheHit: 0.028,
      output: 0.42,
    },
  };

  constructor(private readonly configService: ConfigService) {
    super();

    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn(
        'DEEPSEEK_API_KEY not configured. DeepSeek adapter will not work.',
      );
    }

    // DeepSeek API 使用与 OpenAI 兼容的格式
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000, // 120秒超时（思考模式可能需要更长时间）
    });
  }

  /**
   * 文本生成（同步）
   */
  async generateText(
    request: GenerateTextRequest,
  ): Promise<GenerateTextResponse> {
    this.validateRequest(request);

    const model = request.model || this.defaultModel;

    // 处理 messages 或 prompt 格式
    let messages: Array<{ role: string; content: string }>;
    if (request.messages && request.messages.length > 0) {
      messages = request.messages;
    } else if (request.prompt) {
      messages = [{ role: 'user', content: request.prompt }];
    } else {
      throw new Error('请提供 messages 或 prompt 参数');
    }

    try {
      this.logger.debug(
        `Generating text with DeepSeek model: ${model}, messages count: ${messages.length}`,
      );

      const response = await this.client.post('/chat/completions', {
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stop,
        stream: false,
      });

      const choice = response.data.choices[0];
      const usage = response.data.usage;

      return {
        text: choice.message.content,
        model: response.data.model,
        finishReason: choice.finish_reason,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        metadata: {
          id: response.data.id,
          created: response.data.created,
          // DeepSeek 特有的缓存信息（如果有）
          promptCacheHitTokens: usage.prompt_cache_hit_tokens || 0,
          promptCacheMissTokens: usage.prompt_cache_miss_tokens || 0,
        },
      };
    } catch (error) {
      this.logger.error(
        `DeepSeek generateText error: ${error.message}`,
        error.stack,
      );
      this.handleError(error);
    }
  }

  /**
   * 文本生成（流式）
   */
  generateTextStream(request: GenerateTextRequest): Observable<StreamChunk> {
    this.validateRequest(request);

    return new Observable((subscriber) => {
      const model = request.model || this.defaultModel;

      // 处理 messages 或 prompt 格式
      let messages: Array<{ role: string; content: string }>;
      if (request.messages && request.messages.length > 0) {
        messages = request.messages;
      } else if (request.prompt) {
        messages = [{ role: 'user', content: request.prompt }];
      } else {
        subscriber.error(new Error('请提供 messages 或 prompt 参数'));
        return;
      }

      this.logger.debug(
        `Generating text stream with DeepSeek model: ${model}, messages count: ${messages.length}`,
      );

      this.client
        .post(
          '/chat/completions',
          {
            model,
            messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens,
            top_p: request.topP,
            frequency_penalty: request.frequencyPenalty,
            presence_penalty: request.presencePenalty,
            stop: request.stop,
            stream: true,
          },
          {
            responseType: 'stream',
          },
        )
        .then((response) => {
          let buffer = '';
          let totalTokens = { prompt: 0, completion: 0 };

          response.data.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim() === '') continue;
              if (line.trim() === 'data: [DONE]') {
                subscriber.next({
                  delta: '',
                  done: true,
                  finishReason: 'stop',
                  usage: {
                    promptTokens: totalTokens.prompt,
                    completionTokens: totalTokens.completion,
                    totalTokens: totalTokens.prompt + totalTokens.completion,
                  },
                });
                subscriber.complete();
                return;
              }

              if (line.startsWith('data: ')) {
                try {
                  const jsonStr = line.slice(6);
                  const data = JSON.parse(jsonStr);

                  if (data.choices?.[0]?.delta?.content) {
                    subscriber.next({
                      delta: data.choices[0].delta.content,
                      done: false,
                    });
                  }

                  // 提取 token 使用情况
                  if (data.usage) {
                    totalTokens = {
                      prompt: data.usage.prompt_tokens || 0,
                      completion: data.usage.completion_tokens || 0,
                    };
                  }
                } catch (e) {
                  this.logger.warn(`Failed to parse SSE data: ${line}`);
                }
              }
            }
          });

          response.data.on('end', () => {
            if (!subscriber.closed) {
              subscriber.next({
                delta: '',
                done: true,
                finishReason: 'stop',
                usage: {
                  promptTokens: totalTokens.prompt,
                  completionTokens: totalTokens.completion,
                  totalTokens: totalTokens.prompt + totalTokens.completion,
                },
              });
              subscriber.complete();
            }
          });

          response.data.on('error', (error: Error) => {
            this.logger.error(`Stream error: ${error.message}`, error.stack);
            subscriber.error(error);
          });
        })
        .catch((error) => {
          this.logger.error(
            `DeepSeek stream error: ${error.message}`,
            error.stack,
          );
          try {
            this.handleError(error);
          } catch (e) {
            subscriber.error(e);
          }
        });
    });
  }

  /**
   * 计算成本
   * 注意：DeepSeek 有缓存命中和未命中两种定价
   * 这里保守估计使用缓存未命中的价格
   */
  calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number {
    const modelPricing =
      this.pricing['deepseek-chat'] || this.pricing['deepseek-chat'];

    // 使用缓存未命中的价格（保守估计）
    const inputCost = (usage.promptTokens / 1000000) * modelPricing.input;
    const outputCost = (usage.completionTokens / 1000000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 根据模型计算成本（与 OpenAI 适配器接口一致）
   */
  calculateCostForModel(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): number {
    const modelPricing = this.pricing[model] || this.pricing['deepseek-chat'];

    // 使用缓存未命中的价格（保守估计）
    const inputCost = (usage.promptTokens / 1000000) * modelPricing.input;
    const outputCost = (usage.completionTokens / 1000000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 根据模型和缓存信息计算精确成本
   */
  calculateCostWithCache(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
    cacheInfo?: {
      promptCacheHitTokens?: number;
      promptCacheMissTokens?: number;
    },
  ): number {
    const modelPricing = this.pricing[model] || this.pricing['deepseek-chat'];

    let inputCost = 0;

    // 如果有缓存信息，使用精确计费
    if (
      cacheInfo &&
      (cacheInfo.promptCacheHitTokens || cacheInfo.promptCacheMissTokens)
    ) {
      const cacheHitCost =
        ((cacheInfo.promptCacheHitTokens || 0) / 1000000) *
        modelPricing.inputCacheHit;
      const cacheMissCost =
        ((cacheInfo.promptCacheMissTokens || 0) / 1000000) * modelPricing.input;
      inputCost = cacheHitCost + cacheMissCost;
    } else {
      // 否则使用保守估计（全部按缓存未命中计费）
      inputCost = (usage.promptTokens / 1000000) * modelPricing.input;
    }

    const outputCost = (usage.completionTokens / 1000000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 获取模型信息
   */
  getModelInfo(model: string) {
    const isReasonerModel = model === 'deepseek-reasoner';

    return {
      model,
      version: 'DeepSeek-V3.2-Exp',
      mode: isReasonerModel ? 'Thinking Mode' : 'Non-thinking Mode',
      contextLength: 128000, // 128K
      maxOutput: isReasonerModel ? 64000 : 8000, // 64K for reasoner, 8K for chat
      defaultOutput: isReasonerModel ? 32000 : 4000,
      features: {
        jsonOutput: true,
        functionCalling: !isReasonerModel, // 仅 chat 模式支持
        prefixCompletion: true,
        fimCompletion: !isReasonerModel,
      },
      pricing: this.pricing[model] || this.pricing['deepseek-chat'],
    };
  }
}
