/**
 * Vision API 客户端 — OpenRouter 多模态 Chat Completions 包装
 *
 * 职责（精简后）：
 *  - 统一 model / fallback model / 配置
 *  - 主模型遇 429 / 5xx 自动切换到 fallback 模型重试一次
 *  - 启动期校验 API key
 *  - 屏蔽具体 HTTP 细节，向上仅暴露 `complete()` 和向用户友好的 i18n 错误
 *
 * 不再在本类内做（已下沉到 `LlmService`）：
 *  - 配额扣减（quota）
 *  - Circuit Breaker（按 feature 自动隔离）
 *  - 超时控制
 *  - Usage 记录 / cost 估算
 *  - HTTP 鉴权头与请求体编码
 *
 * 不在本类内做（与之前一致）：
 *  - prompt 构建（见 ImagePromptBuilder）
 *  - 响应解析（见 ImageResultParser）
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from '../../../../../core/i18n';
import type { Locale } from '../../../../diet/app/recommendation/utils/i18n-messages';
import { AnalysisPromptSchemaService } from '../analysis-prompt-schema.service';
import { LlmService } from '../../../../../core/llm/llm.service';
import { RegionAiModelRoutingService } from '../../../../../core/region';
import {
  LlmFeature,
  LlmQuotaExceededError,
  LlmUnavailableError,
} from '../../../../../core/llm/llm.types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 5000;
const TEMPERATURE = 0.3;

@Injectable()
export class VisionApiClient implements OnModuleInit {
  private readonly logger = new Logger(VisionApiClient.name);
  private readonly httpReferer: string;
  private readonly siteTitle: string;

  constructor(
    private readonly config: ConfigService,
    private readonly i18n: I18nService,
    private readonly promptSchema: AnalysisPromptSchemaService,
    private readonly llm: LlmService,
    private readonly aiModelRouting: RegionAiModelRoutingService,
  ) {
    // OpenRouter 流量归因 headers（透传给 LlmService，仅在 stream 路径生效；
    // 非流式路径走 LangChain SDK，无法塞 headers，OpenRouter 仍可工作但无归因）
    this.httpReferer =
      this.config.get<string>('OPENROUTER_HTTP_REFERER') ||
      this.config.get<string>('APP_PUBLIC_URL') ||
      'https://eatcheck.app';
    this.siteTitle =
      this.config.get<string>('OPENROUTER_SITE_TITLE') || 'EatCheck';
  }

  /**
   * 启动期强制校验：
   * - 生产环境无 OPENROUTER_API_KEY 直接抛错（让 Cloud Run 启动失败比线上 500 风暴更安全）
   * - 非生产仅 warn，便于本地无 key 跑联调
   */
  async onModuleInit(): Promise<void> {
    const route = await this.aiModelRouting.resolveFoodImageAnalysis();
    if (!route.apiKey) {
      const msg = `${route.provider.toUpperCase()} API key is not configured; Vision API will fail`;
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(msg);
        throw new Error(msg);
      }
      this.logger.warn(msg);
    }
  }

  /**
   * 调用 vision 模型，返回 LLM 文本输出。
   *
   * 已统一处理（在 LlmService 内）：配额、breaker、超时、usage/cost 记录。
   * 本方法仅负责：
   *   - 构造多模态 messages
   *   - 主模型失败时切 fallback 模型重试一次（LlmService 内不重试）
   *   - 把统一异常映射到 i18n 业务异常
   *
   * 抛出：
   *   - ServiceUnavailableException：上游不可用 / 熔断打开（i18n: food.analyze.unavailable）
   *   - BadRequestException：业务超时 / 失败（i18n: food.analyze.timeout / failed）
   *   - LlmQuotaExceededError：用户配额耗尽，由上层映射 HTTP 429
   */
  async complete(
    systemPrompt: string,
    imageUrl: string,
    userHint: string,
    userId: string,
    locale?: Locale,
  ): Promise<string> {
    const route = await this.aiModelRouting.resolveFoodImageAnalysis({
      locale,
    });
    try {
      return await this.invoke(
        route.model,
        route.provider,
        route.apiKey,
        route.baseUrl,
        systemPrompt,
        imageUrl,
        userHint,
        userId,
        locale,
      );
    } catch (err) {
      // 配额耗尽：直接上抛
      if (err instanceof LlmQuotaExceededError) throw err;

      // 上游不可用：尝试 fallback 一次
      if (err instanceof LlmUnavailableError) {
        if (!route.fallbackModel) {
          this.logger.error(
            `Vision model ${route.model} unavailable and no fallback configured`,
          );
          throw new ServiceUnavailableException(
            this.i18n.t('food.analyze.unavailable'),
          );
        }

        this.logger.warn(
          `Vision primary model ${route.model} unavailable, falling back to ${route.fallbackModel}`,
        );
        try {
          return await this.invoke(
            route.fallbackModel,
            route.provider,
            route.apiKey,
            route.baseUrl,
            systemPrompt,
            imageUrl,
            userHint,
            userId,
            locale,
          );
        } catch (fallbackErr) {
          if (fallbackErr instanceof LlmQuotaExceededError) throw fallbackErr;
          this.logger.error(
            `Vision fallback model also failed: ${(fallbackErr as Error).message}`,
          );
          throw new ServiceUnavailableException(
            this.i18n.t('food.analyze.unavailable'),
          );
        }
      }

      // 其它错误：视为业务级失败
      this.logger.error(`Vision API error: ${(err as Error).message}`);
      throw new BadRequestException(this.i18n.t('food.analyze.failed'));
    }
  }

  /** 单次 LlmService 调用（不含 fallback 重试） */
  private async invoke(
    model: string,
    provider: string,
    apiKey: string,
    baseUrl: string,
    systemPrompt: string,
    imageUrl: string,
    userHint: string,
    userId: string,
    locale?: Locale,
  ): Promise<string> {
    const result = await this.llm.chat({
      feature: LlmFeature.FoodImage,
      provider,
      apiKey,
      baseUrl,
      model,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      responseFormat: { type: 'json_object' },
      timeoutMs: REQUEST_TIMEOUT_MS,
      extraHeaders: {
        'HTTP-Referer': this.httpReferer,
        'X-Title': this.siteTitle,
      },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: this.promptSchema.getUserMessage('image', userHint, locale),
            },
            {
              type: 'image_url',
              image_url: { url: imageUrl, detail: 'auto' },
            },
          ],
        },
      ],
    });

    return result.content;
  }
}
