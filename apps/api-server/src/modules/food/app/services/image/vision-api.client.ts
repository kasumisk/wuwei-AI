/**
 * Vision API 客户端 — OpenRouter 多模态 Chat Completions 包装
 *
 * 职责：
 *  - 统一 base URL / model / fallback model / 超时 / 鉴权头
 *  - 主模型遇 429 自动切换到 fallback 模型重试一次
 *  - 屏蔽具体 HTTP 细节，向上仅暴露 `complete()` 和向用户友好的 i18n 错误
 *
 * 不在本类内做：
 *  - prompt 构建（见 ImagePromptBuilder）
 *  - 响应解析（见 ImageResultParser）
 */
import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from '../../../../../core/i18n';
import type { Locale } from '../../../../diet/app/recommendation/utils/i18n-messages';
import { getUserMessage } from '../analysis-prompt-schema';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.3;

interface OpenRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
  model?: string;
  usage?: { total_tokens?: number };
}

@Injectable()
export class VisionApiClient {
  private readonly logger = new Logger(VisionApiClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fallbackModel: string;

  constructor(
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
  ) {
    this.apiKey =
      this.config.get<string>('OPENROUTER_API_KEY') ||
      this.config.get<string>('OPENAI_API_KEY') ||
      '';
    this.baseUrl =
      this.config.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.model =
      this.config.get<string>('VISION_MODEL') ||
      'qwen/qwen3-vl-32b-instruct';
    this.fallbackModel =
      this.config.get<string>('VISION_MODEL_FALLBACK') ||
      'qwen/qwen-vl-plus';
  }

  /**
   * 调用 vision 模型，返回 LLM 文本输出。
   * 内部已处理：429 fallback、超时、HTTP 非 2xx。
   * 抛出：BadRequestException（携带本地化文案）。
   */
  async complete(
    systemPrompt: string,
    imageUrl: string,
    userHint: string,
    locale?: Locale,
  ): Promise<string> {
    const body = (model: string) =>
      JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: getUserMessage('image', userHint, locale) },
              {
                type: 'image_url',
                image_url: { url: imageUrl, detail: 'auto' },
              },
            ],
          },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      });

    const send = (model: string) =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://uway.dev-net.uk',
          'X-Title': 'Wuwei Health',
        },
        body: body(model),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

    let response: Response;
    try {
      response = await send(this.model);
      if (response.status === 429) {
        this.logger.warn(
          `Vision model ${this.model} rate-limited (429), retrying with ${this.fallbackModel}`,
        );
        response = await send(this.fallbackModel);
      }
    } catch (err) {
      this.logger.error(`Vision API request error: ${(err as Error).message}`);
      throw new BadRequestException(this.i18n.t('food.analyze.timeout'));
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      this.logger.error(
        `OpenRouter API error: ${response.status} ${errText.slice(0, 500)}`,
      );
      throw new BadRequestException(this.i18n.t('food.analyze.failed'));
    }

    const data = (await response.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    this.logger.debug(
      `Vision API ok: model=${data.model}, tokens=${data.usage?.total_tokens ?? 'N/A'}`,
    );
    return content;
  }
}
