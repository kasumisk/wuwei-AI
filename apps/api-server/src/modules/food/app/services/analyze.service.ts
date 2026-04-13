import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NutritionScoreBreakdown } from '../../../diet/app/services/nutrition-score.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';
import { QUEUE_NAMES, QUEUE_DEFAULT_OPTIONS } from '../../../../core/queue';
import { FoodAnalysisJobData } from '../processors/food-analysis.processor';
import { ImageFoodAnalysisService } from './image-food-analysis.service';
import {
  DomainEvents,
  AnalysisSubmittedEvent,
  AnalysisCompletedEvent,
} from '../../../../core/events/domain-events';

// V5: AI 人格 Prompt — 已迁移到 ImageFoodAnalysisService

export interface AnalysisResult {
  foods: Array<{
    name: string;
    calories: number;
    quantity?: string;
    category?: string;
    protein?: number;
    fat?: number;
    carbs?: number;
    quality?: number;
    satiety?: number;
    /** V6.3 P1-11: 膳食纤维 (g) */
    fiber?: number;
    /** V6.3 P1-11: 钠 (mg) */
    sodium?: number;
    /** V6.3 P1-11: 饱和脂肪 (g) */
    saturatedFat?: number | null;
    /** V6.3 P1-11: 添加糖 (g) */
    addedSugar?: number | null;
    /** V6.3 P1-11: 维生素A (μg RAE) */
    vitaminA?: number | null;
    /** V6.3 P1-11: 维生素C (mg) */
    vitaminC?: number | null;
    /** V6.3 P1-11: 钙 (mg) */
    calcium?: number | null;
    /** V6.3 P1-11: 铁 (mg) */
    iron?: number | null;
    /** V6.3 P1-11: 是否为 AI 估算值 */
    estimated?: boolean;
  }>;
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  avgQuality: number;
  avgSatiety: number;
  mealType: string;
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
  // V1: 决策字段
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  suggestion: string;
  insteadOptions: string[];
  compensation: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment: string;
  encouragement: string;
  // V6: 多维营养评分
  nutritionScore: number;
  scoreBreakdown?: NutritionScoreBreakdown;
  highlights?: string[];
}

// ─── V6 Phase 1.4: 异步分析结果缓存结构 ───

/** 分析任务状态 */
export type AnalysisStatus = 'processing' | 'completed' | 'failed';

/** Redis 中存储的分析结果 wrapper */
export interface AnalysisCacheEntry {
  status: AnalysisStatus;
  data?: AnalysisResult;
  error?: string;
  createdAt: number;
}

// ─── Redis 缓存 key 和 TTL ───

/** 分析结果缓存 key 前缀 */
const ANALYSIS_CACHE_PREFIX = 'food_analysis';
/** 分析结果缓存 TTL: 30 分钟 */
const ANALYSIS_CACHE_TTL_MS = 30 * 60 * 1000;

// Prompt 常量、辅助函数（buildGoalAwarePrompt, resolveDecision, estimateNutrition 等）
// 已全部迁移到 ImageFoodAnalysisService — 避免重复维护

/**
 * AI 食物图片分析服务 — 队列调度 + 缓存协调层
 *
 * V6.1 Phase 2.3: 核心分析逻辑已拆分到 ImageFoodAnalysisService。
 * 本服务保留职责：
 * - submitAnalysis(): 提交分析任务到 BullMQ 队列，立即返回 requestId
 * - processAnalysis(): 由 Processor 调用，委托给 ImageFoodAnalysisService → 写入 Redis
 * - getAnalysisStatus(): 查询分析结果或状态（客户端轮询用）
 * - analyzeImage(): 保留原同步接口用于内部调用或兼容场景
 */
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisCacheService: RedisCacheService,
    @InjectQueue(QUEUE_NAMES.FOOD_ANALYSIS)
    private readonly foodAnalysisQueue: Queue<FoodAnalysisJobData>,
    // V6.1 Phase 2.3: 核心图片分析逻辑委托给 ImageFoodAnalysisService
    private readonly imageFoodAnalysisService: ImageFoodAnalysisService,
    // V6.1 Phase 2.6: 域事件发射
    private readonly eventEmitter: EventEmitter2,
  ) {
    // 仅用于 submitAnalysis 的前置校验（API Key 是否配置）
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI 分析功能将不可用');
    } else {
      this.logger.log('AI 分析调度服务已初始化');
    }
  }

  // ==================== V6 Phase 1.4: 异步队列接口 ====================

  /**
   * 提交 AI 分析任务到队列（非阻塞）
   *
   * @returns requestId — 客户端用此 ID 轮询结果
   */
  async submitAnalysis(
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<{ requestId: string }> {
    if (!this.apiKey) {
      throw new BadRequestException('AI 分析服务未配置');
    }

    const requestId = crypto.randomUUID();

    // 先在 Redis 中创建 "processing" 占位，客户端轮询可立即看到状态
    await this.cacheAnalysisStatus(requestId, {
      status: 'processing',
      createdAt: Date.now(),
    });

    // 向 BullMQ 队列提交任务
    const queueConfig = QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ANALYSIS];
    await this.foodAnalysisQueue.add(
      'analyze', // job name
      { requestId, imageUrl, mealType, userId },
      {
        attempts: queueConfig.maxRetries + 1, // BullMQ attempts 包含首次执行
        backoff: {
          type: queueConfig.backoffType,
          delay: queueConfig.backoffDelay,
        },
        removeOnComplete: 100, // 保留最近 100 个完成的 job
        removeOnFail: 50, // 保留最近 50 个失败的 job
      },
    );

    this.logger.log(
      `AI 分析任务已入队: requestId=${requestId}, userId=${userId || 'anonymous'}`,
    );

    // V6.1 Phase 2.6: 发射分析提交事件
    if (userId) {
      this.eventEmitter.emit(
        DomainEvents.ANALYSIS_SUBMITTED,
        new AnalysisSubmittedEvent(userId, requestId, 'image'),
      );
    }

    return { requestId };
  }

  /**
   * 执行实际的 AI 分析（由 FoodAnalysisProcessor 调用）
   *
   * V6.1: 委托给 ImageFoodAnalysisService.executeAnalysis()，
   * 并在有 userId 时异步保存分析记录（V61 格式）。
   */
  async processAnalysis(
    requestId: string,
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<void> {
    const result = await this.imageFoodAnalysisService.executeAnalysis(
      imageUrl,
      mealType,
      userId,
    );

    // 写入 Redis 缓存（completed 状态，旧格式供轮询端点返回）
    await this.cacheAnalysisStatus(requestId, {
      status: 'completed',
      data: result,
      createdAt: Date.now(),
    });

    // V6.1 Phase 2.4: 有登录用户时，异步保存分析记录到 food_analysis_records
    if (userId) {
      this.imageFoodAnalysisService
        .persistAnalysisRecord(result, userId, imageUrl, mealType)
        .catch((err) =>
          this.logger.warn(
            `异步保存图片分析记录失败: ${(err as Error).message}`,
          ),
        );

      // V6.1 Phase 2.6: 发射分析完成事件（推动画像更新和推荐联动）
      const foodNames = result.foods.map((f) => f.name);
      const foodCategories = [
        ...new Set(
          result.foods.map((f) => f.category).filter(Boolean) as string[],
        ),
      ];
      const avgConfidence =
        result.foods.length > 0
          ? result.foods.reduce(
              (s, f) => s + ((f as any).confidence ?? 0.6),
              0,
            ) / result.foods.length
          : 0.5;

      this.eventEmitter.emit(
        DomainEvents.ANALYSIS_COMPLETED,
        new AnalysisCompletedEvent(
          userId,
          requestId,
          'image',
          foodNames,
          foodCategories,
          result.totalCalories,
          result.decision === 'AVOID'
            ? 'avoid'
            : result.decision === 'LIMIT'
              ? 'caution'
              : 'recommend',
          avgConfidence,
        ),
      );
    }
  }

  /**
   * 查询分析结果或状态（客户端轮询用）
   *
   * @returns { status, data?, error? } 或 null（requestId 不存在/已过期）
   */
  async getAnalysisStatus(
    requestId: string,
  ): Promise<AnalysisCacheEntry | null> {
    const key = this.redisCacheService.buildKey(
      ANALYSIS_CACHE_PREFIX,
      requestId,
    );
    return this.redisCacheService.get<AnalysisCacheEntry>(key);
  }

  /**
   * 缓存分析错误状态（由 Processor 在 catch 中调用）
   */
  async cacheAnalysisError(
    requestId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.cacheAnalysisStatus(requestId, {
      status: 'failed',
      error: errorMessage,
      createdAt: Date.now(),
    });
  }

  // ==================== 原同步接口（保留用于内部调用 / 兼容场景） ====================

  /**
   * 同步分析食物图片（阻塞式，用于内部服务调用）
   *
   * V6.1: 委托给 ImageFoodAnalysisService.executeAnalysis()
   */
  async analyzeImage(
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<{ requestId: string } & AnalysisResult> {
    if (!this.apiKey) {
      throw new BadRequestException('AI 分析服务未配置');
    }

    const result = await this.imageFoodAnalysisService.executeAnalysis(
      imageUrl,
      mealType,
      userId,
    );

    // 生成 requestId 并写入 Redis（兼容旧的 getCachedResult 逻辑）
    const requestId = crypto.randomUUID();
    await this.cacheAnalysisStatus(requestId, {
      status: 'completed',
      data: result,
      createdAt: Date.now(),
    });

    return { requestId, ...result };
  }

  /**
   * 获取暂存的分析结果（V6: 从 Redis 读取，兼容旧接口签名）
   */
  getCachedResult(requestId: string): Promise<AnalysisResult | null> {
    return this.getAnalysisStatus(requestId).then((entry) => {
      if (!entry || entry.status !== 'completed') return null;
      return entry.data ?? null;
    });
  }

  /**
   * V6.1: 获取 ImageFoodAnalysisService 实例（供 Processor 等外部直接调用 V61 链路）
   */
  getImageAnalysisService(): ImageFoodAnalysisService {
    return this.imageFoodAnalysisService;
  }

  // ==================== 私有方法 ====================

  /**
   * 写入分析状态/结果到 Redis
   */
  private async cacheAnalysisStatus(
    requestId: string,
    entry: AnalysisCacheEntry,
  ): Promise<void> {
    const key = this.redisCacheService.buildKey(
      ANALYSIS_CACHE_PREFIX,
      requestId,
    );
    await this.redisCacheService.set(key, entry, ANALYSIS_CACHE_TTL_MS);
  }
}
