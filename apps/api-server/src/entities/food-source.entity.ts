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

@Entity('food_sources')
@Index(['foodId'])
@Index(['sourceType'])
export class FoodSource {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'food_id' })
  foodId: string;

  @Column({ type: 'varchar', length: 50, name: 'source_type', comment: 'usda / openfoodfacts / edamam / crawl_meituan / ai_deepseek' })
  sourceType: string;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'source_id', comment: '该来源中的原始ID' })
  sourceId?: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'source_url', comment: '原始数据URL' })
  sourceUrl?: string;

  @Column({ type: 'jsonb', name: 'raw_data', comment: '原始数据完整保存' })
  rawData: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true, name: 'mapped_data', comment: '映射到标准字段后的数据' })
  mappedData?: Record<string, any>;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0.8, comment: '来源置信度' })
  confidence: number;

  @Column({ type: 'boolean', default: false, name: 'is_primary', comment: '是否为主数据源' })
  isPrimary: boolean;

  @Column({ type: 'int', default: 50, comment: '来源优先级 1-100' })
  priority: number;

  @Column({ type: 'timestamp', default: () => 'NOW()', name: 'fetched_at', comment: '抓取时间' })
  fetchedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => FoodLibrary, (food) => food.sources, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'food_id' })
  food: FoodLibrary;
}
