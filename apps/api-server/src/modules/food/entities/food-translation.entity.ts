import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { FoodLibrary } from './food-library.entity';

@Entity('food_translations')
@Unique(['foodId', 'locale'])
@Index(['locale'])
export class FoodTranslation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'food_id' })
  foodId: string;

  @Column({ type: 'varchar', length: 10, comment: 'zh-CN / zh-TW / en-US / ja-JP / ko-KR' })
  locale: string;

  @Column({ type: 'varchar', length: 200, comment: '当地语言名称' })
  name: string;

  @Column({ type: 'text', nullable: true, comment: '别名，逗号分隔' })
  aliases?: string;

  @Column({ type: 'text', nullable: true, comment: '食物描述' })
  description?: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'serving_desc', comment: '本地化份量描述' })
  servingDesc?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => FoodLibrary, (food) => food.translations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'food_id' })
  food: FoodLibrary;
}
