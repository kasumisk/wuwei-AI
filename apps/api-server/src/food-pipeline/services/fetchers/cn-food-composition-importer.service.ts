import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ImportMetadata, NormalizedFoodData } from './usda-fetcher.service';
import {
  FoodPipelineOrchestratorService,
  ImportResult,
} from '../food-pipeline-orchestrator.service';

interface JsonVisionRecord {
  foodCode?: string;
  foodName?: string;
  edible?: string;
  water?: string;
  energyKCal?: string;
  energyKJ?: string;
  protein?: string;
  fat?: string;
  CHO?: string;
  dietaryFiber?: string;
  cholesterol?: string;
  ash?: string;
  vitaminA?: string;
  carotene?: string;
  retinol?: string;
  thiamin?: string;
  riboflavin?: string;
  niacin?: string;
  vitaminC?: string;
  vitaminETotal?: string;
  vitaminE1?: string;
  vitaminE2?: string;
  vitaminE3?: string;
  Ca?: string;
  P?: string;
  K?: string;
  Na?: string;
  Mg?: string;
  Fe?: string;
  Zn?: string;
  Se?: string;
  Cu?: string;
  Mn?: string;
  remark?: string;
}

interface FileClassification {
  originalPath: string;
  originalSegments: string[];
  category: string;
  subCategory?: string;
  foodGroup?: string;
}

export interface CnFoodCompositionImportSummary {
  totalFiles: number;
  totalRecords: number;
  importedRecords: number;
  importResult: ImportResult;
}

@Injectable()
export class CnFoodCompositionImporterService {
  private readonly logger = new Logger(CnFoodCompositionImporterService.name);

  private readonly topLevelCategoryMap: Record<
    string,
    { category: string; foodGroup?: string }
  > = {
    畜肉类及其制品: { category: 'protein', foodGroup: 'meat' },
    禽肉类及其制品: { category: 'protein', foodGroup: 'poultry' },
    鱼虾蟹贝类: { category: 'protein', foodGroup: 'seafood' },
    蛋类及其制品: { category: 'protein', foodGroup: 'egg' },
    干豆类及其制品: { category: 'protein', foodGroup: 'legume' },
    谷类及其制品: { category: 'grain', foodGroup: 'grain' },
    薯类淀粉及其制品: { category: 'grain', foodGroup: 'tuber' },
    坚果种子类: { category: 'fat', foodGroup: 'nuts_seeds' },
    蔬菜类及其制品: { category: 'veggie', foodGroup: 'vegetable' },
    菌藻类: { category: 'veggie', foodGroup: 'fungi_algae' },
    水果类及其制品: { category: 'fruit', foodGroup: 'fruit' },
    乳类及其制品: { category: 'dairy', foodGroup: 'dairy' },
    动物油脂类: { category: 'fat', foodGroup: 'animal_fat' },
    植物油: { category: 'fat', foodGroup: 'plant_oil' },
    其他类: { category: 'composite', foodGroup: 'other' },
  };

  private readonly subCategoryMap: Record<string, string> = {
    牛: 'beef',
    猪: 'pork',
    羊: 'lamb',
    马: 'horse',
    驴: 'donkey',
    其他: 'other',
    鸡: 'chicken',
    鸭: 'duck',
    鹅: 'goose',
    火鸡: 'turkey',
    鱼: 'fish',
    虾: 'shrimp',
    蟹: 'crab',
    贝: 'shellfish',
    鸡蛋: 'chicken_egg',
    鸭蛋: 'duck_egg',
    鹅蛋: 'goose_egg',
    鹌鹑蛋: 'quail_egg',
    大豆: 'soybean',
    绿豆: 'mung_bean',
    赤豆: 'adzuki_bean',
    蚕豆: 'broad_bean',
    芸豆: 'kidney_bean',
    稻米: 'rice',
    小麦: 'wheat',
    大麦: 'barley',
    小米黄米: 'millet',
    玉米: 'corn',
    树坚果: 'tree_nuts',
    种子: 'seeds',
    菌类: 'mushroom',
    藻类: 'algae',
    根菜类: 'root_vegetable',
    茄果瓜菜类: 'fruiting_vegetable',
    嫩茎叶花菜类: 'leafy_vegetable',
    薯芋类: 'tuber_vegetable',
    水生蔬菜类: 'aquatic_vegetable',
    葱蒜类: 'allium_vegetable',
    鲜豆类: 'fresh_bean',
    野生蔬菜类: 'wild_vegetable',
    柑橘类: 'citrus',
    瓜果类: 'melon',
    核果类: 'stone_fruit',
    浆果类: 'berry',
    热带亚热带水果: 'tropical_fruit',
    仁果类: 'pome_fruit',
    奶粉: 'milk_powder',
    奶酪: 'cheese',
    奶油: 'cream',
    酸奶: 'yogurt',
    液态乳: 'liquid_milk',
    淀粉类: 'starch',
    薯类: 'tuber',
    动物油脂: 'animal_fat',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: FoodPipelineOrchestratorService,
  ) {}

  async importFromDirectory(
    directoryPath: string,
  ): Promise<CnFoodCompositionImportSummary> {
    await this.ensureFoodSchemaColumns();

    const fileNames = (await fs.readdir(directoryPath))
      .filter((fileName) => fileName.endsWith('.json'))
      .sort();

    const foods: NormalizedFoodData[] = [];

    for (const fileName of fileNames) {
      const absolutePath = join(directoryPath, fileName);
      const fileClassification = this.classifyFile(fileName);
      const content = await fs.readFile(absolutePath, 'utf8');
      const items = JSON.parse(content) as JsonVisionRecord[];

      for (const item of items) {
        const normalized = this.normalizeRecord(
          item,
          fileName,
          fileClassification,
        );
        if (!normalized) {
          continue;
        }

        foods.push(normalized);
      }
    }

    this.logger.log(`CN food composition parsed: total=${foods.length}`);

    const importResult = await this.orchestrator.importNormalizedFoods(
      foods,
      'cn_food_composition',
    );

    return {
      totalFiles: fileNames.length,
      totalRecords: foods.length,
      importedRecords: foods.length,
      importResult,
    };
  }

  private normalizeRecord(
    record: JsonVisionRecord,
    fileName: string,
    classification: FileClassification,
  ): NormalizedFoodData | null {
    if (!record.foodCode || !record.foodName) {
      return null;
    }

    const traceFields: string[] = [];
    const aliasParts = this.extractAliases(record.foodName);
    const importMetadata = this.buildImportMetadata();

    const mappedData = {
      water: this.parseNumeric(record.water, 'water', traceFields),
      edible: this.parseNumeric(record.edible, 'edible', traceFields),
      ash: this.parseNumeric(record.ash, 'ash', traceFields),
      carotene: this.parseNumeric(record.carotene, 'carotene', traceFields),
      retinol: this.parseNumeric(record.retinol, 'retinol', traceFields),
      thiamin: this.parseNumeric(record.thiamin, 'thiamin', traceFields),
      riboflavin: this.parseNumeric(
        record.riboflavin,
        'riboflavin',
        traceFields,
      ),
      niacin: this.parseNumeric(record.niacin, 'niacin', traceFields),
      selenium: this.parseNumeric(record.Se, 'selenium', traceFields),
      copper: this.parseNumeric(record.Cu, 'copper', traceFields),
      manganese: this.parseNumeric(record.Mn, 'manganese', traceFields),
      vitaminE1: this.parseNumeric(record.vitaminE1, 'vitaminE1', traceFields),
      vitaminE2: this.parseNumeric(record.vitaminE2, 'vitaminE2', traceFields),
      vitaminE3: this.parseNumeric(record.vitaminE3, 'vitaminE3', traceFields),
      energyKJ: this.parseNumeric(record.energyKJ, 'energyKJ', traceFields),
      remark: this.cleanOptionalText(record.remark),
      originalFileName: fileName,
      originalCategoryPath: classification.originalPath,
      traceFields,
    };

    return {
      sourceType: 'cn_food_composition',
      sourceId: record.foodCode,
      sourceUrl: `local://json_data_vision/${fileName}`,
      rawPayload: {
        ...record,
        originalFileName: fileName,
        originalCategoryPath: classification.originalPath,
      },
      mappedData,
      fetchedAt: new Date(),
      name: aliasParts.name,
      aliases: aliasParts.aliases,
      category: classification.category,
      subCategory: classification.subCategory,
      foodGroup: classification.foodGroup,
      calories:
        this.parseNumeric(record.energyKCal, 'energyKCal', traceFields) || 0,
      protein: this.parseNumeric(record.protein, 'protein', traceFields),
      fat: this.parseNumeric(record.fat, 'fat', traceFields),
      carbs: this.parseNumeric(record.CHO, 'CHO', traceFields),
      fiber: this.parseNumeric(
        record.dietaryFiber,
        'dietaryFiber',
        traceFields,
      ),
      cholesterol: this.parseNumeric(
        record.cholesterol,
        'cholesterol',
        traceFields,
      ),
      sodium: this.parseNumeric(record.Na, 'Na', traceFields),
      potassium: this.parseNumeric(record.K, 'K', traceFields),
      calcium: this.parseNumeric(record.Ca, 'Ca', traceFields),
      iron: this.parseNumeric(record.Fe, 'Fe', traceFields),
      vitaminA: this.parseNumeric(record.vitaminA, 'vitaminA', traceFields),
      vitaminC: this.parseNumeric(record.vitaminC, 'vitaminC', traceFields),
      vitaminE: this.parseNumeric(
        record.vitaminETotal,
        'vitaminETotal',
        traceFields,
      ),
      zinc: this.parseNumeric(record.Zn, 'Zn', traceFields),
      magnesium: this.parseNumeric(record.Mg, 'Mg', traceFields),
      phosphorus: this.parseNumeric(record.P, 'P', traceFields),
      isProcessed: false,
      isFried: false,
      processingLevel: 1,
      mealTypes: this.deriveMealTypes(classification.category),
      standardServingG: 100,
      standardServingDesc: '每100g',
      searchWeight: importMetadata.desiredSearchWeight,
      code: `FOOD_CFC_${record.foodCode.replace(/[^0-9A-Za-z]/g, '')}`,
      importMetadata,
    };
  }

  private classifyFile(fileName: string): FileClassification {
    const stem = basename(fileName, '.json').replace(/^merged_/, '');
    const segments = stem.split('-');
    const top = segments[0];
    const second = segments[1];
    const third = segments.slice(2).join('-');
    const topLevel = this.topLevelCategoryMap[top] || {
      category: 'composite',
      foodGroup: 'other',
    };

    const subCategory =
      this.subCategoryMap[third] || this.subCategoryMap[second] || undefined;

    return {
      originalPath: stem,
      originalSegments: segments,
      category: topLevel.category,
      subCategory,
      foodGroup: topLevel.foodGroup,
    };
  }

  private buildImportMetadata(): ImportMetadata {
    return {
      group: 'regular',
      desiredStatus: 'active',
      desiredVerified: true,
      desiredVerifiedBy: 'json-vision-import',
      desiredSearchWeight: 100,
      operator: 'json_vision_import',
    };
  }

  private extractAliases(foodName: string): { name: string; aliases?: string } {
    const match = foodName.match(/^(.*?)(?:\[([^\]]+)\])$/);
    if (!match) {
      return { name: foodName.trim() };
    }

    const aliasSet = match[2]
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      name: match[1].trim(),
      aliases: aliasSet.length > 0 ? aliasSet.join(',') : undefined,
    };
  }

  private deriveMealTypes(category: string): string[] {
    switch (category) {
      case 'dairy':
        return ['breakfast', 'snack'];
      case 'fruit':
        return ['breakfast', 'snack'];
      case 'veggie':
        return ['lunch', 'dinner'];
      case 'fat':
        return ['lunch', 'dinner'];
      case 'grain':
      case 'protein':
        return ['breakfast', 'lunch', 'dinner'];
      default:
        return ['lunch', 'dinner'];
    }
  }

  private parseNumeric(
    value: string | undefined,
    fieldName: string,
    traceFields: string[],
  ): number | undefined {
    if (!value || value === '—') {
      return undefined;
    }

    if (value === 'Tr') {
      traceFields.push(fieldName);
      return undefined;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private cleanOptionalText(value?: string): string | undefined {
    if (!value || value === '—') {
      return undefined;
    }

    return value.trim() || undefined;
  }

  private async ensureFoodSchemaColumns(): Promise<void> {
    const existingColumns = await this.prisma.$queryRawUnsafe<
      Array<{ column_name: string }>
    >(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'foods'`,
    );

    const existingColumnNames = new Set(
      existingColumns.map((column) => column.column_name),
    );

    const requiredColumns: Array<{ name: string; sql: string }> = [
      {
        name: 'cuisine',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "cuisine" VARCHAR(30)`,
      },
      {
        name: 'flavor_profile',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "flavor_profile" JSONB`,
      },
      {
        name: 'prep_time_minutes',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "prep_time_minutes" INT`,
      },
      {
        name: 'cook_time_minutes',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "cook_time_minutes" INT`,
      },
      {
        name: 'skill_required',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "skill_required" VARCHAR(10)`,
      },
      {
        name: 'estimated_cost_level',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "estimated_cost_level" INT`,
      },
      {
        name: 'shelf_life_days',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "shelf_life_days" INT`,
      },
      {
        name: 'fodmap_level',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "fodmap_level" VARCHAR(10)`,
      },
      {
        name: 'oxalate_level',
        sql: `ALTER TABLE "foods" ADD COLUMN IF NOT EXISTS "oxalate_level" VARCHAR(10)`,
      },
      // V8.2: embedding_v5 已迁移到 food_embeddings 关联表，不再属于 foods 表 DDL 自动补齐范围
    ];

    for (const column of requiredColumns) {
      if (existingColumnNames.has(column.name)) {
        continue;
      }

      this.logger.warn(`foods 表缺少列 ${column.name}，导入前自动补齐`);
      await this.prisma.$executeRawUnsafe(column.sql);
    }
  }
}
