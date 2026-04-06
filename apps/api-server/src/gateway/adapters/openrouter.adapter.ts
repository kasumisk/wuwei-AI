import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import axios, { AxiosInstance } from 'axios';
import {
  BaseCapabilityAdapter,
  GenerateTextRequest,
  GenerateTextResponse,
  StreamChunk,
  GenerateImageRequest,
  GenerateImageResponse,
} from './base.adapter';

/**
 * OpenRouter 适配器
 * 通过 OpenRouter 统一代理访问 GPT-4o, Claude, Llama 等模型
 * API 文档: https://openrouter.ai/docs
 */
@Injectable()
export class OpenRouterAdapter extends BaseCapabilityAdapter {
  readonly provider = 'openrouter';
  readonly defaultModel = 'openai/gpt-4o';

  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  // OpenRouter 定价表（USD per 1M tokens）
  private readonly pricing: Record<
    string,
    { input: number; output: number }
  > = {
    'openai/gpt-4o': { input: 2.5, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
    'openai/gpt-4.1': { input: 2, output: 8 },
    'openai/gpt-4.1-mini': { input: 0.4, output: 1.6 },
    'openai/gpt-4.1-nano': { input: 0.1, output: 0.4 },
    'anthropic/claude-sonnet-4': { input: 3, output: 15 },
    'anthropic/claude-3.5-haiku': { input: 0.8, output: 4 },
    'google/gemini-2.5-pro-preview': { input: 1.25, output: 10 },
    'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.6 },
    'meta-llama/llama-4-maverick': { input: 0.2, output: 0.6 },
    'deepseek/deepseek-chat-v3': { input: 0.3, output: 0.8 },
  };

  constructor(private readonly configService: ConfigService) {
    super();

    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY not configured. OpenRouter adapter will not work.',
      );
    } else {
      this.logger.log('OpenRouter adapter initialized');
    }

    this.client = axios.create({
      baseURL: 'https://openrouter.ai/api/v1',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://uway.dev-net.uk',
        'X-Title': 'Wuwei Health',
      },
      timeout: 60000,
    });
  }

  /**
   * 文本生成（同步）— 兼容 OpenAI Chat Completions 格式
   */
  async generateText(
    request: GenerateTextRequest,
  ): Promise<GenerateTextResponse> {
    this.validateRequest(request);

    const model = request.model || this.defaultModel;

    let messages: Array<{ role: string; content: any }>;
    if (request.messages && request.messages.length > 0) {
      messages = request.messages;
    } else if (request.prompt) {
      messages = [{ role: 'user', content: request.prompt }];
    } else {
      throw new Error('请提供 messages 或 prompt 参数');
    }

    try {
      this.logger.debug(
        `OpenRouter text generation: model=${model}, messages=${messages.length}`,
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
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
        },
        metadata: {
          id: response.data.id,
          created: response.data.created,
          provider: response.data.provider,
        },
      };
    } catch (error) {
      this.logger.error(
        `OpenRouter generateText error: ${error.message}`,
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

      let messages: Array<{ role: string; content: any }>;
      if (request.messages && request.messages.length > 0) {
        messages = request.messages;
      } else if (request.prompt) {
        messages = [{ role: 'user', content: request.prompt }];
      } else {
        subscriber.error(new Error('请提供 messages 或 prompt 参数'));
        return;
      }

      this.logger.debug(
        `OpenRouter stream: model=${model}, messages=${messages.length}`,
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
          { responseType: 'stream' },
        )
        .then((response) => {
          let buffer = '';
          const totalTokens = { prompt: 0, completion: 0 };

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
                    totalTokens:
                      totalTokens.prompt + totalTokens.completion,
                  },
                });
                subscriber.complete();
                return;
              }

              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.delta?.content) {
                    subscriber.next({
                      delta: data.choices[0].delta.content,
                      done: false,
                    });
                  }
                  if (data.usage) {
                    totalTokens.prompt =
                      data.usage.prompt_tokens || 0;
                    totalTokens.completion =
                      data.usage.completion_tokens || 0;
                  }
                } catch {
                  this.logger.warn(
                    `Failed to parse SSE data: ${line}`,
                  );
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
                  totalTokens:
                    totalTokens.prompt + totalTokens.completion,
                },
              });
              subscriber.complete();
            }
          });

          response.data.on('error', (err: Error) => {
            this.logger.error(
              `OpenRouter stream error: ${err.message}`,
            );
            subscriber.error(err);
          });
        })
        .catch((error) => {
          this.logger.error(
            `OpenRouter stream request error: ${error.message}`,
          );
          subscriber.error(error);
        });
    });
  }

  /**
   * 图像生成（通过 OpenRouter 转发 DALL-E）
   */
  async generateImage(
    request: GenerateImageRequest,
  ): Promise<GenerateImageResponse> {
    this.validateRequest(request);

    const model = request.model || 'openai/dall-e-3';

    try {
      const response = await this.client.post('/images/generations', {
        model,
        prompt: request.prompt,
        size: request.size || '1024x1024',
        quality: request.quality || 'standard',
        n: request.n || 1,
      });

      return {
        images: response.data.data.map((img: any) => ({
          url: img.url,
          b64Json: img.b64_json,
        })),
        model,
        revisedPrompt: response.data.data[0]?.revised_prompt,
      };
    } catch (error) {
      this.logger.error(
        `OpenRouter image generation error: ${error.message}`,
      );
      this.handleError(error);
    }
  }

  /**
   * 计算成本（USD per 1M tokens 定价）
   */
  calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number {
    const defaultPricing = this.pricing[this.defaultModel];
    return (
      (usage.promptTokens / 1_000_000) * defaultPricing.input +
      (usage.completionTokens / 1_000_000) * defaultPricing.output
    );
  }

  /**
   * 指定模型计算成本
   */
  calculateCostForModel(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
    },
  ): number {
    const p = this.pricing[model] || this.pricing[this.defaultModel];
    return (
      (usage.promptTokens / 1_000_000) * p.input +
      (usage.completionTokens / 1_000_000) * p.output
    );
  }
}
