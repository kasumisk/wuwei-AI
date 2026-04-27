import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { StorageService } from '../../../../storage/storage.service';
import { AnalyzeService } from '../services/analyze.service';
import { TextFoodAnalysisService } from '../services/text-food-analysis.service';
import { AnalysisSessionService } from '../services/analysis-session.service';
import { AnalyzeImageDto } from '../../../diet/app/dto/food.dto';
import { AnalyzeTextDto } from '../dto/analyze-text.dto';
import { RefineAnalysisDto } from '../dto/refine-analysis.dto';
import { SaveAnalysisToRecordDto } from '../dto/save-analysis.dto';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { UserApiThrottle } from '../../../../core/throttle/throttle.constants';
import { QuotaGateService } from '../../../subscription/app/services/quota-gate.service';
import { ResultEntitlementService } from '../../../subscription/app/services/result-entitlement.service';
import { PaywallTriggerService } from '../../../subscription/app/services/paywall-trigger.service';
import { SubscriptionService } from '../../../subscription/app/services/subscription.service';
import {
  GatedFeature,
  SubscriptionTier,
} from '../../../subscription/subscription.types';
import { AnalysisRecordStatus } from '../../food.types';
import { FoodService } from '../../../diet/app/services/food.service';
import { RecordSource, MealType } from '../../../diet/diet.types';
import {
  DomainEvents,
  AnalysisSavedToRecordEvent,
} from '../../../../core/events/domain-events';
import { FoodAnalysisResultV61 } from '../../../decision/types/analysis-result.types';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { translateEnum } from '../../../../common/i18n/enum-i18n';

// ─── V7.9 Phase 3-4: 文本分析缓存配置 ───

/** 文本分析缓存 TTL（毫秒） */
const TEXT_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟
/** 文本分析缓存最大条目数 */
const TEXT_ANALYSIS_CACHE_MAX_SIZE = 200;

/** 文本分析缓存条目 */
interface TextAnalysisCacheEntry {
  /** 缓存结果 */
  result: FoodAnalysisResultV61;
  /** 写入时间戳 */
  createdAt: number;
}

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalyzeController {
  // V7.9 Phase 3-4: 文本分析结果缓存（内存 Map，按输入文本哈希索引）
  private readonly textAnalysisCache = new Map<
    string,
    TextAnalysisCacheEntry
  >();

  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly storageService: StorageService,
    // V6.1: 文本分析链路
    private readonly textFoodAnalysisService: TextFoodAnalysisService,
    private readonly quotaGateService: QuotaGateService,
    private readonly resultEntitlementService: ResultEntitlementService,
    private readonly paywallTriggerService: PaywallTriggerService,
    private readonly subscriptionService: SubscriptionService,
    // V6.1 Phase 1.8: 分析结果保存为饮食记录
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly eventEmitter: EventEmitter2,
    // 置信度驱动 V1：session 服务
    private readonly analysisSessionService: AnalysisSessionService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== V6.1: 文本分析端点 ====================

  /**
   * 文本食物分析（同步）
   * POST /api/app/food/analyze-text
   *
   * V6.1 Phase 1.6: 新增文本分析链路
   * V7.9 Phase 3-4: 文本分析缓存（相同输入+餐次在10分钟内返回缓存结果）
   * - 输入食物名称或自然语言描述
   * - 优先匹配标准食物库（零 AI 成本）
   * - 未命中走 LLM 拆解
   * - 返回统一 FoodAnalysisResultV61
   * - 集成配额门控 + 结果权益裁剪
   */
  @Post('analyze-text')
  @HttpCode(HttpStatus.OK)
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '文本食物 AI 分析' })
  @ApiBody({ type: AnalyzeTextDto })
  async analyzeText(
    @Body() dto: AnalyzeTextDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 获取用户订阅信息（配额检查和结果裁剪都需要）
    const summary = await this.subscriptionService.getUserSummary(user.id);

    // V7.9 P3-4: 检查文本分析缓存（在配额扣减之前，命中缓存不消耗配额）
    const cacheKey = this.buildTextAnalysisCacheKey(
      dto.text,
      dto.mealType,
      user.id,
    );
    const cached = this.getFromTextAnalysisCache(cacheKey);
    if (cached) {
      // 按订阅等级裁剪缓存结果（订阅可能已变更）
      const trimmedResult = this.resultEntitlementService.trimResult(
        cached,
        summary.tier,
        summary.entitlements,
      );
      return ResponseWrapper.success(
        trimmedResult,
        this.i18n.t('food.analyzeCompleteCached'),
      );
    }

    // 2. 配额门控检查（AI_TEXT_ANALYSIS 计次类功能）
    const access = await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.AI_TEXT_ANALYSIS,
      scene: 'food_text_analysis',
      consumeQuota: true,
    });

    if (!access.allowed) {
      // 硬付费墙: 配额耗尽，记录触发并返回增强的付费墙展示数据
      const paywallDisplay =
        await this.paywallTriggerService.handleAccessDecision(
          access,
          user.id,
          GatedFeature.AI_TEXT_ANALYSIS,
          summary.tier,
        );

      const errorMessage =
        access.paywall?.message ?? this.i18n.t('food.textQuotaExceeded');
      if (paywallDisplay) {
        return ResponseWrapper.error(errorMessage, 403, paywallDisplay);
      }
      return ResponseWrapper.error(errorMessage, 403);
    }

    // 3. 执行文本分析
    const fullResult = await this.textFoodAnalysisService.analyze(
      dto.text,
      dto.mealType,
      user.id,
      (dto.locale as any) || undefined,
      dto.contextOverride?.localHour,
      dto.hints,
    );

    // V7.9 P3-4: 写入缓存（使用完整结果，裁剪在读取时按当前订阅等级执行）
    this.setToTextAnalysisCache(cacheKey, fullResult);

    // 4. 按订阅等级裁剪结果
    const trimmedResult = this.resultEntitlementService.trimResult(
      fullResult,
      summary.tier,
      summary.entitlements,
    );

    // 5. 异步记录结果裁剪触发的软付费墙（不阻塞响应）
    const hiddenFields = trimmedResult.entitlement?.fieldsHidden ?? [];
    if (hiddenFields.length > 0) {
      this.paywallTriggerService
        .recordResultTrimTrigger(user.id, summary.tier, hiddenFields)
        .catch(() => {
          /* 静默失败，不影响主流程 */
        });
    }

    return ResponseWrapper.success(
      trimmedResult,
      this.i18n.t('food.analyzeComplete'),
    );
  }

  /**
   * 将分析结果保存为饮食记录
   * POST /api/app/food/analyze-save
   *
   * V6.1 Phase 1.8: 分析结果可保存为 FoodRecord
   * - 根据 analysisId 查找分析记录
   * - 将分析结果中的营养数据、决策等映射为饮食记录
   * - 支持覆盖餐次和记录时间
   * - 发布 food.analysis.saved_to_record 域事件
   */
  @Post('analyze-save')
  @HttpCode(HttpStatus.CREATED)
  @UserApiThrottle(20, 60)
  @ApiOperation({ summary: '保存分析结果为饮食记录' })
  @ApiBody({ type: SaveAnalysisToRecordDto })
  async saveAnalysisToRecord(
    @Body() dto: SaveAnalysisToRecordDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 查找分析记录
    const analysisRecord = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: dto.analysisId },
    });

    if (!analysisRecord) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }

    // 2. 验证归属
    if (analysisRecord.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionEdit'),
      );
    }

    // 3. 检查分析状态
    if (analysisRecord.status !== 'completed') {
      throw new BadRequestException(this.i18n.t('food.analysisIncomplete'));
    }

    // 4. 从分析记录中提取数据构建 CreateFoodRecordDto
    const result = this.reconstructAnalysisResult(analysisRecord);
    const mealType =
      dto.mealType || (analysisRecord.mealType as MealType) || MealType.LUNCH;

    const createDto = {
      analysisId: dto.analysisId,
      source: RecordSource.DECISION,
      mealType,
      foods:
        result.foods?.map((f) => ({
          name: f.name,
          calories: f.calories ?? 0,
          quantity: f.quantity,
          category: f.category,
          protein: f.protein,
          fat: f.fat,
          carbs: f.carbs,
          glycemicIndex: f.glycemicIndex,
        })) ?? [],
      totalCalories: result.totals?.calories ?? 0,
      advice: result.explanation?.summary,
      isHealthy: result.decision?.shouldEat ?? true,
      recordedAt: dto.recordedAt,
      // 决策字段映射
      decision: this.mapRecommendationToDecision(
        result.decision?.recommendation,
      ),
      riskLevel: this.mapRiskLevel(result.decision?.riskLevel),
      reason: result.decision?.reason,
      suggestion: result.explanation?.primaryReason,
      insteadOptions: result.alternatives?.map((a) => a.name) ?? [],
      // 多维营养字段
      totalProtein: result.totals?.protein ?? 0,
      totalFat: result.totals?.fat ?? 0,
      totalCarbs: result.totals?.carbs ?? 0,
      nutritionScore: result.score?.nutritionScore ?? 0,
    };

    // 5. 保存饮食记录（统一 Food Records V8，会触发 MEAL_RECORDED 事件和日报更新）
    const record = await this.foodService.createRecord(
      user.id,
      createDto as any,
    );

    // 6. 发布分析保存事件
    this.eventEmitter.emit(
      DomainEvents.ANALYSIS_SAVED_TO_RECORD,
      new AnalysisSavedToRecordEvent(
        user.id,
        dto.analysisId,
        record.id,
        analysisRecord.inputType as 'text' | 'image',
        mealType,
        result.foods?.map((f) => f.name) ?? [],
        result.totals?.calories ?? 0,
      ),
    );

    return ResponseWrapper.success(
      { recordId: record.id, analysisId: dto.analysisId },
      this.i18n.t('food.analyzeSavedAsRecord'),
    );
  }

  // ==================== 私有辅助方法 ====================

  /**
   * 从分析记录的 JSONB 字段重建 FoodAnalysisResultV61
   *
   * 分析记录的各个 payload 字段分散保存，这里合并成统一结构
   */
  private reconstructAnalysisResult(
    record: any,
  ): Partial<FoodAnalysisResultV61> {
    const nutrition = record.nutritionPayload as Record<string, unknown> | null;
    const decision = record.decisionPayload as Record<string, unknown> | null;
    const recognized = record.recognizedPayload as Record<
      string,
      unknown
    > | null;

    // 优先从 recognizedPayload.foods 或 nutritionPayload.foods 读取食物列表
    let foods = (recognized?.foods ??
      (nutrition as any)?.foods ??
      []) as FoodAnalysisResultV61['foods'];

    // 兜底：当 foods 为空但 recognizedPayload.terms 存在时（历史记录兼容）
    // 用 terms 元数据 + totals 平摊营养值构建近似食物列表
    if (
      (!foods || foods.length === 0) &&
      Array.isArray((recognized as any)?.terms) &&
      (recognized as any).terms.length > 0
    ) {
      const terms = (recognized as any).terms as Array<{
        name: string;
        quantity?: string;
        fromLibrary?: boolean;
      }>;
      const totals = (nutrition?.totals ?? {}) as {
        calories?: number;
        protein?: number;
        fat?: number;
        carbs?: number;
      };
      const count = terms.length;
      foods = terms.map((t) => ({
        name: t.name,
        quantity: t.quantity,
        category: 'unknown',
        calories: count > 0 ? Math.round((totals.calories ?? 0) / count) : 0,
        protein: count > 0 ? Math.round((totals.protein ?? 0) / count) : 0,
        fat: count > 0 ? Math.round((totals.fat ?? 0) / count) : 0,
        carbs: count > 0 ? Math.round((totals.carbs ?? 0) / count) : 0,
        confidence: 0.5,
      })) as FoodAnalysisResultV61['foods'];
    }

    return {
      foods,
      totals: (nutrition?.totals ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      }) as FoodAnalysisResultV61['totals'],
      score: (nutrition?.score ?? {
        healthScore: 0,
        nutritionScore: 0,
        confidenceScore: 0,
      }) as FoodAnalysisResultV61['score'],
      decision: (decision?.decision ?? {
        recommendation: 'caution' as const,
        shouldEat: true,
        reason: '',
        riskLevel: 'low' as const,
      }) as FoodAnalysisResultV61['decision'],
      alternatives: (decision?.alternatives ??
        []) as FoodAnalysisResultV61['alternatives'],
      explanation: (decision?.explanation ?? {
        summary: '',
      }) as FoodAnalysisResultV61['explanation'],
      summary: (decision?.summary ??
        undefined) as FoodAnalysisResultV61['summary'],
      evidencePack: (decision?.evidencePack ??
        undefined) as FoodAnalysisResultV61['evidencePack'],
      shouldEatAction: (decision?.shouldEatAction ??
        undefined) as FoodAnalysisResultV61['shouldEatAction'],
      analysisState: (nutrition?.analysisState ??
        undefined) as FoodAnalysisResultV61['analysisState'],
      confidenceDiagnostics: (nutrition?.confidenceDiagnostics ??
        undefined) as FoodAnalysisResultV61['confidenceDiagnostics'],
    };
  }

  /**
   * 将 V6.1 三档建议映射为 V1 四档决策
   */
  private mapRecommendationToDecision(recommendation?: string): string {
    switch (recommendation) {
      case 'recommend':
        return 'SAFE';
      case 'caution':
        return 'LIMIT';
      case 'avoid':
        return 'AVOID';
      default:
        return 'OK';
    }
  }

  /**
   * 将 V6.1 风险等级映射为 emoji
   */
  private mapRiskLevel(riskLevel?: string): string {
    switch (riskLevel) {
      case 'low':
        return '🟢';
      case 'medium':
        return '🟡';
      case 'high':
        return '🔴';
      default:
        return '🟢';
    }
  }

  // ==================== V6.1 Phase 3.4: 历史分析 API ====================

  /**
   * 获取分析历史列表
   * GET /api/app/food/analysis/history
   *
   * V6.1 Phase 3.4: 历史分析页
   * 订阅分级控制:
   * - Free: 最近 3 条
   * - Pro/Premium: 全量（分页）
   */
  @Get('analysis/history')
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '获取分析历史列表' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: '页码（从 1 开始）',
  })
  @ApiQuery({
    name: 'pageSize',
    required: false,
    type: Number,
    description: '每页条数（默认 20）',
  })
  @ApiQuery({
    name: 'inputType',
    required: false,
    enum: ['text', 'image'],
    description: '按分析类型过滤',
  })
  async getAnalysisHistory(
    @CurrentAppUser() user: AppUserPayload,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('inputType') inputType?: 'text' | 'image',
  ): Promise<ApiResponse> {
    // 1. 获取用户订阅信息
    const summary = await this.subscriptionService.getUserSummary(user.id);

    // 2. 确定可查看的记录上限
    const access = await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.ANALYSIS_HISTORY,
      consumeQuota: false, // 查看不消耗配额
    });

    // 从 entitlements 获取历史记录限制
    const historyLimit =
      summary.entitlements?.[GatedFeature.ANALYSIS_HISTORY] ?? 3;
    const isUnlimited = historyLimit >= 999999;

    // 3. 分页参数
    const pageNum = Math.max(1, parseInt(page || '1', 10) || 1);
    const size = Math.min(
      50,
      Math.max(1, parseInt(pageSize || '20', 10) || 20),
    );
    const skip = (pageNum - 1) * size;

    // 4. 构建查询条件
    const where: any = {
      userId: user.id,
      status: AnalysisRecordStatus.COMPLETED,
    };
    if (inputType) {
      where.inputType = inputType;
    }

    // 5. 应用分级限制
    let items: any[];
    let total: number;

    if (!isUnlimited) {
      // Free 用户只能看最近 N 条
      items = await this.prisma.foodAnalysisRecords.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: historyLimit,
      });
      total = historyLimit;
    } else {
      [items, total] = await Promise.all([
        this.prisma.foodAnalysisRecords.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: size,
        }),
        this.prisma.foodAnalysisRecords.count({ where }),
      ]);
    }

    // 6. 映射为前端友好的列表结构
    const list = items.map((r) => ({
      analysisId: r.id,
      inputType: r.inputType,
      mealType: r.mealType,
      mealTypeLabel: translateEnum('mealType', r.mealType),
      status: r.status,
      confidenceScore: r.confidenceScore,
      qualityScore: r.qualityScore,
      persistStatus: r.persistStatus,
      createdAt: r.createdAt,
      // 摘要信息（从 payload 中提取关键字段）
      summary: this.extractHistorySummary(r),
    }));

    // 7. 如果 Free 用户，附加付费墙提示
    const paywallHint = !isUnlimited
      ? {
          limitedTo: historyLimit,
          message: this.i18n.t('food.freeTierHistoryLimit', {
            limit: historyLimit,
          }),
          recommendedTier: SubscriptionTier.PRO,
        }
      : null;

    return ResponseWrapper.success({
      items: list,
      total: isUnlimited ? total : historyLimit,
      page: isUnlimited ? pageNum : 1,
      pageSize: isUnlimited ? size : historyLimit,
      paywallHint,
    });
  }

  /**
   * 获取分析详情
   * GET /api/app/food/analysis/:analysisId
   *
   * V6.1 Phase 3.4: 分析详情页
   * 返回完整的分析记录（含 payload 数据），按订阅等级裁剪敏感字段
   */
  @Get('analysis/:analysisId')
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '获取分析详情' })
  @ApiParam({ name: 'analysisId', description: '分析记录 ID' })
  async getAnalysisDetail(
    @Param('analysisId') analysisId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 查找分析记录
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: analysisId },
    });

    if (!record) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }

    // 2. 验证归属
    if (record.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionView'),
      );
    }

    // 3. 获取用户订阅信息
    const summary = await this.subscriptionService.getUserSummary(user.id);

    // 4. 从 JSONB 重建 V61 结构
    const fullResult = this.reconstructAnalysisResult(record);

    // 5. 构建完整的 V61 结构用于裁剪
    const v61: FoodAnalysisResultV61 = {
      analysisId: record.id,
      inputType: record.inputType as 'text' | 'image',
      inputSnapshot: {
        rawText: record.rawText ?? undefined,
        imageUrl: record.imageUrl ?? undefined,
        mealType: record.mealType as
          | 'breakfast'
          | 'lunch'
          | 'dinner'
          | 'snack'
          | undefined,
      },
      foods: fullResult.foods ?? [],
      totals: fullResult.totals ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      },
      score: fullResult.score ?? {
        healthScore: 0,
        nutritionScore: 0,
        confidenceScore: record.confidenceScore
          ? Number(record.confidenceScore)
          : 0,
      },
      decision: fullResult.decision ?? {
        recommendation: 'caution',
        shouldEat: true,
        reason: '',
        riskLevel: 'medium',
      },
      alternatives: fullResult.alternatives ?? [],
      explanation: fullResult.explanation ?? { summary: '' },
      entitlement: {
        tier: summary.tier,
        fieldsHidden: [],
      },
    };

    // 6. 按订阅等级裁剪
    const trimmedResult = this.resultEntitlementService.trimResult(
      v61,
      summary.tier,
      summary.entitlements,
    );

    // 7. 附加元信息
    const detail = {
      ...trimmedResult,
      // 元信息
      meta: {
        qualityScore: record.qualityScore,
        persistStatus: record.persistStatus,
        matchedFoodCount: record.matchedFoodCount,
        candidateFoodCount: record.candidateFoodCount,
        createdAt: record.createdAt,
        mealTypeLabel: translateEnum('mealType', record.mealType),
      },
    };

    return ResponseWrapper.success(detail);
  }

  /**
   * 删除分析记录
   * DELETE /api/app/food/analysis/:analysisId
   *
   * 仅删除分析历史，不删除已保存的饮食记录。
   */
  @Delete('analysis/:analysisId')
  @UserApiThrottle(20, 60)
  @ApiOperation({ summary: '删除分析记录' })
  @ApiParam({ name: 'analysisId', description: '分析记录 ID' })
  async deleteAnalysis(
    @Param('analysisId') analysisId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: analysisId },
      select: { id: true, userId: true },
    });

    if (!record) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }

    if (record.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionDelete'),
      );
    }

    await this.prisma.foodAnalysisRecords.delete({
      where: { id: analysisId },
    });

    return ResponseWrapper.success(
      null,
      this.i18n.t('food.analyzeRecordDeleted'),
    );
  }

  /**
   * 从分析记录提取历史列表的摘要信息
   */
  private extractHistorySummary(record: any): {
    foodNames: string[];
    totalCalories: number;
    recommendation?: string;
  } {
    const recognized = record.recognizedPayload as Record<
      string,
      unknown
    > | null;
    const nutrition = record.nutritionPayload as Record<string, unknown> | null;
    const decision = record.decisionPayload as Record<string, unknown> | null;

    // 提取食物名称
    const foods = (recognized?.foods ?? nutrition?.foods ?? []) as Array<{
      name?: string;
    }>;
    const foodNames = foods
      .map((f) => f.name)
      .filter((n): n is string => !!n)
      .slice(0, 5); // 最多显示 5 个

    // 提取总热量
    const totals = nutrition?.totals as { calories?: number } | undefined;
    const totalCalories = totals?.calories ?? 0;

    // 提取决策
    const dec = decision?.decision as { recommendation?: string } | undefined;
    const recommendation = dec?.recommendation;

    return { foodNames, totalCalories, recommendation };
  }

  // ==================== V6: 图片分析端点 ====================

  /**
   * 上传图片并提交 AI 分析（异步模式）
   * POST /api/app/food/analyze
   *
   * V6 Phase 1.4: 改为异步队列模式
   * V6.1 Phase 2.5: 集成配额门控（AI_IMAGE_ANALYSIS）
   * - 先检查图片分析配额
   * - 配额允许才上传图片并提交队列
   * - 配额耗尽返回付费墙
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传食物图片 AI 分析（异步）' })
  async analyzeImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: 'jpeg|png|webp|heic',
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: AnalyzeImageDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // V6.1 Phase 2.5: 配额门控（AI_IMAGE_ANALYSIS 计次类功能）
    const summary = await this.subscriptionService.getUserSummary(user.id);
    const access = await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.AI_IMAGE_ANALYSIS,
      scene: 'food_image_analysis',
      consumeQuota: true,
    });

    if (!access.allowed) {
      // 硬付费墙: 配额耗尽
      const paywallDisplay =
        await this.paywallTriggerService.handleAccessDecision(
          access,
          user.id,
          GatedFeature.AI_IMAGE_ANALYSIS,
          summary.tier,
        );

      const errorMessage =
        access.paywall?.message ?? this.i18n.t('food.imageQuotaExceeded');
      if (paywallDisplay) {
        return ResponseWrapper.error(errorMessage, 403, paywallDisplay);
      }
      return ResponseWrapper.error(errorMessage, 403);
    }

    // 1. 上传图片到 R2（同步，通常很快）
    const uploaded = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'food-images',
    );

    // 2. 提交 AI 分析任务到队列（非阻塞）
    const { requestId } = await this.analyzeService.submitAnalysis(
      uploaded.url,
      dto.mealType,
      user.id,
      (dto.locale as Locale | undefined) || undefined,
    );

    // 置信度驱动 V1：为本次请求创建 AnalysisSession（绑定 requestId + 配额记录）
    const session = await this.analysisSessionService.createSession({
      userId: user.id,
      requestId,
      mealType: dto.mealType,
      imageUrl: uploaded.url,
    });

    return ResponseWrapper.success(
      {
        requestId,
        analysisSessionId: session.id,
        status: 'processing',
        stage: 'analyzing' as const,
        imageUrl: uploaded.url,
      },
      this.i18n.t('food.analyzeSubmitted'),
    );
  }

  /**
   * 轮询获取 AI 分析结果
   * GET /api/app/food/analyze/:requestId
   *
   * V6 Phase 1.4: 新增轮询端点
   * V6.1 Phase 2.5: 完成时按订阅等级裁剪结果，触发软付费墙
   *
   * 响应状态：
   * - processing: 分析进行中，客户端应继续轮询（建议间隔 2-3s）
   * - completed: 分析完成，data 中包含完整或裁剪后的结果
   * - failed: 分析失败，error 中包含错误信息
   */
  @Get('analyze/:requestId')
  @ApiOperation({ summary: '获取 AI 分析结果（轮询）' })
  @ApiParam({ name: 'requestId', description: '分析任务 ID' })
  async getAnalysisResult(
    @Param('requestId') requestId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const entry = await this.analyzeService.getAnalysisStatus(requestId);

    if (!entry) {
      throw new NotFoundException(this.i18n.t('food.analysisTaskNotFound'));
    }

    if (entry.status === 'processing') {
      return ResponseWrapper.success(
        { requestId, status: 'processing', stage: 'analyzing' as const },
        this.i18n.t('food.analyzeInProgress'),
      );
    }

    if (entry.status === 'failed') {
      return ResponseWrapper.error(
        entry.error || this.i18n.t('food.analyzeFailed'),
        HttpStatus.OK,
        { requestId, status: 'failed', error: entry.error },
      );
    }

    // 置信度驱动 V1：needs_review 分支（低置信度，仅返回 foods 骨架）
    if (entry.stage === 'needs_review' && entry.needsReview) {
      const nr = entry.needsReview;
      // 二次校验 session 归属（防止 requestId 被窃取轮询）
      const session = await this.analysisSessionService.getById(
        nr.analysisSessionId,
      );
      if (session && session.userId !== user.id) {
        throw new ForbiddenException(
          this.i18n.t('food.analysisTaskNoPermission'),
        );
      }
      return ResponseWrapper.success(
        {
          requestId,
          analysisSessionId: nr.analysisSessionId,
          status: 'completed',
          stage: 'needs_review' as const,
          confidence: {
            level: nr.confidenceLevel,
            overall: nr.overallConfidence,
            threshold: Number(process.env.CONFIDENCE_HIGH_THRESHOLD ?? 0.75),
            reasons: nr.reasons,
          },
          foods: nr.foods,
          imageUrl: nr.imageUrl,
          expiresAt: nr.expiresAt,
          refineUrl: `/api/app/food/analyze/${requestId}/refine`,
        },
        this.i18n.t('food.analyzeNeedsReview'),
      );
    }

    // V6.1 Phase 2.5: completed — 将队列结果转为统一结构并按订阅裁剪

    // 获取用户订阅信息
    const userSummary = await this.subscriptionService.getUserSummary(user.id);

    // 构造简化的 V61 结构用于裁剪（图片分析的轮询结果）
    const rawData = entry.data;
    if (!rawData) {
      return ResponseWrapper.success(
        { requestId, status: 'completed', result: null },
        this.i18n.t('food.analyzeComplete'),
      );
    }

    // 将旧格式结果适配为 V61 进行裁剪
    const v61ForTrim: FoodAnalysisResultV61 = {
      analysisId: requestId,
      inputType: 'image',
      inputSnapshot: { imageUrl: rawData.imageUrl },
      foods: (rawData.foods || []).map((f) => ({
        name: f.name,
        quantity: f.quantity,
        category: f.category,
        confidence: (f as any).confidence ?? 0.6,
        calories: f.calories,
        protein: f.protein,
        fat: f.fat,
        carbs: f.carbs,
      })),
      totals: {
        calories: rawData.totalCalories,
        protein: rawData.totalProtein,
        fat: rawData.totalFat,
        carbs: rawData.totalCarbs,
      },
      score: {
        healthScore: rawData.nutritionScore || 50,
        nutritionScore: rawData.nutritionScore || 50,
        confidenceScore: 60,
      },
      decision: {
        recommendation:
          rawData.decision === 'SAFE' || rawData.decision === 'OK'
            ? 'recommend'
            : rawData.decision === 'AVOID'
              ? 'avoid'
              : 'caution',
        shouldEat: rawData.decision !== 'AVOID',
        reason: rawData.reason || rawData.advice,
        riskLevel: rawData.riskLevel?.includes('🔴')
          ? 'high'
          : rawData.riskLevel?.includes('🟡') ||
              rawData.riskLevel?.includes('🟠')
            ? 'medium'
            : 'low',
      },
      alternatives: (rawData.insteadOptions || []).map((name) => ({
        name,
        reason: this.i18n.t('food.betterForCurrentGoal'),
      })),
      explanation: {
        summary: rawData.advice || rawData.contextComment || '',
        primaryReason: rawData.reason,
        userContextImpact: rawData.contextComment
          ? [rawData.contextComment]
          : undefined,
      },
      ingestion: {
        matchedExistingFoods: false,
        shouldPersistCandidate: false,
        reviewRequired: false,
      },
      entitlement: { tier: userSummary.tier as any, fieldsHidden: [] },
    };

    // 按订阅等级裁剪结果
    const trimmedResult = this.resultEntitlementService.trimResult(
      v61ForTrim,
      userSummary.tier,
      userSummary.entitlements,
    );

    // 异步记录裁剪触发的软付费墙
    const hiddenFields = trimmedResult.entitlement?.fieldsHidden ?? [];
    if (hiddenFields.length > 0) {
      this.paywallTriggerService
        .recordResultTrimTrigger(user.id, userSummary.tier, hiddenFields)
        .catch(() => {
          /* 静默失败 */
        });
    }

    // 置信度驱动 V1：高置信度直出时也反查 session，便于前端联动
    const linkedSession =
      await this.analysisSessionService.getByRequestId(requestId);

    return ResponseWrapper.success(
      {
        requestId,
        // 优先用数据库 analysisId（供 analyze-save），fallback 为 requestId（兼容旧逻辑）
        analysisId: entry.analysisId ?? requestId,
        analysisSessionId: linkedSession?.id,
        status: 'completed',
        stage: 'final' as const,
        confidence: linkedSession?.imagePhase
          ? {
              level: linkedSession.imagePhase.confidenceLevel,
              overall: linkedSession.imagePhase.overallConfidence,
              threshold: Number(process.env.CONFIDENCE_HIGH_THRESHOLD ?? 0.75),
              source: 'vision' as const,
            }
          : undefined,
        // 统一返回结构，客户端只消费 result
        result: trimmedResult,
      },
      this.i18n.t('food.analyzeComplete'),
    );
  }

  // ==================== 置信度驱动 V1：refine 端点 ====================

  /**
   * 用户修正低置信度识别结果，不扣配额，同步返回最终营养分析
   * POST /api/app/food/analyze/:requestId/refine
   *
   * 关联设计文档：docs/CONFIDENCE_DRIVEN_FOOD_ANALYSIS_V1.md §4.3.3
   *
   * 流程：
   * 1. 通过 requestId 反查 session
   * 2. 校验归属 / 状态（awaiting_refine） / 未过期
   * 3. 将 refinedFoods 拼成描述文本，调 TextFoodAnalysisService.analyze()
   *    —— **不扣 AI_TEXT_ANALYSIS 配额**（session 已扣过 AI_IMAGE_ANALYSIS）
   * 4. 结果按订阅裁剪后返回，session 置为 finalized
   */
  @Post('analyze/:requestId/refine')
  @HttpCode(HttpStatus.OK)
  @UserApiThrottle(10, 60)
  @ApiOperation({ summary: '低置信度分析结果修正（不扣配额）' })
  @ApiParam({ name: 'requestId', description: '首次图片分析 requestId' })
  @ApiBody({ type: RefineAnalysisDto })
  async refineAnalysis(
    @Param('requestId') requestId: string,
    @Body() dto: RefineAnalysisDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 反查 session（首选通过 requestId，其次 dto 中的 sessionId 作为双重校验）
    const session = await this.analysisSessionService.getByRequestId(requestId);
    if (!session) {
      throw new NotFoundException(this.i18n.t('food.analysisTaskNotFound'));
    }
    if (session.id !== dto.analysisSessionId) {
      throw new BadRequestException(this.i18n.t('food.sessionMismatch'));
    }

    // 2. 校验归属 / 状态 / 未过期
    try {
      await this.analysisSessionService.assertRefineable(session.id, user.id);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'SESSION_FORBIDDEN') {
        throw new ForbiddenException(
          this.i18n.t('food.analysisTaskCorrectNoPermission'),
        );
      }
      if (code === 'SESSION_EXPIRED') {
        return ResponseWrapper.error(this.i18n.t('food.sessionExpired'), 410);
      }
      if (code === 'SESSION_WRONG_STATUS') {
        return ResponseWrapper.error(
          this.i18n.t('food.sessionWrongStatus'),
          409,
        );
      }
      throw err;
    }

    // 3. 拼接描述文本并复用 TextFoodAnalysisService（不扣配额）
    let derivedText: string;
    try {
      derivedText = this.analysisSessionService.buildDerivedText(
        dto.foods,
        dto.userNote,
      );
    } catch (e) {
      throw new BadRequestException(
        (e as Error).message || this.i18n.t('food.correctedListInvalid'),
      );
    }
    if (!derivedText) {
      throw new BadRequestException(this.i18n.t('food.correctedListInvalid'));
    }

    const fullResult = await this.textFoodAnalysisService.analyze(
      derivedText,
      session.mealType,
      user.id,
    );

    // 4. 按订阅等级裁剪
    const summary = await this.subscriptionService.getUserSummary(user.id);
    const trimmedResult = this.resultEntitlementService.trimResult(
      fullResult,
      summary.tier,
      summary.entitlements,
    );

    // 5. 更新 session
    await this.analysisSessionService.markFinalized(session.id, {
      refinePhase: {
        submittedAt: new Date().toISOString(),
        refinedFoods: dto.foods,
        derivedText,
      },
    });

    return ResponseWrapper.success(
      {
        requestId,
        analysisSessionId: session.id,
        status: 'completed',
        stage: 'final' as const,
        confidence: {
          level: 'high' as const,
          source: 'user_refined' as const,
        },
        result: trimmedResult,
        quotaConsumed: false,
      },
      this.i18n.t('food.refineSuccess'),
    );
  }

  // ==================== V7.9 Phase 3-3: 食物快捷分析 ====================

  /**
   * 根据食物库 ID 快捷分析（零 AI 成本）
   * GET /api/app/food/analyze-quick/:foodId
   *
   * V7.9 Phase 3-3: 对已有食物库中的食物直接查库构建分析结果，
   * 跳过 AI 调用，零成本零延迟。适用于：
   * - 用户从食物库选择食物后查看详细分析
   * - 食物搜索结果的快速分析入口
   * - 不消耗 AI 分析配额
   */
  @Get('analyze-quick/:foodId')
  @UserApiThrottle(60, 60)
  @ApiOperation({ summary: '按食物ID快捷分析（零AI成本）' })
  @ApiParam({ name: 'foodId', description: '食物库 ID' })
  async analyzeQuickByFoodId(
    @Param('foodId') foodId: string,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 查找食物库记录
    const food = await this.prisma.foods.findUnique({
      where: { id: foodId },
    });
    if (!food) {
      throw new NotFoundException(this.i18n.t('food.foodNotFound'));
    }

    // 2. 获取用户订阅信息（用于结果裁剪）
    const summary = await this.subscriptionService.getUserSummary(user.id);

    // 3. 直接从食物库数据构建 FoodAnalysisResultV61（零 AI 调用）
    const calories = Number(food.calories) || 0;
    const protein = Number(food.protein) || 0;
    const fat = Number(food.fat) || 0;
    const carbs = Number(food.carbs) || 0;
    const fiber = Number(food.fiber) || 0;
    const sodium = Number(food.sodium) || 0;
    const confidence = Number(food.confidence) || 50;

    // 基于数据计算简单的健康评分
    const qualityScore = Number(food.qualityScore) || 50;
    const nutrientDensity = Number(food.nutrientDensity) || 50;
    const healthScore = Math.round((qualityScore + nutrientDensity) / 2);

    // 简化决策：基于 quality_score
    const recommendation: 'recommend' | 'caution' | 'avoid' =
      qualityScore >= 70
        ? 'recommend'
        : qualityScore >= 40
          ? 'caution'
          : 'avoid';
    const shouldEat = recommendation !== 'avoid';
    const riskLevel: 'low' | 'medium' | 'high' =
      qualityScore >= 70 ? 'low' : qualityScore >= 40 ? 'medium' : 'high';

    const analysisId = `quick-${foodId}`;
    const servingDesc =
      food.standardServingDesc || `${food.standardServingG || 100}g`;

    const v61: FoodAnalysisResultV61 = {
      analysisId,
      inputType: 'text',
      inputSnapshot: { rawText: food.name },
      foods: [
        {
          name: food.name,
          foodLibraryId: food.id,
          quantity: servingDesc,
          estimatedWeightGrams: Number(food.standardServingG) || 100,
          category: food.category || undefined,
          confidence: confidence / 100,
          calories,
          protein,
          fat,
          carbs,
          fiber: fiber || undefined,
          sodium: sodium || undefined,
        },
      ],
      totals: { calories, protein, fat, carbs, fiber, sodium },
      score: {
        healthScore,
        nutritionScore: qualityScore,
        confidenceScore: confidence,
      },
      decision: {
        recommendation,
        shouldEat,
        reason: this.buildQuickAnalysisReason(food),
        riskLevel,
      },
      alternatives: [],
      explanation: {
        summary: this.i18n.t('food.quickSummaryTemplate', {
          name: food.name,
          servingDesc,
          calories,
          protein,
        }),
      },
      ingestion: {
        matchedExistingFoods: true,
        shouldPersistCandidate: false,
        reviewRequired: false,
      },
      entitlement: { tier: summary.tier, fieldsHidden: [] },
    };

    // 4. 按订阅等级裁剪
    const trimmedResult = this.resultEntitlementService.trimResult(
      v61,
      summary.tier,
      summary.entitlements,
    );

    return ResponseWrapper.success(
      trimmedResult,
      this.i18n.t('food.analyzeQuickComplete'),
    );
  }

  // ─── V7.9 Phase 3-3: 快捷分析辅助方法 ───

  /**
   * 构建快捷分析的决策理由
   *
   * 基于食物属性生成简短的决策理由文案。
   */
  private buildQuickAnalysisReason(food: any): string {
    const parts: string[] = [];

    const qualityScore = Number(food.qualityScore) || 0;
    if (qualityScore >= 70) {
      parts.push(this.i18n.t('food.quickReason.qualityGood'));
    }

    if (food.isFried) {
      parts.push(this.i18n.t('food.quickReason.friedControl'));
    }
    if (Number(food.processingLevel) >= 3) {
      parts.push(this.i18n.t('food.quickReason.highProcessing'));
    }

    const protein = Number(food.protein) || 0;
    const calories = Number(food.calories) || 1;
    if (protein / calories > 0.08) {
      parts.push(this.i18n.t('food.quickReason.highProtein'));
    }

    if (Number(food.fiber) >= 3) {
      parts.push(this.i18n.t('food.quickReason.highFiber'));
    }

    return parts.length > 0
      ? parts.join(this.i18n.t('food.quickReason.separator'))
      : this.i18n.t('food.quickReason.moderate');
  }

  // ─── V7.9 Phase 3-4: 文本分析缓存工具方法 ───

  /**
   * 构建文本分析缓存键
   *
   * 使用 SHA256 哈希，包含：输入文本 + 餐次 + 用户ID
   * 同一用户、同一输入、同一餐次命中缓存。
   */
  private buildTextAnalysisCacheKey(
    text: string,
    mealType: string | undefined,
    userId: string,
  ): string {
    const raw = `${userId}:${mealType || 'none'}:${text.trim().toLowerCase()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  /**
   * 从文本分析缓存读取
   */
  private getFromTextAnalysisCache(key: string): FoodAnalysisResultV61 | null {
    const entry = this.textAnalysisCache.get(key);
    if (!entry) return null;

    // TTL 过期检查
    if (Date.now() - entry.createdAt > TEXT_ANALYSIS_CACHE_TTL_MS) {
      this.textAnalysisCache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * 写入文本分析缓存（含容量淘汰）
   */
  private setToTextAnalysisCache(
    key: string,
    result: FoodAnalysisResultV61,
  ): void {
    // 容量淘汰：超过上限时清理最旧的一半
    if (this.textAnalysisCache.size >= TEXT_ANALYSIS_CACHE_MAX_SIZE) {
      const entries = Array.from(this.textAnalysisCache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      );
      const deleteCount = Math.floor(TEXT_ANALYSIS_CACHE_MAX_SIZE / 2);
      for (let i = 0; i < deleteCount; i++) {
        this.textAnalysisCache.delete(entries[i][0]);
      }
    }

    this.textAnalysisCache.set(key, {
      result,
      createdAt: Date.now(),
    });
  }
}
