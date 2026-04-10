import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { CapabilityRouter } from './services/capability-router.service';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { QwenAdapter } from './adapters/qwen.adapter';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';
import { AdapterFactory } from './adapters/adapter.factory';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  controllers: [GatewayController],
  providers: [
    GatewayService,
    CapabilityRouter,
    OpenAIAdapter,
    DeepSeekAdapter,
    QwenAdapter,
    OpenRouterAdapter,
    AdapterFactory,
    ApiKeyGuard,
  ],
  exports: [GatewayService, CapabilityRouter, ApiKeyGuard],
})
export class GatewayModule {}
