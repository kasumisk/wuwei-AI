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

export enum AppPlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum UpdateType {
  OPTIONAL = 'optional',
  FORCE = 'force',
}

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

  @Column({
    type: 'enum',
    enum: AppPlatform,
    nullable: true,
    enumName: 'app_versions_platform_enum',
  })
  platform?: AppPlatform;

  @Column({ type: 'varchar', length: 50 })
  version: string;

  @Column({ type: 'int' })
  versionCode: number;

  @Column({
    type: 'enum',
    enum: UpdateType,
    default: UpdateType.OPTIONAL,
    enumName: 'app_versions_updateType_enum',
  })
  updateType: UpdateType;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  minSupportVersion?: string;

  @Column({ type: 'int', nullable: true })
  minSupportVersionCode?: number;

  @Column({
    type: 'enum',
    enum: AppVersionStatus,
    default: AppVersionStatus.DRAFT,
    enumName: 'app_versions_status_enum',
  })
  status: AppVersionStatus;

  @Column({ type: 'boolean', default: false })
  grayRelease: boolean;

  @Column({ type: 'int', default: 0 })
  grayPercent: number;

  @Column({ type: 'timestamp', nullable: true })
  releaseDate?: Date;

  @Column({ type: 'jsonb', nullable: true })
  i18nDescription?: Record<string, string>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @OneToMany(() => AppVersionPackage, (pkg) => pkg.version, { cascade: true })
  packages: AppVersionPackage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
