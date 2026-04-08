import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

/** USDA 原始食物数据 */
export interface UsdaRawFood {
  fdcId: number;
  description: string;
  foodCategory?: string;
  dataType?: string;
  brandOwner?: string;
  ingredients?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  foodNutrients: UsdaNutrient[];
}

interface UsdaNutrient {
  nutrientId: number;
  nutrientName: string;
  nutrientNumber: string;
  unitName: string;
  value: number;
}

interface UsdaSearchResponse {
  totalHits: number;
  currentPage: number;
  totalPages: number;
  foods: UsdaRawFood[];
}

/** 标准化后的食物数据 */
export interface NormalizedFoodData {
  sourceType: 'usda';
  sourceId: string;
  sourceUrl: string;
  rawPayload: Record<string, any>;
  fetchedAt: Date;
  // 映射后的标准字段
  name: string;
  category?: string;
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sugar?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;
  sodium?: number;
  potassium?: number;
  calcium?: number;
  iron?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  vitaminE?: number;
  vitaminB12?: number;
  folate?: number;
  zinc?: number;
  magnesium?: number;
}

/**
 * USDA FoodData Central 数据采集器
 * API: https://api.nal.usda.gov/fdc/v1/
 * License: Public Domain
 */
@Injectable()
export class UsdaFetcherService {
  private readonly logger = new Logger(UsdaFetcherService.name);
  private readonly baseUrl = 'https://api.nal.usda.gov/fdc/v1';
  private readonly apiKey: string;

  // USDA nutrientId → 字段映射
  private readonly NUTRIENT_MAP: Record<number, string> = {
    1008: 'calories',     // Energy (kcal)
    1003: 'protein',      // Protein
    1004: 'fat',          // Total lipid (fat)
    1005: 'carbs',        // Carbohydrate, by difference
    1079: 'fiber',        // Fiber, total dietary
    2000: 'sugar',        // Sugars, total
    1258: 'saturatedFat', // Fatty acids, total saturated
    1257: 'transFat',     // Fatty acids, total trans
    1253: 'cholesterol',  // Cholesterol
    1093: 'sodium',       // Sodium, Na
    1092: 'potassium',    // Potassium, K
    1087: 'calcium',      // Calcium, Ca
    1089: 'iron',         // Iron, Fe
    1106: 'vitaminA',     // Vitamin A, RAE
    1162: 'vitaminC',     // Vitamin C
    1114: 'vitaminD',     // Vitamin D (D2 + D3)
    1109: 'vitaminE',     // Vitamin E (alpha-tocopherol)
    1178: 'vitaminB12',   // Vitamin B-12
    1177: 'folate',       // Folate, total
    1095: 'zinc',         // Zinc, Zn
    1090: 'magnesium',    // Magnesium, Mg
  };

  // USDA category → 标准 category 映射
  private readonly CATEGORY_MAP: Record<string, string> = {
    'Beef Products': 'protein',
    'Pork Products': 'protein',
    'Lamb, Veal, and Game Products': 'protein',
    'Poultry Products': 'protein',
    'Finfish and Shellfish Products': 'protein',
    'Sausages and Luncheon Meats': 'protein',
    'Legumes and Legume Products': 'protein',
    'Egg Products': 'protein',
    'Vegetables and Vegetable Products': 'veggie',
    'Fruits and Fruit Juices': 'fruit',
    'Cereal Grains and Pasta': 'grain',
    'Breakfast Cereals': 'grain',
    'Baked Products': 'grain',
    'Dairy and Egg Products': 'dairy',
    'Beverages': 'beverage',
    'Snacks': 'snack',
    'Sweets': 'snack',
    'Spices and Herbs': 'condiment',
    'Fats and Oils': 'fat',
    'Nut and Seed Products': 'fat',
    'Soups, Sauces, and Gravies': 'composite',
    'Meals, Entrees, and Side Dishes': 'composite',
    'Fast Foods': 'composite',
    'Restaurant Foods': 'composite',
    'Baby Foods': 'composite',
    'American Indian/Alaska Native Foods': 'composite',
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.apiKey = this.configService.get<string>('USDA_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('USDA_API_KEY not configured. USDA fetcher will not work. Get a free key at https://fdc.nal.usda.gov/api-key-signup.html');
    }
  }

  /**
   * 搜索 USDA 食物数据
   */
  async search(query: string, pageSize = 25, pageNumber = 1): Promise<{ foods: NormalizedFoodData[]; totalHits: number }> {
    const url = `${this.baseUrl}/foods/search`;
    const { data } = await firstValueFrom(
      this.httpService.get<UsdaSearchResponse>(url, {
        params: {
          api_key: this.apiKey,
          query,
          pageSize,
          pageNumber,
          dataType: ['Foundation', 'SR Legacy'].join(','),
        },
      }),
    );

    return {
      foods: data.foods.map(f => this.normalize(f)),
      totalHits: data.totalHits,
    };
  }

  /**
   * 按 USDA fdcId 获取食物详情
   */
  async getById(fdcId: number): Promise<NormalizedFoodData | null> {
    try {
      const url = `${this.baseUrl}/food/${fdcId}`;
      const { data } = await firstValueFrom(
        this.httpService.get<UsdaRawFood>(url, {
          params: { api_key: this.apiKey },
        }),
      );
      return this.normalize(data);
    } catch (e) {
      this.logger.warn(`Failed to fetch USDA food ${fdcId}: ${e.message}`);
      return null;
    }
  }

  /**
   * 批量获取食物数据
   */
  async batchGet(fdcIds: number[]): Promise<NormalizedFoodData[]> {
    const url = `${this.baseUrl}/foods`;
    const { data } = await firstValueFrom(
      this.httpService.post<UsdaRawFood[]>(url, { fdcIds }, {
        params: { api_key: this.apiKey },
      }),
    );
    return data.map(f => this.normalize(f));
  }

  /**
   * 批量同步：分页拉取全部 Foundation + SR Legacy 食物
   */
  async *syncAll(options: { pageSize?: number; maxPages?: number } = {}): AsyncGenerator<NormalizedFoodData[]> {
    const pageSize = options.pageSize || 200;
    const maxPages = options.maxPages || Infinity;
    let pageNumber = 1;

    while (pageNumber <= maxPages) {
      this.logger.log(`Fetching USDA page ${pageNumber}, pageSize=${pageSize}`);
      try {
        const result = await this.search('*', pageSize, pageNumber);
        if (result.foods.length === 0) break;
        yield result.foods;
        if (result.foods.length < pageSize) break;
        pageNumber++;
        // Rate limiting: USDA allows 1000 req/hour
        await this.sleep(500);
      } catch (e) {
        this.logger.error(`USDA sync page ${pageNumber} failed: ${e.message}`);
        break;
      }
    }
  }

  /**
   * 将 USDA 原始数据标准化为统一格式
   */
  private normalize(raw: UsdaRawFood): NormalizedFoodData {
    const nutrients: Record<string, number> = {};
    for (const n of raw.foodNutrients || []) {
      const field = this.NUTRIENT_MAP[n.nutrientId];
      if (field && n.value != null) {
        nutrients[field] = n.value;
      }
    }

    return {
      sourceType: 'usda',
      sourceId: String(raw.fdcId),
      sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${raw.fdcId}/nutrients`,
      rawPayload: raw as any,
      fetchedAt: new Date(),
      name: raw.description,
      category: (raw.foodCategory ? this.CATEGORY_MAP[raw.foodCategory] : undefined) || undefined,
      calories: nutrients.calories || 0,
      protein: nutrients.protein,
      fat: nutrients.fat,
      carbs: nutrients.carbs,
      fiber: nutrients.fiber,
      sugar: nutrients.sugar,
      saturatedFat: nutrients.saturatedFat,
      transFat: nutrients.transFat,
      cholesterol: nutrients.cholesterol,
      sodium: nutrients.sodium,
      potassium: nutrients.potassium,
      calcium: nutrients.calcium,
      iron: nutrients.iron,
      vitaminA: nutrients.vitaminA,
      vitaminC: nutrients.vitaminC,
      vitaminD: nutrients.vitaminD,
      vitaminE: nutrients.vitaminE,
      vitaminB12: nutrients.vitaminB12,
      folate: nutrients.folate,
      zinc: nutrients.zinc,
      magnesium: nutrients.magnesium,
    };
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
