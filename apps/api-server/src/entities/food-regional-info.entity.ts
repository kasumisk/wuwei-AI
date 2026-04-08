import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { FoodLibrary } from './food-library.entity';

/**
 * 食物地区适配信息
 */
@Entity('food_regional_info')
@Unique(['foodId', 'region'])
export class FoodRegionalInfo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'food_id' })
  foodId: string;

  @Column({ type: 'varchar', length: 10, comment: '地区代码: CN / US / JP / KR / EU' })
  region: string;

  @Column({ type: 'int', default: 0, name: 'local_popularity', comment: '该地区流行度' })
  localPopularity: number;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'local_price_range', comment: '价格区间: low / medium / high' })
  localPriceRange: string;

  @Column({ type: 'varchar', length: 20, nullable: true, comment: '可获得性: common / seasonal / rare' })
  availability: string;

  @Column({ type: 'jsonb', nullable: true, name: 'regulatory_info', comment: '监管信息' })
  regulatoryInfo: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => FoodLibrary, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'food_id' })
  food: FoodLibrary;
}
