import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  Logger,
  HttpException,
  HttpStatus,
  Sse,
  MessageEvent,
  Res,
  Header,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Observable, map, catchError, finalize, tap } from 'rxjs';
import { GatewayService } from './gateway.service';
import { CapabilityRouter } from './services/capability-router.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CapabilityPermissionGuard } from './guards/capability-permission.guard';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { QuotaGuard } from './guards/quota.guard';
import { ApiResponse } from '../common/types/response.type';
import { GenerateTextDto } from './dto/generate-text.dto';
import { GenerateImageDto } from './dto/generate-image.dto';
import { IgnoreResponseInterceptor } from '../core/decorators/ignore-response-interceptor.decorator';

@ApiTags('Gateway - AI 能力网关')
@Controller('gateway')
@UseGuards(ApiKeyGuard, CapabilityPermissionGuard, RateLimitGuard, QuotaGuard)
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(
    private readonly gatewayService: GatewayService,
    private readonly capabilityRouter: CapabilityRouter,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  /**
   * 文本生成
   * POST /api/gateway/text/generation
   */
  @Post('text/generation')
  @ApiOperation({ summary: '文本生成' })
  @SwaggerResponse({ status: 200, description: '生成成功' })
  async textGeneration(
    @Req() request: any,
    @Body() body: GenerateTextDto,
  ): Promise<ApiResponse> {
    const { client, capabilityType } = request;
    const startTime = Date.now();
    const requestId = uuidv4();

    try {
      // 1. 路由到最佳提供商（传递请求的模型）
      const routing = await this.capabilityRouter.route(
        client.id,
        capabilityType,
        body.model, // 传递用户请求的模型
      );

      if (!routing) {
        throw new HttpException(
          '没有可用的提供商配置',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      this.logger.log(
        `Routing request to ${routing.provider.name} with model ${routing.model} for client ${client.id} (requested: ${body.model || 'auto'})`,
      );

      // 2. 获取适配器
      const adapter = this.adapterFactory.getAdapter(routing.provider.name);

      // 3. 验证请求参数（必须有 messages 或 prompt）
      this.logger.debug(`[Gateway] Request body:`, {
        hasMessages: !!body.messages,
        messagesLength: body.messages?.length,
        hasPrompt: !!body.prompt,
        promptLength: body.prompt?.length,
      });

      if (!body.messages && !body.prompt) {
        throw new HttpException(
          '请提供 messages 或 prompt 参数',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 4. 确定使用的模型（优先使用请求中指定的model，否则使用路由选择的默认model）
      const modelToUse = body.model || routing.model;

      // 5. 调用 API 生成文本
      const result = await adapter.generateText({
        messages: body.messages,
        prompt: body.prompt,
        model: modelToUse,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
        topP: body.topP,
        frequencyPenalty: body.frequencyPenalty,
        presencePenalty: body.presencePenalty,
        stop: body.stop,
      });

      const latency = Date.now() - startTime;

      // 4. 计算成本
      const cost = adapter.calculateCost(result.usage);

      // 5. 记录使用情况
      await this.gatewayService.recordUsage({
        clientId: client.id,
        requestId,
        capabilityType,
        provider: routing.provider.name,
        model: result.model,
        status: 'success',
        usage: {
          inputTokens: result.usage.promptTokens,
          outputTokens: result.usage.completionTokens,
          totalTokens: result.usage.totalTokens,
        },
        cost,
        responseTime: latency,
        metadata: {
          finishReason: result.finishReason,
          ...result.metadata,
        },
      });

      this.logger.log(
        `Request completed successfully for client ${client.id}, latency: ${latency}ms, cost: $${cost.toFixed(6)}`,
      );

      return {
        success: true,
        code: 200,
        message: '文本生成成功',
        data: {
          text: result.text,
          model: result.model,
          provider: routing.provider.name,
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          },
          cost,
          latency,
          finishReason: result.finishReason,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      this.logger.error(
        `Text generation failed for client ${client.id}: ${error.message}`,
        error.stack,
      );

      // 尝试故障转移
      try {
        const routing = await this.capabilityRouter.route(
          client.id,
          capabilityType,
        );

        if (routing) {
          const fallbackRouting = await this.capabilityRouter.fallback(
            client.id,
            capabilityType,
            [routing.provider.name],
          );

          if (fallbackRouting) {
            this.logger.log(
              `Attempting fallback to ${fallbackRouting.provider.name} for client ${client.id}`,
            );

            const fallbackAdapter = this.adapterFactory.getAdapter(
              fallbackRouting.provider.name,
            );
            const fallbackResult = await fallbackAdapter.generateText({
              messages: body.messages,
              prompt: body.prompt,
              model: fallbackRouting.model,
              temperature: body.temperature,
              maxTokens: body.maxTokens,
              topP: body.topP,
              frequencyPenalty: body.frequencyPenalty,
              presencePenalty: body.presencePenalty,
              stop: body.stop,
            });

            const fallbackLatency = Date.now() - startTime;
            const fallbackCost = fallbackAdapter.calculateCost(
              fallbackResult.usage,
            );

            await this.gatewayService.recordUsage({
              clientId: client.id,
              requestId,
              capabilityType,
              provider: fallbackRouting.provider.name,
              model: fallbackResult.model,
              status: 'success',
              usage: {
                inputTokens: fallbackResult.usage.promptTokens,
                outputTokens: fallbackResult.usage.completionTokens,
                totalTokens: fallbackResult.usage.totalTokens,
              },
              cost: fallbackCost,
              responseTime: fallbackLatency,
              metadata: {
                fallback: true,
                originalProvider: routing.provider.name,
                finishReason: fallbackResult.finishReason,
              },
            });

            this.logger.log(
              `Fallback completed successfully for client ${client.id}`,
            );

            return {
              success: true,
              code: 200,
              message: '文本生成成功（故障转移）',
              data: {
                text: fallbackResult.text,
                model: fallbackResult.model,
                provider: fallbackRouting.provider.name,
                usage: {
                  promptTokens: fallbackResult.usage.promptTokens,
                  completionTokens: fallbackResult.usage.completionTokens,
                  totalTokens: fallbackResult.usage.totalTokens,
                },
                cost: fallbackCost,
                latency: fallbackLatency,
                finishReason: fallbackResult.finishReason,
                fallback: true,
              },
            };
          }
        }
      } catch (fallbackError) {
        this.logger.error(
          `Fallback also failed for client ${client.id}: ${fallbackError.message}`,
          fallbackError.stack,
        );
      }

      // 记录失败
      await this.gatewayService.recordUsage({
        clientId: client.id,
        requestId,
        capabilityType,
        provider: 'unknown',
        model: 'unknown',
        status: 'failed',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
        cost: 0,
        responseTime: latency,
        metadata: {
          error: error.message,
        },
      });

      throw new HttpException(
        error.message || '文本生成失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 流式文本生成 (Server-Sent Events)
   * POST /api/gateway/text/generation/stream
   */
  @Post('text/generation/stream')
  @Sse()
  @IgnoreResponseInterceptor()
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @ApiOperation({ summary: '流式文本生成' })
  @SwaggerResponse({ status: 200, description: 'SSE 流式响应' })
  async textGenerationStream(
    @Req() request: any,
    @Body() body: GenerateTextDto,
  ): Promise<Observable<MessageEvent>> {
    this.logger.log('Stream request received');
    const { client, capabilityType } = request;
    const startTime = Date.now();
    const requestId = uuidv4();

    try {
      // 1. 路由到最佳提供商（传递请求的模型）
      const routing = await this.capabilityRouter.route(
        client.id,
        capabilityType,
        body.model, // 传递用户请求的模型
      );

      if (!routing) {
        throw new HttpException(
          '没有可用的提供商配置',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      this.logger.log(
        `[Stream] Routing request to ${routing.provider.name} for client ${client.id} (requested: ${body.model || 'auto'})`,
      );

      // 2. 验证请求参数
      if (!body.messages && !body.prompt) {
        throw new HttpException(
          '请提供 messages 或 prompt 参数',
          HttpStatus.BAD_REQUEST,
        );
      }

      // 3. 获取适配器
      const adapter = this.adapterFactory.getAdapter(routing.provider.name);

      // 4. 确定使用的模型
      const modelToUse = body.model || routing.model;

      // 用于累积统计
      let totalTokens = 0;
      let promptTokens = 0;
      let completionTokens = 0;
      let generatedText = '';

      // 5. 返回流式 Observable
      return adapter
        .generateTextStream({
          messages: body.messages,
          prompt: body.prompt,
          model: modelToUse,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          topP: body.topP,
          frequencyPenalty: body.frequencyPenalty,
          presencePenalty: body.presencePenalty,
          stop: body.stop,
        })
        .pipe(
          tap((chunk) => {
            // 累积生成的文本
            if (chunk.delta) {
              generatedText += chunk.delta;
            }
            // 更新 token 统计
            if (chunk.usage) {
              promptTokens = chunk.usage.promptTokens || promptTokens;
              completionTokens =
                chunk.usage.completionTokens || completionTokens;
              totalTokens = chunk.usage.totalTokens || totalTokens;
            }
          }),
          map(
            (chunk): MessageEvent => ({
              id: requestId,
              data: {
                id: requestId,
                delta: chunk.delta,
                usage: chunk.usage,
                finishReason: chunk.finishReason,
                model: chunk.model || modelToUse,
                provider: routing.provider.name,
              },
            }),
          ),
          catchError((error) => {
            this.logger.error(
              `[Stream] Error for client ${client.id}: ${error.message}`,
              error.stack,
            );

            // 记录失败
            this.gatewayService
              .recordUsage({
                clientId: client.id,
                requestId,
                capabilityType,
                provider: routing.provider.name,
                model: modelToUse,
                status: 'failed',
                usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                cost: 0,
                responseTime: Date.now() - startTime,
                metadata: { error: error.message },
              })
              .catch((recordError) => {
                this.logger.error(
                  `Failed to record usage: ${recordError.message}`,
                );
              });

            // Return the error event as a value, do not throw
            return new Observable<MessageEvent>((subscriber) => {
              subscriber.next({
                data: {
                  error: true,
                  message: error.message,
                  code: error.status || 500,
                },
              });
              subscriber.complete();
            });
          }),
          finalize(() => {
            const latency = Date.now() - startTime;

            // 流结束时记录使用情况
            const cost = adapter.calculateCost({
              promptTokens,
              completionTokens,
              totalTokens,
            });

            this.gatewayService
              .recordUsage({
                clientId: client.id,
                requestId,
                capabilityType,
                provider: routing.provider.name,
                model: modelToUse,
                status: 'success',
                usage: {
                  inputTokens: promptTokens,
                  outputTokens: completionTokens,
                  totalTokens,
                },
                cost,
                responseTime: latency,
                metadata: {
                  streaming: true,
                  textLength: generatedText.length,
                },
              })
              .then(() => {
                this.logger.log(
                  `[Stream] Completed for client ${client.id}, latency: ${latency}ms, cost: $${cost.toFixed(6)}`,
                );
              })
              .catch((recordError) => {
                this.logger.error(
                  `Failed to record usage: ${recordError.message}`,
                );
              });
          }),
        );
    } catch (error) {
      this.logger.error(
        `[Stream] Setup failed for client ${client.id}: ${error.message}`,
        error.stack,
      );

      throw new HttpException(
        error.message || '流式文本生成失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 图像生成
   * POST /api/gateway/image/generation
   */
  @Post('image/generation')
  @ApiOperation({ summary: '图像生成' })
  @SwaggerResponse({ status: 200, description: '生成成功' })
  async imageGeneration(
    @Req() request: any,
    @Body() body: GenerateImageDto,
  ): Promise<ApiResponse> {
    const { client, capabilityType } = request;
    const startTime = Date.now();
    const requestId = uuidv4();

    try {
      // 1. 路由到最佳提供商
      const routing = await this.capabilityRouter.route(
        client.id,
        capabilityType,
      );

      if (!routing) {
        throw new HttpException(
          '没有可用的图像生成提供商配置',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      this.logger.log(
        `[Image] Routing request to ${routing.provider.name} with model ${routing.model} for client ${client.id}`,
      );

      // 2. 获取适配器
      const adapter = this.adapterFactory.getAdapter(routing.provider.name);

      // 3. 确定使用的模型
      const modelToUse = body.model || routing.model;

      // 4. 调用 API 生成图像
      const result = await adapter.generateImage({
        prompt: body.prompt,
        model: modelToUse,
        size: body.size || '1024x1024',
        quality: body.quality || 'standard',
        n: body.n || 1,
        style: body.style,
      });

      const latency = Date.now() - startTime;

      // 5. 计算成本（图像生成通常按张数计费）
      const cost = this.calculateImageCost(
        modelToUse,
        body.size || '1024x1024',
        body.quality || 'standard',
        body.n || 1,
      );

      // 6. 记录使用情况
      await this.gatewayService.recordUsage({
        clientId: client.id,
        requestId,
        capabilityType,
        provider: routing.provider.name,
        model: result.model,
        status: 'success',
        usage: {
          imageCount: result.images.length,
          size: body.size || '1024x1024',
          quality: body.quality || 'standard',
        },
        cost,
        responseTime: latency,
        metadata: {
          revisedPrompt: result.revisedPrompt,
        },
      });

      this.logger.log(
        `[Image] Request completed for client ${client.id}, generated ${result.images.length} images, latency: ${latency}ms, cost: $${cost.toFixed(4)}`,
      );

      return {
        success: true,
        code: 200,
        message: '图像生成成功',
        data: {
          images: result.images,
          model: result.model,
          provider: routing.provider.name,
          revisedPrompt: result.revisedPrompt,
          cost,
          latency,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      this.logger.error(
        `[Image] Generation failed for client ${client.id}: ${error.message}`,
        error.stack,
      );

      // 尝试故障转移
      try {
        const routing = await this.capabilityRouter.route(
          client.id,
          capabilityType,
        );

        if (routing) {
          const fallbackRouting = await this.capabilityRouter.fallback(
            client.id,
            capabilityType,
            [routing.provider.name],
          );

          if (fallbackRouting) {
            this.logger.log(
              `[Image] Attempting fallback to ${fallbackRouting.provider.name} for client ${client.id}`,
            );

            const fallbackAdapter = this.adapterFactory.getAdapter(
              fallbackRouting.provider.name,
            );
            const fallbackResult = await fallbackAdapter.generateImage({
              prompt: body.prompt,
              model: fallbackRouting.model,
              size: body.size || '1024x1024',
              quality: body.quality || 'standard',
              n: body.n || 1,
              style: body.style,
            });

            const fallbackLatency = Date.now() - startTime;
            const fallbackCost = this.calculateImageCost(
              fallbackRouting.model,
              body.size || '1024x1024',
              body.quality || 'standard',
              body.n || 1,
            );

            await this.gatewayService.recordUsage({
              clientId: client.id,
              requestId,
              capabilityType,
              provider: fallbackRouting.provider.name,
              model: fallbackResult.model,
              status: 'success',
              usage: {
                imageCount: fallbackResult.images.length,
                size: body.size || '1024x1024',
                quality: body.quality || 'standard',
              },
              cost: fallbackCost,
              responseTime: fallbackLatency,
              metadata: {
                fallback: true,
                originalProvider: routing.provider.name,
                revisedPrompt: fallbackResult.revisedPrompt,
              },
            });

            return {
              success: true,
              code: 200,
              message: '图像生成成功（故障转移）',
              data: {
                images: fallbackResult.images,
                model: fallbackResult.model,
                provider: fallbackRouting.provider.name,
                revisedPrompt: fallbackResult.revisedPrompt,
                cost: fallbackCost,
                latency: fallbackLatency,
                fallback: true,
              },
            };
          }
        }
      } catch (fallbackError) {
        this.logger.error(
          `[Image] Fallback also failed for client ${client.id}: ${fallbackError.message}`,
          fallbackError.stack,
        );
      }

      // 记录失败
      await this.gatewayService.recordUsage({
        clientId: client.id,
        requestId,
        capabilityType,
        provider: 'unknown',
        model: 'unknown',
        status: 'failed',
        usage: {
          imageCount: 0,
        },
        cost: 0,
        responseTime: latency,
        metadata: {
          error: error.message,
        },
      });

      throw new HttpException(
        error.message || '图像生成失败',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 计算图像生成成本
   * 基于 DALL-E 3 定价
   */
  private calculateImageCost(
    model: string,
    size: string,
    quality: string,
    count: number,
  ): number {
    // DALL-E 3 定价 (2024)
    const pricing = {
      'dall-e-3': {
        '1024x1024': { standard: 0.04, hd: 0.08 },
        '1024x1792': { standard: 0.08, hd: 0.12 },
        '1792x1024': { standard: 0.08, hd: 0.12 },
      },
      'dall-e-2': {
        '256x256': { standard: 0.016, hd: 0.016 },
        '512x512': { standard: 0.018, hd: 0.018 },
        '1024x1024': { standard: 0.02, hd: 0.02 },
      },
    };

    const modelPricing = pricing[model] || pricing['dall-e-3'];
    const sizePricing = modelPricing[size] || modelPricing['1024x1024'];
    const pricePerImage = sizePricing[quality] || sizePricing.standard;

    return pricePerImage * count;
  }
}
