/**
 * 区域+时区优化（深度分析 P0-2）：用户 regionCode 变更缓存主动失效 Listener
 *
 * 监听 user.region.changed 事件，主动删除该用户与"地区/时区"绑定的两类缓存：
 *
 * 1. PreferenceProfileService → 'pref_profile:{userId}' 前缀
 *    用户偏好画像中含 regional boost map，旧地区残留会污染新地区评分。
 *
 * 2. SceneResolverService → 'scene:user:{userId}:patterns' 前缀
 *    行为分桶 key 为 `${dayOfWeek}_${mealType}`，dayOfWeek 按用户本地时区计算；
 *    跨地区通常意味着跨时区，旧分桶语义失效，必须重新积累。
 *
 * 注意：
 * - 'regional_boost:{countryCode}' 是 country 维度共享缓存，不在此清理。
 * - declared/aggregated profile 缓存由 PROFILE_UPDATED 事件经 ProfileCacheService
 *   自动失效，本 listener 不重复处理。
 *
 * 失败不抛出（保持推荐可用性），仅打 WARN 日志。
 */
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  UserRegionChangedEvent,
} from '../../../../../core/events/domain-events';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';

@Injectable()
export class UserRegionCacheInvalidationListener {
  private readonly logger = new Logger(
    UserRegionCacheInvalidationListener.name,
  );

  constructor(private readonly redis: RedisCacheService) {}

  @OnEvent(DomainEvents.USER_REGION_CHANGED, { async: true })
  async handleUserRegionChanged(
    event: UserRegionChangedEvent,
  ): Promise<void> {
    const { userId, previousRegionCode, currentRegionCode, source } = event;

    this.logger.log(
      `[UserRegionCache] Invalidating user-bound caches for userId=${userId} ` +
        `(${previousRegionCode ?? 'null'} → ${currentRegionCode}, source=${source})`,
    );

    try {
      const [prefDeleted, sceneDeleted] = await Promise.all([
        // PreferenceProfileService 的 pref_profile:{userId} 命名空间
        this.redis.delByPrefix(`pref_profile:${userId}`),
        // SceneResolverService 行为分桶
        this.redis.delByPrefix(`scene:user:${userId}:patterns`),
      ]);

      this.logger.log(
        `[UserRegionCache] Invalidated userId=${userId}: ` +
          `pref_profile=${prefDeleted} keys, scene_patterns=${sceneDeleted} keys`,
      );
    } catch (err) {
      this.logger.warn(
        `[UserRegionCache] Failed to invalidate caches for userId=${userId}: ${(err as Error).message}`,
      );
    }
  }
}
