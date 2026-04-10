/**
 * V6 Phase 1.11 — 推送设备令牌 Entity
 *
 * 存储用户的 FCM/APNs 设备令牌。
 * 一个用户可有多个设备（手机 + 平板），通过 deviceId 区分。
 * 令牌过期或用户登出时标记 isActive=false。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 设备平台 */
export type DevicePlatform = 'ios' | 'android' | 'web';

@Entity('device_token')
@Index('idx_device_token_user', ['userId'])
@Index('idx_device_token_lookup', ['userId', 'deviceId'], { unique: true })
export class DeviceToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** FCM 设备令牌 */
  @Column({ name: 'token', type: 'varchar', length: 500 })
  token: string;

  /** 设备唯一标识（客户端生成，用于更新同一设备的令牌） */
  @Column({ name: 'device_id', type: 'varchar', length: 200 })
  deviceId: string;

  /** 平台 */
  @Column({ name: 'platform', type: 'varchar', length: 10 })
  platform: DevicePlatform;

  /** 是否有效（登出或令牌失效时设为 false） */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
