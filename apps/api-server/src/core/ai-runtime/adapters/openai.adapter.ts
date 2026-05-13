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
 * OpenAI 适配器
 * 支持 GPT-3.5, GPT-4, DALL-E 等模型
 */
@Injectable()
export class OpenAIAdapter extends BaseCapabilityAdapter {
  readonly provider = 'openai';
  readonly defaultModel = 'gpt-3.5-turbo';

  private readonly logger = new Logger(OpenAIAdapter.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  // 定价表 (USD per 1K tokens)
  private readonly pricing = {
    'gpt-3.5-turbo': {
      input: 0.0005,
      output: 0.0015,
    },
    'gpt-3.5-turbo-16k': {
      input: 0.003,
      output: 0.004,
    },
    'gpt-4': {
      input: 0.03,
      output: 0.06,
    },
    'gpt-4-32k': {
      input: 0.06,
      output: 0.12,
    },
    'gpt-4-turbo': {
      input: 0.01,
      output: 0.03,
    },
    'gpt-4o': {
      input: 0.005,
      output: 0.015,
    },
    'gpt-4o-mini': {
      input: 0.00015,
      output: 0.0006,
    },
  };

  constructor(private readonly configService: ConfigService) {
    super();

    this.apiKey = this.configService.get<string>('OPENAI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn(
        'OPENAI_API_KEY not configured. OpenAI adapter will not work.',
      );
    }

    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60秒超时
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
      // 使用 OpenAI 标准的 messages 格式
      messages = request.messages;
    } else if (request.prompt) {
      // 兼容旧的 prompt 格式，转换为 messages
      messages = [{ role: 'user', content: request.prompt }];
    } else {
      throw new Error('请提供 messages 或 prompt 参数');
    }

    try {
      this.logger.debug(
        `Generating text with OpenAI model: ${model}, messages count: ${messages.length}`,
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
        },
      };
    } catch (error) {
      this.logger.error(
        `OpenAI generateText error: ${error.message}`,
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
        `Generating text stream with OpenAI model: ${model}, messages count: ${messages.length}`,
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

                  // 尝试提取 token 使用情况（如果有）
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
            `OpenAI stream error: ${error.message}`,
            error.stack,
          );
          subscriber.error(this.handleError(error));
        });
    });
  }

  /**
   * 图像生成
   */
  async generateImage(
    request: GenerateImageRequest,
  ): Promise<GenerateImageResponse> {
    this.validateRequest(request);

    const model = request.model || 'dall-e-3';

    try {
      this.logger.debug(
        `Generating image with OpenAI model: ${model}, prompt: ${request.prompt}`,
      );

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
        model: response.data.model || model,
        metadata: {
          created: response.data.created,
        },
      };
    } catch (error) {
      this.logger.error(
        `OpenAI generateImage error: ${error.message}`,
        error.stack,
      );
      this.handleError(error);
    }
  }

  /**
   * 计算成本
   */
  calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number {
    // 默认使用 gpt-3.5-turbo 的定价
    const modelPricing =
      this.pricing['gpt-3.5-turbo'] || this.pricing['gpt-3.5-turbo'];

    const inputCost = (usage.promptTokens / 1000) * modelPricing.input;
    const outputCost = (usage.completionTokens / 1000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 根据模型计算成本
   */
  calculateCostForModel(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): number {
    const modelPricing = this.pricing[model] || this.pricing['gpt-3.5-turbo'];

    const inputCost = (usage.promptTokens / 1000) * modelPricing.input;
    const outputCost = (usage.completionTokens / 1000) * modelPricing.output;

    return inputCost + outputCost;
  }
}
