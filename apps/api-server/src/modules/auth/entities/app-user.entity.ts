import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum AuthType {
  ANONYMOUS = 'anonymous',
  GOOGLE = 'google',
  EMAIL = 'email',
  PHONE = 'phone',
  WECHAT = 'wechat',
  WECHAT_MINI = 'wechat_mini',
  APPLE = 'apple',
}

export enum AppUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

@Entity('app_users')
export class AppUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: AuthType,
    default: AuthType.ANONYMOUS,
    name: 'auth_type',
  })
  authType: AuthType;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, select: false })
  password?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'google_id', unique: true })
  googleId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'device_id', unique: true })
  deviceId?: string;

  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'wechat_open_id', unique: true })
  wechatOpenId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'wechat_union_id' })
  wechatUnionId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'wechat_mini_open_id', unique: true })
  wechatMiniOpenId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'apple_id', unique: true })
  appleId?: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  nickname?: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatar?: string;

  @Column({
    type: 'enum',
    enum: AppUserStatus,
    default: AppUserStatus.ACTIVE,
  })
  status: AppUserStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
