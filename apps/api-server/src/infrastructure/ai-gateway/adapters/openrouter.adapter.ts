import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import axios, { AxiosInstance } from 'axios';
import {
  BaseAdapter,
  GenerateTextRequest,
  GenerateTextResponse,
  StreamChunk,
} from './base.adapter';

@Injectable()
export class OpenRouterAdapter extends BaseAdapter {
  readonly provider = 'openrouter';
  readonly defaultModel = 'openai/gpt-4o';

  private readonly logger = new Logger(OpenRouterAdapter.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;

  private readonly pricing: Record<string, { input: number; output: number }> = {
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
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY not configured.');
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

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    this.validateRequest(request);
    const model = request.model || this.defaultModel;

    const messages = request.messages?.length
      ? request.messages
      : [{ role: 'user' as const, content: request.prompt || '' }];

    try {
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
        metadata: { id: response.data.id, provider: response.data.provider },
      };
    } catch (error) {
      this.logger.error(`OpenRouter generateText error: ${error.message}`);
      this.handleError(error);
    }
  }

  generateTextStream(request: GenerateTextRequest): Observable<StreamChunk> {
    this.validateRequest(request);
    return new Observable((subscriber) => {
      const model = request.model || this.defaultModel;
      const messages = request.messages?.length
        ? request.messages
        : [{ role: 'user' as const, content: request.prompt || '' }];

      this.client
        .post(
          '/chat/completions',
          {
            model,
            messages,
            temperature: request.temperature ?? 0.7,
            max_tokens: request.maxTokens,
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
              if (line.trim() === '' || line.trim() === 'data: [DONE]') {
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
                }
                continue;
              }
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices?.[0]?.delta?.content) {
                    subscriber.next({ delta: data.choices[0].delta.content, done: false });
                  }
                  if (data.usage) {
                    totalTokens.prompt = data.usage.prompt_tokens || 0;
                    totalTokens.completion = data.usage.completion_tokens || 0;
                  }
                } catch {
                  // skip parse errors
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

          response.data.on('error', (err: Error) => subscriber.error(err));
        })
        .catch((error) => subscriber.error(error));
    });
  }

  calculateCost(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): number {
    const p = this.pricing[this.defaultModel];
    return (usage.promptTokens / 1_000_000) * p.input + (usage.completionTokens / 1_000_000) * p.output;
  }

  calculateCostForModel(
    model: string,
    usage: { promptTokens: number; completionTokens: number },
  ): number {
    const p = this.pricing[model] || this.pricing[this.defaultModel];
    return (usage.promptTokens / 1_000_000) * p.input + (usage.completionTokens / 1_000_000) * p.output;
  }
}
