import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AppChannel, STORE_CHANNELS } from '../app-version.types';
import {
  CreateAppVersionPackageDto,
  UpdateAppVersionPackageDto,
} from './dto/app-version-management.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppVersionPackageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  /** 获取某版本的所有渠道包 */
  async findByVersion(versionId: string) {
    await this.assertVersionExists(versionId);
    return this.prisma.appVersionPackages.findMany({
      where: { versionId },
      orderBy: { channel: 'asc' },
    });
  }

  /** 创建渠道包 */
  async create(versionId: string, dto: CreateAppVersionPackageDto) {
    await this.assertVersionExists(versionId);

    const existing = await this.prisma.appVersionPackages.findFirst({
      where: { versionId, channel: dto.channel, platform: dto.platform },
    });
    if (existing) {
      throw new ConflictException(
        this.i18n.t('appVersion.appVersionPackage.alreadyExists', {
          channel: dto.channel,
        }),
      );
    }

    // 商店渠道不需要文件大小和 checksum，自动补全默认商店 URL
    let downloadUrl = dto.downloadUrl;
    if (!downloadUrl && STORE_CHANNELS.includes(dto.channel)) {
      downloadUrl = this.getDefaultStoreUrl(dto.channel);
    }

    if (!downloadUrl) {
      throw new BadRequestException(
        this.i18n.t('appVersion.appVersionPackage.downloadUrlRequired'),
      );
    }

    return this.prisma.appVersionPackages.create({
      data: {
        versionId,
        platform: dto.platform,
        channel: dto.channel,
        downloadUrl,
        fileSize: dto.fileSize ?? 0,
        checksum: dto.checksum,
        enabled: dto.enabled ?? true,
      },
    });
  }

  /** 更新渠道包 */
  async update(
    versionId: string,
    packageId: string,
    dto: UpdateAppVersionPackageDto,
  ) {
    const pkg = await this.findOne(versionId, packageId);

    return this.prisma.appVersionPackages.update({
      where: { id: pkg.id },
      data: dto,
    });
  }

  /** 删除渠道包 */
  async remove(
    versionId: string,
    packageId: string,
  ): Promise<{ message: string }> {
    const pkg = await this.findOne(versionId, packageId);
    await this.prisma.appVersionPackages.delete({ where: { id: pkg.id } });
    return {
      message: this.i18n.t('appVersion.appVersionPackage.deleteSuccess'),
    };
  }

  /** 切换渠道包启用状态 */
  async toggleEnabled(versionId: string, packageId: string) {
    const pkg = await this.findOne(versionId, packageId);

    return this.prisma.appVersionPackages.update({
      where: { id: pkg.id },
      data: { enabled: !pkg.enabled },
    });
  }

  private async findOne(versionId: string, packageId: string) {
    const pkg = await this.prisma.appVersionPackages.findFirst({
      where: { id: packageId, versionId },
    });
    if (!pkg) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersionPackage.notFound', { packageId }),
      );
    }
    return pkg;
  }

  private async assertVersionExists(versionId: string): Promise<void> {
    const count = await this.prisma.appVersions.count({
      where: { id: versionId },
    });
    if (!count) {
      throw new NotFoundException(
        this.i18n.t('appVersion.appVersionPackage.versionNotFound', {
          versionId,
        }),
      );
    }
  }

  /** 获取商店渠道的默认URL */
  getDefaultStoreUrl(channel: AppChannel): string {
    if (channel === AppChannel.APP_STORE) {
      return (
        this.configService.get<string>('APP_STORE_URL') ||
        'https://apps.apple.com/app/id0000000000'
      );
    }
    if (channel === AppChannel.GOOGLE_PLAY) {
      return (
        this.configService.get<string>('GOOGLE_PLAY_URL') ||
        'https://play.google.com/store/apps/details?id=com.example.app'
      );
    }
    return '';
  }

  /** 获取商店渠道默认URL（供前端展示使用） */
  getStoreDefaults() {
    return {
      appStoreUrl:
        this.configService.get<string>('APP_STORE_URL') ||
        'https://apps.apple.com/app/id0000000000',
      googlePlayUrl:
        this.configService.get<string>('GOOGLE_PLAY_URL') ||
        'https://play.google.com/store/apps/details?id=com.example.app',
    };
  }
}
