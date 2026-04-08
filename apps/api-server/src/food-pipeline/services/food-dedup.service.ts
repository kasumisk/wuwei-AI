import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';
import { CleanedFoodData } from './food-data-cleaner.service';

export interface DedupMatch {
  existingFood: FoodLibrary;
  similarity: number;
  matchType: 'barcode' | 'source_id' | 'name_exact' | 'name_fuzzy';
}

/**
 * 食物去重服务
 * 策略优先级: 条形码精确匹配 > 来源ID匹配 > 名称模糊匹配 + 营养辅助
 */
@Injectable()
export class FoodDedupService {
  private readonly logger = new Logger(FoodDedupService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodRepo: Repository<FoodLibrary>,
  ) {}

  /**
   * 查找重复项
   */
  async findDuplicate(food: CleanedFoodData): Promise<DedupMatch | null> {
    // 优先级 1: 条形码精确匹配
    if (food.rawPayload?.code) {
      const barMatch = await this.foodRepo.findOne({
        where: { barcode: food.rawPayload.code },
      });
      if (barMatch) {
        return { existingFood: barMatch, similarity: 1.0, matchType: 'barcode' };
      }
    }

    // 优先级 2: 来源ID匹配 (source_type + source_id)
    if (food.primarySource && food.primarySourceId) {
      const sourceMatch = await this.foodRepo.findOne({
        where: { primarySource: food.primarySource, primarySourceId: food.primarySourceId },
      });
      if (sourceMatch) {
        return { existingFood: sourceMatch, similarity: 1.0, matchType: 'source_id' };
      }
    }

    // 优先级 3: 名称匹配
    const nameNormalized = this.normalizeName(food.name);
    if (!nameNormalized) return null;

    // 3a: 精确名称匹配
    const exactMatch = await this.foodRepo.findOne({ where: { name: food.name } });
    if (exactMatch) {
      return { existingFood: exactMatch, similarity: 1.0, matchType: 'name_exact' };
    }

    // 3b: 模糊名称匹配（使用 ILIKE + 营养数据辅助）
    const candidates = await this.foodRepo
      .createQueryBuilder('f')
      .where('f.name ILIKE :name', { name: `%${nameNormalized.substring(0, 20)}%` })
      .orWhere('f.aliases ILIKE :name', { name: `%${nameNormalized.substring(0, 20)}%` })
      .limit(10)
      .getMany();

    let bestMatch: DedupMatch | null = null;

    for (const candidate of candidates) {
      const nameSimilarity = this.calculateSimilarity(nameNormalized, this.normalizeName(candidate.name));
      if (nameSimilarity < 0.7) continue;

      // 营养数据辅助验证
      const nutritionSimilarity = this.calculateNutritionSimilarity(food, candidate);
      const combined = nameSimilarity * 0.6 + nutritionSimilarity * 0.4;

      if (combined > 0.85 && (!bestMatch || combined > bestMatch.similarity)) {
        bestMatch = { existingFood: candidate, similarity: combined, matchType: 'name_fuzzy' };
      }
    }

    return bestMatch;
  }

  /**
   * 合并食物数据（保留高优先级来源数据）
   */
  mergeFood(existing: FoodLibrary, incoming: CleanedFoodData, sourcePriority: number): Partial<FoodLibrary> {
    const FIELD_PRIORITIES: Record<string, string[]> = {
      high: ['calories', 'protein', 'fat', 'carbs'],
      medium: ['fiber', 'sugar', 'sodium', 'category'],
      low: ['glycemicIndex', 'processingLevel', 'qualityScore'],
    };

    const merged: Partial<FoodLibrary> = {};

    // 补充缺失字段（不覆盖已有数据，除非来源优先级更高）
    const fields = [
      'barcode', 'category', 'subCategory', 'foodGroup',
      'fiber', 'sugar', 'saturatedFat', 'transFat', 'cholesterol',
      'sodium', 'potassium', 'calcium', 'iron',
      'vitaminA', 'vitaminC', 'vitaminD', 'vitaminE', 'vitaminB12',
      'folate', 'zinc', 'magnesium',
      'glycemicIndex', 'glycemicLoad', 'processingLevel',
      'imageUrl', 'thumbnailUrl',
    ];

    for (const field of fields) {
      const existingVal = (existing as any)[field];
      const incomingVal = (incoming as any)[field];
      if (existingVal == null && incomingVal != null) {
        (merged as any)[field] = incomingVal;
      }
    }

    // 合并数组字段（去重取并集）
    if (incoming.rawPayload?.allergens) {
      const existingAllergens = existing.allergens || [];
      const incomingAllergens = incoming.rawPayload.allergens || [];
      merged.allergens = [...new Set([...existingAllergens, ...incomingAllergens])];
    }

    const existingTags = existing.tags || [];
    merged.tags = [...new Set([...existingTags])];

    return merged;
  }

  /**
   * 名称标准化（用于比较）
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[,，、;；]/g, '')
      .replace(/[（(][^）)]*[)）]/g, '') // 去掉括号内容
      .trim();
  }

  /**
   * 字符串相似度（Jaccard + 最长公共子序列）
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    // Bigram Jaccard similarity
    const bigramsA = new Set<string>();
    const bigramsB = new Set<string>();
    for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.substring(i, i + 2));
    for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.substring(i, i + 2));

    let intersection = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) intersection++;
    }
    const union = bigramsA.size + bigramsB.size - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * 营养数据相似度
   */
  private calculateNutritionSimilarity(a: Partial<FoodLibrary>, b: Partial<FoodLibrary>): number {
    const fields = ['calories', 'protein', 'fat', 'carbs'] as const;
    let matchCount = 0;
    let totalCount = 0;

    for (const field of fields) {
      const va = (a as any)[field];
      const vb = (b as any)[field];
      if (va != null && vb != null && va > 0) {
        totalCount++;
        const diff = Math.abs(va - vb) / va;
        if (diff <= 0.2) matchCount++;
      }
    }

    return totalCount > 0 ? matchCount / totalCount : 0.5;
  }
}
