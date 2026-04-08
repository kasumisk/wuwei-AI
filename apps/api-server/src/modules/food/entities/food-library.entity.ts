import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { FoodTranslation } from './food-translation.entity';
import { FoodSource } from './food-source.entity';
import { FoodChangeLog } from './food-change-log.entity';
import { FoodConflict } from './food-conflict.entity';

export enum FoodCategory {
  PROTEIN = 'protein',
  GRAIN = 'grain',
  VEGGIE = 'veggie',
  FRUIT = 'fruit',
  DAIRY = 'dairy',
  FAT = 'fat',
  BEVERAGE = 'beverage',
  SNACK = 'snack',
  CONDIMENT = 'condiment',
  COMPOSITE = 'composite',
}

export enum FoodStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
  MERGED = 'merged',
}

@Entity('foods')
@Index(['searchWeight'])
@Index(['category'])
@Index(['code'], { unique: true })
@Index(['barcode'])
@Index(['status'])
@Index(['primarySource'])
export class FoodLibrary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true, comment: '全局唯一编码: FOOD_CN_001' })
  code: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true, comment: '别名，逗号分隔' })
  aliases?: string;

  @Column({ type: 'varchar', length: 50, nullable: true, comment: 'EAN-13/UPC条形码' })
  barcode?: string;

  @Column({ type: 'varchar', length: 20, default: 'draft', comment: '状态: draft/active/archived/merged' })
  status: string;

  @Column({ type: 'varchar', length: 30, comment: '一级分类: protein/grain/veggie/fruit/dairy/fat/beverage/snack/condiment/composite' })
  category: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'sub_category', comment: '二级分类: lean_meat/whole_grain/leafy_green...' })
  subCategory?: string;

  @Column({ type: 'varchar', length: 30, nullable: true, name: 'food_group', comment: '多样性分组: meat/poultry/seafood/legume...' })
  foodGroup?: string;

  @Column({ type: 'decimal', precision: 7, scale: 1, comment: '热量 kcal/100g' })
  calories: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '蛋白质 g/100g' })
  protein?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '脂肪 g/100g' })
  fat?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '碳水化合物 g/100g' })
  carbs?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, comment: '膳食纤维 g/100g' })
  fiber?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, comment: '糖 g/100g' })
  sugar?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'saturated_fat', comment: '饱和脂肪 g/100g' })
  saturatedFat?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'trans_fat', comment: '反式脂肪 g/100g' })
  transFat?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '胆固醇 mg/100g' })
  cholesterol?: number;

  @Column({ type: 'decimal', precision: 7, scale: 1, nullable: true, comment: '钠 mg/100g' })
  sodium?: number;

  @Column({ type: 'decimal', precision: 7, scale: 1, nullable: true, comment: '钾 mg/100g' })
  potassium?: number;

  @Column({ type: 'decimal', precision: 7, scale: 1, nullable: true, comment: '钙 mg/100g' })
  calcium?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '铁 mg/100g' })
  iron?: number;

  @Column({ type: 'decimal', precision: 7, scale: 1, nullable: true, name: 'vitamin_a', comment: '维生素A μg RAE/100g' })
  vitaminA?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, name: 'vitamin_c', comment: '维生素C mg/100g' })
  vitaminC?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'vitamin_d', comment: '维生素D μg/100g' })
  vitaminD?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'vitamin_e', comment: '维生素E mg/100g' })
  vitaminE?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, name: 'vitamin_b12', comment: '维生素B12 μg/100g' })
  vitaminB12?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '叶酸 μg/100g' })
  folate?: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true, comment: '锌 mg/100g' })
  zinc?: number;

  @Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, comment: '镁 mg/100g' })
  magnesium?: number;

  @Column({ type: 'int', nullable: true, name: 'glycemic_index', comment: 'GI值 0-100' })
  glycemicIndex?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'glycemic_load', comment: 'GL值' })
  glycemicLoad?: number;

  @Column({ type: 'boolean', default: false, name: 'is_processed', comment: '是否加工食品' })
  isProcessed: boolean;

  @Column({ type: 'boolean', default: false, name: 'is_fried', comment: '是否油炸' })
  isFried: boolean;

  @Column({ type: 'int', default: 1, name: 'processing_level', comment: 'NOVA分级 1-4' })
  processingLevel: number;

  @Column({ type: 'jsonb', default: '[]', comment: '过敏原: ["gluten","dairy","nuts","soy","egg","shellfish"]' })
  allergens: string[];

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true, name: 'quality_score', comment: '食物品质评分 1-10' })
  qualityScore?: number;

  @Column({ type: 'decimal', precision: 3, scale: 1, nullable: true, name: 'satiety_score', comment: '饱腹感评分 1-10' })
  satietyScore?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'nutrient_density', comment: 'NRF9.3营养密度评分' })
  nutrientDensity?: number;

  @Column({ type: 'jsonb', default: '[]', name: 'meal_types', comment: '适合餐次: ["breakfast","lunch","dinner","snack"]' })
  mealTypes: string[];

  @Column({ type: 'jsonb', default: '[]', comment: '标签: ["high_protein","low_fat","keto","vegan"]' })
  tags: string[];

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'main_ingredient', comment: '主原料: chicken/rice/tofu' })
  mainIngredient?: string;

  @Column({ type: 'jsonb', default: '{}', comment: '搭配关系: {"goodWith":["rice"],"badWith":["cola"]}' })
  compatibility: Record<string, string[]>;

  @Column({ type: 'int', default: 100, name: 'standard_serving_g', comment: '标准份量克数' })
  standardServingG: number;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'standard_serving_desc', comment: '份量描述' })
  standardServingDesc?: string;

  @Column({ type: 'jsonb', default: '[]', name: 'common_portions', comment: '常用份量: [{"name":"1碗","grams":200}]' })
  commonPortions: Array<{ name: string; grams: number }>;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url', comment: '食物图片' })
  imageUrl?: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'thumbnail_url', comment: '缩略图' })
  thumbnailUrl?: string;

  @Column({ type: 'varchar', length: 50, default: 'manual', name: 'primary_source', comment: '主数据来源: usda/openfoodfacts/ai/manual/crawl' })
  primarySource: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'primary_source_id', comment: '来源原始ID' })
  primarySourceId?: string;

  @Column({ type: 'int', default: 1, name: 'data_version', comment: '数据版本号' })
  dataVersion: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 1.0, comment: '综合置信度 0-1' })
  confidence: number;

  @Column({ type: 'boolean', default: false, name: 'is_verified' })
  isVerified: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'verified_by', comment: '审核人' })
  verifiedBy?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'verified_at', comment: '审核时间' })
  verifiedAt?: Date;

  @Column({ type: 'int', default: 100, name: 'search_weight', comment: '搜索排序权重' })
  searchWeight: number;

  @Column({ type: 'int', default: 0, comment: '用户使用次数统计' })
  popularity: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => FoodTranslation, (t) => t.food)
  translations: FoodTranslation[];

  @OneToMany(() => FoodSource, (s) => s.food)
  sources: FoodSource[];

  @OneToMany(() => FoodChangeLog, (l) => l.food)
  changeLogs: FoodChangeLog[];

  @OneToMany(() => FoodConflict, (c) => c.food)
  conflicts: FoodConflict[];
}
