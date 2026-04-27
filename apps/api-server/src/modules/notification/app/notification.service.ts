/**
 * V6 Phase 1.11 — NotificationService（通知核心服务）
 *
 * 核心职责：
 * 1. 站内信 CRUD: 创建、查询、标记已读、未读计数
 * 2. 推送调度: 将通知投递到 BullMQ 队列，由 Processor 异步推送
 * 3. 偏好管理: 查询/更新用户通知偏好，发送前检查是否允许
 * 4. 设备令牌: 注册/注销 FCM 设备令牌
 * 5. 便捷方法: 按场景发送通知（餐次提醒、连续性风险、目标进展等）
 *
 * 集成方式：
 * - 其他模块通过注入 NotificationService 调用 send() / sendPush()
 * - 也可通过域事件监听自动触发（Phase 1 暂不自动监听，留给 Phase 2 精细化）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QUEUE_NAMES } from '../../../core/queue/queue.constants';
import { I18nService } from '../../../core/i18n/i18n.service';

// ─── 类型定义 ───

/** 通知类型枚举 */
export type NotificationType =
  | 'meal_reminder' // 餐次提醒
  | 'streak_risk' // 连续性风险
  | 'goal_progress' // 目标进展
  | 'weekly_report' // 周报就绪
  | 'coach_nudge' // 教练提醒
  | 'precomputed_ready' // 推荐就绪
  | 'system'; // 系统通知

/** 设备平台 */
export type DevicePlatform = 'ios' | 'android' | 'web';

// ─── Job 数据结构 ───

export interface NotificationJobData {
  /** 通知记录 ID（已存入 notification 表） */
  notificationId: string;
  /** 目标用户 ID */
  userId: string;
  /** 通知类型 */
  type: NotificationType;
  /** 标题 */
  title: string;
  /** 正文 */
  body: string;
  /** 附加数据 */
  data?: Record<string, unknown>;
}

// ─── 发送参数 ───

export interface SendNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** 是否同时推送到设备（默认 true） */
  push?: boolean;
}

// ─── 偏好类型 ───

interface NotificationPreferenceData {
  id?: string;
  userId: string;
  pushEnabled: boolean;
  enabledTypes: string[];
  quietStart: string | null;
  quietEnd: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION)
    private readonly notificationQueue: Queue,
    private readonly i18n: I18nService,
  ) {}

  // ─── 发送通知（核心方法） ───

  /**
   * 发送通知
   *
   * 1. 检查用户偏好（是否允许该类型通知）
   * 2. 创建站内信记录
   * 3. 如果 push=true 且用户开启推送，投递到队列异步推送
   */
  async send(params: SendNotificationParams) {
    const { userId, type, title, body, data, push = true } = params;

    // 检查用户偏好
    const preference = await this.getPreference(userId);
    if (!this.isTypeAllowed(preference, type)) {
      this.logger.debug(
        `通知已跳过（用户禁用该类型）: userId=${userId}, type=${type}`,
      );
      return null;
    }

    // 创建站内信
    const saved = await this.prisma.notification.create({
      data: {
        userId: userId,
        type,
        title,
        body,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    // 投递推送任务
    if (push && preference.pushEnabled) {
      const jobData: NotificationJobData = {
        notificationId: saved.id,
        userId,
        type,
        title,
        body,
        data,
      };
      await this.notificationQueue.add(`push-${type}`, jobData, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    }

    return saved;
  }

  // ─── 站内信查询 ───

  /**
   * 查询用户站内信列表（分页，按时间倒序）
   */
  async getNotifications(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ items: any[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({
        where: { userId: userId },
      }),
    ]);
    return { items, total };
  }

  /**
   * 查询未读通知数量
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId: userId, isRead: false },
    });
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId: userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /**
   * 标记用户所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return result.count;
  }

  // ─── 偏好管理 ───

  /**
   * 获取用户通知偏好（不存在则返回默认值）
   */
  async getPreference(userId: string): Promise<NotificationPreferenceData> {
    const pref = await this.prisma.notificationPreference.findFirst({
      where: { userId: userId },
    });
    if (pref) return pref as unknown as NotificationPreferenceData;

    // 返回默认偏好（不持久化，用户主动修改时才存储）
    return {
      userId: userId,
      pushEnabled: true,
      enabledTypes: [],
      quietStart: null,
      quietEnd: null,
    };
  }

  /**
   * 更新用户通知偏好（upsert）
   */
  async updatePreference(
    userId: string,
    updates: Partial<{
      pushEnabled: boolean;
      enabledTypes: string[];
      quietStart: string | null;
      quietEnd: string | null;
    }>,
  ): Promise<NotificationPreferenceData> {
    const result = await this.prisma.notificationPreference.upsert({
      where: { userId: userId },
      create: {
        userId: userId,
        ...updates,
      },
      update: {
        ...updates,
      },
    });
    return result as unknown as NotificationPreferenceData;
  }

  // ─── 设备令牌管理 ───

  /**
   * 注册/更新设备推送令牌
   *
   * 同一 (userId, deviceId) 的令牌会被覆盖。
   */
  async registerDeviceToken(
    userId: string,
    token: string,
    deviceId: string,
    platform: DevicePlatform,
  ) {
    const existing = await this.prisma.deviceToken.findFirst({
      where: { userId: userId, deviceId: deviceId },
    });
    if (existing) {
      return this.prisma.deviceToken.update({
        where: { id: existing.id },
        data: {
          token,
          platform,
          isActive: true,
        },
      });
    }
    return this.prisma.deviceToken.create({
      data: {
        userId: userId,
        token,
        deviceId: deviceId,
        platform,
        isActive: true,
      },
    });
  }

  /**
   * 注销设备令牌（登出时调用）
   */
  async deactivateDeviceToken(userId: string, deviceId: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { userId: userId, deviceId: deviceId },
      data: { isActive: false },
    });
  }

  /**
   * 获取用户所有活跃设备令牌
   */
  async getActiveDeviceTokens(userId: string) {
    return this.prisma.deviceToken.findMany({
      where: { userId: userId, isActive: true },
    });
  }

  /**
   * 标记令牌为失效（FCM 返回 invalid token 时调用）
   */
  async invalidateToken(tokenValue: string): Promise<void> {
    await this.prisma.deviceToken.updateMany({
      where: { token: tokenValue },
      data: { isActive: false },
    });
  }

  /**
   * 标记通知为已推送（Processor 成功推送后调用）
   */
  async markAsPushed(notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { isPushed: true },
    });
  }

  // ─── 便捷发送方法 ───

  /** 餐次提醒 */
  async sendMealReminder(userId: string, mealType: string): Promise<void> {
    const mealKeyMap: Record<string, string> = {
      breakfast: 'notification.meal.breakfast',
      lunch: 'notification.meal.lunch',
      dinner: 'notification.meal.dinner',
      snack: 'notification.meal.snack',
    };
    const labelKey = mealKeyMap[mealType];
    const label = labelKey ? this.i18n.t(labelKey) : mealType;
    await this.send({
      userId,
      type: 'meal_reminder',
      title: this.i18n.t('notification.push.mealReminder.title', { label }),
      body: this.i18n.t('notification.push.mealReminder.body', { label }),
      data: { mealType },
    });
  }

  /** 连续性风险提醒 */
  async sendStreakRisk(userId: string, currentStreak: number): Promise<void> {
    await this.send({
      userId,
      type: 'streak_risk',
      title: this.i18n.t('notification.push.streakRisk.title'),
      body: this.i18n.t('notification.push.streakRisk.body', { currentStreak }),
      data: { currentStreak },
    });
  }

  /** 目标进展 */
  async sendGoalProgress(
    userId: string,
    achieved: number,
    total: number,
  ): Promise<void> {
    await this.send({
      userId,
      type: 'goal_progress',
      title: this.i18n.t('notification.push.goalProgress.title'),
      body: this.i18n.t('notification.push.goalProgress.body', {
        achieved,
        total,
      }),
      data: { achieved, total },
    });
  }

  /** 周报就绪 */
  async sendWeeklyReport(userId: string): Promise<void> {
    await this.send({
      userId,
      type: 'weekly_report',
      title: this.i18n.t('notification.push.weeklyReport.title'),
      body: this.i18n.t('notification.push.weeklyReport.body'),
    });
  }

  /** 推荐就绪（预计算完成） */
  async sendPrecomputedReady(userId: string): Promise<void> {
    await this.send({
      userId,
      type: 'precomputed_ready',
      title: this.i18n.t('notification.push.precomputedReady.title'),
      body: this.i18n.t('notification.push.precomputedReady.body'),
    });
  }

  // ─── 私有方法 ───

  /**
   * 检查该通知类型是否被用户允许
   *
   * enabledTypes 为空数组 → 全部允许（默认行为）
   * enabledTypes 非空 → 仅允许列表中的类型
   */
  private isTypeAllowed(
    preference: NotificationPreferenceData,
    type: NotificationType,
  ): boolean {
    if (!preference.enabledTypes || preference.enabledTypes.length === 0) {
      return true; // 空列表 = 全部接收
    }
    return preference.enabledTypes.includes(type);
  }
}
