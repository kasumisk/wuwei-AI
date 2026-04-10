/**
 * V6 Phase 1.5 — 功能开关实体
 *
 * 支持 4 种开关类型：
 * - BOOLEAN:    全局开/关
 * - PERCENTAGE: 百分比放量（如 10% 用户可见新功能）
 * - USER_LIST:  白名单/黑名单
 * - SEGMENT:    按用户画像段开放（如只对 muscle_builder 开放）
 *
 * 存储层: PostgreSQL feature_flag 表 + Redis 缓存（30s TTL）
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 功能开关类型 */
export enum FeatureFlagType {
  /** 全局开/关 */
  BOOLEAN = 'boolean',
  /** 百分比放量 */
  PERCENTAGE = 'percentage',
  /** 白名单/黑名单 */
  USER_LIST = 'user_list',
  /** 按用户画像段 */
  SEGMENT = 'segment',
}

/**
 * 功能开关实体
 *
 * 设计原则：
 * - key 唯一标识，代码中使用字符串常量引用
 * - 配置存 JSONB，不同类型的 flag 有不同的配置结构
 * - enabled 是全局总开关，false 时无视其他配置
 */
@Entity('feature_flag')
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 功能开关标识 key（唯一，代码中引用） */
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index('IDX_feature_flag_key')
  key: string;

  /** 人类可读名称 */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** 描述 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 开关类型 */
  @Column({
    type: 'enum',
    enum: FeatureFlagType,
    default: FeatureFlagType.BOOLEAN,
  })
  type: FeatureFlagType;

  /** 全局总开关（false = 对所有人关闭） */
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /**
   * 类型相关配置（JSONB）
   *
   * BOOLEAN:    {} （无额外配置，仅看 enabled 字段）
   * PERCENTAGE: { "percentage": 10 }  // 0-100
   * USER_LIST:  { "whitelist": ["userId1", "userId2"], "blacklist": [] }
   * SEGMENT:    { "segments": ["muscle_builder", "fat_loss_warrior"] }
   */
  @Column({ type: 'jsonb', default: {} })
  config: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
