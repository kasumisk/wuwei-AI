import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UpdateType, AppVersionStatus } from '../app-version.types';
import {
  CheckUpdateDto,
  GetLatestVersionQueryDto,
  GetVersionHistoryQueryDto,
} from './dto/update.dto';

@Injectable()
export class AppUpdateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将语义化版本号转换为数值（用于比较）
   */
  private parseVersionCode(version: string): number {
    const parts = version.split('.').map(Number);
    return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  }

  /**
   * 客户端检查更新
   */
  async checkUpdate(checkDto: CheckUpdateDto) {
    const {
      platform,
      current_version,
      channel = 'official',
      device_id,
      language,
    } = checkDto;

    const currentVersionCode = this.parseVersionCode(current_version);

    const latestVersion = await this.prisma.app_versions.findFirst({
      where: {
        status: AppVersionStatus.PUBLISHED,
        ...(platform
          ? {
              OR: [{ platform }, { platform: null }],
            }
          : {}),
      },
      include: {
        app_version_packages: {
          where: { enabled: true },
        },
      },
      orderBy: { versionCode: 'desc' },
    });

    if (!latestVersion || latestVersion.versionCode <= currentVersionCode) {
      return { need_update: false };
    }

    // 优先匹配指定渠道的包，否则取第一个可用包
    const pkg =
      latestVersion.app_version_packages?.find((p) => p.channel === channel) ||
      latestVersion.app_version_packages?.[0];

    // 灰度发布检查
    if (latestVersion.grayRelease && latestVersion.grayPercent < 100) {
      if (device_id) {
        const hash = this.hashDeviceId(device_id);
        if (hash > latestVersion.grayPercent) {
          const fallbackVersion = await this.prisma.app_versions.findFirst({
            where: {
              status: AppVersionStatus.PUBLISHED,
              versionCode: { gt: currentVersionCode },
              OR: [{ grayRelease: false }, { grayPercent: 100 }],
              ...(platform
                ? {
                    AND: [
                      {
                        OR: [{ platform }, { platform: null }],
                      },
                    ],
                  }
                : {}),
            },
            include: {
              app_version_packages: {
                where: { enabled: true },
              },
            },
            orderBy: { versionCode: 'desc' },
          });

          if (!fallbackVersion) {
            return { need_update: false };
          }

          return this.buildUpdateResponse(
            fallbackVersion,
            fallbackVersion.app_version_packages?.find(
              (p) => p.channel === channel,
            ) || fallbackVersion.app_version_packages?.[0],
            currentVersionCode,
            language,
          );
        }
      }
    }

    return this.buildUpdateResponse(
      latestVersion,
      pkg,
      currentVersionCode,
      language,
    );
  }

  /**
   * 获取最新版本信息
   */
  async getLatestVersion(query: GetLatestVersionQueryDto) {
    const { platform, channel: _channel = 'official', language } = query;

    const latestVersion = await this.prisma.app_versions.findFirst({
      where: {
        status: AppVersionStatus.PUBLISHED,
        ...(platform
          ? {
              OR: [{ platform }, { platform: null }],
            }
          : {}),
      },
      include: {
        app_version_packages: {
          where: { enabled: true },
        },
      },
      orderBy: { versionCode: 'desc' },
    });

    if (!latestVersion) {
      throw new NotFoundException('暂无可用版本');
    }

    let description = latestVersion.description;
    if (
      language &&
      latestVersion.i18nDescription &&
      (latestVersion.i18nDescription as Record<string, string>)[language]
    ) {
      description = (latestVersion.i18nDescription as Record<string, string>)[
        language
      ];
    }

    const packages = (latestVersion.app_version_packages || []).map((pkg) => ({
      id: pkg.id,
      platform: pkg.platform,
      channel: pkg.channel,
      downloadUrl: pkg.downloadUrl,
      fileSize: Number(pkg.fileSize),
      checksum: pkg.checksum || null,
    }));

    return {
      version: latestVersion.version,
      versionCode: latestVersion.versionCode,
      platform: latestVersion.platform || null,
      title: latestVersion.title,
      description,
      updateType: latestVersion.updateType,
      releaseDate: latestVersion.releaseDate,
      minSupportVersion: latestVersion.minSupportVersion || null,
      packages,
      i18nDescription: latestVersion.i18nDescription || null,
      metadata: latestVersion.metadata || null,
    };
  }

  /**
   * 获取版本更新历史
   */
  async getVersionHistory(query: GetVersionHistoryQueryDto) {
    const { platform, page = 1, pageSize = 10, language } = query;

    const where = {
      status: AppVersionStatus.PUBLISHED as any,
      ...(platform
        ? {
            OR: [{ platform }, { platform: null }],
          }
        : {}),
    };

    const skip = (page - 1) * pageSize;

    const [versions, total] = await Promise.all([
      this.prisma.app_versions.findMany({
        where,
        orderBy: { versionCode: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.app_versions.count({ where }),
    ]);

    const list = versions.map((v) => {
      let description = v.description;
      if (
        language &&
        v.i18nDescription &&
        (v.i18nDescription as Record<string, string>)[language]
      ) {
        description = (v.i18nDescription as Record<string, string>)[language];
      }
      return {
        version: v.version,
        versionCode: v.versionCode,
        platform: v.platform || null,
        title: v.title,
        description,
        updateType: v.updateType,
        releaseDate: v.releaseDate,
      };
    });

    return { list, total, page, pageSize };
  }

  // ==================== 私有方法 ====================

  private buildUpdateResponse(
    version: any,
    pkg: any | undefined,
    currentVersionCode: number,
    language?: string,
  ) {
    let updateType = version.updateType;
    if (
      version.minSupportVersionCode &&
      currentVersionCode < version.minSupportVersionCode
    ) {
      updateType = UpdateType.FORCE;
    }

    let description = version.description;
    if (
      language &&
      version.i18nDescription &&
      (version.i18nDescription as Record<string, string>)[language]
    ) {
      description = (version.i18nDescription as Record<string, string>)[
        language
      ];
    }

    return {
      need_update: true,
      latest_version: version.version,
      update_type: updateType,
      title: version.title,
      description,
      download_url: pkg?.downloadUrl || '',
      file_size: pkg ? Number(pkg.fileSize) : 0,
      checksum: pkg?.checksum || undefined,
      min_support_version: version.minSupportVersion,
    };
  }

  private hashDeviceId(deviceId: string): number {
    let hash = 0;
    for (let i = 0; i < deviceId.length; i++) {
      const char = deviceId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100;
  }
}
