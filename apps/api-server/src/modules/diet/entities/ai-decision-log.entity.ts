import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_decision_logs')
export class AiDecisionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'record_id', type: 'uuid', nullable: true })
  recordId: string | null;

  @Column({ name: 'input_context', type: 'jsonb', nullable: true })
  inputContext: Record<string, any> | null;

  @Column({ name: 'input_image_url', type: 'text', nullable: true })
  inputImageUrl: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  decision: string | null;

  @Column({ name: 'risk_level', type: 'varchar', length: 5, nullable: true })
  riskLevel: string | null;

  @Column({ name: 'full_response', type: 'jsonb', nullable: true })
  fullResponse: Record<string, any> | null;

  @Column({ name: 'user_followed', type: 'boolean', nullable: true })
  userFollowed: boolean | null;

  @Column({
    name: 'user_feedback',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  userFeedback: string | null;

  @Column({
    name: 'actual_outcome',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  actualOutcome: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
