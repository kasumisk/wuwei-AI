import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppVersion,
  UpdateType,
  AppVersionStatus,
} from '../../entities/app-version.entity';
import { AppVersionPackage } from '../../entities/app-version-package.entity';
import {
  CheckUpdateDto,
  GetLatestVersionQueryDto,
  GetVersionHistoryQueryDto,
} from '../dto/update.dto';

@Injectable()
export class AppUpdateService {
  constructor(
    @InjectRepository(AppVersion)
    private readonly appVersionRepository: Repository<AppVersion>,
    @InjectRepository(AppVersionPackage)
    private readonly packageRepository: Repository<AppVersionPackage>,
  ) {}

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

    const queryBuilder = this.appVersionRepository
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.packages', 'pkg', 'pkg.enabled = true')
      .andWhere('version.status = :status', {
        status: AppVersionStatus.PUBLISHED,
      })
      .orderBy('version.versionCode', 'DESC');

    if (platform) {
      queryBuilder.andWhere(
        '(version.platform = :platform OR version.platform IS NULL)',
        { platform },
      );
    }

    const latestVersion = await queryBuilder.getOne();

    if (!latestVersion || latestVersion.versionCode <= currentVersionCode) {
      return { need_update: false };
    }

    // 优先匹配指定渠道的包，否则取第一个可用包
    const pkg =
      latestVersion.packages?.find((p) => p.channel === channel) ||
      latestVersion.packages?.[0];

    // 灰度发布检查
    if (latestVersion.grayRelease && latestVersion.grayPercent < 100) {
      if (device_id) {
        const hash = this.hashDeviceId(device_id);
        if (hash > latestVersion.grayPercent) {
          const fallbackBuilder = this.appVersionRepository
            .createQueryBuilder('version')
            .leftJoinAndSelect('version.packages', 'pkg', 'pkg.enabled = true')
            .where('version.status = :status', {
              status: AppVersionStatus.PUBLISHED,
            })
            .andWhere('version.versionCode > :currentCode', {
              currentCode: currentVersionCode,
            })
            .andWhere(
              '(version.grayRelease = false OR version.grayPercent = 100)',
            )
            .orderBy('version.versionCode', 'DESC');

          if (platform) {
            fallbackBuilder.andWhere(
              '(version.platform = :platform OR version.platform IS NULL)',
              { platform },
            );
          }

          const fallbackVersion = await fallbackBuilder.getOne();

          if (!fallbackVersion) {
            return { need_update: false };
          }

          return this.buildUpdateResponse(
            fallbackVersion,
            fallbackVersion.packages?.find((p) => p.channel === channel) ||
              fallbackVersion.packages?.[0],
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

    const queryBuilder = this.appVersionRepository
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.packages', 'pkg', 'pkg.enabled = true')
      .where('version.status = :status', {
        status: AppVersionStatus.PUBLISHED,
      })
      .orderBy('version.versionCode', 'DESC');

    if (platform) {
      queryBuilder.andWhere(
        '(version.platform = :platform OR version.platform IS NULL)',
        { platform },
      );
    }

    const latestVersion = await queryBuilder.getOne();

    if (!latestVersion) {
      throw new NotFoundException('暂无可用版本');
    }

    let description = latestVersion.description;
    if (language && latestVersion.i18nDescription?.[language]) {
      description = latestVersion.i18nDescription[language];
    }

    const packages = (latestVersion.packages || []).map((pkg) => ({
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

    const queryBuilder = this.appVersionRepository
      .createQueryBuilder('version')
      .where('version.status = :status', {
        status: AppVersionStatus.PUBLISHED,
      })
      .orderBy('version.versionCode', 'DESC');

    if (platform) {
      queryBuilder.andWhere(
        '(version.platform = :platform OR version.platform IS NULL)',
        { platform },
      );
    }

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [versions, total] = await queryBuilder.getManyAndCount();

    const list = versions.map((v) => {
      let description = v.description;
      if (language && v.i18nDescription?.[language]) {
        description = v.i18nDescription[language];
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
    version: AppVersion,
    pkg: AppVersionPackage | undefined,
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
    if (language && version.i18nDescription?.[language]) {
      description = version.i18nDescription[language];
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
