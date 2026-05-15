import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  PushDeliveryStatus,
  PushDeviceContext,
  PushNotificationType,
  PushPayload,
  PushPlatform,
  PushProviderType,
  PushRegion,
  PushSendOptions,
} from './push.types';
import { PushProviderFactory } from './providers/push-provider.factory';
import { PushTemplateService } from './push-template.service';
import {
  RegisterPushTokenDto,
  UnregisterPushTokenDto,
  UpdatePushPreferencesDto,
} from './dto/push.dto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: PushProviderFactory,
    private readonly templates: PushTemplateService,
  ) {}

  async registerToken(userId: string, dto: RegisterPushTokenDto) {
    const providerType = this.providerFactory.resolveType({
      region: dto.pushRegion,
      platform: dto.platform,
      requested: dto.providerType,
      deviceBrand: dto.deviceBrand,
    });
    const resolved = this.providerFactory.resolve(providerType);
    const valid = await resolved.provider.validateToken(dto.token);

    if (!valid) {
      this.logger.warn(
        `Rejected invalid push token: userId=${userId}, provider=${resolved.actualType}`,
      );
    }

    await this.prisma.pushDeviceToken.updateMany({
      where: {
        userId,
        deviceId: dto.deviceId,
        providerType: { not: resolved.actualType },
        isActive: true,
      },
      data: {
        isActive: false,
        disabledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const savedToken = await this.prisma.pushDeviceToken.upsert({
      where: {
        userId_deviceId_providerType: {
          userId,
          deviceId: dto.deviceId,
          providerType: resolved.actualType,
        },
      },
      create: {
        userId,
        token: dto.token,
        deviceId: dto.deviceId,
        platform: dto.platform,
        pushRegion: dto.pushRegion,
        providerType: resolved.actualType,
        timezone: dto.timezone || 'UTC',
        locale: dto.locale || 'en',
        appVersion: dto.appVersion,
        deviceBrand: dto.deviceBrand,
        romType: dto.romType,
        isActive: valid,
        disabledAt: valid ? null : new Date(),
        invalidatedAt: valid ? null : new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        token: dto.token,
        platform: dto.platform,
        pushRegion: dto.pushRegion,
        providerType: resolved.actualType,
        timezone: dto.timezone || 'UTC',
        locale: dto.locale || 'en',
        appVersion: dto.appVersion,
        deviceBrand: dto.deviceBrand,
        romType: dto.romType,
        isActive: valid,
        disabledAt: valid ? null : new Date(),
        invalidatedAt: valid ? null : new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await this.prisma.userNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        timezone: savedToken.timezone,
        locale: savedToken.locale,
      },
      update: {
        timezone: savedToken.timezone,
        locale: savedToken.locale,
        updatedAt: new Date(),
      },
    });

    return savedToken;
  }

  async unregisterToken(userId: string, dto: UnregisterPushTokenDto) {
    const where: Prisma.PushDeviceTokenWhereInput = { userId };
    if (dto.token) where.token = dto.token;
    if (dto.deviceId) where.deviceId = dto.deviceId;
    if (dto.providerType) where.providerType = dto.providerType;

    const result = await this.prisma.pushDeviceToken.updateMany({
      where,
      data: {
        isActive: false,
        disabledAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { disabledCount: result.count };
  }

  async getPreferences(userId: string) {
    return this.prisma.userNotificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async updatePreferences(userId: string, dto: UpdatePushPreferencesDto) {
    return this.prisma.userNotificationPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: { ...dto, updatedAt: new Date() },
    });
  }

  async send(options: PushSendOptions) {
    if (!UUID_RE.test(options.userId)) return { sent: 0, failed: 0 };

    const user = await this.prisma.appUsers.findUnique({
      where: { id: options.userId },
      select: { id: true, status: true },
    });
    if (!user || user.status !== 'active') return { sent: 0, failed: 0 };

    const preference = await this.getPreferences(options.userId);
    if (!options.force && !this.isAllowed(preference, options.type)) {
      return { sent: 0, failed: 0, skipped: true };
    }

    const devices = await this.prisma.pushDeviceToken.findMany({
      where: { userId: options.userId, isActive: true },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (devices.length === 0) return { sent: 0, failed: 0 };

    return this.dispatchToDevices(
      devices.map((device) => this.toDeviceContext(device)),
      options,
      preference.locale,
    );
  }

  async invalidateToken(deviceTokenId: string, reason?: string) {
    await this.prisma.pushDeviceToken.updateMany({
      where: { id: deviceTokenId },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        disabledAt: new Date(),
        updatedAt: new Date(),
      },
    });
    this.logger.debug(
      `Invalidated push token ${deviceTokenId}: ${reason ?? ''}`,
    );
  }

  async getAdminOverview() {
    const [activeDevices, inactiveDevices, failedLogs, sentLogs, byProvider] =
      await Promise.all([
        this.prisma.pushDeviceToken.count({ where: { isActive: true } }),
        this.prisma.pushDeviceToken.count({ where: { isActive: false } }),
        this.prisma.pushNotificationLog.count({
          where: { status: PushDeliveryStatus.FAILED },
        }),
        this.prisma.pushNotificationLog.count({
          where: { status: PushDeliveryStatus.SENT },
        }),
        this.prisma.pushDeviceToken.groupBy({
          by: ['providerType', 'pushRegion', 'isActive'],
          _count: { _all: true },
        }),
      ]);

    return {
      activeDevices,
      inactiveDevices,
      failedLogs,
      sentLogs,
      byProvider,
    };
  }

  async getAdminUserDetail(userId: string) {
    const [user, preference, devices, logs, activeDeviceCount, inactiveDeviceCount] =
      await Promise.all([
        this.prisma.appUsers.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            nickname: true,
            avatar: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
          },
        }),
        this.getPreferences(userId),
        this.prisma.pushDeviceToken.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          take: 20,
        }),
        this.prisma.pushNotificationLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.pushDeviceToken.count({ where: { userId, isActive: true } }),
        this.prisma.pushDeviceToken.count({ where: { userId, isActive: false } }),
      ]);

    if (!user) {
      throw new NotFoundException(`Push user not found: ${userId}`);
    }

    return {
      user,
      preference,
      devices,
      logs,
      summary: {
        activeDeviceCount,
        inactiveDeviceCount,
        sentLogCount: logs.filter((item) => item.status === PushDeliveryStatus.SENT)
          .length,
        failedLogCount: logs.filter(
          (item) => item.status === PushDeliveryStatus.FAILED,
        ).length,
      },
    };
  }

  async getAdminDevices(filters: {
    userId?: string;
    providerType?: string;
    pushRegion?: string;
    isActive?: string;
    limit?: string;
  }) {
    const where: Prisma.PushDeviceTokenWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.providerType)
      where.providerType = filters.providerType as PushProviderType;
    if (filters.pushRegion) where.pushRegion = filters.pushRegion as PushRegion;
    if (filters.isActive === 'true') where.isActive = true;
    if (filters.isActive === 'false') where.isActive = false;

    const limit = Math.min(Number(filters.limit) || 50, 200);
    const list = await this.prisma.pushDeviceToken.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return { list, total: list.length };
  }

  async getAdminLogs(filters: {
    userId?: string;
    notificationType?: string;
    providerType?: string;
    status?: string;
    limit?: string;
  }) {
    const where: Prisma.PushNotificationLogWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.notificationType) {
      where.notificationType = filters.notificationType as PushNotificationType;
    }
    if (filters.providerType) {
      where.providerType = filters.providerType as PushProviderType;
    }
    if (filters.status) {
      where.status = filters.status as PushDeliveryStatus;
    }

    const limit = Math.min(Number(filters.limit) || 50, 200);
    const list = await this.prisma.pushNotificationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { list, total: list.length };
  }

  async getAdminProviderHealth() {
    const [deviceStats, logStats] = await Promise.all([
      this.prisma.pushDeviceToken.groupBy({
        by: ['providerType', 'isActive'],
        _count: { _all: true },
      }),
      this.prisma.pushNotificationLog.groupBy({
        by: ['providerType', 'status'],
        _count: { _all: true },
      }),
    ]);

    return this.providerFactory.getProviderHealth().map((provider) => ({
      ...provider,
      activeDevices: this.groupCount(deviceStats, {
        providerType: provider.type,
        isActive: true,
      }),
      inactiveDevices: this.groupCount(deviceStats, {
        providerType: provider.type,
        isActive: false,
      }),
      sentLogs: this.groupCount(logStats, {
        providerType: provider.type,
        status: PushDeliveryStatus.SENT,
      }),
      failedLogs: this.groupCount(logStats, {
        providerType: provider.type,
        status: PushDeliveryStatus.FAILED,
      }),
    }));
  }

  async disableAdminDevice(id: string) {
    await this.invalidateToken(id, 'disabled_by_admin');
    return { id, disabled: true };
  }

  async retryAdminLog(id: string) {
    const log = await this.prisma.pushNotificationLog.findUnique({
      where: { id },
      include: { deviceToken: true },
    });

    if (!log) {
      throw new NotFoundException(`Push log not found: ${id}`);
    }

    const payload = this.normalizePayload(log.notificationType, log.payload);
    const retryPayload: PushPayload = {
      ...payload,
      source: 'push_admin_retry',
      retryOfLogId: log.id,
    };

    if (log.deviceToken?.isActive) {
      const result = await this.dispatchToDevices(
        [this.toDeviceContext(log.deviceToken)],
        {
          userId: log.userId,
          type: log.notificationType,
          payload: retryPayload,
          scheduledFor: new Date(),
          force: true,
        },
        log.deviceToken.locale,
      );

      return {
        retried: true,
        mode: 'device',
        originalLogId: id,
        ...result,
      };
    }

    const result = await this.send({
      userId: log.userId,
      type: log.notificationType,
      payload: retryPayload,
      scheduledFor: new Date(),
      force: true,
    });

    return {
      retried: true,
      mode: 'user',
      originalLogId: id,
      ...result,
    };
  }

  async cleanupInvalidTokens(limit?: number) {
    const logs = await this.prisma.pushNotificationLog.findMany({
      where: {
        status: PushDeliveryStatus.FAILED,
        deviceTokenId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit ?? 200, 1), 1000),
      select: {
        id: true,
        deviceTokenId: true,
        errorCode: true,
        errorMessage: true,
      },
    });

    const invalidDeviceIds = Array.from(
      new Set(
        logs
          .filter((item) => this.isInvalidTokenFailure(item.errorCode, item.errorMessage))
          .map((item) => item.deviceTokenId)
          .filter((item): item is string => Boolean(item)),
      ),
    );

    if (invalidDeviceIds.length === 0) {
      return {
        scannedLogs: logs.length,
        matchedDeviceIds: 0,
        cleanedCount: 0,
      };
    }

    const result = await this.prisma.pushDeviceToken.updateMany({
      where: {
        id: { in: invalidDeviceIds },
        isActive: true,
      },
      data: {
        isActive: false,
        invalidatedAt: new Date(),
        disabledAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return {
      scannedLogs: logs.length,
      matchedDeviceIds: invalidDeviceIds.length,
      cleanedCount: result.count,
    };
  }

  private isAllowed(
    preference: Awaited<ReturnType<PushService['getPreferences']>>,
    type: PushNotificationType,
  ): boolean {
    if (!preference.pushEnabled) return false;
    switch (type) {
      case PushNotificationType.DAILY_CHECK_IN:
        return preference.dailyCheckInEnabled;
      case PushNotificationType.NO_ANALYSIS_TODAY:
        return preference.noAnalysisTodayEnabled;
      case PushNotificationType.WEEKLY_REPORT_READY:
        return preference.weeklyReportEnabled;
      case PushNotificationType.ANALYSIS_FOLLOW_UP:
        return preference.analysisFollowUpEnabled;
      case PushNotificationType.PREMIUM_UPGRADE_HINT:
        return preference.premiumUpgradeHintEnabled;
    }
  }

  private defaultTarget(type: PushNotificationType): PushPayload['target'] {
    switch (type) {
      case PushNotificationType.WEEKLY_REPORT_READY:
        return 'weekly_report';
      case PushNotificationType.ANALYSIS_FOLLOW_UP:
        return 'analysis_detail';
      case PushNotificationType.PREMIUM_UPGRADE_HINT:
        return 'premium';
      case PushNotificationType.DAILY_CHECK_IN:
      case PushNotificationType.NO_ANALYSIS_TODAY:
        return 'home';
    }
  }

  private async dispatchToDevices(
    devices: PushDeviceContext[],
    options: PushSendOptions,
    fallbackLocale: string,
  ) {
    const locale = options.locale || devices[0]?.locale || fallbackLocale;
    const rendered = this.templates.render(options.type, locale);
    const payload: PushPayload = {
      target: this.defaultTarget(options.type),
      source: 'push',
      ...options.payload,
    };

    let sent = 0;
    let failed = 0;
    const groups = this.groupDevices(devices);

    for (const [providerType, group] of groups) {
      const resolved = this.providerFactory.resolve(providerType);
      const results = await resolved.provider.sendBatch(group, {
        userId: options.userId,
        type: options.type,
        title: rendered.title,
        body: rendered.body,
        payload,
        scheduledFor: options.scheduledFor,
      });

      for (const result of results) {
        const device = group.find((item) => item.token === result.token);
        if (result.success) sent += 1;
        else failed += 1;

        await this.prisma.pushNotificationLog.create({
          data: {
            userId: options.userId,
            deviceTokenId: device?.id,
            notificationType: options.type,
            providerType: resolved.actualType,
            pushRegion: device?.pushRegion ?? PushRegion.GLOBAL,
            status: result.success
              ? PushDeliveryStatus.SENT
              : PushDeliveryStatus.FAILED,
            title: rendered.title,
            body: rendered.body,
            payload: payload as Prisma.InputJsonValue,
            providerMessageId: result.providerMessageId,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            scheduledFor: options.scheduledFor,
            sentAt: result.success ? new Date() : null,
          },
        });

        if (result.invalidToken && device) {
          await this.invalidateToken(device.id, result.errorCode);
        }
      }
    }

    return { sent, failed };
  }

  private normalizePayload(
    type: PushNotificationType,
    rawPayload: Prisma.JsonValue | null,
  ): PushPayload {
    const payloadRecord =
      rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, string | number | boolean | null>)
        : {};

    const target = payloadRecord.target;
    const normalizedTarget =
      target === 'home' ||
      target === 'analysis_detail' ||
      target === 'weekly_report' ||
      target === 'premium'
        ? target
        : this.defaultTarget(type);

    return {
      ...payloadRecord,
      target: normalizedTarget,
    };
  }

  private toDeviceContext(device: {
    id: string;
    userId: string;
    token: string;
    platform: PushPlatform;
    pushRegion: PushRegion;
    providerType: PushProviderType;
    timezone: string;
    locale: string;
  }): PushDeviceContext {
    return {
      id: device.id,
      userId: device.userId,
      token: device.token,
      platform: device.platform,
      pushRegion: device.pushRegion,
      providerType: device.providerType,
      timezone: device.timezone,
      locale: device.locale,
    };
  }

  private isInvalidTokenFailure(
    errorCode?: string | null,
    errorMessage?: string | null,
  ) {
    const haystack = `${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase();
    return [
      'invalid',
      'unregistered',
      'not_registered',
      'registration-token-not-registered',
      'device token not for topic',
    ].some((keyword) => haystack.includes(keyword));
  }

  private groupCount<
    T extends { _count: { _all: number } },
    U extends Partial<Omit<T, '_count'>>,
  >(groups: T[], expected: U) {
    return (
      groups.find((item) =>
        Object.entries(expected).every(
          ([key, value]) => item[key as keyof U & keyof T] === value,
        ),
      )?._count._all ?? 0
    );
  }

  private groupDevices(devices: PushDeviceContext[]) {
    const groups = new Map<PushProviderType, PushDeviceContext[]>();
    for (const device of devices) {
      const list = groups.get(device.providerType) ?? [];
      list.push(device);
      groups.set(device.providerType, list);
    }
    return groups;
  }
}
