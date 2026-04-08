import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';
import {
  GenerateTextRequest,
  GenerateTextResponse,
  StreamChunk,
} from './adapters/base.adapter';

/**
 * AI 网关服务 — 统一对外接口
 * 当前仅保留 OpenRouter adapter
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly openRouterAdapter: OpenRouterAdapter,
    private readonly configService: ConfigService,
  ) {}

  async generateText(request: GenerateTextRequest): Promise<GenerateTextResponse> {
    const model = request.model || this.configService.get<string>('aiGateway.defaultModel') || 'openai/gpt-4o-mini';
    return this.openRouterAdapter.generateText({ ...request, model });
  }

  generateTextStream(request: GenerateTextRequest): Observable<StreamChunk> {
    const model = request.model || this.configService.get<string>('aiGateway.defaultModel') || 'openai/gpt-4o-mini';
    return this.openRouterAdapter.generateTextStream({ ...request, model });
  }

  calculateCost(model: string, usage: { promptTokens: number; completionTokens: number }): number {
    return this.openRouterAdapter.calculateCostForModel(model, usage);
  }
}
