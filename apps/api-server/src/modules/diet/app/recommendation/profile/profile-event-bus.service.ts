/**
 * V7.4 Phase 2-D: ProfileEventBus — 画像事件总线
 *
 * 基于 NestJS EventEmitter2 的画像专用事件总线。
 * 用于解耦"反馈提交"与"画像增量更新"之间的直接调用关系。
 *
 * 事件流：
 *   user.feedback.submitted (已有)
 *     → ProfileEventListener 监听
 *     → 调用 PreferenceProfileService 增量更新
 *     → emit profile.preference.incremental_update (本服务)
 *
 * 好处：
 * - 反馈服务不需要直接注入画像服务（降低耦合）
 * - 增量更新异步执行，不阻塞反馈 API 响应
 * - 可扩展：未来可追加更多 listener（如画像变更日志、AB 实验触发器等）
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ─── 画像事件名称常量 ───

export const ProfileEvents = {
  /** 偏好画像增量更新完成 */
  PREFERENCE_INCREMENTAL_UPDATE:
    'profile.preference.incremental_update' as const,
  /** 画像缓存已失效（通知下游刷新） */
  PREFERENCE_CACHE_INVALIDATED: 'profile.preference.cache_invalidated' as const,
} as const;

export type ProfileEventName =
  (typeof ProfileEvents)[keyof typeof ProfileEvents];

// ─── 事件载荷 ───

/**
 * 偏好画像增量更新事件载荷
 */
export class PreferenceIncrementalUpdateEvent {
  readonly eventName = ProfileEvents.PREFERENCE_INCREMENTAL_UPDATE;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 更新来源（feedback/analysis/manual） */
    public readonly source: 'feedback' | 'analysis' | 'manual',
    /** 影响的维度（category/ingredient/foodGroup/foodName） */
    public readonly affectedDimensions: string[],
    /** 触发的反馈 action（accepted/replaced/skipped） */
    public readonly feedbackAction?: 'accepted' | 'replaced' | 'skipped',
    /** 关联的食物名称 */
    public readonly foodName?: string,
  ) {}
}

/**
 * 偏好缓存失效事件载荷
 */
export class PreferenceCacheInvalidatedEvent {
  readonly eventName = ProfileEvents.PREFERENCE_CACHE_INVALIDATED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 失效原因 */
    public readonly reason: string,
  ) {}
}

// ─── ProfileEventBus 服务 ───

@Injectable()
export class ProfileEventBusService {
  private readonly logger = new Logger(ProfileEventBusService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 发布偏好画像增量更新事件
   */
  emitPreferenceUpdate(event: PreferenceIncrementalUpdateEvent): void {
    this.logger.debug(
      `Emitting ${event.eventName}: userId=${event.userId}, source=${event.source}, ` +
        `dims=[${event.affectedDimensions.join(',')}]`,
    );
    this.eventEmitter.emit(event.eventName, event);
  }

  /**
   * 发布偏好缓存失效事件
   */
  emitCacheInvalidated(event: PreferenceCacheInvalidatedEvent): void {
    this.logger.debug(
      `Emitting ${event.eventName}: userId=${event.userId}, reason=${event.reason}`,
    );
    this.eventEmitter.emit(event.eventName, event);
  }
}
