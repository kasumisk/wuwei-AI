import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { Challenge } from './challenge.entity';

export enum ChallengeStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  FAILED = 'failed',
  ABANDONED = 'abandoned',
}

@Entity('user_challenges')
@Index(['userId', 'challengeId'])
export class UserChallenge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'challenge_id', type: 'uuid' })
  challengeId: string;

  @Column({ name: 'current_progress', type: 'int', default: 0 })
  currentProgress: number;

  @Column({ name: 'max_progress', type: 'int', default: 0 })
  maxProgress: number;

  @Column({ type: 'enum', enum: ChallengeStatus, default: ChallengeStatus.ACTIVE })
  status: ChallengeStatus;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @ManyToOne(() => Challenge, (c) => c.userChallenges, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'challenge_id' })
  challenge: Challenge;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
