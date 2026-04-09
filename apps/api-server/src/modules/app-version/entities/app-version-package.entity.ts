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
import { AppVersion, AppPlatform } from './app-version.entity';

/**
 * 渠道类型
 * - official / beta: 需要上传安装包
 * - app_store / google_play: 商店渠道，填写商店 URL，不上传安装包
 */
export enum AppChannel {
  OFFICIAL = 'official',
  BETA = 'beta',
  APP_STORE = 'app_store',
  GOOGLE_PLAY = 'google_play',
}

/**
 * 商店渠道列表（无需上传安装包）
 */
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

  /**
   * 所属版本 ID（外键）
   */
  @Column({ type: 'uuid' })
  versionId: string;

  @ManyToOne(() => AppVersion, (version) => version.packages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'versionId' })
  version: AppVersion;

  /**
   * 平台类型: android / ios
   */
  @Column({
    type: 'enum',
    enum: AppPlatform,
    enumName: 'app_version_packages_platform_enum',
  })
  platform: AppPlatform;

  /**
   * 渠道：official | beta | app_store | google_play
   */
  @Column({ type: 'varchar', length: 50 })
  channel: string;

  /**
   * 下载 / 商店链接
   */
  @Column({ type: 'varchar', length: 1000 })
  downloadUrl: string;

  /**
   * 文件大小（字节），商店渠道可为 0
   */
  @Column({ type: 'bigint', default: 0 })
  fileSize: number;

  /**
   * 文件校验值（md5:xxx），商店渠道可为空
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  checksum?: string;

  /**
   * 是否启用（可单独禁用某渠道包）
   */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
