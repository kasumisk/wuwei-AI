/**
 * V7.4 Phase 2-E: ProfileEventListener — 画像增量更新监听器
 *
 * 监听 user.feedback.submitted 事件，触发偏好画像的异步增量更新。
 *
 * 事件流：
 *   FeedbackService.submit()
 *     → emit 'user.feedback.submitted' (FeedbackSubmittedEvent)
 *     → ProfileEventListener.onFeedbackSubmitted() (本服务)
 *       → 失效 PreferenceProfile 缓存
 *       → 重建偏好画像（异步，不阻塞调用方）
 *       → emit 'profile.preference.incremental_update' (ProfileEventBus)
 *
 * 好处：
 * - 每次反馈后画像自动更新，无需等待下次推荐时才重建
 * - 异步执行，不影响反馈 API 响应时间
 * - 通过 ProfileEventBus 通知下游（如缓存预热、日志）
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvents,
  FeedbackSubmittedEvent,
} from '../../../../../core/events/domain-events';
import { PreferenceProfileService } from './preference-profile.service';
import { RedisCacheService } from '../../../../../core/redis/redis-cache.service';
import {
  ProfileEventBusService,
  PreferenceIncrementalUpdateEvent,
  PreferenceCacheInvalidatedEvent,
} from './profile-event-bus.service';

@Injectable()
export class ProfileEventListenerService {
  private readonly logger = new Logger(ProfileEventListenerService.name);

  /** Redis key 命名空间（与 PreferenceProfileService 保持一致） */
  private static readonly NS_PREFERENCE = 'pref_profile';

  constructor(
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly redis: RedisCacheService,
    private readonly profileEventBus: ProfileEventBusService,
  ) {}

  /**
   * 监听反馈提交事件 → 增量更新偏好画像
   *
   * @OnEvent 装饰器确保异步执行，不阻塞事件发布方。
   * 处理失败不影响其他 listener，错误被全局 EventErrorHandler 捕获。
   */
  @OnEvent(DomainEvents.FEEDBACK_SUBMITTED, { async: true })
  async onFeedbackSubmitted(event: FeedbackSubmittedEvent): Promise<void> {
    const { userId, action, foodName, foodCategory } = event;

    this.logger.debug(
      `Processing feedback for profile update: userId=${userId}, action=${action}, food=${foodName}`,
    );

    try {
      // Step 1: 失效旧的偏好画像缓存
      const cacheKey = this.redis.buildKey(
        ProfileEventListenerService.NS_PREFERENCE,
        userId,
      );
      await this.redis.del(cacheKey);

      this.profileEventBus.emitCacheInvalidated(
        new PreferenceCacheInvalidatedEvent(
          userId,
          `feedback.${action} on ${foodName}`,
        ),
      );

      // Step 2: 触发偏好画像重建（通过 getOrSet 自动重建并缓存）
      await this.preferenceProfileService.getUserPreferenceProfile(userId);

      // Step 3: 确定影响的维度
      const affectedDimensions: string[] = ['foodName'];
      if (foodCategory) {
        affectedDimensions.push('category');
      }
      // accepted/replaced 都会影响 ingredient 和 foodGroup 维度
      if (action !== 'skipped') {
        affectedDimensions.push('ingredient', 'foodGroup');
      }

      // Step 4: 发布画像增量更新事件
      this.profileEventBus.emitPreferenceUpdate(
        new PreferenceIncrementalUpdateEvent(
          userId,
          'feedback',
          affectedDimensions,
          action,
          foodName,
        ),
      );

      this.logger.debug(
        `Profile updated for userId=${userId} after ${action} on "${foodName}"`,
      );
    } catch (error) {
      // 画像更新失败不应影响反馈流程
      this.logger.warn(
        `Failed to update preference profile for userId=${userId}: ${error}`,
      );
    }
  }
}
