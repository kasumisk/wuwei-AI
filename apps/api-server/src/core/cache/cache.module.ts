/**
 * V6 Phase 1.6 — 统一缓存模块
 *
 * @Global() 全局可用，任何模块均可注入 TieredCacheManager。
 * 依赖 RedisModule（已全局注册）提供的 RedisCacheService 作为 L2 层。
 */
import { Global, Module } from '@nestjs/common';
import { TieredCacheManager } from './tiered-cache-manager';

@Global()
@Module({
  providers: [TieredCacheManager],
  exports: [TieredCacheManager],
})
export class CacheModule {}
