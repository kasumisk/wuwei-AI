import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserChallenge } from './user-challenge.entity';

@Entity('challenges')
export class Challenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'duration_days', type: 'int', default: 7 })
  durationDays: number;

  @Column({ type: 'jsonb', nullable: true })
  rules: Record<string, any> | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  icon: string | null;

  @Column({ name: 'reward_type', type: 'varchar', length: 50, nullable: true })
  rewardType: string | null;

  @Column({ name: 'reward_value', type: 'int', default: 0 })
  rewardValue: number;

  @OneToMany(() => UserChallenge, (uc) => uc.challenge)
  userChallenges: UserChallenge[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
