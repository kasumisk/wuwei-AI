import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';
import { AppVersion, AppVersionStatus, AppPlatform } from '../entities/app-version.entity';
import { AppVersionPackage } from '../entities/app-version-package.entity';
import * as crypto from 'crypto';

@Injectable()
export class AppVersionService {
  private readonly logger = new Logger(AppVersionService.name);

  constructor(
    @InjectRepository(AppVersion)
    private versionRepo: Repository<AppVersion>,
    @InjectRepository(AppVersionPackage)
    private packageRepo: Repository<AppVersionPackage>,
  ) {}

  async findAll(query: {
    platform?: AppPlatform;
    status?: AppVersionStatus;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { platform, status, keyword, page = 1, pageSize = 20 } = query;
    const where: FindOptionsWhere<AppVersion> = {};
    if (platform) where.platform = platform;
    if (status) where.status = status;

    const qb = this.versionRepo.createQueryBuilder('v')
      .leftJoinAndSelect('v.packages', 'packages')
      .orderBy('v.versionCode', 'DESC');

    if (platform) qb.andWhere('v.platform = :platform', { platform });
    if (status) qb.andWhere('v.status = :status', { status });
    if (keyword) qb.andWhere('(v.version ILIKE :kw OR v.title ILIKE :kw)', { kw: `%${keyword}%` });

    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const ver = await this.versionRepo.findOne({
      where: { id },
      relations: ['packages'],
    });
    if (!ver) throw new NotFoundException('版本不存在');
    return ver;
  }

  async create(data: Partial<AppVersion>) {
    const ver = this.versionRepo.create(data);
    return this.versionRepo.save(ver);
  }

  async update(id: string, data: Partial<AppVersion>) {
    await this.findOne(id);
    await this.versionRepo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) {
    const ver = await this.findOne(id);
    return this.versionRepo.remove(ver);
  }

  async publish(id: string) {
    const ver = await this.findOne(id);
    ver.status = AppVersionStatus.PUBLISHED;
    ver.releaseDate = new Date();
    return this.versionRepo.save(ver);
  }

  async archive(id: string) {
    const ver = await this.findOne(id);
    ver.status = AppVersionStatus.ARCHIVED;
    return this.versionRepo.save(ver);
  }

  async checkUpdate(platform: AppPlatform, currentVersionCode: number, deviceId?: string) {
    const latest = await this.versionRepo.findOne({
      where: { platform, status: AppVersionStatus.PUBLISHED },
      relations: ['packages'],
      order: { versionCode: 'DESC' },
    });

    if (!latest || latest.versionCode <= currentVersionCode) {
      return { hasUpdate: false };
    }

    // Gray release check
    if (latest.grayRelease && latest.grayPercent < 100 && deviceId) {
      const hash = this.hashDeviceId(deviceId);
      if (hash % 100 >= latest.grayPercent) {
        return { hasUpdate: false };
      }
    }

    const isForce = latest.minSupportVersionCode
      ? currentVersionCode < latest.minSupportVersionCode
      : false;

    return {
      hasUpdate: true,
      version: latest,
      forceUpdate: isForce,
    };
  }

  private hashDeviceId(deviceId: string): number {
    const hash = crypto.createHash('md5').update(deviceId).digest('hex');
    return parseInt(hash.slice(0, 8), 16) % 100;
  }

  // ===== Package management =====

  async findPackagesByVersion(versionId: string) {
    return this.packageRepo.find({ where: { versionId } });
  }

  async createPackage(versionId: string, data: Partial<AppVersionPackage>) {
    await this.findOne(versionId);
    const pkg = this.packageRepo.create({ ...data, versionId });
    return this.packageRepo.save(pkg);
  }

  async updatePackage(id: string, data: Partial<AppVersionPackage>) {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException('安装包不存在');
    await this.packageRepo.update(id, data);
    return this.packageRepo.findOne({ where: { id } });
  }

  async removePackage(id: string) {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException('安装包不存在');
    return this.packageRepo.remove(pkg);
  }

  async togglePackage(id: string, enabled: boolean) {
    const pkg = await this.packageRepo.findOne({ where: { id } });
    if (!pkg) throw new NotFoundException('安装包不存在');
    pkg.enabled = enabled;
    return this.packageRepo.save(pkg);
  }
}
