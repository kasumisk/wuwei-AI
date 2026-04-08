import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 食物分类枚举
 */
export enum FoodCategory {
  STAPLE = '主食',
  MEAT = '肉类',
  VEGETABLE = '蔬菜',
  FRUIT = '水果',
  BEAN = '豆制品',
  SOUP = '汤类',
  DRINK = '饮品',
  SNACK = '零食',
  FAST_FOOD = '快餐',
  SEASONING = '调味料',
}

/**
 * 食物库实体 — 静态食物营养数据
 */
@Entity('foods')
@Index(['searchWeight'])
@Index(['category'])
export class FoodLibrary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true, comment: '别名，逗号分隔' })
  aliases?: string;

  @Column({ type: 'varchar', length: 50, comment: '食物分类' })
  category: string;

  @Column({ type: 'int', name: 'calories_per_100g', comment: '每100g热量 kcal' })
  caloriesPer100g: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'protein_per_100g', comment: '蛋白质 g/100g' })
  proteinPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'fat_per_100g', comment: '脂肪 g/100g' })
  fatPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'carbs_per_100g', comment: '碳水 g/100g' })
  carbsPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'fiber_per_100g', comment: '膳食纤维 g/100g' })
  fiberPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'sugar_per_100g', comment: '糖 g/100g' })
  sugarPer100g?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, name: 'sodium_per_100g', comment: '钠 mg/100g' })
  sodiumPer100g?: number;

  @Column({ type: 'int', nullable: true, name: 'glycemic_index', comment: 'GI值' })
  glycemicIndex?: number;

  @Column({ type: 'boolean', default: false, name: 'is_processed', comment: '是否加工食品' })
  isProcessed: boolean;

  @Column({ type: 'boolean', default: false, name: 'is_fried', comment: '是否油炸' })
  isFried: boolean;

  @Column({ type: 'jsonb', default: [], name: 'meal_types', comment: '适合餐次: breakfast/lunch/dinner/snack' })
  mealTypes: string[];

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'main_ingredient', comment: '主要食材' })
  mainIngredient?: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'sub_category', comment: '子分类' })
  subCategory?: string;

  @Column({ type: 'int', nullable: true, name: 'quality_score', comment: '食物品质评分 1-10' })
  qualityScore?: number;

  @Column({ type: 'int', nullable: true, name: 'satiety_score', comment: '饱腹感评分 1-10' })
  satietyScore?: number;

  @Column({ type: 'int', default: 100, name: 'standard_serving_g', comment: '标准份量克数' })
  standardServingG: number;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'standard_serving_desc', comment: '份量描述 如"1碗约200g"' })
  standardServingDesc?: string;

  @Column({ type: 'int', default: 100, name: 'search_weight', comment: '搜索排序权重' })
  searchWeight: number;

  @Column({ type: 'boolean', default: true, name: 'is_verified' })
  isVerified: boolean;

  @Column({ type: 'jsonb', default: [], comment: '标签：高蛋白/低热量/高饱腹/高脂肪/高碳水/均衡/天然/外卖 等' })
  tags: string[];

  @Column({ type: 'varchar', length: 20, default: 'official', comment: '数据来源: official=官方/estimated=估算/ai=AI识别' })
  source: 'official' | 'estimated' | 'ai';

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1.0, comment: '营养数据置信度 0-1' })
  confidence: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
