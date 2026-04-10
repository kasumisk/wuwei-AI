/**
 * V6 Phase 1.11 — NotificationProcessor（BullMQ Worker）
 *
 * 异步处理推送通知 job：
 * 1. 获取用户活跃设备令牌
 * 2. 通过 firebase-admin 发送 FCM 推送
 * 3. 处理失效令牌（标记 isActive=false）
 * 4. 标记通知为已推送
 *
 * firebase-admin 的 App 实例通过 FirebaseAdminService 获取。
 * 如果 Firebase 未初始化（如开发环境），推送会被跳过但站内信仍然保留。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import * as admin from 'firebase-admin';
import { QUEUE_NAMES } from '../../../core/queue/queue.constants';
import {
  NotificationService,
  NotificationJobData,
} from './notification.service';

@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);
  private firebaseApp: admin.app.App | null = null;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {
    super();
    // 尝试获取已初始化的 Firebase App 实例
    try {
      this.firebaseApp = admin.app('app-auth');
    } catch {
      this.logger.warn(
        'Firebase Admin 实例 [app-auth] 不可用，推送通知将被跳过',
      );
    }
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { notificationId, userId, type, title, body, data } = job.data;
    this.logger.debug(
      `处理推送: notificationId=${notificationId}, userId=${userId}, type=${type}`,
    );

    // 获取用户活跃设备令牌
    const tokens = await this.notificationService.getActiveDeviceTokens(userId);
    if (tokens.length === 0) {
      this.logger.debug(`无活跃设备令牌，跳过推送: userId=${userId}`);
      return;
    }

    if (!this.firebaseApp) {
      this.logger.debug('Firebase 未初始化，跳过推送（站内信已保留）');
      return;
    }

    // 构建 FCM 消息
    const messaging = this.firebaseApp.messaging();
    const fcmTokens = tokens.map((t) => t.token);

    try {
      const response = await messaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title,
          body,
        },
        data: data
          ? Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, String(v)]),
            )
          : undefined,
        // Android 配置
        android: {
          priority: 'high',
          notification: {
            channelId: 'diet_notifications',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        // APNs 配置
        apns: {
          payload: {
            aps: {
              badge: 1,
              sound: 'default',
            },
          },
        },
      });

      // 处理发送结果
      let successCount = 0;
      response.responses.forEach((resp, idx) => {
        if (resp.success) {
          successCount++;
        } else {
          const errorCode = resp.error?.code;
          // 标记失效令牌
          if (
            errorCode === 'messaging/registration-token-not-registered' ||
            errorCode === 'messaging/invalid-registration-token'
          ) {
            this.notificationService
              .invalidateToken(fcmTokens[idx])
              .catch(() => {
                /* non-critical */
              });
            this.logger.debug(
              `令牌已失效，已标记: token=${fcmTokens[idx].slice(0, 20)}...`,
            );
          } else {
            this.logger.warn(
              `推送失败: token=${fcmTokens[idx].slice(0, 20)}..., error=${errorCode}`,
            );
          }
        }
      });

      this.logger.debug(
        `推送完成: userId=${userId}, 成功=${successCount}/${fcmTokens.length}`,
      );

      // 标记通知为已推送（至少有一个成功即标记）
      if (successCount > 0) {
        await this.notificationService.markAsPushed(notificationId);
      }
    } catch (err) {
      this.logger.error(
        `FCM 推送异常: userId=${userId}, ${(err as Error).message}`,
      );
      throw err; // 让 BullMQ 重试
    }
  }
}
