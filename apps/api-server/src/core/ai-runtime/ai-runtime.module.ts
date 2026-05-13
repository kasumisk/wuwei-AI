import { Global, Module } from '@nestjs/common';
import { AiRoutingModule } from '../ai-routing';
import { AiRuntimeService } from './ai-runtime.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { DeepSeekAdapter } from './adapters/deepseek.adapter';
import { OpenAIAdapter } from './adapters/openai.adapter';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';
import { QwenAdapter } from './adapters/qwen.adapter';
import { UsageArchiveCronService } from './usage-archive-cron.service';
import { UsageQuotaService } from './usage-quota.service';
import { UsageRecorderService } from './usage-recorder.service';

@Global()
@Module({
  imports: [AiRoutingModule],
  providers: [
    AiRuntimeService,
    UsageQuotaService,
    UsageRecorderService,
    UsageArchiveCronService,
    AdapterFactory,
    OpenAIAdapter,
    DeepSeekAdapter,
    QwenAdapter,
    OpenRouterAdapter,
  ],
  exports: [
    AiRuntimeService,
    UsageQuotaService,
    UsageRecorderService,
    AdapterFactory,
  ],
})
export class AiRuntimeModule {}
