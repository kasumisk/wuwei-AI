import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CleanedFoodData } from './food-data-cleaner.service';
import { FoodImportMode } from '../food-pipeline-orchestrator.service';

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

  private readonly EN_TO_ZH_FOOD_ALIASES: Record<string, string[]> = {
    chickenbreast: ['鸡胸肉'],
    beef: ['牛肉'],
    pork: ['猪肉'],
    fish: ['鱼', '鱼肉'],
    egg: ['鸡蛋', '蛋'],
    rice: ['米饭', '白米饭'],
    bread: ['面包'],
    pasta: ['意面', '意大利面', '面食'],
    oat: ['燕麦', '燕麦片'],
    potato: ['土豆', '马铃薯'],
    broccoli: ['西兰花'],
    spinach: ['菠菜'],
    carrot: ['胡萝卜'],
    tomato: ['番茄', '西红柿'],
    onion: ['洋葱'],
    apple: ['苹果'],
    banana: ['香蕉'],
    orange: ['橙子'],
    strawberry: ['草莓'],
    milk: ['牛奶'],
    yogurt: ['酸奶'],
    cheese: ['奶酪'],
  };

  private readonly FOOD_INCLUDE = {
    taxonomy: true,
    healthAssessment: true,
    nutritionDetail: true,
    portionGuide: true,
    foodTranslations: true,
  } as const;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查找重复项
   */
  async findDuplicate(food: CleanedFoodData): Promise<DedupMatch | null> {
    // 优先级 1: 条形码精确匹配
    if (food.rawPayload?.code) {
      const barMatch = await this.prisma.food.findFirst({
        where: { barcode: food.rawPayload.code },
        include: this.FOOD_INCLUDE,
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
      const sourceMatch = await this.prisma.food.findFirst({
        where: {
          primarySource: food.primarySource,
          primarySourceId: food.primarySourceId,
        },
        include: this.FOOD_INCLUDE,
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
    const exactMatch = await this.prisma.food.findFirst({
      where: { name: food.name },
      include: this.FOOD_INCLUDE,
    });
    if (exactMatch) {
      return {
        existingFood: exactMatch,
        similarity: 1.0,
        matchType: 'name_exact',
      };
    }

    // 3a-2: 跨语言桥接匹配
    // USDA 英文名与已有中文食物的英文翻译/别名匹配时，允许直接合并，
    // 否则会把“鸡胸肉”与“chicken breast”导成两条独立记录。
    const translationMatch = await this.prisma.food.findFirst({
      where: {
        OR: [
          {
            foodTranslations: {
              some: {
                locale: 'en-US',
                name: { equals: food.name, mode: 'insensitive' },
              },
            },
          },
          { aliases: { contains: food.name, mode: 'insensitive' } },
        ],
      },
      include: this.FOOD_INCLUDE,
    });
    if (translationMatch) {
      return {
        existingFood: translationMatch,
        similarity: 0.98,
        matchType: 'name_exact',
      };
    }

    const mappedChineseNames = this.lookupChineseAliases(nameNormalized);
    if (mappedChineseNames.length > 0) {
      const dictionaryMatch = await this.prisma.food.findFirst({
        where: {
          OR: mappedChineseNames.flatMap((name) => [
            { name },
            { aliases: { contains: name, mode: 'insensitive' } },
          ]),
        },
        include: this.FOOD_INCLUDE,
      });
      if (dictionaryMatch) {
        return {
          existingFood: dictionaryMatch,
          similarity: 0.97,
          matchType: 'name_exact',
        };
      }
    }

    const translationCandidates = await this.prisma.food.findMany({
      where: {
        foodTranslations: {
          some: {
            locale: 'en-US',
            name: {
              contains: food.name.substring(0, 20),
              mode: 'insensitive',
            },
          },
        },
      },
      include: this.FOOD_INCLUDE,
      take: 10,
    });

    for (const candidate of translationCandidates) {
      const translationName = candidate.foodTranslations.find(
        (item) => item.locale === 'en-US',
      )?.name;
      if (!translationName) continue;

      const nameSimilarity = this.calculateSimilarity(
        nameNormalized,
        this.normalizeName(translationName),
      );
      if (nameSimilarity < 0.82) continue;

      const nutritionSimilarity = this.calculateNutritionSimilarity(
        food,
        candidate,
      );
      const combined = nameSimilarity * 0.7 + nutritionSimilarity * 0.3;
      if (combined > 0.88) {
        return {
          existingFood: candidate,
          similarity: combined,
          matchType: 'name_fuzzy',
        };
      }
    }

    // 3b: 模糊名称匹配（使用 ILIKE + 营养数据辅助）
    const searchPattern = nameNormalized.substring(0, 20);
    const candidates = await this.prisma.food.findMany({
      where: {
        OR: [
          { name: { contains: searchPattern, mode: 'insensitive' } },
          { aliases: { contains: searchPattern, mode: 'insensitive' } },
        ],
      },
      include: this.FOOD_INCLUDE,
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
    importMode: FoodImportMode,
  ): Record<string, any> {
    const merged: Record<string, any> = {};

    // 补充缺失字段（不覆盖已有数据，除非来源优先级更高）
    const mergeFields = this.getMergeFieldsByMode(importMode);
    for (const field of mergeFields) {
      const existingVal = this.getExistingFieldValue(existing, field);
      const incomingVal = (incoming as any)[field];
      if (existingVal == null && incomingVal != null) {
        merged[field] = incomingVal;
      }
    }

    if (importMode === 'fill_missing_only') {
      if (incoming.allergens?.length) {
        const existingAllergens = (existing.taxonomy?.allergens as any[]) || [];
        const incomingAllergens = incoming.allergens || [];
        merged.allergens = [
          ...new Set([...existingAllergens, ...incomingAllergens]),
        ];
      }

      const existingTags = (existing.taxonomy?.tags as any[]) || [];
      const incomingTags =
        incoming.tags || incoming.importMetadata?.extraTags || [];
      merged.tags = [...new Set([...existingTags, ...incomingTags])];

      if (incoming.mealTypes?.length) {
        merged.mealTypes = [
          ...new Set([
            ...((existing.taxonomy?.mealTypes as any[]) || []),
            ...incoming.mealTypes,
          ]),
        ];
      }

      return merged;
    }

    // 对中国食物成分表主库，USDA 命中后默认只补缺失，不主动改写既有分类或核心营养。
    // 分类字段只在主表缺失时补齐，避免“鸡胸肉”被 USDA 英文分类二次改写。
    if (!existing.category && incoming.category) {
      merged.category = incoming.category;
    }
    if (!existing.subCategory && incoming.subCategory) {
      merged.subCategory = incoming.subCategory;
    }
    if (!existing.foodGroup && incoming.foodGroup) {
      merged.foodGroup = incoming.foodGroup;
    }

    // 合并数组字段（去重取并集）
    if (incoming.allergens?.length) {
      const existingAllergens = (existing.taxonomy?.allergens as any[]) || [];
      const incomingAllergens = incoming.allergens || [];
      merged.allergens = [
        ...new Set([...existingAllergens, ...incomingAllergens]),
      ];
    }

    const existingTags = (existing.taxonomy?.tags as any[]) || [];
    const incomingTags =
      incoming.tags || incoming.importMetadata?.extraTags || [];
    merged.tags = [...new Set([...existingTags, ...incomingTags])];

    if (incoming.mealTypes?.length) {
      merged.mealTypes = [
        ...new Set([
          ...((existing.taxonomy?.mealTypes as any[]) || []),
          ...incoming.mealTypes,
        ]),
      ];
    }

    return merged;
  }

  private getMergeFieldsByMode(importMode: FoodImportMode): string[] {
    if (importMode === 'fill_missing_only') {
      return [
        'fiber',
        'sugar',
        'saturatedFat',
        'transFat',
        'cholesterol',
        'sodium',
        'potassium',
        'calcium',
        'iron',
        'vitaminA',
        'vitaminC',
        'vitaminD',
        'vitaminE',
        'vitaminB12',
        'folate',
        'zinc',
        'magnesium',
        'phosphorus',
        'glycemicIndex',
        'glycemicLoad',
        'processingLevel',
        'standardServingDesc',
        'imageUrl',
        'thumbnailUrl',
      ];
    }

    return [
      'aliases',
      'barcode',
      'category',
      'subCategory',
      'foodGroup',
      'fiber',
      'sugar',
      'saturatedFat',
      'transFat',
      'cholesterol',
      'sodium',
      'potassium',
      'calcium',
      'iron',
      'vitaminA',
      'vitaminC',
      'vitaminD',
      'vitaminE',
      'vitaminB12',
      'folate',
      'zinc',
      'magnesium',
      'phosphorus',
      'glycemicIndex',
      'glycemicLoad',
      'processingLevel',
      'mainIngredient',
      'standardServingDesc',
      'imageUrl',
      'thumbnailUrl',
    ];
  }

  /**
   * 名称标准化（用于比较）
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\b(raw|cooked|boneless|skinless|roasted|grilled|boiled)\b/g, '')
      .replace(/\s+/g, '')
      .replace(/[,，、;；]/g, '')
      .replace(/[（(][^）)]*[)）]/g, '') // 去掉括号内容
      .trim();
  }

  private lookupChineseAliases(normalizedEnglishName: string): string[] {
    const direct = this.EN_TO_ZH_FOOD_ALIASES[normalizedEnglishName];
    if (direct) return direct;

    return Object.entries(this.EN_TO_ZH_FOOD_ALIASES)
      .filter(
        ([english]) =>
          normalizedEnglishName.includes(english) ||
          english.includes(normalizedEnglishName),
      )
      .flatMap(([, aliases]) => aliases);
  }

  private getExistingFieldValue(existing: any, field: string): any {
    if (existing[field] != null) return existing[field];

    if (field in (existing.nutritionDetail || {})) {
      return existing.nutritionDetail?.[field];
    }

    if (field in (existing.healthAssessment || {})) {
      return existing.healthAssessment?.[field];
    }

    if (field in (existing.taxonomy || {})) {
      return existing.taxonomy?.[field];
    }

    if (field in (existing.portionGuide || {})) {
      return existing.portionGuide?.[field];
    }

    return undefined;
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
    // a is CleanedFoodData, b is Prisma result (both use camelCase)
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
