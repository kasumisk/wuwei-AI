import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AppVersion,
  UpdateType,
  AppVersionStatus,
} from '../../entities/app-version.entity';
import { AppVersionPackage } from '../../entities/app-version-package.entity';
import {
  CreateAppVersionDto,
  UpdateAppVersionDto,
  GetAppVersionsQueryDto,
  CheckUpdateDto,
  PublishAppVersionDto,
} from '../dto/app-version-management.dto';

@Injectable()
export class AppVersionService {
  constructor(
    @InjectRepository(AppVersion)
    private readonly appVersionRepository: Repository<AppVersion>,
    @InjectRepository(AppVersionPackage)
    private readonly packageRepository: Repository<AppVersionPackage>,
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
    const {
      page = 1,
      pageSize = 10,
      keyword,
      platform,
      status,
      updateType,
    } = query;

    const queryBuilder = this.appVersionRepository
      .createQueryBuilder('version')
      .leftJoinAndSelect('version.packages', 'packages');

    if (keyword) {
      queryBuilder.andWhere(
        '(version.version LIKE :keyword OR version.title LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (platform) {
      queryBuilder.andWhere('version.platform = :platform', { platform });
    }

    if (status) {
      queryBuilder.andWhere('version.status = :status', { status });
    }

    if (updateType) {
      queryBuilder.andWhere('version.updateType = :updateType', { updateType });
    }

    queryBuilder.orderBy('version.versionCode', 'DESC');

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

    return { list, total, page, pageSize };
  }

  /**
   * 获取版本详情（含渠道包）
   */
  async findOne(id: string) {
    const version = await this.appVersionRepository.findOne({
      where: { id },
      relations: ['packages'],
    });

    if (!version) {
      throw new NotFoundException(`版本 #${id} 不存在`);
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
      where.platform = null as any;
    }
    const existing = await this.appVersionRepository.findOne({ where });

    if (existing) {
      const platLabel = createDto.platform || '全平台';
      throw new ConflictException(
        `版本已存在: ${platLabel} v${createDto.version}`,
      );
    }

    const versionCode = this.parseVersionCode(createDto.version);
    const minSupportVersionCode = createDto.minSupportVersion
      ? this.parseVersionCode(createDto.minSupportVersion)
      : undefined;

    const appVersion = this.appVersionRepository.create({
      ...createDto,
      versionCode,
      minSupportVersionCode,
      status: createDto.status || AppVersionStatus.DRAFT,
      grayRelease: createDto.grayRelease || false,
      grayPercent: createDto.grayPercent || 0,
      releaseDate: createDto.releaseDate
        ? new Date(createDto.releaseDate)
        : undefined,
    });

    return await this.appVersionRepository.save(appVersion);
  }

  /**
   * 更新版本
   */
  async update(id: string, updateDto: UpdateAppVersionDto) {
    const version = await this.appVersionRepository.findOne({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(`版本 #${id} 不存在`);
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
          `已发布版本不能修改以下字段: ${invalidKeys.join(', ')}`,
        );
      }
    }

    // 计算 minSupportVersionCode
    if (updateDto.minSupportVersion) {
      (updateDto as any).minSupportVersionCode = this.parseVersionCode(
        updateDto.minSupportVersion,
      );
    }

    if (updateDto.releaseDate) {
      (updateDto as any).releaseDate = new Date(updateDto.releaseDate);
    }

    Object.assign(version, updateDto);

    return await this.appVersionRepository.save(version);
  }

  /**
   * 删除版本
   */
  async remove(id: string) {
    const version = await this.appVersionRepository.findOne({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(`版本 #${id} 不存在`);
    }

    if (version.status === AppVersionStatus.PUBLISHED) {
      throw new BadRequestException('已发布的版本不能直接删除，请先归档');
    }

    await this.appVersionRepository.remove(version);

    return { message: '版本删除成功' };
  }

  /**
   * 发布版本
   */
  async publish(id: string, publishDto?: PublishAppVersionDto) {
    const version = await this.appVersionRepository.findOne({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(`版本 #${id} 不存在`);
    }

    if (version.status === AppVersionStatus.PUBLISHED) {
      throw new BadRequestException('版本已经发布');
    }

    if (version.status === AppVersionStatus.ARCHIVED) {
      throw new BadRequestException('已归档版本不能发布');
    }

    version.status = AppVersionStatus.PUBLISHED;
    version.releaseDate = publishDto?.releaseDate
      ? new Date(publishDto.releaseDate)
      : new Date();

    return await this.appVersionRepository.save(version);
  }

  /**
   * 归档版本
   */
  async archive(id: string) {
    const version = await this.appVersionRepository.findOne({
      where: { id },
    });

    if (!version) {
      throw new NotFoundException(`版本 #${id} 不存在`);
    }

    if (version.status === AppVersionStatus.ARCHIVED) {
      throw new BadRequestException('版本已经归档');
    }

    version.status = AppVersionStatus.ARCHIVED;

    return await this.appVersionRepository.save(version);
  }

  /**
   * 客户端检查更新（公开接口）
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

    // 查找最新的已发布版本（匹配平台或全平台通用），同时加载渠道包
    const queryBuilder = this.appVersionRepository
      .createQueryBuilder('version')
      .leftJoinAndSelect(
        'version.packages',
        'pkg',
        'pkg.enabled = true',
      )
      .where('version.status = :status', {
        status: AppVersionStatus.PUBLISHED,
      })
      .orderBy('version.versionCode', 'DESC');

    if (platform) {
      queryBuilder.andWhere('(version.platform = :platform OR version.platform IS NULL)', { platform });
    }

    const latestVersion = await queryBuilder.getOne();

    // 无最新版本或当前已是最新
    if (!latestVersion || latestVersion.versionCode <= currentVersionCode) {
      return { need_update: false };
    }

    // 取匹配渠道的包，优先匹配指定渠道，否则取第一个可用包
    const pkg = latestVersion.packages?.find(p => p.channel === channel)
      || latestVersion.packages?.[0];

    // 灰度发布检查
    if (latestVersion.grayRelease && latestVersion.grayPercent < 100) {
      if (device_id) {
        const hash = this.hashDeviceId(device_id);
        if (hash > latestVersion.grayPercent) {
          // 不在灰度范围，查找上一个全量发布版本
          const fallbackBuilder = this.appVersionRepository
            .createQueryBuilder('version')
            .leftJoinAndSelect(
              'version.packages',
              'pkg',
              'pkg.enabled = true',
            )
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
            fallbackBuilder.andWhere('(version.platform = :platform OR version.platform IS NULL)', { platform });
          }

          const fallbackVersion = await fallbackBuilder.getOne();

          if (!fallbackVersion) {
            return { need_update: false };
          }

          const fallbackPkg = fallbackVersion.packages?.find(p => p.channel === channel)
            || fallbackVersion.packages?.[0];
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
      description,
      download_url: pkg?.downloadUrl || '',
      file_size: pkg ? Number(pkg.fileSize) : 0,
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
    const total = await this.appVersionRepository.count();
    const published = await this.appVersionRepository.count({
      where: { status: AppVersionStatus.PUBLISHED },
    });
    const draft = await this.appVersionRepository.count({
      where: { status: AppVersionStatus.DRAFT },
    });

    const platformStats = await this.appVersionRepository
      .createQueryBuilder('version')
      .select('version.platform', 'platform')
      .addSelect('COUNT(*)', 'count')
      .groupBy('version.platform')
      .getRawMany();

    return {
      total,
      published,
      draft,
      archived: total - published - draft,
      platformStats,
    };
  }
}
