import { Injectable, Logger } from '@nestjs/common';
import { NormalizedFoodData } from '../fetchers/usda-fetcher.service';

export interface CleanedFoodData extends NormalizedFoodData {
  code?: string;
  status: string;
  confidence: number;
  isVerified: boolean;
  dataVersion: number;
  primarySource: string;
  primarySourceId: string;
  validationWarnings: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 食物数据清洗与标准化服务
 * 实现: 空值处理、异常值检测、宏量验证、文本清洗、单位统一、校验
 */
@Injectable()
export class FoodDataCleanerService {
  private readonly logger = new Logger(FoodDataCleanerService.name);

  // 合理范围 (per 100g)
  private readonly RANGES: Record<string, [number, number]> = {
    calories: [0, 900],
    protein: [0, 100],
    fat: [0, 100],
    carbs: [0, 100],
    fiber: [0, 50],
    sugar: [0, 100],
    saturatedFat: [0, 50],
    transFat: [0, 20],
    cholesterol: [0, 3000],
    sodium: [0, 10000],
    potassium: [0, 5000],
    calcium: [0, 5000],
    iron: [0, 200],
    vitaminA: [0, 30000],
    vitaminC: [0, 5000],
    vitaminD: [0, 250],
    vitaminE: [0, 200],
    vitaminB12: [0, 500],
    folate: [0, 2000],
    zinc: [0, 200],
    magnesium: [0, 2000],
  };

  private readonly VALID_CATEGORIES = [
    'protein',
    'grain',
    'veggie',
    'fruit',
    'dairy',
    'fat',
    'beverage',
    'snack',
    'condiment',
    'composite',
  ];

  /**
   * 清洗单条食物数据
   */
  clean(raw: NormalizedFoodData): CleanedFoodData | null {
    const warnings: string[] = [];

    // 1. 空值处理：没有热量数据的丢弃
    if (!raw.calories || raw.calories <= 0) {
      this.logger.debug(`Discarded ${raw.name}: no calories data`);
      return null;
    }

    // 2. 文本清洗
    const name = this.cleanText(raw.name);
    if (!name || name.length < 1) {
      this.logger.debug(`Discarded: empty name after cleaning`);
      return null;
    }

    // 3. 异常值范围检测 & 裁剪
    const cleaned: Record<string, any> = { ...raw, name };
    for (const [field, [min, max]] of Object.entries(this.RANGES)) {
      const val = (raw as any)[field];
      if (val != null) {
        if (val < min || val > max) {
          warnings.push(
            `${field}=${val} out of range [${min},${max}], clamped`,
          );
          cleaned[field] = Math.max(min, Math.min(max, val));
        }
      }
    }

    // 4. 单位转换: 如果热量单位是 kJ → kcal
    if (
      cleaned.calories > 900 &&
      raw.rawPayload?.nutriments?.['energy-kj_100g']
    ) {
      cleaned.calories = Math.round((cleaned.calories / 4.184) * 10) / 10;
      warnings.push('Converted kJ to kcal');
    }

    // 5. 宏量营养素交叉验证
    if (
      cleaned.protein != null &&
      cleaned.fat != null &&
      cleaned.carbs != null
    ) {
      const expected =
        cleaned.protein * 4 +
        cleaned.carbs * 4 +
        cleaned.fat * 9 +
        (cleaned.fiber || 0) * 2;
      const error = Math.abs(cleaned.calories - expected) / cleaned.calories;
      if (error > 0.15) {
        warnings.push(
          `Macro inconsistency: actual=${cleaned.calories}kcal, expected=${Math.round(expected)}kcal, error=${(error * 100).toFixed(1)}%`,
        );
      }
    }

    // 6. 分类标准化
    if (cleaned.category && !this.VALID_CATEGORIES.includes(cleaned.category)) {
      warnings.push(`Unknown category "${cleaned.category}", set to undefined`);
      cleaned.category = undefined;
    }

    // 7. 置信度计算
    const confidence = this.calculateConfidence(cleaned as any);

    return {
      ...cleaned,
      status: 'draft',
      confidence,
      isVerified: false,
      dataVersion: 1,
      primarySource: raw.sourceType,
      primarySourceId: raw.sourceId,
      validationWarnings: warnings,
    } as CleanedFoodData;
  }

  /**
   * 批量清洗
   */
  cleanBatch(items: NormalizedFoodData[]): {
    cleaned: CleanedFoodData[];
    discarded: number;
  } {
    const cleaned: CleanedFoodData[] = [];
    let discarded = 0;
    for (const item of items) {
      const result = this.clean(item);
      if (result) {
        cleaned.push(result);
      } else {
        discarded++;
      }
    }
    return { cleaned, discarded };
  }

  /**
   * 完整校验
   */
  validate(food: CleanedFoodData): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 必须字段
    if (!food.name) errors.push('name is required');
    if (!food.calories || food.calories <= 0)
      errors.push('calories is required and must be > 0');

    // 范围检查
    if (food.calories && (food.calories < 0 || food.calories > 900)) {
      errors.push(`calories ${food.calories} out of valid range`);
    }

    // 分类检查
    if (food.category && !this.VALID_CATEGORIES.includes(food.category)) {
      warnings.push(`Invalid category: ${food.category}`);
    }

    // 置信度检查
    if (food.confidence < 0 || food.confidence > 1) {
      errors.push(`confidence ${food.confidence} out of range [0,1]`);
    }

    // 宏量一致性检查
    if (food.protein != null && food.fat != null && food.carbs != null) {
      const expected =
        food.protein * 4 +
        food.carbs * 4 +
        food.fat * 9 +
        (food.fiber || 0) * 2;
      const error =
        food.calories > 0
          ? Math.abs(food.calories - expected) / food.calories
          : 0;
      if (error > 0.25) {
        warnings.push(`High macro inconsistency: ${(error * 100).toFixed(1)}%`);
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * 根据数据完整度计算置信度
   */
  private calculateConfidence(food: Record<string, any>): number {
    let score = 0.5; // 基础分（有热量数据就给 0.5）

    // 来源加分
    const sourceBonus: Record<string, number> = {
      usda: 0.2,
      openfoodfacts: 0.1,
      cn_food_composition: 0.18,
      ai: 0.05,
      manual: 0.15,
      crawl: 0.05,
    };
    score += sourceBonus[food.sourceType] || 0;

    // 关键字段完整度加分
    const keyFields = ['protein', 'fat', 'carbs', 'fiber', 'sodium'];
    const filledCount = keyFields.filter((f) => food[f] != null).length;
    score += (filledCount / keyFields.length) * 0.15;

    // 微量营养素完整度加分
    const microFields = [
      'vitaminA',
      'vitaminC',
      'calcium',
      'iron',
      'potassium',
      'zinc',
    ];
    const microCount = microFields.filter((f) => food[f] != null).length;
    score += (microCount / microFields.length) * 0.1;

    // 分类加分
    if (food.category) score += 0.05;

    return Math.round(Math.min(1, score) * 100) / 100;
  }

  /**
   * 文本清洗
   */
  private cleanText(text: string): string {
    if (!text) return '';
    return text
      .replace(/<[^>]+>/g, '') // Remove HTML
      .replace(/[\t\r\n]+/g, ' ') // Normalize whitespace
      .replace(/\s+/g, ' ') // Multiple spaces → single
      .replace(/[，]/g, ',') // 全角逗号 → 半角
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .trim();
  }
}
