import {
  IsEnum,
  IsOptional,
  IsString,
  IsInt,
  IsArray,
  IsBoolean,
  IsUUID,
  ValidateNested,
  Min,
  Max,
  IsNumber,
  IsDateString,
  IsIn,
  IsObject,
} from 'class-validator';
// Note: IsIn kept for CreateFoodRecordDto.decision field
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType, RecordSource } from '../../diet.types';

// ========== Analyze ==========

export class AnalyzeImageDto {
  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional({
    description: '语言区域（可选，默认跟随请求头）',
    example: 'en-US',
    enum: ['zh-CN', 'en-US', 'ja-JP'],
  })
  @IsOptional()
  @IsString()
  locale?: string;
}

export class FoodItemDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  calories: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quantity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  protein?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fat?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  carbs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  quality?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  satiety?: number;

  @ApiPropertyOptional({ description: '血糖指数 0-100' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  glycemicIndex?: number;
}

// ========== Food Records ==========

export class UpdateFoodRecordDto {
  @ApiPropertyOptional({ type: [FoodItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodItemDto)
  foods?: FoodItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  totalCalories?: number;

  @ApiPropertyOptional({ enum: MealType })
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  advice?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isHealthy?: boolean;
}

// ========== Food Library ==========

export class AddFromLibraryDto {
  @ApiProperty({ description: '食物库 ID' })
  @IsUUID()
  foodLibraryId: string;

  @ApiProperty({ description: '用户选择的克数' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  servingGrams: number;

  @ApiProperty({ enum: MealType, description: '餐次' })
  @IsEnum(MealType)
  mealType: MealType;
}

// ========== Food Log（统一写入 V8） ==========

/**
 * V8: 统一 Food Log 写入 DTO
 * 所有来源（手动/推荐/分析决策）均通过此 DTO 写入。
 */
export class CreateFoodRecordDto {
  @ApiProperty({ type: [FoodItemDto], description: '食物列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FoodItemDto)
  foods: FoodItemDto[];

  @ApiProperty({ description: '本餐热量 kcal' })
  @IsInt()
  @Min(0)
  totalCalories: number;

  @ApiProperty({ enum: MealType, description: '餐次' })
  @IsEnum(MealType)
  mealType: MealType;

  @ApiProperty({
    enum: RecordSource,
    description: '来源：manual/recommend/decision/text_analysis/image_analysis',
  })
  @IsEnum(RecordSource)
  source: RecordSource;

  // ── 营养素（可选） ──
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalProtein?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalFat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() totalCarbs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() avgQuality?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() avgSatiety?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() nutritionScore?: number;

  // ── 来源追溯（分析决策来源） ──
  @ApiPropertyOptional({ description: '分析记录 ID（source=decision 时填写）' })
  @IsOptional()
  @IsUUID()
  analysisId?: string;

  // ── 来源追溯（推荐来源） ──
  @ApiPropertyOptional({
    description: '推荐追踪 ID（source=recommend 时填写）',
  })
  @IsOptional()
  @IsString()
  recommendationTraceId?: string;

  // ── 决策快照（分析决策来源时由后端自动补充，前端也可传入） ──
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['SAFE', 'OK', 'LIMIT', 'AVOID'])
  decision?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() riskLevel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() suggestion?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  insteadOptions?: string[];
  @ApiPropertyOptional() @IsOptional() @IsObject() compensation?: Record<
    string,
    string
  >;
  @ApiPropertyOptional() @IsOptional() @IsString() contextComment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() encouragement?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() advice?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isHealthy?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string;

  @ApiPropertyOptional({ description: '记录时间，默认当前时间' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}

/**
 * V8: Food Log 查询 DTO（支持按日期/日期范围+来源筛选）
 *
 * 优先级：startDate+endDate > date > 默认今日
 */
export class FoodRecordQueryDto {
  @ApiPropertyOptional({ description: '查询日期 YYYY-MM-DD，默认今日' })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({
    description: '范围起始日期 YYYY-MM-DD（含），与 endDate 配合使用',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    description: '范围结束日期 YYYY-MM-DD（含），与 startDate 配合使用',
  })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ enum: RecordSource, description: '按来源筛选' })
  @IsOptional()
  @IsEnum(RecordSource)
  source?: RecordSource;

  @ApiPropertyOptional({ description: '页码，默认1' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数，默认20' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
