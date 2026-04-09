import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { AppVersionPackage } from './app-version-package.entity';

/**
 * 平台类型
 */
export enum AppPlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

/**
 * 更新类型
 */
export enum UpdateType {
  OPTIONAL = 'optional',
  FORCE = 'force',
}

/**
 * 版本状态
 */
export enum AppVersionStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

@Entity('app_versions')
@Index(['platform', 'version'], { unique: true })
export class AppVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * 平台类型: android / ios（可选，为空表示全平台通用）
   */
  @Column({
    type: 'enum',
    enum: AppPlatform,
    nullable: true,
    enumName: 'app_versions_platform_enum',
  })
  platform?: AppPlatform;

  /**
   * 版本号 (Semantic Versioning, e.g. "1.3.0")
   */
  @Column({ type: 'varchar', length: 50 })
  version: string;

  /**
   * 版本号数值（用于比较，e.g. 1*10000 + 3*100 + 0 = 10300）
   */
  @Column({ type: 'int' })
  versionCode: number;

  /**
   * 更新类型: optional / force
   */
  @Column({
    type: 'enum',
    enum: UpdateType,
    default: UpdateType.OPTIONAL,
    enumName: 'app_versions_updateType_enum',
  })
  updateType: UpdateType;

  /**
   * 更新标题
   */
  @Column({ type: 'varchar', length: 255 })
  title: string;

  /**
   * 更新描述（支持 Markdown）
   */
  @Column({ type: 'text' })
  description: string;

  /**
   * 最低支持版本号（低于此版本强制更新）
   */
  @Column({ type: 'varchar', length: 50, nullable: true })
  minSupportVersion?: string;

  /**
   * 最低支持版本号数值
   */
  @Column({ type: 'int', nullable: true })
  minSupportVersionCode?: number;

  /**
   * 版本状态
   */
  @Column({
    type: 'enum',
    enum: AppVersionStatus,
    default: AppVersionStatus.DRAFT,
    enumName: 'app_versions_status_enum',
  })
  status: AppVersionStatus;

  /**
   * 是否启用灰度发布
   */
  @Column({ type: 'boolean', default: false })
  grayRelease: boolean;

  /**
   * 灰度发布比例（0-100）
   */
  @Column({ type: 'int', default: 0 })
  grayPercent: number;

  /**
   * 发布时间
   */
  @Column({ type: 'timestamp', nullable: true })
  releaseDate?: Date;

  /**
   * 多语言描述 (JSON: { "zh-CN": "...", "en-US": "..." })
   */
  @Column({ type: 'jsonb', nullable: true })
  i18nDescription?: Record<string, string>;

  /**
   * 扩展元数据
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  /**
   * 渠道包列表（一个版本对应多个渠道包）
   */
  @OneToMany(() => AppVersionPackage, (pkg) => pkg.version, { cascade: true })
  packages: AppVersionPackage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
