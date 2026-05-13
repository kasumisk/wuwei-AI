import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import axios, { AxiosInstance } from 'axios';
import {
  BaseCapabilityAdapter,
  GenerateTextRequest,
  GenerateTextResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  StreamChunk,
} from './base.adapter';

/**
 * 阿里云通义千问（Qwen）适配器
 * 支持 Qwen-Plus、Qwen-Max、Qwen-Turbo 等模型
 * API 文档: https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api
 */
@Injectable()
export class QwenAdapter extends BaseCapabilityAdapter {
  readonly provider = 'qwen';
  readonly defaultModel = 'qwen-plus';

  private readonly logger = new Logger(QwenAdapter.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  // 定价表 (CNY) - 2025年价格
  private readonly pricing = {
    // 文本模型 (per 1M tokens)
    'qwen-max': {
      input: 0.04, // ¥40/M tokens
      output: 0.12, // ¥120/M tokens
    },
    'qwen-plus': {
      input: 0.004, // ¥4/M tokens
      output: 0.012, // ¥12/M tokens
    },
    'qwen-turbo': {
      input: 0.003, // ¥3/M tokens
      output: 0.006, // ¥6/M tokens
    },
    'qwen-long': {
      input: 0.0005, // ¥0.5/M tokens
      output: 0.002, // ¥2/M tokens
    },
    'qwen2.5-72b-instruct': {
      input: 0.004, // ¥4/M tokens
      output: 0.004, // ¥4/M tokens
    },
    'qwen2.5-32b-instruct': {
      input: 0.0035, // ¥3.5/M tokens
      output: 0.0035, // ¥3.5/M tokens
    },
    'qwen2.5-14b-instruct': {
      input: 0.003, // ¥3/M tokens
      output: 0.003, // ¥3/M tokens
    },
    'qwen2.5-7b-instruct': {
      input: 0.002, // ¥2/M tokens
      output: 0.002, // ¥2/M tokens
    },
    // 图像生成模型 (per image)
    'wanx-v1': {
      perImage: 0.08, // ¥0.08/张 (1024x1024)
    },
    'wanx-sketch-to-image-v1': {
      perImage: 0.08, // ¥0.08/张 (线稿生图)
    },
    'wanx-background-generation-v2': {
      perImage: 0.08, // ¥0.08/张 (背景生成)
    },
  };

  constructor(configService: ConfigService) {
    super();
    this.apiKey = configService.get<string>('QWEN_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn('QWEN_API_KEY not configured');
    }

    // 使用 OpenAI 兼容接口
    this.client = axios.create({
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 120000, // 120 秒超时
    });

    this.logger.log('Qwen adapter initialized');
  }

  /**
   * 同步文本生成
   */
  async generateText(
    request: GenerateTextRequest,
  ): Promise<GenerateTextResponse> {
    const startTime = Date.now();

    try {
      this.logger.debug(
        `Generating text with model: ${request.model || this.defaultModel}`,
      );

      const response = await this.client.post('/chat/completions', {
        model: request.model || this.defaultModel,
        messages: [
          {
            role: 'user',
            content: request.prompt,
          },
        ],
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
        // Qwen 特有参数
        enable_search: false, // 是否启用联网搜索
      });

      const data = response.data;
      const choice = data.choices[0];

      const result: GenerateTextResponse = {
        text: choice.message.content,
        model: data.model,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        finishReason: choice.finish_reason,
        metadata: {
          id: data.id,
          created: data.created,
          latency: Date.now() - startTime,
        },
      };

      this.logger.debug(
        `Text generation completed in ${Date.now() - startTime}ms`,
      );

      return result;
    } catch (error) {
      this.logger.error(`Qwen API error: ${error.message}`, error.stack);

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;

        // Qwen 特定错误处理
        if (status === 401) {
          throw new Error('Qwen API Key 无效或未配置');
        } else if (status === 429) {
          throw new Error('Qwen API 请求频率超限，请稍后重试');
        } else if (status === 400) {
          throw new Error(
            `Qwen API 请求参数错误: ${errorData?.message || error.message}`,
          );
        }

        throw new Error(
          `Qwen API 调用失败 (${status}): ${errorData?.message || error.message}`,
        );
      }

      throw error;
    }
  }

  /**
   * 流式文本生成
   */
  generateTextStream(request: GenerateTextRequest): Observable<StreamChunk> {
    return new Observable((subscriber) => {
      this.logger.debug(
        `Starting stream with model: ${request.model || this.defaultModel}`,
      );

      this.client
        .post(
          '/chat/completions',
          {
            model: request.model || this.defaultModel,
            messages: [
              {
                role: 'user',
                content: request.prompt,
              },
            ],
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens,
            top_p: request.topP,
            stream: true,
            stream_options: {
              include_usage: true, // 在最后一个 chunk 返回 token 使用情况
            },
          },
          {
            responseType: 'stream',
          },
        )
        .then((response) => {
          let buffer = '';
          const totalTokens = {
            prompt: 0,
            completion: 0,
          };

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

                  // 处理内容增量
                  if (data.choices?.[0]?.delta?.content) {
                    subscriber.next({
                      delta: data.choices[0].delta.content,
                      done: false,
                    });
                  }

                  // 提取 token 使用情况（在最后一个 chunk 中）
                  if (data.usage) {
                    totalTokens.prompt = data.usage.prompt_tokens || 0;
                    totalTokens.completion = data.usage.completion_tokens || 0;
                  }

                  // 处理结束标志
                  if (data.choices?.[0]?.finish_reason) {
                    subscriber.next({
                      delta: '',
                      done: true,
                      finishReason: data.choices[0].finish_reason,
                      model: data.model,
                      usage: {
                        promptTokens: totalTokens.prompt,
                        completionTokens: totalTokens.completion,
                        totalTokens:
                          totalTokens.prompt + totalTokens.completion,
                      },
                    });
                  }
                } catch (parseError) {
                  this.logger.error(
                    `Failed to parse SSE data: ${parseError.message}`,
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
          this.logger.error(`Stream request failed: ${error.message}`);

          if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const errorData = error.response?.data;

            if (status === 401) {
              subscriber.error(new Error('Qwen API Key 无效或未配置'));
            } else if (status === 429) {
              subscriber.error(new Error('Qwen API 请求频率超限，请稍后重试'));
            } else {
              subscriber.error(
                new Error(
                  `Qwen API 调用失败: ${errorData?.message || error.message}`,
                ),
              );
            }
          } else {
            subscriber.error(error);
          }
        });
    });
  }

  /**
   * 计算成本（人民币）
   */
  calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number {
    const model = this.defaultModel;
    const modelPricing = this.pricing[model] || this.pricing['qwen-plus'];

    const inputCost = (usage.promptTokens / 1_000_000) * modelPricing.input;
    const outputCost =
      (usage.completionTokens / 1_000_000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 计算指定模型的成本
   */
  calculateCostForModel(
    model: string,
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ): number {
    const modelPricing = this.pricing[model] || this.pricing['qwen-plus'];

    const inputCost = (usage.promptTokens / 1_000_000) * modelPricing.input;
    const outputCost =
      (usage.completionTokens / 1_000_000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * 图像生成
   * 使用通义万相 (Wanx) 图像生成 API
   * API 文档: https://help.aliyun.com/zh/model-studio/developer-reference/wanx-image-generation
   */
  async generateImage(
    request: GenerateImageRequest,
  ): Promise<GenerateImageResponse> {
    const startTime = Date.now();
    const model = request.model || 'wanx-v1';

    try {
      this.logger.debug(
        `Generating image with Wanx model: ${model}, prompt: ${request.prompt}`,
      );

      // 通义万相使用不同的 API endpoint
      const imageClient = axios.create({
        baseURL: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
        headers: {
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable', // 异步模式
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 60000,
      });

      // 解析图片尺寸
      const size = request.size || '1024*1024';
      const [width, height] = size.includes('x')
        ? size.split('x')
        : size.split('*');

      // 第一步：提交图像生成任务
      const taskResponse = await imageClient.post('/text2image/generation', {
        model: model,
        input: {
          prompt: request.prompt,
        },
        parameters: {
          size: `${width}*${height}`,
          n: request.n || 1,
          // seed: request.seed, // 可选：固定种子以生成可重复的图像
        },
      });

      const taskId = taskResponse.data.output?.task_id;
      if (!taskId) {
        throw new Error('Failed to get task ID from Wanx API');
      }

      this.logger.debug(`Image generation task created: ${taskId}`);

      // 第二步：轮询任务状态直到完成
      let attempts = 0;
      const maxAttempts = 60; // 最多等待 60 秒
      let taskResult: any;

      while (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 等待 1 秒

        const statusResponse = await imageClient.get(
          `/text2image/generation/${taskId}`,
        );

        const taskStatus = statusResponse.data.output?.task_status;
        this.logger.debug(`Task ${taskId} status: ${taskStatus}`);

        if (taskStatus === 'SUCCEEDED') {
          taskResult = statusResponse.data;
          break;
        } else if (taskStatus === 'FAILED') {
          throw new Error(
            `Image generation failed: ${statusResponse.data.output?.message || 'Unknown error'}`,
          );
        }

        attempts++;
      }

      if (!taskResult) {
        throw new Error('Image generation timeout after 60 seconds');
      }

      // 提取图像 URL
      const images = taskResult.output.results.map((result: any) => ({
        url: result.url,
      }));

      const response: GenerateImageResponse = {
        images,
        model: model,
        metadata: {
          taskId,
          created: Date.now(),
          latency: Date.now() - startTime,
        },
      };

      this.logger.debug(
        `Image generation completed in ${Date.now() - startTime}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Wanx image generation error: ${error.message}`,
        error.stack,
      );

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;

        if (status === 401) {
          throw new Error('Qwen API Key 无效或未配置');
        } else if (status === 429) {
          throw new Error('Wanx API 请求频率超限，请稍后重试');
        } else if (status === 400) {
          throw new Error(
            `Wanx API 请求参数错误: ${errorData?.message || error.message}`,
          );
        }

        throw new Error(
          `Wanx API 调用失败 (${status}): ${errorData?.message || error.message}`,
        );
      }

      throw error;
    }
  }

  /**
   * 计算图像生成成本
   */
  calculateImageCost(model: string, imageCount: number): number {
    const modelPricing = this.pricing[model] || this.pricing['wanx-v1'];
    if (modelPricing.perImage) {
      return modelPricing.perImage * imageCount;
    }
    return 0;
  }
}
