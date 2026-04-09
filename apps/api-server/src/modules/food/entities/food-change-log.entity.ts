import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { FoodLibrary } from './food-library.entity';

@Entity('food_change_logs')
@Index(['foodId', 'version'])
export class FoodChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'food_id' })
  foodId: string;

  @Column({ type: 'int', comment: '版本号' })
  version: number;

  @Column({
    type: 'varchar',
    length: 20,
    comment: 'create / update / merge / verify / archive',
  })
  action: string;

  @Column({
    type: 'jsonb',
    comment: '变更内容: {"field": {"old": x, "new": y}}',
  })
  changes: Record<string, any>;

  @Column({ type: 'text', nullable: true, comment: '变更原因' })
  reason?: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: '操作人: admin / ai_pipeline / usda_sync',
  })
  operator?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => FoodLibrary, (food) => food.changeLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'food_id' })
  food: FoodLibrary;
}
