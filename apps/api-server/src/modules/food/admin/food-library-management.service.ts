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

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

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
         f.field_sources, f.field_confidence
       FROM foods f
       WHERE ${whereClause}
       ORDER BY f.search_weight DESC, f.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params,
      pageSize,
      offset,
    );

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const food = await this.prisma.foods.findUnique({ where: { id } });
    if (!food) {
      throw new NotFoundException('食物不存在');
    }
    // Load relations separately
    const [translations, sources, conflicts] = await Promise.all([
      this.prisma.food_translations.findMany({ where: { food_id: id } }),
      this.prisma.food_sources.findMany({ where: { food_id: id } }),
      this.prisma.food_conflicts.findMany({ where: { food_id: id } }),
    ]);
    return { ...food, translations, sources, conflicts };
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
    const food = await this.findOne(id);
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

    const saved = await this.prisma.foods.update({
      where: { id },
      data: {
        ...mappedData,
        data_version: newVersion,
        field_sources: newSources,
        field_confidence: newConfidence,
      },
    });

    // V8.0: 更新完整度评分
    const completeness = this.computeSimpleCompleteness(saved);
    const enrichmentStatus =
      completeness >= 80
        ? 'completed'
        : completeness >= 30
          ? 'partial'
          : 'pending';

    await this.prisma.foods.update({
      where: { id },
      data: {
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
    const food = await this.findOne(id);
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
    const food = await this.findOne(id);
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
    const food = await this.findOne(id);
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

    const conflictCount = await this.prisma.food_conflicts.count({
      where: { resolution: 'pending' },
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
}
