import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppVersionPackage,
  AppChannel,
  STORE_CHANNELS,
} from '../../entities/app-version-package.entity';
import { AppVersion } from '../../entities/app-version.entity';
import {
  CreateAppVersionPackageDto,
  UpdateAppVersionPackageDto,
} from '../dto/app-version-management.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppVersionPackageService {
  constructor(
    @InjectRepository(AppVersionPackage)
    private readonly packageRepository: Repository<AppVersionPackage>,
    @InjectRepository(AppVersion)
    private readonly versionRepository: Repository<AppVersion>,
    private readonly configService: ConfigService,
  ) {}

  /** 获取某版本的所有渠道包 */
  async findByVersion(versionId: string): Promise<AppVersionPackage[]> {
    await this.assertVersionExists(versionId);
    return this.packageRepository.find({
      where: { versionId },
      order: { channel: 'ASC' },
    });
  }

  /** 创建渠道包 */
  async create(
    versionId: string,
    dto: CreateAppVersionPackageDto,
  ): Promise<AppVersionPackage> {
    await this.assertVersionExists(versionId);

    const existing = await this.packageRepository.findOne({
      where: { versionId, channel: dto.channel, platform: dto.platform },
    });
    if (existing) {
      throw new ConflictException(`渠道包已存在: ${dto.platform} ${dto.channel}，请直接编辑`);
    }

    // 商店渠道不需要文件大小和 checksum，自动补全默认商店 URL
    let downloadUrl = dto.downloadUrl;
    if (!downloadUrl && STORE_CHANNELS.includes(dto.channel)) {
      downloadUrl = this.getDefaultStoreUrl(dto.channel);
    }

    if (!downloadUrl) {
      throw new BadRequestException('下载链接不能为空');
    }

    const pkg = this.packageRepository.create({
      versionId,
      platform: dto.platform,
      channel: dto.channel,
      downloadUrl,
      fileSize: dto.fileSize ?? 0,
      checksum: dto.checksum,
      enabled: dto.enabled ?? true,
    });

    return this.packageRepository.save(pkg);
  }

  /** 更新渠道包 */
  async update(
    versionId: string,
    packageId: string,
    dto: UpdateAppVersionPackageDto,
  ): Promise<AppVersionPackage> {
    const pkg = await this.findOne(versionId, packageId);
    Object.assign(pkg, dto);
    return this.packageRepository.save(pkg);
  }

  /** 删除渠道包 */
  async remove(
    versionId: string,
    packageId: string,
  ): Promise<{ message: string }> {
    const pkg = await this.findOne(versionId, packageId);
    await this.packageRepository.remove(pkg);
    return { message: '渠道包删除成功' };
  }

  /** 切换渠道包启用状态 */
  async toggleEnabled(
    versionId: string,
    packageId: string,
  ): Promise<AppVersionPackage> {
    const pkg = await this.findOne(versionId, packageId);
    pkg.enabled = !pkg.enabled;
    return this.packageRepository.save(pkg);
  }

  private async findOne(
    versionId: string,
    packageId: string,
  ): Promise<AppVersionPackage> {
    const pkg = await this.packageRepository.findOne({
      where: { id: packageId, versionId },
    });
    if (!pkg) {
      throw new NotFoundException(`渠道包 #${packageId} 不存在`);
    }
    return pkg;
  }

  private async assertVersionExists(versionId: string): Promise<void> {
    const count = await this.versionRepository.count({
      where: { id: versionId },
    });
    if (!count) {
      throw new NotFoundException(`版本 #${versionId} 不存在`);
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
