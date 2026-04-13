import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CleanedFoodData } from './food-data-cleaner.service';

export interface DedupMatch {
  existingFood: any;
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查找重复项
   */
  async findDuplicate(food: CleanedFoodData): Promise<DedupMatch | null> {
    // 优先级 1: 条形码精确匹配
    if (food.rawPayload?.code) {
      const barMatch = await this.prisma.foods.findFirst({
        where: { barcode: food.rawPayload.code },
      });
      if (barMatch) {
        return {
          existingFood: barMatch,
          similarity: 1.0,
          matchType: 'barcode',
        };
      }
    }

    // 优先级 2: 来源ID匹配 (source_type + source_id)
    if (food.primarySource && food.primarySourceId) {
      const sourceMatch = await this.prisma.foods.findFirst({
        where: {
          primary_source: food.primarySource,
          primary_source_id: food.primarySourceId,
        },
      });
      if (sourceMatch) {
        return {
          existingFood: sourceMatch,
          similarity: 1.0,
          matchType: 'source_id',
        };
      }
    }

    // 优先级 3: 名称匹配
    const nameNormalized = this.normalizeName(food.name);
    if (!nameNormalized) return null;

    // 3a: 精确名称匹配
    const exactMatch = await this.prisma.foods.findFirst({
      where: { name: food.name },
    });
    if (exactMatch) {
      return {
        existingFood: exactMatch,
        similarity: 1.0,
        matchType: 'name_exact',
      };
    }

    // 3b: 模糊名称匹配（使用 ILIKE + 营养数据辅助）
    const searchPattern = nameNormalized.substring(0, 20);
    const candidates = await this.prisma.foods.findMany({
      where: {
        OR: [
          { name: { contains: searchPattern, mode: 'insensitive' } },
          { aliases: { contains: searchPattern, mode: 'insensitive' } },
        ],
      },
      take: 10,
    });

    let bestMatch: DedupMatch | null = null;

    for (const candidate of candidates) {
      const nameSimilarity = this.calculateSimilarity(
        nameNormalized,
        this.normalizeName(candidate.name),
      );
      if (nameSimilarity < 0.7) continue;

      // 营养数据辅助验证
      const nutritionSimilarity = this.calculateNutritionSimilarity(
        food,
        candidate,
      );
      const combined = nameSimilarity * 0.6 + nutritionSimilarity * 0.4;

      if (combined > 0.85 && (!bestMatch || combined > bestMatch.similarity)) {
        bestMatch = {
          existingFood: candidate,
          similarity: combined,
          matchType: 'name_fuzzy',
        };
      }
    }

    return bestMatch;
  }

  /**
   * 合并食物数据（保留高优先级来源数据）
   */
  mergeFood(
    existing: any,
    incoming: CleanedFoodData,
    sourcePriority: number,
  ): Record<string, any> {
    const merged: Record<string, any> = {};

    // 补充缺失字段（不覆盖已有数据，除非来源优先级更高）
    // Note: existing uses snake_case (Prisma), incoming uses camelCase
    const fieldMappings: Array<{ incoming: string; existing: string }> = [
      { incoming: 'aliases', existing: 'aliases' },
      { incoming: 'barcode', existing: 'barcode' },
      { incoming: 'category', existing: 'category' },
      { incoming: 'subCategory', existing: 'sub_category' },
      { incoming: 'foodGroup', existing: 'food_group' },
      { incoming: 'fiber', existing: 'fiber' },
      { incoming: 'sugar', existing: 'sugar' },
      { incoming: 'saturatedFat', existing: 'saturated_fat' },
      { incoming: 'transFat', existing: 'trans_fat' },
      { incoming: 'cholesterol', existing: 'cholesterol' },
      { incoming: 'sodium', existing: 'sodium' },
      { incoming: 'potassium', existing: 'potassium' },
      { incoming: 'calcium', existing: 'calcium' },
      { incoming: 'iron', existing: 'iron' },
      { incoming: 'vitaminA', existing: 'vitamin_a' },
      { incoming: 'vitaminC', existing: 'vitamin_c' },
      { incoming: 'vitaminD', existing: 'vitamin_d' },
      { incoming: 'vitaminE', existing: 'vitamin_e' },
      { incoming: 'vitaminB12', existing: 'vitamin_b12' },
      { incoming: 'folate', existing: 'folate' },
      { incoming: 'zinc', existing: 'zinc' },
      { incoming: 'magnesium', existing: 'magnesium' },
      { incoming: 'phosphorus', existing: 'phosphorus' },
      { incoming: 'glycemicIndex', existing: 'glycemic_index' },
      { incoming: 'glycemicLoad', existing: 'glycemic_load' },
      { incoming: 'processingLevel', existing: 'processing_level' },
      { incoming: 'mainIngredient', existing: 'main_ingredient' },
      { incoming: 'standardServingDesc', existing: 'standard_serving_desc' },
      { incoming: 'imageUrl', existing: 'image_url' },
      { incoming: 'thumbnailUrl', existing: 'thumbnail_url' },
    ];

    for (const mapping of fieldMappings) {
      const existingVal = existing[mapping.existing];
      const incomingVal = (incoming as any)[mapping.incoming];
      if (existingVal == null && incomingVal != null) {
        merged[mapping.existing] = incomingVal;
      }
    }

    // 同 source_id 更新时，允许结构化字段被最新映射结果纠正
    if (incoming.category && existing.category !== incoming.category) {
      merged.category = incoming.category;
    }
    if (
      incoming.subCategory &&
      existing.sub_category !== incoming.subCategory
    ) {
      merged.sub_category = incoming.subCategory;
    }
    if (incoming.foodGroup && existing.food_group !== incoming.foodGroup) {
      merged.food_group = incoming.foodGroup;
    }

    // 合并数组字段（去重取并集）
    if (incoming.rawPayload?.allergens) {
      const existingAllergens = (existing.allergens as any[]) || [];
      const incomingAllergens = incoming.rawPayload.allergens || [];
      merged.allergens = [
        ...new Set([...existingAllergens, ...incomingAllergens]),
      ];
    }

    const existingTags = (existing.tags as any[]) || [];
    const incomingTags =
      incoming.tags || incoming.importMetadata?.extraTags || [];
    merged.tags = [...new Set([...existingTags, ...incomingTags])];

    if (incoming.mealTypes?.length) {
      merged.meal_types = [
        ...new Set([
          ...((existing.meal_types as any[]) || []),
          ...incoming.mealTypes,
        ]),
      ];
    }

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
  private calculateNutritionSimilarity(
    a: Partial<any>,
    b: Partial<any>,
  ): number {
    // a is CleanedFoodData (camelCase), b is Prisma result (snake_case)
    const fieldsA = ['calories', 'protein', 'fat', 'carbs'] as const;
    let matchCount = 0;
    let totalCount = 0;

    for (const field of fieldsA) {
      const va = a[field];
      const vb = b[field];
      if (va != null && vb != null && va > 0) {
        totalCount++;
        const diff = Math.abs(va - vb) / va;
        if (diff <= 0.2) matchCount++;
      }
    }

    return totalCount > 0 ? matchCount / totalCount : 0.5;
  }
}
