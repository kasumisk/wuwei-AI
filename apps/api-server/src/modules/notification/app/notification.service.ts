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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  Notification,
  NotificationType,
} from '../entities/notification.entity';
import { NotificationPreference } from '../entities/notification-preference.entity';
import { DeviceToken, DevicePlatform } from '../entities/device-token.entity';
import { QUEUE_NAMES } from '../../../core/queue/queue.constants';

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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(DeviceToken)
    private readonly deviceTokenRepo: Repository<DeviceToken>,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION)
    private readonly notificationQueue: Queue,
  ) {}

  // ─── 发送通知（核心方法） ───

  /**
   * 发送通知
   *
   * 1. 检查用户偏好（是否允许该类型通知）
   * 2. 创建站内信记录
   * 3. 如果 push=true 且用户开启推送，投递到队列异步推送
   */
  async send(params: SendNotificationParams): Promise<Notification | null> {
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
    const notification = this.notificationRepo.create({
      userId,
      type,
      title,
      body,
      data: data || null,
    });
    const saved = await this.notificationRepo.save(notification);

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
  ): Promise<{ items: Notification[]; total: number }> {
    const [items, total] = await this.notificationRepo.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  /**
   * 查询未读通知数量
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationRepo.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * 标记单条通知为已读
   */
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    await this.notificationRepo.update(
      { id: notificationId, userId },
      { isRead: true, readAt: new Date() },
    );
  }

  /**
   * 标记用户所有通知为已读
   */
  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationRepo.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return result.affected || 0;
  }

  // ─── 偏好管理 ───

  /**
   * 获取用户通知偏好（不存在则返回默认值）
   */
  async getPreference(userId: string): Promise<NotificationPreference> {
    const pref = await this.preferenceRepo.findOne({ where: { userId } });
    if (pref) return pref;

    // 返回默认偏好（不持久化，用户主动修改时才存储）
    const defaultPref = new NotificationPreference();
    defaultPref.userId = userId;
    defaultPref.pushEnabled = true;
    defaultPref.enabledTypes = [];
    defaultPref.quietStart = null;
    defaultPref.quietEnd = null;
    return defaultPref;
  }

  /**
   * 更新用户通知偏好（upsert）
   */
  async updatePreference(
    userId: string,
    updates: Partial<
      Pick<
        NotificationPreference,
        'pushEnabled' | 'enabledTypes' | 'quietStart' | 'quietEnd'
      >
    >,
  ): Promise<NotificationPreference> {
    let pref = await this.preferenceRepo.findOne({ where: { userId } });
    if (!pref) {
      pref = this.preferenceRepo.create({ userId });
    }
    Object.assign(pref, updates);
    return this.preferenceRepo.save(pref);
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
  ): Promise<DeviceToken> {
    let existing = await this.deviceTokenRepo.findOne({
      where: { userId, deviceId },
    });
    if (existing) {
      existing.token = token;
      existing.platform = platform;
      existing.isActive = true;
      return this.deviceTokenRepo.save(existing);
    }
    const newToken = this.deviceTokenRepo.create({
      userId,
      token,
      deviceId,
      platform,
      isActive: true,
    });
    return this.deviceTokenRepo.save(newToken);
  }

  /**
   * 注销设备令牌（登出时调用）
   */
  async deactivateDeviceToken(userId: string, deviceId: string): Promise<void> {
    await this.deviceTokenRepo.update(
      { userId, deviceId },
      { isActive: false },
    );
  }

  /**
   * 获取用户所有活跃设备令牌
   */
  async getActiveDeviceTokens(userId: string): Promise<DeviceToken[]> {
    return this.deviceTokenRepo.find({
      where: { userId, isActive: true },
    });
  }

  /**
   * 标记令牌为失效（FCM 返回 invalid token 时调用）
   */
  async invalidateToken(tokenValue: string): Promise<void> {
    await this.deviceTokenRepo.update(
      { token: tokenValue },
      { isActive: false },
    );
  }

  /**
   * 标记通知为已推送（Processor 成功推送后调用）
   */
  async markAsPushed(notificationId: string): Promise<void> {
    await this.notificationRepo.update(notificationId, { isPushed: true });
  }

  // ─── 便捷发送方法 ───

  /** 餐次提醒 */
  async sendMealReminder(userId: string, mealType: string): Promise<void> {
    const mealLabels: Record<string, string> = {
      breakfast: '早餐',
      lunch: '午餐',
      dinner: '晚餐',
      snack: '加餐',
    };
    const label = mealLabels[mealType] || mealType;
    await this.send({
      userId,
      type: 'meal_reminder',
      title: `${label}时间到了`,
      body: `查看今日${label}推荐，保持健康饮食习惯`,
      data: { mealType },
    });
  }

  /** 连续性风险提醒 */
  async sendStreakRisk(userId: string, currentStreak: number): Promise<void> {
    await this.send({
      userId,
      type: 'streak_risk',
      title: '别让连续记录中断',
      body: `你已经连续记录 ${currentStreak} 天了，今天还差一次记录就能继续保持！`,
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
      title: '本周目标进展',
      body: `本周已达成 ${achieved}/${total} 天目标，继续加油！`,
      data: { achieved, total },
    });
  }

  /** 周报就绪 */
  async sendWeeklyReport(userId: string): Promise<void> {
    await this.send({
      userId,
      type: 'weekly_report',
      title: '周度营养报告已生成',
      body: '查看你的周度营养分析和改善建议',
    });
  }

  /** 推荐就绪（预计算完成） */
  async sendPrecomputedReady(userId: string): Promise<void> {
    await this.send({
      userId,
      type: 'precomputed_ready',
      title: '今日餐单已备好',
      body: '查看为你精心准备的一日三餐推荐',
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
    preference: NotificationPreference,
    type: NotificationType,
  ): boolean {
    if (!preference.enabledTypes || preference.enabledTypes.length === 0) {
      return true; // 空列表 = 全部接收
    }
    return preference.enabledTypes.includes(type);
  }
}
