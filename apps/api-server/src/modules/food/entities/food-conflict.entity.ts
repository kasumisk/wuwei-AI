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

@Entity('food_conflicts')
@Index(['foodId'])
@Index(['resolution'])
export class FoodConflict {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'food_id' })
  foodId: string;

  @Column({
    type: 'varchar',
    length: 50,
    comment: '冲突字段: calories / protein / category ...',
  })
  field: string;

  @Column({
    type: 'jsonb',
    comment:
      '冲突来源: [{"source":"usda","value":165},{"source":"off","value":170}]',
  })
  sources: Array<{ source: string; value: any }>;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
    comment: 'pending / auto_highest_priority / manual / averaged',
  })
  resolution?: string;

  @Column({
    type: 'text',
    nullable: true,
    name: 'resolved_value',
    comment: '最终采用的值',
  })
  resolvedValue?: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'resolved_by' })
  resolvedBy?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'resolved_at' })
  resolvedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => FoodLibrary, (food) => food.conflicts)
  @JoinColumn({ name: 'food_id' })
  food: FoodLibrary;
}
