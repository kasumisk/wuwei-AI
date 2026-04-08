import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AppVersion } from './app-version.entity';

// 重新声明以避免循环导入
export enum PackagePlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum AppChannel {
  OFFICIAL = 'official',
  BETA = 'beta',
  APP_STORE = 'app_store',
  GOOGLE_PLAY = 'google_play',
}

export const STORE_CHANNELS = [AppChannel.APP_STORE, AppChannel.GOOGLE_PLAY];

@Entity('app_version_packages')
@Index(
  'IDX_app_version_packages_version_channel_platform',
  ['versionId', 'channel', 'platform'],
  { unique: true },
)
export class AppVersionPackage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  versionId: string;

  @ManyToOne(() => AppVersion, (version) => version.packages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'versionId' })
  version: AppVersion;

  @Column({
    type: 'enum',
    enum: PackagePlatform,
    enumName: 'app_version_packages_platform_enum',
  })
  platform: PackagePlatform;

  @Column({ type: 'varchar', length: 50 })
  channel: string;

  @Column({ type: 'varchar', length: 1000 })
  downloadUrl: string;

  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  checksum?: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
