import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';
import { FoodProvenanceRepository } from '../repositories';
import {
  ENRICHABLE_FIELDS,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  ENRICHMENT_STAGES,
  snakeToCamel,
} from '../../../food-pipeline/services/food-enrichment.service';
import { ENRICHMENT_FIELD_LABELS, ENRICHMENT_FIELD_UNITS } from '../food.types';
import {
  HEALTH_ASSESSMENT_FIELDS,
  NUTRITION_DETAIL_FIELDS,
  FOOD_SPLIT_INCLUDE,
  PORTION_GUIDE_FIELDS,
  TAXONOMY_FIELDS,
} from '../food-split.helper';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
    private readonly provenanceRepo: FoodProvenanceRepository,
  ) {}

  // ==================== DTO → DB 字段映射 ====================
  // After Prisma schema migration to camelCase field names, the DTO keys
  // match Prisma field names directly. We only need to strip undefined values
  // to avoid accidentally nullifying existing data during partial updates.
  private stripUndefined(dto: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        result[key] = value;
      }
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
    const getFieldSqlRef = (field: string): string => {
      const camelField = snakeToCamel(field);
      if (NUTRITION_DETAIL_FIELDS.has(camelField)) return `nd.${field}`;
      if (HEALTH_ASSESSMENT_FIELDS.has(camelField)) return `ha.${field}`;
      if (TAXONOMY_FIELDS.has(camelField)) return `tx.${field}`;
      if (PORTION_GUIDE_FIELDS.has(camelField)) return `pg.${field}`;
      return `f.${field}`;
    };

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
      conditions.push(`${getFieldSqlRef(missingField)} IS NULL`);
    }
    // V8.1: 多字段缺失组合筛选（逗号分隔，所有字段均为空才匹配）
    if (missingFields) {
      const fields = missingFields
        .split(',')
        .map((f) => f.trim())
        .filter((f) => /^[a-z_][a-z0-9_]*$/.test(f));
      if (fields.length > 0) {
        const nullConds = fields
          .map((f) => `${getFieldSqlRef(f)} IS NULL`)
          .join(' AND ');
        conditions.push(`(${nullConds})`);
      }
    }
    // V8.1: 按补全失败字段筛选（V8.2: 改为 EXISTS 子查询 food_field_provenance 表）
    if (failedField && /^[a-z_][a-z0-9_]*$/.test(failedField)) {
      conditions.push(
        `EXISTS (SELECT 1 FROM food_field_provenance p WHERE p.food_id = f.id AND p.status = 'failed' AND p.field_name = $${paramIdx})`,
      );
      params.push(failedField);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;

    // V8.1: 动态排序字段（白名单校验防止 SQL 注入）
    const SORTABLE_FIELDS: Record<string, string> = {
      dataCompleteness: 'f.data_completeness',
      confidence: 'f.confidence',
      createdAt: 'f.created_at',
      updatedAt: 'f.updated_at',
      searchWeight: 'f.search_weight',
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
         nd.added_sugar AS added_sugar, nd.natural_sugar AS natural_sugar, nd.saturated_fat AS saturated_fat, nd.trans_fat AS trans_fat,
         nd.cholesterol AS cholesterol,
          -- 微量营养素（per 100g）
         f.sodium, f.potassium, f.calcium, f.iron,
         nd.vitamin_a AS vitamin_a, nd.vitamin_c AS vitamin_c, nd.vitamin_d AS vitamin_d, nd.vitamin_e AS vitamin_e,
         nd.vitamin_b12 AS vitamin_b12, nd.folate AS folate, nd.zinc AS zinc, nd.magnesium AS magnesium,
         nd.phosphorus AS phosphorus, nd.purine AS purine,
          -- 健康评估
         ha.glycemic_index AS glycemic_index, ha.glycemic_load AS glycemic_load,
         ha.is_processed AS is_processed, ha.is_fried AS is_fried, ha.processing_level AS processing_level,
         ha.fodmap_level AS fodmap_level, ha.oxalate_level AS oxalate_level,
         tx.allergens AS allergens, ha.quality_score AS quality_score, ha.satiety_score AS satiety_score, ha.nutrient_density AS nutrient_density,
          -- 标签与推荐决策
         tx.meal_types AS meal_types, tx.tags AS tags,
          f.main_ingredient, f.ingredient_list,
         tx.compatibility AS compatibility, tx.available_channels AS available_channels, f.commonality_score,
          -- 份量信息
         pg.standard_serving_g AS standard_serving_g, pg.standard_serving_desc AS standard_serving_desc, pg.common_portions AS common_portions,
          -- 烹饪与风味
         tx.cuisine AS cuisine, tx.flavor_profile AS flavor_profile,
         pg.cooking_methods AS cooking_methods,
         pg.required_equipment AS required_equipment, pg.serving_temperature AS serving_temperature,
         tx.texture_tags AS texture_tags, tx.dish_type AS dish_type,
         pg.prep_time_minutes AS prep_time_minutes, pg.cook_time_minutes AS cook_time_minutes, pg.skill_required AS skill_required,
         pg.estimated_cost_level AS estimated_cost_level, pg.shelf_life_days AS shelf_life_days,
          -- 媒体资源
         f.image_url, f.thumbnail_url,
         -- 数据溯源与质控
         f.primary_source, f.primary_source_id,
         f.data_version, f.confidence, f.is_verified,
         f.verified_by, f.verified_at,
          f.search_weight, f.popularity,
          f.created_at, f.updated_at,
          -- V7.9 营养素字段
         nd.vitamin_b6 AS vitamin_b6, nd.omega3 AS omega3, nd.omega6 AS omega6,
         nd.soluble_fiber AS soluble_fiber, nd.insoluble_fiber AS insoluble_fiber, pg.water_content_percent AS water_content_percent,
         f.acquisition_difficulty,
           -- 补全元数据
           f.data_completeness, f.enrichment_status, f.last_enriched_at,
         -- V8.1: 整体审核状态 + 审核元数据
         f.review_status,
         f.reviewed_by,
         f.reviewed_at,
         -- V8.2: failed_fields 已迁移到 food_field_provenance 表，按需 JOIN 查询
         (
           SELECT jsonb_object_agg(p.field_name, jsonb_build_object('reason', COALESCE(p.failure_reason, ''), 'updatedAt', p.updated_at))
             FROM food_field_provenance p
            WHERE p.food_id = f.id AND p.status = 'failed'
         ) AS "failedFields"
        FROM foods f
        LEFT JOIN food_nutrition_details nd ON nd.food_id = f.id
        LEFT JOIN food_health_assessments ha ON ha.food_id = f.id
        LEFT JOIN food_taxonomies tx ON tx.food_id = f.id
        LEFT JOIN food_portion_guides pg ON pg.food_id = f.id
        WHERE ${whereClause}
        ORDER BY ${orderClause}
        LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params,
      pageSize,
      offset,
    );

    // Raw SQL returns snake_case column names; convert to camelCase for API response
    const toCamelCase = (row: Record<string, any>): Record<string, any> => {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        const camel = key.replace(/_([a-z])/g, (_, c: string) =>
          c.toUpperCase(),
        );
        result[camel] = value;
      }
      return result;
    };

    return {
      list: list.map(toCamelCase),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string) {
    const food = await this.prisma.food.findUnique({
      where: { id },
      include: FOOD_SPLIT_INCLUDE,
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFound'));
    }
    // Load relations separately
    const [translations, sources, conflicts] = await Promise.all([
      this.prisma.foodTranslations.findMany({ where: { foodId: id } }),
      this.prisma.foodSources.findMany({ where: { foodId: id } }),
      this.prisma.foodConflicts.findMany({ where: { foodId: id } }),
    ]);

    // V8.2: 构建 enrichmentMeta — 字段级完整度详情（异步：从 provenance 表查失败字段）
    const enrichmentMeta = await this.buildEnrichmentMeta(food);

    return { ...food, translations, sources, conflicts, enrichmentMeta };
  }

  /**
   * V8.3: 轻量查询 — 仅检查食物存在性并返回食物记录
   * 供 update/toggleVerified/updateStatus/remove 等方法使用，
   * 避免加载 translations/sources/conflicts/enrichmentMeta（4个额外查询）
   */
  private async findOneSimple(id: string) {
    const food = await this.prisma.food.findUnique({
      where: { id },
      include: FOOD_SPLIT_INCLUDE,
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFound'));
    }
    return food;
  }

  /**
   * V8.2: 构建食物字段级补全元数据
   * 提供每个可补全字段的填充状态、数据来源、置信度等信息
   *
   * V8.2 重构：failed_fields JSONB 已删除，改为从 food_field_provenance 表
   * 查询 status='failed' 行；本方法变为异步。
   */
  private async buildEnrichmentMeta(food: any) {
    const [successMap, failedRows] = await Promise.all([
      this.provenanceRepo.getSuccessMap(food.id),
      this.provenanceRepo.listFailures(food.id),
    ]);
    const failedFields: Record<string, any> = {};
    for (const row of failedRows) {
      const raw = (row.rawValue as Record<string, any>) || {};
      failedFields[row.fieldName] = {
        reason: row.failureReason ?? raw.reasonCode ?? null,
        ...raw,
        updatedAt: row.updatedAt,
      };
    }

    const getFieldValue = (field: string) => {
      const camelField = snakeToCamel(field);
      if (NUTRITION_DETAIL_FIELDS.has(camelField))
        return food.nutritionDetail?.[camelField];
      if (HEALTH_ASSESSMENT_FIELDS.has(camelField))
        return food.healthAssessment?.[camelField];
      if (TAXONOMY_FIELDS.has(camelField)) return food.taxonomy?.[camelField];
      if (PORTION_GUIDE_FIELDS.has(camelField))
        return food.portionGuide?.[camelField];
      return food[camelField];
    };

    const isFieldFilled = (field: string): boolean => {
      const value = getFieldValue(field);
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      if (
        field === 'processing_level' ||
        field === 'commonality_score' ||
        field === 'available_channels'
      ) {
        return Boolean(successMap[field]);
      }
      return true;
    };

    // 字段级详情
    const fieldDetails = (ENRICHABLE_FIELDS as readonly string[]).map(
      (field) => {
        const filled = isFieldFilled(field);
        const label = ENRICHMENT_FIELD_LABELS[field] ?? field;
        const unit = ENRICHMENT_FIELD_UNITS[field] ?? '';
        return {
          field,
          label,
          unit,
          filled,
          value: filled ? getFieldValue(field) : null,
          source: successMap[field]?.source ?? null,
          confidence: successMap[field]?.confidence ?? null,
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
    for (const meta of Object.values(successMap)) {
      sourceDistribution[meta.source] =
        (sourceDistribution[meta.source] || 0) + 1;
    }

    return {
      completeness: {
        score:
          food.dataCompleteness ??
          this.computeSimpleCompleteness(food, successMap),
        groups,
      },
      fieldDetails,
      missingFields,
      failedFieldCount: Object.keys(failedFields).length,
      sourceDistribution,
      enrichmentHistory: {
        lastEnrichedAt: food.lastEnrichedAt,
        enrichmentStatus: food.enrichmentStatus,
        reviewStatus: food.reviewStatus,
        reviewedBy: food.reviewedBy,
        reviewedAt: food.reviewedAt,
        dataVersion: food.dataVersion,
      },
    };
  }

  async create(dto: CreateFoodLibraryDto) {
    const existing = await this.prisma.food.findFirst({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        this.i18n.t('food.foodNameDuplicate', { name: dto.name }),
      );
    }
    const codeExisting = await this.prisma.food.findFirst({
      where: { code: dto.code },
    });
    if (codeExisting) {
      throw new ConflictException(
        this.i18n.t('food.foodCodeDuplicate', { code: dto.code }),
      );
    }
    const saved = await this.prisma.food.create({
      data: this.stripUndefined(dto) as any,
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
      const existing = await this.prisma.food.findFirst({
        where: { name: dto.name },
      });
      if (existing) {
        throw new ConflictException(
          this.i18n.t('food.foodNameDuplicate', { name: (dto as any).name }),
        );
      }
    }

    // 记录变更前后
    const changes: Record<string, any> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined && (food as any)[key] !== value) {
        changes[key] = { old: (food as any)[key], new: value };
      }
    }

    const mappedData = this.stripUndefined(dto);
    const newVersion = (food.dataVersion || 1) + 1;

    const enrichableSet = new Set<string>(
      ENRICHABLE_FIELDS as unknown as string[],
    );

    // V8.3: 预计算完整度，合并到单次 UPDATE 中（避免双重 UPDATE）
    // 需要先合并 mappedData 到 food 上以计算更新后的完整度
    const mergedForCompleteness = { ...food, ...mappedData };
    const successMap = await this.provenanceRepo.getSuccessMap(id);
    for (const [dbKey] of Object.entries(mappedData)) {
      if (enrichableSet.has(dbKey)) {
        successMap[dbKey] = { source: 'manual', confidence: 1.0 };
      }
    }
    const completeness = this.computeSimpleCompleteness(
      mergedForCompleteness,
      successMap,
    );
    const enrichmentStatus =
      completeness >= 80
        ? 'completed'
        : completeness >= 30
          ? 'partial'
          : 'pending';

    const saved = await this.prisma.food.update({
      where: { id },
      data: {
        ...mappedData,
        dataVersion: newVersion,
        dataCompleteness: completeness,
        enrichmentStatus: enrichmentStatus,
      },
    });

    for (const [dbKey] of Object.entries(mappedData)) {
      if (enrichableSet.has(dbKey)) {
        await this.provenanceRepo.recordSuccess({
          foodId: id,
          fieldName: dbKey,
          source: 'manual',
          confidence: 1.0,
        });
        await this.provenanceRepo.clearFailuresForField(id, dbKey);
      }
    }

    if (Object.keys(changes).length > 0) {
      await this.createChangeLog(
        id,
        saved.dataVersion,
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
  private computeSimpleCompleteness(
    food: any,
    successMap: Record<
      string,
      { source: string; confidence: number | null }
    > = {},
  ): number {
    const getFieldValue = (field: string) => {
      const camelField = snakeToCamel(field);
      if (NUTRITION_DETAIL_FIELDS.has(camelField))
        return food.nutritionDetail?.[camelField];
      if (HEALTH_ASSESSMENT_FIELDS.has(camelField))
        return food.healthAssessment?.[camelField];
      if (TAXONOMY_FIELDS.has(camelField)) return food.taxonomy?.[camelField];
      if (PORTION_GUIDE_FIELDS.has(camelField))
        return food.portionGuide?.[camelField];
      return food[camelField];
    };

    const isFieldFilled = (field: string): boolean => {
      const value = getFieldValue(field);
      if (value === null || value === undefined) return false;
      if ((JSON_ARRAY_FIELDS as readonly string[]).includes(field))
        return Array.isArray(value) && value.length > 0;
      if ((JSON_OBJECT_FIELDS as readonly string[]).includes(field))
        return typeof value === 'object' && Object.keys(value).length > 0;
      if (
        field === 'processing_level' ||
        field === 'commonality_score' ||
        field === 'available_channels'
      ) {
        return Boolean(successMap[field]);
      }
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
    await this.prisma.food.delete({ where: { id } });
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
        const existing = await this.prisma.food.findFirst({
          where: { code: dto.code },
        });
        if (existing) {
          skipped++;
          continue;
        }
        const saved = await this.prisma.food.create({
          data: this.stripUndefined(dto) as any,
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
    const newIsVerified = !food.isVerified;
    const newVersion = (food.dataVersion || 1) + 1;
    const saved = await this.prisma.food.update({
      where: { id },
      data: {
        isVerified: newIsVerified,
        verifiedBy: newIsVerified ? operator : null,
        verifiedAt: newIsVerified ? new Date() : null,
        dataVersion: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.dataVersion,
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
    const newVersion = (food.dataVersion || 1) + 1;
    const saved = await this.prisma.food.update({
      where: { id },
      data: {
        status: newStatus,
        dataVersion: newVersion,
      },
    });

    await this.createChangeLog(
      id,
      saved.dataVersion,
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
    // V8.5: 合并 getStatisticsV81 能力，统一返回完整统计（包含 enrichmentStatus、completenessDistribution、reviewStatusCounts、avgCompleteness）
    const [
      totalResult,
      verifiedResult,
      pendingConflictsResult,
      byCategoryResult,
      bySourceResult,
      byStatusResult,
      enrichmentStatusResult,
      completenessDistResult,
      reviewStatusResult,
      avgCompletenessResult,
    ] = await Promise.all([
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM foods`,
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM foods WHERE is_verified = TRUE`,
      this.prisma.$queryRaw<[{ count: string }]>`
        SELECT COUNT(*)::text AS count FROM food_conflicts WHERE resolved_at IS NULL`,
      this.prisma.$queryRaw<Array<{ category: string; count: string }>>`
        SELECT category, COUNT(*)::text AS count FROM foods GROUP BY category ORDER BY COUNT(*) DESC`,
      this.prisma.$queryRaw<Array<{ source: string; count: string }>>`
        SELECT primary_source AS source, COUNT(*)::text AS count FROM foods GROUP BY primary_source ORDER BY COUNT(*) DESC`,
      this.prisma.$queryRaw<Array<{ status: string; count: string }>>`
        SELECT status, COUNT(*)::text AS count FROM foods GROUP BY status`,
      // enrichment_status 分布
      this.prisma.$queryRaw<Array<{ status: string; count: string }>>`
        SELECT COALESCE(enrichment_status, 'pending') AS status, COUNT(*)::text AS count
        FROM foods GROUP BY 1`,
      // 完整度分布：low(<30) / mid(30-79) / high(>=80)
      this.prisma.$queryRaw<Array<{ bucket: string; count: string }>>`
        SELECT
          CASE
            WHEN COALESCE(data_completeness, 0) < 30 THEN 'low'
            WHEN COALESCE(data_completeness, 0) < 80 THEN 'mid'
            ELSE 'high'
          END AS bucket,
          COUNT(*)::text AS count
        FROM foods GROUP BY 1`,
      // review_status 分布
      this.prisma.$queryRaw<Array<{ review_status: string; count: string }>>`
        SELECT review_status, COUNT(*)::text AS count
        FROM foods GROUP BY review_status`,
      // V8.5: 全库平均完整度（仅计算已补全 > 0 的食物，排除 pending 拉低均值）
      this.prisma.$queryRaw<[{ avg: string }]>`
        SELECT COALESCE(AVG(data_completeness), 0)::text AS avg
        FROM foods WHERE data_completeness IS NOT NULL AND data_completeness > 0`,
    ]);

    const total = parseInt((totalResult as any)[0]?.count ?? '0', 10);
    const verified = parseInt((verifiedResult as any)[0]?.count ?? '0', 10);
    const unverified = total - verified;
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
    const byStatus = (byStatusResult as any[]).map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
    }));

    // enrichmentStatus 分布
    const enrichMap: Record<string, number> = {};
    for (const row of enrichmentStatusResult as any[]) {
      enrichMap[row.status] = parseInt(row.count, 10);
    }
    const enrichmentStatus = {
      pending: enrichMap['pending'] ?? 0,
      completed: enrichMap['completed'] ?? 0,
      partial: enrichMap['partial'] ?? 0,
      failed: enrichMap['failed'] ?? 0,
      staged: enrichMap['staged'] ?? 0,
      rejected: enrichMap['rejected'] ?? 0,
    };

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

    // V8.5: 全库平均完整度
    const avgCompleteness = parseFloat(
      parseFloat((avgCompletenessResult as any)[0]?.avg ?? '0').toFixed(1),
    );

    return {
      total,
      verified,
      unverified,
      byCategory,
      bySource,
      byStatus,
      pendingConflicts,
      enrichmentStatus,
      completenessDistribution,
      reviewStatusCounts,
      avgCompleteness,
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
    return this.prisma.foodTranslations.findMany({
      where: { foodId: foodId },
      orderBy: { locale: 'asc' },
    });
  }

  async createTranslation(foodId: string, dto: CreateFoodTranslationDto) {
    await this.findOne(foodId); // validate food exists
    const existing = await this.prisma.foodTranslations.findFirst({
      where: { foodId: foodId, locale: (dto as any).locale },
    });
    if (existing) {
      throw new ConflictException(
        this.i18n.t('food.translationDuplicate', {
          locale: (dto as any).locale,
        }),
      );
    }
    return this.prisma.foodTranslations.create({
      data: { ...(dto as any), foodId: foodId },
    });
  }

  async updateTranslation(
    translationId: string,
    dto: UpdateFoodTranslationDto,
  ) {
    const translation = await this.prisma.foodTranslations.findUnique({
      where: { id: translationId },
    });
    if (!translation)
      throw new NotFoundException(this.i18n.t('food.translationNotFound'));
    return this.prisma.foodTranslations.update({
      where: { id: translationId },
      data: dto as any,
    });
  }

  async deleteTranslation(translationId: string) {
    const translation = await this.prisma.foodTranslations.findUnique({
      where: { id: translationId },
    });
    if (!translation)
      throw new NotFoundException(this.i18n.t('food.translationNotFound'));
    await this.prisma.foodTranslations.delete({
      where: { id: translationId },
    });
    return { message: this.i18n.t('food.translationDeleted') };
  }

  // ==================== 数据来源管理 ====================

  async getSources(foodId: string) {
    return this.prisma.foodSources.findMany({
      where: { foodId: foodId },
      orderBy: { priority: 'desc' },
    });
  }

  async createSource(foodId: string, dto: CreateFoodSourceDto) {
    await this.findOne(foodId);
    return this.prisma.foodSources.create({
      data: { ...(dto as any), foodId: foodId },
    });
  }

  async deleteSource(sourceId: string) {
    const source = await this.prisma.foodSources.findUnique({
      where: { id: sourceId },
    });
    if (!source)
      throw new NotFoundException(this.i18n.t('food.sourceNotFound'));
    await this.prisma.foodSources.delete({ where: { id: sourceId } });
    return { message: this.i18n.t('food.sourceDeleted') };
  }

  // ==================== 变更日志 ====================

  async getChangeLogs(foodId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [list, total] = await Promise.all([
      this.prisma.foodChangeLogs.findMany({
        where: { foodId: foodId },
        orderBy: { version: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.foodChangeLogs.count({ where: { foodId: foodId } }),
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
    return this.prisma.foodChangeLogs.create({
      data: {
        foodId: foodId,
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
    if (foodId) where.foodId = foodId;
    if (resolution) where.resolution = resolution;

    const [list, total] = await Promise.all([
      this.prisma.foodConflicts.findMany({
        where,
        include: { foods: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.foodConflicts.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  async resolveConflict(
    conflictId: string,
    dto: ResolveFoodConflictDto,
    operator = 'admin',
  ) {
    const conflict = await this.prisma.foodConflicts.findUnique({
      where: { id: conflictId },
    });
    if (!conflict)
      throw new NotFoundException(this.i18n.t('food.conflictNotFound'));

    return this.prisma.foodConflicts.update({
      where: { id: conflictId },
      data: {
        resolution: (dto as any).resolution,
        resolvedValue: (dto as any).resolvedValue,
        resolvedBy: operator,
        resolvedAt: new Date(),
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
    const updateData: Record<string, any> = { reviewStatus: reviewStatus };
    if (reviewStatus === 'approved' || reviewStatus === 'rejected') {
      updateData.reviewedBy = operator;
      updateData.reviewedAt = new Date();
    } else {
      // pending（重置）时清空审核者
      updateData.reviewedBy = null;
      updateData.reviewedAt = null;
    }
    const result = await this.prisma.food.updateMany({
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
    const foods = await this.prisma.food.findMany({
      where: { id: { in: ids } },
      select: { id: true, dataVersion: true },
    });

    await this.prisma.foodChangeLogs.createMany({
      data: foods.map((f) => ({
        foodId: f.id,
        version: f.dataVersion ?? 1,
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
}
