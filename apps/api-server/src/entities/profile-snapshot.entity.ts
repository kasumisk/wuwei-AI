import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('profile_snapshots')
export class ProfileSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, any>;

  @Column({ name: 'trigger_type', type: 'varchar', length: 30 })
  triggerType: string;

  @Column({ name: 'changed_fields', type: 'jsonb' })
  changedFields: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
