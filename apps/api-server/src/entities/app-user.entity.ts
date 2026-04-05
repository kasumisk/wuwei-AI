import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * App 用户认证方式枚举
 */
export enum AppUserAuthType {
  ANONYMOUS = 'anonymous',
  GOOGLE = 'google',
  EMAIL = 'email',
}

/**
 * App 用户状态枚举
 */
export enum AppUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

/**
 * App 用户实体
 */
@Entity('app_users')
@Index(['email'], { unique: true, where: '"email" IS NOT NULL' })
@Index(['googleId'], { unique: true, where: '"google_id" IS NOT NULL' })
@Index(['deviceId'])
export class AppUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AppUserAuthType,
    default: AppUserAuthType.ANONYMOUS,
    name: 'auth_type',
    comment: '认证方式',
  })
  authType: AppUserAuthType;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '邮箱地址',
  })
  email?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    select: false,
    comment: '密码（邮箱登录用）',
  })
  password?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'google_id',
    comment: 'Google 用户ID',
  })
  googleId?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'device_id',
    comment: '设备ID（匿名用户标识）',
  })
  deviceId?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '昵称',
  })
  nickname?: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: '头像URL',
  })
  avatar?: string;

  @Column({
    type: 'enum',
    enum: AppUserStatus,
    default: AppUserStatus.ACTIVE,
    comment: '用户状态',
  })
  status: AppUserStatus;

  @Column({
    type: 'boolean',
    default: false,
    name: 'email_verified',
    comment: '邮箱是否已验证',
  })
  emailVerified: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login_at' })
  lastLoginAt?: Date;

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: '扩展元数据',
  })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
