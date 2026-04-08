import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

@Entity('achievements')
@Index(['code'], { unique: true })
export class Achievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  icon: string | null;

  @Column({ type: 'int', default: 1 })
  threshold: number;

  @Column({ name: 'reward_type', type: 'varchar', length: 50, nullable: true })
  rewardType: string | null;

  @Column({ name: 'reward_value', type: 'int', default: 0 })
  rewardValue: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @OneToMany(() => UserAchievement, (ua) => ua.achievement)
  userAchievements: UserAchievement[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
