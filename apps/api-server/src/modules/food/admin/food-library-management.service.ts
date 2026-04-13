import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  ENRICHABLE_FIELDS,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  ENRICHMENT_STAGES,
} from '../../../food-pipeline/services/food-enrichment.service';
import { ENRICHMENT_FIELD_LABELS, ENRICHMENT_FIELD_UNITS } from '../food.types';
import {
  GetFoodLibraryQueryDto,
  CreateFoodLibraryDto,
  UpdateFoodLibraryDto,
  CreateFoodTranslationDto,
  UpdateFoodTranslationDto,
  CreateFoodSourceDto,
  ResolveFoodConflictDto,
} from './dto/food-library-management.dto';

@Injectable()
export class FoodLibraryManagementService {
  private readonly logger = new Logger(FoodLibraryManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== DTO → DB 字段映射 ====================
  // Prisma 使用 snake_case，DTO 新增字段使用 camelCase，需要手动映射。
  // 其他字段（code/name/aliases 等）Prisma 已通过 @map 自动映射，无需重复处理。
  private mapDtoToDb(dto: Record<string, any>): Record<string, any> {
    const {
      subCategory,
      foodGroup,
      foodForm,
      dishPriority,
      addedSugar,
      naturalSugar,
      saturatedFat,
      transFat,
      vitaminA,
      vitaminC,
      vitaminD,
      vitaminE,
      vitaminB12,
      // V7.9 新增微量营养素
      vitaminB6,
      omega3,
      omega6,
      solubleFiber,
      insolubleFiber,
      waterContentPercent,
      glycemicIndex,
      glycemicLoad,
      isProcessed,
      isFried,
      processingLevel,
      fodmapLevel,
      oxalateLevel,
      qualityScore,
      satietyScore,
      nutrientDensity,
      mealTypes,
      mainIngredient,
      ingredientList,
      availableChannels,
      commonalityScore,
      standardServingG,
      standardServingDesc,
      commonPortions,
      flavorProfile,
      cookingMethod,
      cookingMethods,
      requiredEquipment,
      servingTemperature,
      textureTags,
      dishType,
      prepTimeMinutes,
      cookTimeMinutes,
      skillRequired,
      estimatedCostLevel,
      shelfLifeDays,
      // V7.9 获取难度
      acquisitionDifficulty,
      imageUrl,
      thumbnailUrl,
      primarySource,
      primarySourceId,
      isVerified,
      searchWeight,
      ...rest
    } = dto;

    const mapped: Record<string, any> = { ...rest };

    if (subCategory !== undefined) mapped.sub_category = subCategory;
    if (foodGroup !== undefined) mapped.food_group = foodGroup;
    if (foodForm !== undefined) mapped.food_form = foodForm;
    if (dishPriority !== undefined) mapped.dish_priority = dishPriority;
    if (addedSugar !== undefined) mapped.added_sugar = addedSugar;
    if (naturalSugar !== undefined) mapped.natural_sugar = naturalSugar;
    if (saturatedFat !== undefined) mapped.saturated_fat = saturatedFat;
    if (transFat !== undefined) mapped.trans_fat = transFat;
    if (vitaminA !== undefined) mapped.vitamin_a = vitaminA;
    if (vitaminC !== undefined) mapped.vitamin_c = vitaminC;
    if (vitaminD !== undefined) mapped.vitamin_d = vitaminD;
    if (vitaminE !== undefined) mapped.vitamin_e = vitaminE;
    if (vitaminB12 !== undefined) mapped.vitamin_b12 = vitaminB12;
    // V7.9 新增微量营养素（DB字段名与DTO一致，无需snake_case映射，但为统一风格仍显式列出）
    if (vitaminB6 !== undefined) mapped.vitamin_b6 = vitaminB6;
    if (omega3 !== undefined) mapped.omega3 = omega3;
    if (omega6 !== undefined) mapped.omega6 = omega6;
    if (solubleFiber !== undefined) mapped.soluble_fiber = solubleFiber;
    if (insolubleFiber !== undefined) mapped.insoluble_fiber = insolubleFiber;
    if (waterContentPercent !== undefined)
      mapped.water_content_percent = waterContentPercent;
    if (glycemicIndex !== undefined) mapped.glycemic_index = glycemicIndex;
    if (glycemicLoad !== undefined) mapped.glycemic_load = glycemicLoad;
    if (isProcessed !== undefined) mapped.is_processed = isProcessed;
    if (isFried !== undefined) mapped.is_fried = isFried;
    if (processingLevel !== undefined)
      mapped.processing_level = processingLevel;
    if (fodmapLevel !== undefined) mapped.fodmap_level = fodmapLevel;
    if (oxalateLevel !== undefined) mapped.oxalate_level = oxalateLevel;
    if (qualityScore !== undefined) mapped.quality_score = qualityScore;
    if (satietyScore !== undefined) mapped.satiety_score = satietyScore;
    if (nutrientDensity !== undefined)
      mapped.nutrient_density = nutrientDensity;
    if (mealTypes !== undefined) mapped.meal_types = mealTypes;
    if (mainIngredient !== undefined) mapped.main_ingredient = mainIngredient;
    if (ingredientList !== undefined) mapped.ingredient_list = ingredientList;
    if (availableChannels !== undefined)
      mapped.available_channels = availableChannels;
    if (commonalityScore !== undefined)
      mapped.commonality_score = commonalityScore;
    if (standardServingG !== undefined)
      mapped.standard_serving_g = standardServingG;
    if (standardServingDesc !== undefined)
      mapped.standard_serving_desc = standardServingDesc;
    if (commonPortions !== undefined) mapped.common_portions = commonPortions;
    if (flavorProfile !== undefined) mapped.flavor_profile = flavorProfile;
    if (cookingMethod !== undefined) mapped.cooking_method = cookingMethod;
    if (cookingMethods !== undefined) mapped.cooking_methods = cookingMethods;
    if (requiredEquipment !== undefined)
      mapped.required_equipment = requiredEquipment;
    if (servingTemperature !== undefined)
      mapped.serving_temperature = servingTemperature;
    if (textureTags !== undefined) mapped.texture_tags = textureTags;
    if (dishType !== undefined) mapped.dish_type = dishType;
    if (prepTimeMinutes !== undefined)
      mapped.prep_time_minutes = prepTimeMinutes;
    if (cookTimeMinutes !== undefined)
      mapped.cook_time_minutes = cookTimeMinutes;
    if (skillRequired !== undefined) mapped.skill_required = skillRequired;
    if (estimatedCostLevel !== undefined)
      mapped.estimated_cost_level = estimatedCostLevel;
    if (shelfLifeDays !== undefined) mapped.shelf_life_days = shelfLifeDays;
    if (acquisitionDifficulty !== undefined)
      mapped.acquisition_difficulty = acquisitionDifficulty;
    if (imageUrl !== undefined) mapped.image_url = imageUrl;
    if (thumbnailUrl !== undefined) mapped.thumbnail_url = thumbnailUrl;
    if (primarySource !== undefined) mapped.primary_source = primarySource;
    if (primarySourceId !== undefined)
      mapped.primary_source_id = primarySourceId;
    if (isVerified !== undefined) mapped.is_verified = isVerified;
    if (searchWeight !== undefined) mapped.search_weight = searchWeight;

    return mapped;
  }

  /**
   * DB 行（snake_case）→ 前端 DTO（camelCase）浅层转换。
   * 仅转换顶层键，JSONB 对象内部结构保持不变（field_sources/flavor_profile 等的内部 key 不变）。
   */
  private static mapFoodToDto(food: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(food)) {
      const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      result[camel] = value;
    }
    return result;
  }

  // ==================== 食物 CRUD ====================

  async findAll(query: GetFoodLibraryQueryDto) {
    const {
      page = 1,
      pageSize = 20,
      keyword,
      name,
      code,
      category,
      isVerified,
      primarySource,
      status,
      minCompleteness,
      maxCompleteness,
      enrichmentStatus,
      missingField,
      missingFields,
      reviewStatus,
      failedField,
      sortBy,
      sortOrder = 'desc',
    } = query;

    // Build dynamic WHERE clauses for ILIKE support
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIdx = 1;

    // keyword：同时模糊匹配 name / aliases / code（兼容旧调用方）
    if (keyword) {
      conditions.push(
        `(f.name ILIKE $${paramIdx} OR f.aliases ILIKE $${paramIdx} OR f.code ILIKE $${paramIdx})`,
      );
      params.push(`%${keyword}%`);
      paramIdx++;
    }
    // name：ProTable 列搜索直接传 name，单独模糊匹配名称和别名
    if (name && !keyword) {
      conditions.push(
        `(f.name ILIKE $${paramIdx} OR f.aliases ILIKE $${paramIdx})`,
      );
      params.push(`%${name}%`);
      paramIdx++;
    }
    // code：编码独立模糊搜索
    if (code && !keyword) {
      conditions.push(`f.code ILIKE $${paramIdx}`);
      params.push(`%${code}%`);
      paramIdx++;
    }
    if (category) {
      conditions.push(`f.category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }
    if (status) {
      conditions.push(`f.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }
    if (isVerified !== undefined) {
      // URL query string 传来可能是字符串 "true"/"false"，强制转为布尔值
      const boolVal =
        typeof isVerified === 'string'
          ? (isVerified as string) === 'true'
          : Boolean(isVerified);
      conditions.push(`f.is_verified = $${paramIdx}`);
      params.push(boolVal);
      paramIdx++;
    }
    if (primarySource) {
      conditions.push(`f.primary_source = $${paramIdx}`);
      params.push(primarySource);
      paramIdx++;
    }
    // 完整度范围筛选
    if (minCompleteness !== undefined) {
      conditions.push(`f.data_completeness >= $${paramIdx}`);
      params.push(minCompleteness);
      paramIdx++;
    }
    if (maxCompleteness !== undefined) {
      conditions.push(`f.data_completeness <= $${paramIdx}`);
      params.push(maxCompleteness);
      paramIdx++;
    }
    // 补全状态筛选
    if (enrichmentStatus) {
      conditions.push(`f.enrichment_status = $${paramIdx}`);
      params.push(enrichmentStatus);
      paramIdx++;
    }
    // V8.1: 整体审核状态筛选
    if (reviewStatus) {
      conditions.push(`f.review_status = $${paramIdx}`);
      params.push(reviewStatus);
      paramIdx++;
    }
    // V8.1: 按指定字段为空筛选（仅允许字母/数字/下划线，防止 SQL 注入）
    if (missingField && /^[a-z_][a-z0-9_]*$/.test(missingField)) {
      conditions.push(`f.${missingField} IS NULL`);
    }
    // V8.1: 多字段缺失组合筛选（逗号分隔，所有字段均为空才匹配）
    if (missingFields) {
      const fields = missingFields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => /^[a-z_][a-z0-9_]*$/.test(f));
      if (fields.length > 0) {
        const nullConds = fields.map((f) => `f.${f} IS NULL`).join(' AND ');
        conditions.push(`(${nullConds})`);
      }
    }
    // V8.1: 按补全失败字段筛选（field_sources 中含 'ai_failed' 的字段）
    if (failedField && /^[a-z_][a-z0-9_]*$/.test(failedField)) {
      conditions.push(`f.failed_fields ? $${paramIdx}`);
      params.push(failedField);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    // V8.1: 动态排序字段（白名单校验防止 SQL 注入）
    const SORTABLE_FIELDS: Record<string, string> = {
      data_completeness: 'f.data_completeness',
      confidence: 'f.confidence',
      created_at: 'f.created_at',
      updated_at: 'f.updated_at',
      search_weight: 'f.search_weight',
      name: 'f.name',
      calories: 'f.calories',
    };
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';
    let orderClause = 'f.search_weight DESC, f.created_at DESC';
    if (sortBy && SORTABLE_FIELDS[sortBy]) {
      orderClause = `${SORTABLE_FIELDS[sortBy]} ${direction} NULLS LAST, f.created_at DESC`;
    }

    const totalResult = await this.prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count FROM foods f WHERE ${whereClause}`,
      ...params,
    );
    const total = parseInt(totalResult[0]?.count ?? '0', 10);

    // 修复：避免在同一模板字符串中使用 paramIdx++（求值顺序不确定）
    const limitIdx = paramIdx;
    const offsetIdx = paramIdx + 1;

    const list = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT
         -- 基本信息
         f.id, f.code, f.name, f.aliases, f.barcode, f.status,
         f.category, f.sub_category, f.food_group,
         f.food_form, f.dish_priority,
         -- 宏量营养素（per 100g）
         f.calories, f.protein, f.fat, f.carbs, f.fiber, f.sugar,
         f.added_sugar, f.natural_sugar, f.saturated_fat, f.trans_fat,
         f.cholesterol,
         -- 微量营养素（per 100g）
         f.sodium, f.potassium, f.calcium, f.iron,
         f.vitamin_a, f.vitamin_c, f.vitamin_d, f.vitamin_e,
         f.vitamin_b12, f.folate, f.zinc, f.magnesium,
         f.phosphorus, f.purine,
         -- 健康评估
         f.glycemic_index, f.glycemic_load,
         f.is_processed, f.is_fried, f.processing_level,
         f.fodmap_level, f.oxalate_level,
         f.allergens, f.quality_score, f.satiety_score, f.nutrient_density,
         -- 标签与推荐决策
         f.meal_types, f.tags,
         f.main_ingredient, f.ingredient_list,
         f.compatibility, f.available_channels, f.commonality_score,
         -- 份量信息
         f.standard_serving_g, f.standard_serving_desc, f.common_portions,
         -- 烹饪与风味
         f.cuisine, f.flavor_profile,
         f.cooking_method, f.cooking_methods,
         f.required_equipment, f.serving_temperature,
         f.texture_tags, f.dish_type,
         f.prep_time_minutes, f.cook_time_minutes, f.skill_required,
         f.estimated_cost_level, f.shelf_life_days,
         -- 媒体资源
         f.image_url, f.thumbnail_url,
         -- 数据溯源与质控
         f.primary_source, f.primary_source_id,
         f.data_version, f.confidence, f.is_verified,
         f.verified_by, f.verified_at,
         f.search_weight, f.popularity,
         f.created_at, f.updated_at,
         -- V7.9 营养素字段
         f.vitamin_b6, f.omega3, f.omega6,
         f.soluble_fiber, f.insoluble_fiber, f.water_content_percent,
         f.acquisition_difficulty,
         -- 补全元数据
         f.data_completeness, f.enrichment_status, f.last_enriched_at,
         f.field_sources, f.field_confidence,
         -- V8.1: 整体审核状态 + 审核元数据
         f.review_status,
         f.reviewed_by,
         f.reviewed_at,
         f.failed_fields
       FROM foods f
       WHERE ${whereClause}
       ORDER BY ${orderClause}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params,
      pageSize,
      offset,
    );

    return {
      list: list.map(FoodLibraryManagementService.mapFoodToDto),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const food = await this.findOneSimple(id);
    // Load relations separately
    const [translations, sources, conflicts] = await Promise.all([
      this.prisma.food_translations.findMany({ where: { food_id: id } }),
      this.prisma.food_sources.findMany({ where: { food_id: id } }),
      this.prisma.food_conflicts.findMany({ where: { food_id: id } }),
    ]);

    // V8.1: 构建 enrichmentMeta — 字段级完整度详情
    const enrichmentMeta = this.buildEnrichmentMeta(food);

    return { ...FoodLibraryManagementService.mapFoodToDto(food), translations, sources, conflicts, enrichmentMeta };
  }

  /**
   * V8.3: 轻量查询 — 仅检查食物存在性并返回食物记录
   * 供 update/toggleVerified/updateStatus/remove 等方法使用，
   * 避免加载 translations/sources/conflicts/enrichmentMeta（4个额外查询）
   */
  private async findOneSimple(id: string) {
    const food = await this.prisma.foods.findUnique({ where: { id } });
    if (!food) {
      throw new NotFoundException('食物不存在');
    }
    return food;
  }

  /**
   * V8.1: 构建食物字段级补全元数据
   * 提供每个可补全字段的填充状态、数据来源、置信度等信息
   */
  private buildEnrichmentMeta(food: any) {
    const fieldSources = (food.field_sources as Record<string, string>) || {};
    const fieldConfidence =
      (food.field_confidence as Record<string, number>) || {};
    const failedFields = (food.failed_fields as Record<string, any>) || {};

    const isFieldFilled = (field: string): boolean => {
      const value = food[field];
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      return true;
    };

    // 字段级详情
    const fieldDetails = (ENRICHABLE_FIELDS as readonly string[]).map(
      (field) => {
        const filled = isFieldFilled(field);
        const label =
          ENRICHMENT_FIELD_LABELS[
            field as keyof typeof ENRICHMENT_FIELD_LABELS
          ] ?? field;
        const unit =
          ENRICHMENT_FIELD_UNITS[
            field as keyof typeof ENRICHMENT_FIELD_UNITS
          ] ?? '';
        return {
          field,
          label,
          unit,
          filled,
          value: filled ? food[field] : null,
          source: fieldSources[field] ?? null,
          confidence: fieldConfidence[field] ?? null,
          failed: failedFields[field] ?? null,
        };
      },
    );

    // 缺失字段列表
    const missingFields = fieldDetails
      .filter((d) => !d.filled)
      .map((d) => d.field);

    // 分组完整度
    const computeGroupScore = (fields: readonly string[]): number => {
      if (fields.length === 0) return 0;
      const filled = fields.filter((f) => isFieldFilled(f)).length;
      return Math.round((filled / fields.length) * 100);
    };

    const groups = {
      core: computeGroupScore(
        ENRICHMENT_STAGES[0].fields as unknown as string[],
      ),
      micro: computeGroupScore(
        ENRICHMENT_STAGES[1].fields as unknown as string[],
      ),
      health: computeGroupScore(
        ENRICHMENT_STAGES[2].fields as unknown as string[],
      ),
      usage: computeGroupScore(
        ENRICHMENT_STAGES[3].fields as unknown as string[],
      ),
      extended: computeGroupScore(
        ENRICHMENT_STAGES[4].fields as unknown as string[],
      ),
    };

    // 来源分布
    const sourceDistribution: Record<string, number> = {};
    for (const src of Object.values(fieldSources)) {
      sourceDistribution[src] = (sourceDistribution[src] || 0) + 1;
    }

    return {
      completeness: {
        score: food.data_completeness ?? this.computeSimpleCompleteness(food),
        groups,
      },
      fieldDetails,
      missingFields,
      failedFieldCount: Object.keys(failedFields).length,
      sourceDistribution,
      enrichmentHistory: {
        lastEnrichedAt: food.last_enriched_at,
        enrichmentStatus: food.enrichment_status,
        reviewStatus: food.review_status,
        reviewedBy: food.reviewed_by,
        reviewedAt: food.reviewed_at,
        dataVersion: food.data_version,
      },
    };
  }

  async create(dto: CreateFoodLibraryDto) {
    const existing = await this.prisma.foods.findFirst({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`食物 "${dto.name}" 已存在`);
    }
    const codeExisting = await this.prisma.foods.findFirst({
      where: { code: dto.code },
    });
    if (codeExisting) {
      throw new ConflictException(`编码 "${dto.code}" 已存在`);
    }
    const saved = await this.prisma.foods.create({
      data: this.mapDtoToDb(dto) as any,
    });

    // 写变更日志
    await this.createChangeLog(
      saved.id,
      1,
      'create',
      dto as any,
      '创建食物',
      'admin',
    );
    return saved;
  }

  async update(id: string, dto: UpdateFoodLibraryDto, operator = 'admin') {
    // V8.3: 使用 findOneSimple 避免加载 translations/sources/conflicts/enrichmentMeta
    const food = await this.findOneSimple(id);
    if (dto.name && dto.name !== food.name) {
      const existing = await this.prisma.foods.findFirst({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(`食物 "${(dto as any).name}" 已存在`);
      }
    }

    // 记录变更前后
    const changes: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && (food as any)[key] !== value) {
        changes[key] = { old: (food as any)[key], new: value };
      }
    }

    const mappedData = this.mapDtoToDb(dto);
    const newVersion = (food.data_version || 1) + 1;

    // V8.0: 更新 field_sources — 手动编辑的字段标记为 'manual'
    const existingSources =
      (food.field_sources as Record<string, string>) || {};
    const existingConfidence =
      (food.field_confidence as Record<string, number>) || {};
    const newSources = { ...existingSources };
    const newConfidence = { ...existingConfidence };
    const enrichableSet = new Set<string>(
      ENRICHABLE_FIELDS as unknown as string[],
    );

    for (const [dbKey] of Object.entries(mappedData)) {
      if (enrichableSet.has(dbKey)) {
        newSources[dbKey] = 'manual';
        newConfidence[dbKey] = 1.0; // 手动编辑置信度为 1.0
      }
    }

    // V8.3: 预计算完整度，合并到单次 UPDATE 中（避免双重 UPDATE）
    // 需要先合并 mappedData 到 food 上以计算更新后的完整度
    const mergedForCompleteness = { ...food, ...mappedData };
    const completeness = this.computeSimpleCompleteness(mergedForCompleteness);
    const enrichmentStatus =
      completeness >= 80
        ? 'completed'
        : completeness >= 30
          ? 'partial'
          : 'pending';

    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        ...mappedData,
        data_version: newVersion,
        field_sources: newSources,
        field_confidence: newConfidence,
        data_completeness: completeness,
        enrichment_status: enrichmentStatus,
      },
    });

    if (Object.keys(changes).length > 0) {
      await this.createChangeLog(
        id,
        saved.data_version,
        'update',
        changes,
        undefined,
        operator,
      );
    }
    return saved;
  }

  /**
   * V8.0: 简化版完整度计算（复用 ENRICHMENT_STAGES 权重逻辑）
   * 避免循环依赖：不引入 FoodEnrichmentService，直接使用常量计算
   */
  private computeSimpleCompleteness(food: any): number {
    const isFieldFilled = (field: string): boolean => {
      const value = food[field];
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      return true;
    };

    const computeGroupScore = (fields: readonly string[]): number => {
      if (fields.length === 0) return 0;
      const filled = fields.filter((f) => isFieldFilled(f)).length;
      return filled / fields.length;
    };

    const weights = [0.35, 0.25, 0.15, 0.15, 0.1];
    let score = 0;
    for (let i = 0; i < ENRICHMENT_STAGES.length && i < weights.length; i++) {
      score +=
        computeGroupScore(ENRICHMENT_STAGES[i].fields as unknown as string[]) *
        weights[i];
    }
    return Math.round(score * 100);
  }

  async remove(id: string): Promise<{ message: string }> {
    // V8.3: 使用 findOneSimple 避免不必要的关联查询
    const food = await this.findOneSimple(id);
    await this.prisma.foods.delete({ where: { id } });
    return { message: `食物 "${food.name}" 已删除` };
  }

  async batchImport(
    foods: CreateFoodLibraryDto[],
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dto of foods) {
      try {
        const existing = await this.prisma.foods.findFirst({
          where: { code: dto.code },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const saved = await this.prisma.foods.create({
          data: this.mapDtoToDb(dto) as any,
        });
        await this.createChangeLog(
          saved.id,
          1,
          'create',
          dto as any,
          '批量导入',
          'admin',
        );
        imported++;
      } catch (e) {
        errors.push(`${dto.code} (${dto.name}): ${e.message}`);
      }
    }

    return { imported, skipped, errors };
  }

  async toggleVerified(id: string, operator = 'admin') {
    // V8.3: 使用 findOneSimple 避免不必要的关联查询
    const food = await this.findOneSimple(id);
    const newIsVerified = !food.is_verified;
    const newVersion = (food.data_version || 1) + 1;
    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        is_verified: newIsVerified,
        verified_by: newIsVerified ? operator : null,
        verified_at: newIsVerified ? new Date() : null,
        data_version: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.data_version,
      'verify',
      {
        isVerified: { old: !newIsVerified, new: newIsVerified },
      },
      undefined,
      operator,
    );
    return saved;
  }

  async updateStatus(id: string, newStatus: string, operator = 'admin') {
    // V8.3: 使用 findOneSimple 避免不必要的关联查询
    const food = await this.findOneSimple(id);
    const oldStatus = food.status;
    const newVersion = (food.data_version || 1) + 1;
    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        status: newStatus,
        data_version: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.data_version,
      newStatus === 'archived' ? 'archive' : 'update',
      {
        status: { old: oldStatus, new: newStatus },
      },
      undefined,
      operator,
    );
    return saved;
  }

  // ==================== 统计 ====================

  async getStatistics() {
    const [total, verified] = await Promise.all([
      this.prisma.foods.count(),
      this.prisma.foods.count({ where: { is_verified: true } }),
    ]);
    const unverified = total - verified;

    const byCategory = await this.prisma.$queryRawUnsafe<
      { category: string; count: string }[]
    >(
      `SELECT category, COUNT(*)::text AS count FROM foods GROUP BY category ORDER BY COUNT(*) DESC`,
    );

    const bySource = await this.prisma.$queryRawUnsafe<
      { source: string; count: string }[]
    >(
      `SELECT primary_source AS source, COUNT(*)::text AS count FROM foods GROUP BY primary_source`,
    );

    const byStatus = await this.prisma.$queryRawUnsafe<
      { status: string; count: string }[]
    >(`SELECT status, COUNT(*)::text AS count FROM foods GROUP BY status`);

    // V8.3: 统一冲突计数口径 — 使用 resolved_at IS NULL（与 getStatisticsV81 一致）
    const conflictCount = await this.prisma.food_conflicts.count({
      where: { resolved_at: null },
    });

    return {
      total,
      verified,
      unverified,
      byCategory,
      bySource,
      byStatus,
      pendingConflicts: conflictCount,
    };
  }

  async getCategories(): Promise<string[]> {
    const result = await this.prisma.$queryRawUnsafe<{ category: string }[]>(
      `SELECT DISTINCT category FROM foods ORDER BY category ASC`,
    );
    return result.map((r) => r.category);
  }

  // ==================== 翻译管理 ====================

  async getTranslations(foodId: string) {
    return this.prisma.food_translations.findMany({
      where: { food_id: foodId },
      orderBy: { locale: 'asc' },
    });
  }

  async createTranslation(foodId: string, dto: CreateFoodTranslationDto) {
    await this.findOne(foodId); // validate food exists
    const existing = await this.prisma.food_translations.findFirst({
      where: { food_id: foodId, locale: (dto as any).locale },
    });
    if (existing) {
      throw new ConflictException(`该食物的 ${(dto as any).locale} 翻译已存在`);
    }
    return this.prisma.food_translations.create({
      data: { ...(dto as any), food_id: foodId },
    });
  }

  async updateTranslation(
    translationId: string,
    dto: UpdateFoodTranslationDto,
  ) {
    const translation = await this.prisma.food_translations.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    return this.prisma.food_translations.update({
      where: { id: translationId },
      data: dto as any,
    });
  }

  async deleteTranslation(translationId: string) {
    const translation = await this.prisma.food_translations.findUnique({
      where: { id: translationId },
    });
    if (!translation) throw new NotFoundException('翻译记录不存在');
    await this.prisma.food_translations.delete({
      where: { id: translationId },
    });
    return { message: '翻译已删除' };
  }

  // ==================== 数据来源管理 ====================

  async getSources(foodId: string) {
    return this.prisma.food_sources.findMany({
      where: { food_id: foodId },
      orderBy: { priority: 'desc' },
    });
  }

  async createSource(foodId: string, dto: CreateFoodSourceDto) {
    await this.findOne(foodId);
    return this.prisma.food_sources.create({
      data: { ...(dto as any), food_id: foodId },
    });
  }

  async deleteSource(sourceId: string) {
    const source = await this.prisma.food_sources.findUnique({
      where: { id: sourceId },
    });
    if (!source) throw new NotFoundException('来源记录不存在');
    await this.prisma.food_sources.delete({ where: { id: sourceId } });
    return { message: '来源已删除' };
  }

  // ==================== 变更日志 ====================

  async getChangeLogs(foodId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [list, total] = await Promise.all([
      this.prisma.food_change_logs.findMany({
        where: { food_id: foodId },
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.food_change_logs.count({ where: { food_id: foodId } }),
    ]);
    return { list, total, page, pageSize };
  }

  private async createChangeLog(
    foodId: string,
    version: number,
    action: string,
    changes: Record<string, any>,
    reason?: string,
    operator?: string,
  ) {
    return this.prisma.food_change_logs.create({
      data: {
        food_id: foodId,
        version,
        action,
        changes,
        reason: reason ?? null,
        operator: operator ?? null,
      },
    });
  }

  // ==================== 冲突管理 ====================

  async getConflicts(query: {
    foodId?: string;
    resolution?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { foodId, resolution, page = 1, pageSize = 20 } = query;

    const where: any = {};
    if (foodId) where.food_id = foodId;
    if (resolution) where.resolution = resolution;

    const [list, total] = await Promise.all([
      this.prisma.food_conflicts.findMany({
        where,
        include: { foods: true },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.food_conflicts.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async resolveConflict(
    conflictId: string,
    dto: ResolveFoodConflictDto,
    operator = 'admin',
  ) {
    const conflict = await this.prisma.food_conflicts.findUnique({
      where: { id: conflictId },
    });
    if (!conflict) throw new NotFoundException('冲突记录不存在');

    return this.prisma.food_conflicts.update({
      where: { id: conflictId },
      data: {
        resolution: (dto as any).resolution,
        resolved_value: (dto as any).resolvedValue,
        resolved_by: operator,
        resolved_at: new Date(),
      },
    });
  }

  // ─── V8.1: 批量更新 review_status ─────────────────────────────────────

  async batchUpdateReviewStatus(
    ids: string[],
    reviewStatus: 'pending' | 'approved' | 'rejected',
    reason?: string,
    operator = 'admin',
  ): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };

    // 批量更新 review_status 字段 + V8.1 审核元数据
    const updateData: Record<string, any> = { review_status: reviewStatus };
    if (reviewStatus === 'approved' || reviewStatus === 'rejected') {
      updateData.reviewed_by = operator;
      updateData.reviewed_at = new Date();
    } else {
      // pending（重置）时清空审核者
      updateData.reviewed_by = null;
      updateData.reviewed_at = null;
    }
    const result = await this.prisma.foods.updateMany({
      where: { id: { in: ids } },
      data: updateData as any,
    });

    // 写入变更日志（批量，每条食物一条日志）
    const actionMap: Record<string, string> = {
      approved: 'review_approved',
      rejected: 'review_rejected',
      pending: 'review_reset',
    };
    const action = actionMap[reviewStatus] ?? 'review_reset';
    const foods = await this.prisma.foods.findMany({
      where: { id: { in: ids } },
      select: { id: true, data_version: true },
    });

    await this.prisma.food_change_logs.createMany({
      data: foods.map((f) => ({
        food_id: f.id,
        version: f.data_version ?? 1,
        action,
        changes: { reviewStatus, previousStatus: null },
        reason: reason ?? `批量设置审核状态为 ${reviewStatus}`,
        operator,
      })),
    });

    this.logger.log(
      `batchUpdateReviewStatus: ${result.count} 条食物 → ${reviewStatus}`,
    );
    return { updated: result.count };
  }

  // ─── V8.1: 统计信息增强（含完整度分布和 reviewStatus 计数）────────────

  async getStatisticsV81() {
    // 原有统计（沿用 V8.0 logic，此处重建 SELECT）
    const [
      totalResult,
      verifiedResult,
      pendingConflictsResult,
      byCategoryResult,
      bySourceResult,
      completenessDistResult,
      reviewStatusResult,
    ] = await Promise.all([
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM foods WHERE status = 'active'`,
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM foods WHERE is_verified = TRUE AND status = 'active'`,
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM food_conflicts WHERE resolved_at IS NULL`,
      this.prisma.$queryRaw<Array<{ category: string; count: string }>>`
        SELECT category, COUNT(*)::text AS count FROM foods WHERE status = 'active' GROUP BY category ORDER BY COUNT(*) DESC`,
      this.prisma.$queryRaw<Array<{ source: string; count: string }>>`
        SELECT primary_source AS source, COUNT(*)::text AS count FROM foods WHERE status = 'active' GROUP BY primary_source ORDER BY COUNT(*) DESC`,
      // 完整度分布：<30 / 30-79 / >=80
      this.prisma.$queryRaw<Array<{ bucket: string; count: string }>>`
        SELECT
          CASE
            WHEN data_completeness < 30 THEN 'low'
            WHEN data_completeness < 80 THEN 'mid'
            ELSE 'high'
          END AS bucket,
          COUNT(*)::text AS count
        FROM foods WHERE status = 'active'
        GROUP BY 1`,
      // review_status 分布
      this.prisma.$queryRaw<Array<{ review_status: string; count: string }>>`
        SELECT review_status, COUNT(*)::text AS count
        FROM foods WHERE status = 'active'
        GROUP BY review_status`,
    ]);

    const total = parseInt((totalResult as any)[0]?.count ?? '0', 10);
    const verified = parseInt((verifiedResult as any)[0]?.count ?? '0', 10);
    const pendingConflicts = parseInt(
      (pendingConflictsResult as any)[0]?.count ?? '0',
      10,
    );
    const byCategory = (byCategoryResult as any[]).map((r) => ({
      category: r.category,
      count: parseInt(r.count, 10),
    }));
    const bySource = (bySourceResult as any[]).map((r) => ({
      source: r.source,
      count: parseInt(r.count, 10),
    }));

    // 完整度分布
    const completenessMap: Record<string, number> = {};
    for (const row of completenessDistResult as any[]) {
      completenessMap[row.bucket] = parseInt(row.count, 10);
    }
    const completenessDistribution = {
      low: completenessMap['low'] ?? 0,
      mid: completenessMap['mid'] ?? 0,
      high: completenessMap['high'] ?? 0,
    };

    // review_status 分布
    const reviewMap: Record<string, number> = {};
    for (const row of reviewStatusResult as any[]) {
      reviewMap[row.review_status] = parseInt(row.count, 10);
    }
    const reviewStatusCounts = {
      pending: reviewMap['pending'] ?? 0,
      approved: reviewMap['approved'] ?? 0,
      rejected: reviewMap['rejected'] ?? 0,
    };

    return {
      total,
      verified,
      pendingConflicts,
      byCategory,
      bySource,
      completenessDistribution,
      reviewStatusCounts,
    };
  }
}
