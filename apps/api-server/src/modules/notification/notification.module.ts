/**
 * V6 Phase 1.11 — NotificationModule
 *
 * 通知推送基础能力：
 * - 站内信 CRUD + 未读计数
 * - FCM 推送（firebase-admin，异步队列处理）
 * - 用户通知偏好管理
 * - 设备令牌注册/注销
 *
 * 模块设计为 @Global()，其他模块可直接注入 NotificationService 发送通知。
 */
import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Notification } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { DeviceToken } from './entities/device-token.entity';
import { NotificationService } from './app/notification.service';
import { NotificationProcessor } from './app/notification.processor';
import { NotificationController } from './app/notification.controller';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      Notification,
      NotificationPreference,
      DeviceToken,
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationProcessor],
  exports: [NotificationService],
})
export class NotificationModule {}
