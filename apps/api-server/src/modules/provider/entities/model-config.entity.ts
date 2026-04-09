import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CapabilityType, ModelStatus, Currency } from '@ai-platform/shared';
import { Provider } from './provider.entity';

/**
 * 模型配置实体
 */
@Entity('model_configs')
@Index(['providerId', 'modelName', 'capabilityType'], { unique: true })
export class ModelConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  providerId: string;

  @Column({ type: 'varchar', length: 100 })
  modelName: string;

  @Column({ type: 'varchar', length: 100 })
  displayName: string;

  @Column({
    type: 'enum',
    enum: CapabilityType,
  })
  capabilityType: CapabilityType;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({
    type: 'enum',
    enum: ModelStatus,
    default: ModelStatus.ACTIVE,
  })
  status: ModelStatus;

  // 定价配置
  @Column({ type: 'decimal', precision: 10, scale: 6 })
  inputCostPer1kTokens: number;

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  outputCostPer1kTokens: number;

  @Column({
    type: 'enum',
    enum: Currency,
    default: Currency.USD,
  })
  currency: Currency;

  // 限制配置
  @Column({ type: 'int' })
  maxTokens: number;

  @Column({ type: 'int', nullable: true })
  maxRequestsPerMinute?: number;

  @Column({ type: 'int' })
  contextWindow: number;

  // 功能配置
  @Column({ type: 'boolean', default: false })
  streaming: boolean;

  @Column({ type: 'boolean', default: false })
  functionCalling: boolean;

  @Column({ type: 'boolean', default: false })
  vision: boolean;

  // ========== 扩展配置字段（来自原 CapabilityConfig） ==========

  /**
   * 自定义端点（覆盖 Provider 的 baseUrl）
   * 某些模型可能需要不同的 endpoint
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  endpoint?: string;

  /**
   * 自定义 API Key（覆盖 Provider 的 apiKey）
   * 某些模型可能需要单独的认证
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  customApiKey?: string;

  /**
   * 自定义超时时间（毫秒）
   */
  @Column({ type: 'int', nullable: true })
  customTimeout?: number;

  /**
   * 自定义重试次数
   */
  @Column({ type: 'int', nullable: true })
  customRetries?: number;

  /**
   * 额外的配置元数据
   * 存储原 capability config 的其他字段
   */
  @Column({ type: 'jsonb', nullable: true })
  configMetadata?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Provider, (provider) => provider.models, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'providerId' })
  provider: Provider;
}
