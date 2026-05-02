/**
 * core/llm — 统一 LLM 调用模块（Global）
 *
 * 提供：
 *   - LlmService（chat 直连模式）
 *   - UsageQuotaService（配额预扣 / 退还）
 *   - UsageRecorderService（异步 cost 入账）
 *   - UsageArchiveCronService（每日 UTC 02:00 归档 90 天前记录）
 *
 * 依赖（全部 @Global，无需显式 import）：
 *   - PrismaModule
 *   - CircuitBreakerModule
 *   - MetricsModule
 *   - ScheduleModule（AppModule 全局注册）
 */
import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { UsageQuotaService } from './usage-quota.service';
import { UsageRecorderService } from './usage-recorder.service';
import { UsageArchiveCronService } from './usage-archive-cron.service';

@Global()
@Module({
  providers: [
    LlmService,
    UsageQuotaService,
    UsageRecorderService,
    UsageArchiveCronService,
  ],
  exports: [LlmService, UsageQuotaService, UsageRecorderService],
})
export class LlmModule {}
