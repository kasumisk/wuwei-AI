import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 使用记录实体
 * 记录客户端对AI能力的使用情况
 */
@Entity('usage_records')
@Index(['clientId', 'timestamp'])
@Index(['capabilityType', 'timestamp'])
@Index(['provider', 'timestamp'])
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'client_id' })
  clientId: string;

  @Column({ type: 'varchar', length: 255, name: 'request_id' })
  requestId: string;

  @Column({ type: 'varchar', length: 100, name: 'capability_type' })
  capabilityType: string;

  @Column({ type: 'varchar', length: 50 })
  provider: string;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'varchar', length: 20 })
  status: 'success' | 'failed' | 'timeout';

  @Column({ type: 'jsonb' })
  usage: {
    tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    duration?: number; // 秒
    fileSize?: number; // 字节
    [key: string]: any;
  };

  @Column({ type: 'decimal', precision: 10, scale: 6 })
  cost: number; // 美元

  @Column({ type: 'int', name: 'response_time' })
  responseTime: number; // 毫秒

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    userAgent?: string;
    ipAddress?: string;
    errorCode?: string;
    errorMessage?: string;
    [key: string]: any;
  };

  @CreateDateColumn({ type: 'timestamp' })
  timestamp: Date;
}
