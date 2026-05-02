import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UpdateType, AppVersionStatus } from '../app-version.types';
import {
  CreateAppVersionDto,
  UpdateAppVersionDto,
  GetAppVersionsQueryDto,
  CheckUpdateDto,
  PublishAppVersionDto,
} from './dto/app-version-management.dto';

@Injectable()
export class AppVersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 将语义化版本号转换为数值（用于比较）
   * e.g. "1.3.0" => 10300, "2.10.5" => 21005
   */
  private parseVersionCode(version: string): number {
    const parts = version.split('.').map(Number);
    return (parts[0] || 0) * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
  }

  /**
   * 获取版本列表（分页）
   */
  async findAll(query: GetAppVersionsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const { keyword, platform, status, updateType } = query;

    const where: any = {};

    if (keyword) {
      where.OR = [
        { version: { contains: keyword, mode: 'insensitive' } },
        { title: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (platform) {
      where.platform = platform;
    }

    if (status) {
      where.status = status;
    }

    if (updateType) {
      where.updateType = updateType;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.appVersions.findMany({
        where,
        include: { appVersionPackages: true },
        orderBy: { versionCode: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.appVersions.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  /**
   * 获取版本详情（含渠道包）
   */
  async findOne(id: string) {
    const version = await this.prisma.appVersions.findUnique({
      where: { id },
      include: { appVersionPackages: true },
    });

    if (!version) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersion.notFound', { id }),
      );
    }

    return version;
  }

  /**
   * 创建版本
   */
  async create(createDto: CreateAppVersionDto) {
    // 检查版本号是否已存在（同平台+版本号不能重复）
    const where: any = { version: createDto.version };
    if (createDto.platform) {
      where.platform = createDto.platform;
    } else {
      where.platform = null;
    }
    const existing = await this.prisma.appVersions.findFirst({ where });

    if (existing) {
      const platLabel = createDto.platform || 'all';
      throw new ConflictException(
        this.i18n.t('appVersion.appVersion.alreadyExists', {
          platform: platLabel,
          version: createDto.version,
        }),
      );
    }

    const versionCode = this.parseVersionCode(createDto.version);
    const minSupportVersionCode = createDto.minSupportVersion
      ? this.parseVersionCode(createDto.minSupportVersion)
      : undefined;

    const appVersion = await this.prisma.appVersions.create({
      data: {
        ...createDto,
        versionCode,
        minSupportVersionCode,
        status: createDto.status || AppVersionStatus.DRAFT,
        grayRelease: createDto.grayRelease || false,
        grayPercent: createDto.grayPercent || 0,
        releaseDate: createDto.releaseDate
          ? new Date(createDto.releaseDate)
          : undefined,
      },
    });

    return appVersion;
  }

  /**
   * 更新版本
   */
  async update(id: string, updateDto: UpdateAppVersionDto) {
    const version = await this.prisma.appVersions.findUnique({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersion.notFound', { id }),
      );
    }

    // 已发布的版本只能修改部分字段
    if (version.status === AppVersionStatus.PUBLISHED) {
      const allowedFields = [
        'updateType',
        'description',
        'grayRelease',
        'grayPercent',
        'i18nDescription',
        'metadata',
      ];
      const updateKeys = Object.keys(updateDto).filter(
        (k) => updateDto[k] !== undefined,
      );
      const invalidKeys = updateKeys.filter((k) => !allowedFields.includes(k));
      if (invalidKeys.length > 0) {
        throw new BadRequestException(
          this.i18n.t('appVersion.appVersion.cannotUpdatePublishedFields', {
            fields: invalidKeys.join(', '),
          }),
        );
      }
    }

    // 计算 minSupportVersionCode
    const data: any = { ...updateDto };
    if (updateDto.minSupportVersion) {
      data.minSupportVersionCode = this.parseVersionCode(
        updateDto.minSupportVersion,
      );
    }

    if (updateDto.releaseDate) {
      data.releaseDate = new Date(updateDto.releaseDate);
    }

    return await this.prisma.appVersions.update({
      where: { id },
      data,
    });
  }

  /**
   * 删除版本
   */
  async remove(id: string) {
    const version = await this.prisma.appVersions.findUnique({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersion.notFound', { id }),
      );
    }

    if (version.status === AppVersionStatus.PUBLISHED) {
      throw new BadRequestException(
        this.i18n.t('appVersion.appVersion.cannotDeletePublished'),
      );
    }

    await this.prisma.appVersions.delete({ where: { id } });

    return { message: this.i18n.t('appVersion.appVersion.deleteSuccess') };
  }

  /**
   * 发布版本
   */
  async publish(id: string, publishDto?: PublishAppVersionDto) {
    const version = await this.prisma.appVersions.findUnique({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersion.notFound', { id }),
      );
    }

    if (version.status === AppVersionStatus.PUBLISHED) {
      throw new BadRequestException(
        this.i18n.t('appVersion.appVersion.alreadyPublished'),
      );
    }

    if (version.status === AppVersionStatus.ARCHIVED) {
      throw new BadRequestException(
        this.i18n.t('appVersion.appVersion.cannotPublishArchived'),
      );
    }

    return await this.prisma.appVersions.update({
      where: { id },
      data: {
        status: AppVersionStatus.PUBLISHED,
        releaseDate: publishDto?.releaseDate
          ? new Date(publishDto.releaseDate)
          : new Date(),
      },
    });
  }

  /**
   * 归档版本
   */
  async archive(id: string) {
    const version = await this.prisma.appVersions.findUnique({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersion.notFound', { id }),
      );
    }

    if (version.status === AppVersionStatus.ARCHIVED) {
      throw new BadRequestException(
        this.i18n.t('appVersion.appVersion.alreadyArchived'),
      );
    }

    return await this.prisma.appVersions.update({
      where: { id },
      data: { status: AppVersionStatus.ARCHIVED },
    });
  }

  /**
   * 客户端检查更新（公开接口）
   */
  async checkUpdate(checkDto: CheckUpdateDto) {
    const {
      platform,
      currentVersion,
      channel = 'official',
      deviceId,
      language,
    } = checkDto;

    const currentVersionCode = this.parseVersionCode(currentVersion);

    // 查找最新的已发布版本（匹配平台或全平台通用），同时加载渠道包
    const latestVersion = await this.prisma.appVersions.findFirst({
      where: {
        status: AppVersionStatus.PUBLISHED,
        ...(platform
          ? {
              OR: [{ platform }, { platform: null }],
            }
          : {}),
      },
      include: {
        appVersionPackages: {
          where: { enabled: true },
        },
      },
      orderBy: { versionCode: 'desc' },
    });

    // 无最新版本或当前已是最新
    if (!latestVersion || latestVersion.versionCode <= currentVersionCode) {
      return { needUpdate: false };
    }

    // 取匹配渠道的包，优先匹配指定渠道，否则取第一个可用包
    const pkg =
      latestVersion.appVersionPackages?.find((p) => p.channel === channel) ||
      latestVersion.appVersionPackages?.[0];

    // 灰度发布检查
    if (latestVersion.grayRelease && latestVersion.grayPercent < 100) {
      if (deviceId) {
        const hash = this.hashDeviceId(deviceId);
        if (hash > latestVersion.grayPercent) {
          // 不在灰度范围，查找上一个全量发布版本
          const fallbackVersion = await this.prisma.appVersions.findFirst({
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
              appVersionPackages: {
                where: { enabled: true },
              },
            },
            orderBy: { versionCode: 'desc' },
          });

          if (!fallbackVersion) {
            return { needUpdate: false };
          }

          const fallbackPkg =
            fallbackVersion.appVersionPackages?.find(
              (p) => p.channel === channel,
            ) || fallbackVersion.appVersionPackages?.[0];
          return this.buildUpdateResponse(
            fallbackVersion,
            fallbackPkg,
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
   * 构建更新响应
   */
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
      needUpdate: true,
      latestVersion: version.version,
      updateType,
      description,
      downloadUrl: pkg?.downloadUrl || '',
      fileSize: pkg ? Number(pkg.fileSize) : 0,
      checksum: pkg?.checksum || undefined,
    };
  }

  /**
   * 基于 device_id 生成 0-100 的哈希值（用于灰度发布）
   */
  private hashDeviceId(deviceId: string): number {
    let hash = 0;
    for (let i = 0; i < deviceId.length; i++) {
      const char = deviceId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100;
  }

  /**
   * 获取版本统计信息
   */
  async getStats() {
    const [total, published, draft, platformStats] = await Promise.all([
      this.prisma.appVersions.count(),
      this.prisma.appVersions.count({
        where: { status: AppVersionStatus.PUBLISHED },
      }),
      this.prisma.appVersions.count({
        where: { status: AppVersionStatus.DRAFT },
      }),
      this.prisma.appVersions.groupBy({
        by: ['platform'],
        _count: { _all: true },
      }),
    ]);

    return {
      total,
      published,
      draft,
      archived: total - published - draft,
      platformStats: platformStats.map((s) => ({
        platform: s.platform,
        count: s._count._all,
      })),
    };
  }
}
