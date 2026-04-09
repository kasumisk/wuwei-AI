import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ProviderType, ProviderStatus } from '@ai-platform/shared';
import { ModelConfig } from './model-config.entity';

/**
 * 提供商配置实体
 */
@Entity('providers')
@Index(['name'], { unique: true })
export class Provider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: ProviderType,
  })
  type: ProviderType;

  @Column({ type: 'varchar', length: 500 })
  baseUrl: string;

  @Column({ type: 'varchar', length: 500 })
  apiKey: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  healthCheckUrl?: string;

  @Column({ type: 'int', default: 30000 })
  timeout: number;

  @Column({ type: 'int', default: 3 })
  retryCount: number;

  @Column({
    type: 'enum',
    enum: ProviderStatus,
    default: ProviderStatus.ACTIVE,
  })
  status: ProviderStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastHealthCheck?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ModelConfig, (model) => model.provider)
  models: ModelConfig[];
}
