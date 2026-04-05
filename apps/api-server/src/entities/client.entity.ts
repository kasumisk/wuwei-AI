import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ClientCapabilityPermission } from './client-capability-permission.entity';

/**
 * 客户端实体
 * 管理使用平台的客户端信息
 */
@Entity('clients')
@Index(['apiKey'], { unique: true })
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'api_key' })
  apiKey: string;

  @Column({ type: 'varchar', length: 255, name: 'api_secret' })
  apiSecret: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'suspended' | 'inactive';

  @Column({ type: 'jsonb', nullable: true, name: 'quota_config' })
  quotaConfig?: {
    monthlyQuota?: number; // 月配额（美元）
    dailyQuota?: number; // 日配额（美元）
    enableAutoRecharge?: boolean; // 是否自动充值
    alertThreshold?: number; // 告警阈值（百分比）
    [key: string]: any;
  };

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    company?: string;
    email?: string;
    phone?: string;
    [key: string]: any;
  };

  @OneToMany(
    () => ClientCapabilityPermission,
    (permission) => permission.client,
    { cascade: true },
  )
  permissions: ClientCapabilityPermission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
