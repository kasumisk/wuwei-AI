import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/**
 * IdempotencyModule — 全局幂等服务。
 *
 * Prisma 已是 @Global，不需要在此 import；直接 provide IdempotencyService。
 * 业务模块（subscription / queue / cron）只需在 controller/service 注入即可。
 */
@Global()
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
