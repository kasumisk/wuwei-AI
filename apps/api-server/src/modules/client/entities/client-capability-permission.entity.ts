import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from './client.entity';

/**
 * 客户端能力权限实体
 * 管理客户端对各种AI能力的访问权限
 */
@Entity('client_capability_permissions')
@Index(['clientId', 'capabilityType'], { unique: true })
export class ClientCapabilityPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId: string;

  @Column({ type: 'varchar', length: 100, name: 'capability_type' })
  capabilityType: string; // 如: text.generation

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 60, name: 'rate_limit' })
  rateLimit: number; // 每分钟请求限制

  @Column({ type: 'bigint', nullable: true, name: 'quota_limit' })
  quotaLimit?: number; // 配额限制（文本: token数, 图像: 图片数）

  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    name: 'preferred_provider',
  })
  preferredProvider?: string; // 首选提供商

  @Column({
    type: 'simple-array',
    nullable: true,
    name: 'allowed_providers',
  })
  allowedProviders?: string[]; // 允许的提供商列表

  @Column({
    type: 'simple-array',
    nullable: true,
    name: 'allowed_models',
  })
  allowedModels?: string[]; // 允许的模型列表

  @Column({ type: 'jsonb', nullable: true })
  config?: {
    maxConcurrentRequests?: number;
    fallbackEnabled?: boolean; // 允许故障转移
    costLimit?: number; // 单次请求最大成本（美元）
    customParams?: any;
    [key: string]: any;
  };

  @ManyToOne(() => Client, (client) => client.permissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'client_id' })
  client: Client;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
