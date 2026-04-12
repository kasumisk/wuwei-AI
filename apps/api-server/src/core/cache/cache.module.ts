/**
 * V6 Phase 1.6 — 统一缓存模块
 *
 * @Global() 全局可用，任何模块均可注入 TieredCacheManager。
 * 依赖 RedisModule（已全局注册）提供的 RedisCacheService 作为 L2 层。
 *
 * V7.3 P3-A: 新增 RequestScopedCacheService（请求级缓存，Scope.REQUEST）
 * V7.3 P3-B: 新增 CacheWarmupService（启动预热）
 * V7.4 P1-F: CacheWarmupService 注入 ProfileResolverService，需导入 UserModule
 */
import { Global, Module, forwardRef } from '@nestjs/common';
import { TieredCacheManager } from './tiered-cache-manager';
import { RequestScopedCacheService } from './request-scoped-cache.service';
import { CacheWarmupService } from './cache-warmup.service';
import { UserModule } from '../../modules/user/user.module';

@Global()
@Module({
  imports: [forwardRef(() => UserModule)],
  providers: [
    TieredCacheManager,
    RequestScopedCacheService,
    CacheWarmupService,
  ],
  exports: [TieredCacheManager, RequestScopedCacheService, CacheWarmupService],
})
export class CacheModule {}
