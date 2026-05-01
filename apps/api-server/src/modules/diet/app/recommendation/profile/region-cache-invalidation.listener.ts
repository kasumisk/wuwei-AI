/**
 * 区域+时区优化（阶段 2.2）：区域数据缓存主动失效 Listener
 *
 * 监听 food.region.data_changed 事件，主动删除与该国家代码相关的两类缓存：
 * 1. SeasonalityService  → 'seasonality:region:{countryCode}' 前缀
 * 2. PreferenceProfileService → 'regional_boost:{countryCode}' 前缀
 *
 * 使用 delByPrefix 而非精确 key 删除，保证任何 cacheVersion 下都能失效。
 * 失败不抛出（保持推荐可用性），仅打 WARN 日志。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  RegionDataChangedEvent,
} from '../../../../../core/events/domain-events';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';

@Injectable()
export class RegionCacheInvalidationListener {
  private readonly logger = new Logger(RegionCacheInvalidationListener.name);

  constructor(private readonly redis: RedisCacheService) {}

  @OnEvent(DomainEvents.REGION_DATA_CHANGED, { async: true })
  async handleRegionDataChanged(event: RegionDataChangedEvent): Promise<void> {
    const { countryCode, source, foodId } = event;

    this.logger.log(
      `[RegionCache] Invalidating caches for countryCode=${countryCode} ` +
        `(source=${source}, foodId=${foodId ?? 'n/a'})`,
    );

    try {
      const [seasonalityDeleted, regionalBoostDeleted] = await Promise.all([
        // SeasonalityService 缓存键前缀：'seasonality:region:{countryCode}'
        this.redis.delByPrefix(`seasonality:region:${countryCode}`),
        // PreferenceProfileService 缓存键前缀：'regional_boost:{countryCode}'
        this.redis.delByPrefix(`regional_boost:${countryCode}`),
      ]);

      this.logger.log(
        `[RegionCache] Invalidated countryCode=${countryCode}: ` +
          `seasonality=${seasonalityDeleted} keys, regional_boost=${regionalBoostDeleted} keys`,
      );
    } catch (err) {
      this.logger.warn(
        `[RegionCache] Failed to invalidate caches for countryCode=${countryCode}: ${(err as Error).message}`,
      );
    }
  }
}
