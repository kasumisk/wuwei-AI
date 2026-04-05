import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../entities/client.entity';
import { ClientCapabilityPermission } from '../entities/client-capability-permission.entity';
import { ModelConfig } from '../entities/model-config.entity';
import { Provider } from '../entities/provider.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { CapabilityRouter } from './services/capability-router.service';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { QwenAdapter } from './adapters/qwen.adapter';
import { AdapterFactory } from './adapters/adapter.factory';
import { ApiKeyGuard } from './guards/api-key.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Client,
      ClientCapabilityPermission,
      ModelConfig,
      Provider,
      UsageRecord,
    ]),
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    CapabilityRouter,
    OpenAIAdapter,
    DeepSeekAdapter,
    QwenAdapter,
    AdapterFactory,
    ApiKeyGuard,
  ],
  exports: [GatewayService, CapabilityRouter, ApiKeyGuard],
})
export class GatewayModule {}
