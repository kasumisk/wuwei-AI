import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { NormalizedFoodData } from './usda-fetcher.service';

interface OffProduct {
  code: string;
  product_name: string;
  product_name_en?: string;
  product_name_zh?: string;
  brands?: string;
  categories_tags?: string[];
  nova_group?: number;
  nutriscore_grade?: string;
  nutriments?: Record<string, number>;
  allergens_tags?: string[];
  image_url?: string;
  image_small_url?: string;
}

/**
 * Open Food Facts API 服务
 * 主要用于条形码扫描查询 + 产品数据补充
 * License: ODbL (Open Database License)
 */
@Injectable()
export class OpenFoodFactsService {
  private readonly logger = new Logger(OpenFoodFactsService.name);
  private readonly baseUrl = 'https://world.openfoodfacts.org/api/v2';

  // OFF category → 标准 category 映射
  private readonly CATEGORY_MAP: Record<string, string> = {
    'en:meats': 'protein',
    'en:poultry': 'protein',
    'en:fishes': 'protein',
    'en:seafood': 'protein',
    'en:eggs': 'protein',
    'en:legumes': 'protein',
    'en:vegetables': 'veggie',
    'en:fruits': 'fruit',
    'en:cereals-and-potatoes': 'grain',
    'en:breads': 'grain',
    'en:pastas': 'grain',
    'en:dairies': 'dairy',
    'en:milks': 'dairy',
    'en:cheeses': 'dairy',
    'en:beverages': 'beverage',
    'en:snacks': 'snack',
    'en:sweets': 'snack',
    'en:condiments': 'condiment',
    'en:sauces': 'condiment',
    'en:fats': 'fat',
    'en:nuts': 'fat',
    'en:meals': 'composite',
    'en:soups': 'composite',
  };

  private readonly ALLERGEN_MAP: Record<string, string> = {
    'en:gluten': 'gluten',
    'en:milk': 'dairy',
    'en:eggs': 'egg',
    'en:nuts': 'nuts',
    'en:peanuts': 'nuts',
    'en:soybeans': 'soy',
    'en:fish': 'fish',
    'en:crustaceans': 'shellfish',
    'en:molluscs': 'shellfish',
    'en:celery': 'celery',
    'en:mustard': 'mustard',
    'en:sesame-seeds': 'sesame',
    'en:sulphites': 'sulphites',
    'en:lupin': 'lupin',
  };

  constructor(private readonly httpService: HttpService) {}

  /**
   * 条形码查询
   */
  async getByBarcode(barcode: string): Promise<NormalizedFoodData | null> {
    try {
      const url = `${this.baseUrl}/product/${barcode}`;
      const { data } = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            fields:
              'code,product_name,product_name_en,product_name_zh,brands,categories_tags,nova_group,nutriscore_grade,nutriments,allergens_tags,image_url,image_small_url',
          },
          headers: { 'User-Agent': 'WuweiAI/1.0 (https://wuwei.ai)' },
        }),
      );

      if (data.status !== 1 || !data.product) {
        this.logger.debug(`Product not found for barcode: ${barcode}`);
        return null;
      }

      return this.normalize(data.product);
    } catch (e) {
      this.logger.warn(`OpenFoodFacts barcode lookup failed: ${e.message}`);
      return null;
    }
  }

  /**
   * 关键字搜索
   */
  async search(
    query: string,
    pageSize = 25,
    page = 1,
  ): Promise<{ foods: NormalizedFoodData[]; count: number }> {
    try {
      const { data } = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/search`, {
          params: {
            search_terms: query,
            page_size: pageSize,
            page,
            fields:
              'code,product_name,product_name_en,product_name_zh,brands,categories_tags,nova_group,nutriscore_grade,nutriments,allergens_tags,image_url,image_small_url',
            json: 1,
          },
          headers: { 'User-Agent': 'WuweiAI/1.0 (https://wuwei.ai)' },
        }),
      );

      return {
        foods: (data.products || [])
          .map((p: OffProduct) => this.normalize(p))
          .filter(Boolean),
        count: data.count || 0,
      };
    } catch (e) {
      this.logger.warn(`OpenFoodFacts search failed: ${e.message}`);
      return { foods: [], count: 0 };
    }
  }

  private normalize(product: OffProduct): NormalizedFoodData | null {
    const n = product.nutriments || {};
    const calories =
      n['energy-kcal_100g'] ||
      (n['energy-kj_100g'] ? n['energy-kj_100g'] / 4.184 : 0);
    if (!calories || calories <= 0) return null;

    const name =
      product.product_name_zh ||
      product.product_name_en ||
      product.product_name ||
      '';
    if (!name) return null;

    // 映射分类
    let category: string | undefined;
    for (const tag of product.categories_tags || []) {
      const mapped = this.CATEGORY_MAP[tag];
      if (mapped) {
        category = mapped;
        break;
      }
    }

    // 映射过敏原
    const allergens: string[] = [];
    for (const tag of product.allergens_tags || []) {
      const mapped = this.ALLERGEN_MAP[tag];
      if (mapped && !allergens.includes(mapped)) allergens.push(mapped);
    }

    return {
      sourceType: 'openfoodfacts' as any,
      sourceId: product.code,
      sourceUrl: `https://world.openfoodfacts.org/product/${product.code}`,
      rawPayload: product as any,
      fetchedAt: new Date(),
      name,
      category,
      calories: Math.round(calories * 10) / 10,
      protein: n.proteins_100g,
      fat: n.fat_100g,
      carbs: n.carbohydrates_100g,
      fiber: n.fiber_100g,
      sugar: n.sugars_100g,
      saturatedFat: n['saturated-fat_100g'],
      transFat: n['trans-fat_100g'],
      cholesterol: n.cholesterol_100g ? n.cholesterol_100g * 1000 : undefined, // g → mg
      sodium: n.sodium_100g ? n.sodium_100g * 1000 : undefined, // g → mg
      potassium: n.potassium_100g ? n.potassium_100g * 1000 : undefined,
      calcium: n.calcium_100g ? n.calcium_100g * 1000 : undefined,
      iron: n.iron_100g ? n.iron_100g * 1000 : undefined,
      vitaminA: n['vitamin-a_100g'] ? n['vitamin-a_100g'] * 1000000 : undefined,
      vitaminC: n['vitamin-c_100g'] ? n['vitamin-c_100g'] * 1000 : undefined,
      vitaminD: n['vitamin-d_100g'] ? n['vitamin-d_100g'] * 1000000 : undefined,
      vitaminE: undefined,
      vitaminB12: undefined,
      folate: undefined,
      zinc: n.zinc_100g ? n.zinc_100g * 1000 : undefined,
      magnesium: n.magnesium_100g ? n.magnesium_100g * 1000 : undefined,
    };
  }
}
