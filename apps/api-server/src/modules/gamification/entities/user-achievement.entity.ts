import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { Achievement } from './achievement.entity';

@Entity('user_achievements')
@Index(['userId', 'achievementId'], { unique: true })
export class UserAchievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'achievement_id', type: 'uuid' })
  achievementId: string;

  @Column({ name: 'unlocked_at', type: 'timestamptz' })
  unlockedAt: Date;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @ManyToOne(() => Achievement, (a) => a.userAchievements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'achievement_id' })
  achievement: Achievement;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
