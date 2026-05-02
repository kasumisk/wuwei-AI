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

export interface UsdaImportPreset {
  key: string;
  label: string;
  description: string;
  queries: string[];
  coverage: string[];
}

export interface UsdaCategoryOption {
  value: string;
  label: string;
  mappedCategory: string;
}

const USDA_CATEGORY_LABEL_ZH_MAP: Record<string, string> = {
  'American Indian/Alaska Native Foods': '美洲印第安人与阿拉斯加原住民食品',
  'Baby Foods': '婴儿食品',
  'Baked Products': '烘焙制品',
  'Beef Products': '牛肉制品',
  Beverages: '饮料',
  'Breakfast Cereals': '早餐谷物',
  'Cereal Grains and Pasta': '谷物与意面',
  'Dairy and Egg Products': '乳制品与蛋类',
  'Fast Foods': '快餐食品',
  'Fats and Oils': '脂肪与油脂',
  'Finfish and Shellfish Products': '鱼类与贝类制品',
  'Fruits and Fruit Juices': '水果与果汁',
  'Lamb, Veal, and Game Products': '羊肉、小牛肉与野味制品',
  'Legumes and Legume Products': '豆类及豆制品',
  'Meals, Entrees, and Side Dishes': '主餐、主菜与配菜',
  'Nut and Seed Products': '坚果与种子制品',
  'Pork Products': '猪肉制品',
  'Poultry Products': '禽类制品',
  'Restaurant Foods': '餐厅食品',
  'Sausages and Luncheon Meats': '香肠与冷切肉制品',
  Snacks: '零食',
  'Soups, Sauces, and Gravies': '汤、酱汁与肉汁',
  'Spices and Herbs': '香料与草本',
  Sweets: '甜食',
  'Vegetables and Vegetable Products': '蔬菜及蔬菜制品',
};

export const USDA_IMPORT_PRESETS: UsdaImportPreset[] = [
  {
    key: 'core_protein',
    label: '基础蛋白包',
    description: '鸡肉、牛肉、猪肉、鱼、鸡蛋等高频蛋白食物。',
    queries: ['chicken breast', 'beef', 'pork', 'fish', 'egg'],
    coverage: ['鸡胸肉', '牛肉', '猪肉', '鱼类', '鸡蛋'],
  },
  {
    key: 'staple_carbs',
    label: '主食碳水包',
    description: '米饭、面包、面食、燕麦、土豆等基础主食。',
    queries: ['rice', 'bread', 'pasta', 'oat', 'potato'],
    coverage: ['米饭', '面包', '意面', '燕麦', '土豆'],
  },
  {
    key: 'vegetables',
    label: '蔬菜包',
    description: '西兰花、菠菜、胡萝卜、番茄、洋葱等常见蔬菜。',
    queries: ['broccoli', 'spinach', 'carrot', 'tomato', 'onion'],
    coverage: ['西兰花', '菠菜', '胡萝卜', '番茄', '洋葱'],
  },
  {
    key: 'fruits',
    label: '水果包',
    description: '苹果、香蕉、橙子、草莓等高频水果。',
    queries: ['apple', 'banana', 'orange', 'strawberry'],
    coverage: ['苹果', '香蕉', '橙子', '草莓'],
  },
  {
    key: 'dairy',
    label: '乳制品包',
    description: '牛奶、酸奶、奶酪等常见乳制品。',
    queries: ['milk', 'yogurt', 'cheese'],
    coverage: ['牛奶', '酸奶', '奶酪'],
  },
];

/** 标准化后的食物数据 */
export interface ImportMetadata {
  group?: 'regular' | 'special';
  specialReason?: string;
  extraTags?: string[];
  desiredStatus?: 'draft' | 'active';
  desiredVerified?: boolean;
  desiredVerifiedBy?: string;
  desiredSearchWeight?: number;
  operator?: string;
}

export interface NormalizedFoodData {
  sourceType: string;
  sourceId: string;
  sourceUrl: string;
  rawPayload: Record<string, any>;
  mappedData?: Record<string, any>;
  fetchedAt: Date;
  code?: string;
  // 映射后的标准字段
  name: string;
  aliases?: string;
  category?: string;
  subCategory?: string;
  foodGroup?: string;
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
  phosphorus?: number;
  glycemicIndex?: number;
  glycemicLoad?: number;
  isProcessed?: boolean;
  isFried?: boolean;
  processingLevel?: number;
  allergens?: string[];
  mealTypes?: string[];
  tags?: string[];
  mainIngredient?: string;
  compatibility?: Record<string, string[]>;
  standardServingG?: number;
  standardServingDesc?: string;
  commonPortions?: Array<{ name: string; grams: number }>;
  barcode?: string;
  searchWeight?: number;
  importMetadata?: ImportMetadata;
  commonalityScore?: number;
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
    1008: 'calories', // Energy (kcal)
    1003: 'protein', // Protein
    1004: 'fat', // Total lipid (fat)
    1005: 'carbs', // Carbohydrate, by difference
    1079: 'fiber', // Fiber, total dietary
    2000: 'sugar', // Sugars, total
    1258: 'saturatedFat', // Fatty acids, total saturated
    1257: 'transFat', // Fatty acids, total trans
    1253: 'cholesterol', // Cholesterol
    1093: 'sodium', // Sodium, Na
    1092: 'potassium', // Potassium, K
    1087: 'calcium', // Calcium, Ca
    1089: 'iron', // Iron, Fe
    1106: 'vitaminA', // Vitamin A, RAE
    1162: 'vitaminC', // Vitamin C
    1114: 'vitaminD', // Vitamin D (D2 + D3)
    1109: 'vitaminE', // Vitamin E (alpha-tocopherol)
    1178: 'vitaminB12', // Vitamin B-12
    1177: 'folate', // Folate, total
    1095: 'zinc', // Zinc, Zn
    1090: 'magnesium', // Magnesium, Mg
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
    'Vegetables and Vegetable Products': 'veggie',
    'Fruits and Fruit Juices': 'fruit',
    'Cereal Grains and Pasta': 'grain',
    'Breakfast Cereals': 'grain',
    'Baked Products': 'grain',
    'Dairy and Egg Products': 'dairy',
    Beverages: 'beverage',
    Snacks: 'snack',
    Sweets: 'snack',
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
      this.logger.warn(
        'USDA_API_KEY not configured. USDA fetcher will not work. Get a free key at https://fdc.nal.usda.gov/api-key-signup.html',
      );
    }
  }

  /**
   * 搜索 USDA 食物数据
   */
  async search(
    query: string,
    pageSize = 25,
    pageNumber = 1,
    options: { foodCategory?: string; dataTypes?: string[] } = {},
  ): Promise<{ foods: NormalizedFoodData[]; totalHits: number }> {
    const url = `${this.baseUrl}/foods/search`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<UsdaSearchResponse>(url, {
          params: {
            api_key: this.apiKey,
            query,
            pageSize,
            pageNumber,
            dataType: (options.dataTypes || ['Foundation', 'SR Legacy']).join(
              ',',
            ),
            // USDA 对包含 "/" 的分类值存在兼容问题，例如
            // "American Indian/Alaska Native Foods" 直接传会 400/500。
            // 这里将 "/" 预替换为 "%2F"，让最终请求落成 USDA 可接受的格式。
            foodCategory: this.normalizeFoodCategoryParam(options.foodCategory),
          },
        }),
      );

      return {
        foods: data.foods.map((f) => this.normalize(f)),
        totalHits: data.totalHits,
      };
    } catch (e) {
      throw this.wrapUsdaError(`search query="${query}"`, e);
    }
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
      this.logger.warn(
        `Failed to fetch USDA food ${fdcId}: ${this.formatUsdaError(e)}`,
      );
      return null;
    }
  }

  /**
   * 批量获取食物数据
   */
  async batchGet(fdcIds: number[]): Promise<NormalizedFoodData[]> {
    const url = `${this.baseUrl}/foods`;
    try {
      const { data } = await firstValueFrom(
        this.httpService.post<UsdaRawFood[]>(
          url,
          { fdcIds },
          {
            params: { api_key: this.apiKey },
          },
        ),
      );
      return data.map((f) => this.normalize(f));
    } catch (e) {
      throw this.wrapUsdaError(`batchGet ids=${fdcIds.length}`, e);
    }
  }

  /**
   * 批量同步：分页拉取全部 Foundation + SR Legacy 食物
   */
  async *syncAll(
    options: { pageSize?: number; maxPages?: number } = {},
  ): AsyncGenerator<NormalizedFoodData[]> {
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
      category:
        (raw.foodCategory ? this.CATEGORY_MAP[raw.foodCategory] : undefined) ||
        undefined,
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

  private normalizeFoodCategoryParam(
    foodCategory?: string,
  ): string | undefined {
    if (!foodCategory) return undefined;
    return foodCategory.replaceAll('/', '%2F');
  }

  getSupportedCategories(): UsdaCategoryOption[] {
    return Object.entries(this.CATEGORY_MAP)
      .map(([value, mappedCategory]) => ({
        value,
        label: USDA_CATEGORY_LABEL_ZH_MAP[value] || value,
        mappedCategory,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private wrapUsdaError(context: string, error: any): Error {
    return new Error(`USDA ${context} failed: ${this.formatUsdaError(error)}`);
  }

  private formatUsdaError(error: any): string {
    const status = error?.response?.status;
    const remoteMessage =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.response?.statusText;
    const message = remoteMessage || error?.message || 'Unknown error';
    return status ? `status ${status} - ${message}` : message;
  }
}
