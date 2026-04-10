import { Global, Module } from '@nestjs/common';
import { RedisCacheService } from './redis-cache.service';

/**
 * Redis 模块 (V4 Phase 3.9)
 *
 * Global 模块，所有其他模块均可注入 RedisCacheService
 * Redis 不可用时所有操作静默降级
 */
@Global()
@Module({
  providers: [RedisCacheService],
  exports: [RedisCacheService],
})
export class RedisModule {}
