/**
 * FoodImageEnrichmentAdminService
 *
 * 后台图片补全管理服务：
 *  - 扫描缺图食物
 *  - 批量/单条入队生成
 *  - 单条立即同步生成（用于测试/紧急补图）
 *  - 统计进度
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { QueueProducer } from '../../../core/queue/queue-producer.service';
import { QUEUE_NAMES, QUEUE_DEFAULT_OPTIONS } from '../../../core/queue/queue.constants';
import {
  FoodImageEnrichmentService,
  ImageEnrichmentJobPayload,
} from './food-image-enrichment.service';

export interface ImageEnrichmentJobsResult {
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  active: Array<{ jobId: string; foodId: string; foodName: string; startedAt: number }>;
  recent: Array<{
    jobId: string;
    foodId: string;
    foodName: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    qualityScore: number;
    candidateStatus: string | null;
    status: 'completed' | 'failed';
    finishedAt: number;
    error?: string;
  }>;
}

export interface ImageEnrichmentCandidate {
  id: string;
  foodId: string;
  foodName: string;
  jobId: string;
  storedUrl: string | null;
  storedThumbnailUrl: string | null;
  source: string;
  qualityScore: number | null;
  matchScore: number | null;
  finalScore: number | null;
  aiReason: string | null;
  isFoodImage: boolean | null;
  isMatchedFood: boolean | null;
  status: string;
  rejectionReason: string | null;
  createdAt: number;
}

export interface ImageEnrichmentCandidatesResult {
  total: number;
  items: ImageEnrichmentCandidate[];
}

export interface ImageEnrichmentApproveResult {
  candidateId: string;
  foodId: string;
  imageUrl: string;
  thumbnailUrl: string | null;
}

export interface ImageEnrichmentRejectResult {
  candidateId: string;
  status: 'rejected';
}

export interface ImageEnrichmentScanResult {
  totalFoods: number;
  missingImage: number;
  missingThumbnail: number;
  covered: number;
  coveragePercent: number;
}

export interface ImageEnrichmentEnqueueResult {
  enqueued: number;
  skipped: number;
  foodIds: string[];
}

@Injectable()
export class FoodImageEnrichmentAdminService {
  private readonly logger = new Logger(FoodImageEnrichmentAdminService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.FOOD_IMAGE_GENERATION)
    private readonly imageQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly queueProducer: QueueProducer,
    private readonly imageEnrichment: FoodImageEnrichmentService,
  ) {}

  // ─── 扫描缺图统计 ──────────────────────────────────────────────────────────

  async scan(): Promise<ImageEnrichmentScanResult> {
    const [totalFoods, missingImage, missingThumbnail] = await Promise.all([
      this.prisma.food.count({ where: { status: 'active' } }),
      this.prisma.food.count({ where: { status: 'active', imageUrl: null } }),
      this.prisma.food.count({ where: { status: 'active', thumbnailUrl: null } }),
    ]);

    const covered = totalFoods - missingImage;
    return {
      totalFoods,
      missingImage,
      missingThumbnail,
      covered,
      coveragePercent: totalFoods > 0 ? Math.round((covered / totalFoods) * 100) : 0,
    };
  }

  // ─── 清空队列 ─────────────────────────────────────────────────────────────

  async clearQueue(): Promise<{ cleared: number; detail: Record<string, number> }> {
    const [waitingCount, delayedCount, activeCount, failedCount] = await Promise.all([
      this.imageQueue.getWaitingCount(),
      this.imageQueue.getDelayedCount(),
      this.imageQueue.getActiveCount(),
      this.imageQueue.getFailedCount(),
    ]);

    // drain(true) 清除 waiting + delayed；clean 清除 failed/completed 历史
    await Promise.all([
      this.imageQueue.drain(true),
      this.imageQueue.clean(0, 1000, 'failed'),
      this.imageQueue.clean(0, 1000, 'completed'),
    ]);

    const total = waitingCount + delayedCount + activeCount + failedCount;
    this.logger.log(
      `清空队列: waiting=${waitingCount} delayed=${delayedCount} active=${activeCount} failed=${failedCount}`,
    );
    return {
      cleared: total,
      detail: { waiting: waitingCount, delayed: delayedCount, active: activeCount, failed: failedCount },
    };
  }

  // ─── 批量入队 ─────────────────────────────────────────────────────────────

  async enqueue(opts: {
    onlyMissing?: boolean;
    foodGroup?: string | string[];
    primarySource?: string | string[];
    isVerified?: boolean;
    dishType?: string | string[];
    minDishPriority?: number;
    maxDishPriority?: number;
    premiumThreshold?: number;
    limit?: number;
    force?: boolean;
  }): Promise<ImageEnrichmentEnqueueResult> {
    const {
      onlyMissing = true,
      foodGroup,
      primarySource,
      isVerified,
      dishType,
      minDishPriority,
      maxDishPriority,
      premiumThreshold = 80,
      limit = 200,
      force = false,
    } = opts;

    const where: Record<string, any> = { status: 'active' };
    if (onlyMissing) where.imageUrl = null;
    if (foodGroup && (!Array.isArray(foodGroup) || foodGroup.length > 0)) where.foodGroup = Array.isArray(foodGroup) ? { in: foodGroup } : foodGroup;
    if (primarySource && (!Array.isArray(primarySource) || primarySource.length > 0)) where.primarySource = Array.isArray(primarySource) ? { in: primarySource } : primarySource;
    if (isVerified !== undefined) where.isVerified = isVerified;
    if (dishType && (!Array.isArray(dishType) || dishType.length > 0)) where.foodForm = Array.isArray(dishType) ? { in: dishType } : dishType;
    if (minDishPriority !== undefined || maxDishPriority !== undefined) {
      where.dishPriority = {};
      if (minDishPriority !== undefined) where.dishPriority.gte = minDishPriority;
      if (maxDishPriority !== undefined) where.dishPriority.lte = maxDishPriority;
    }

    // 排除候选图表中已有生成结果的食物（uploaded / review_needed / approved）
    // force=true 时跳过此过滤，允许重新生成
    if (!force) {
      const alreadyGeneratedIds = await this.prisma.foodImageCandidate.findMany({
        where: { status: { in: ['uploaded', 'review_needed', 'approved'] } },
        select: { foodId: true },
        distinct: ['foodId'],
      });
      const excludeIds = alreadyGeneratedIds.map((r) => r.foodId);
      if (excludeIds.length > 0) {
        where.id = { notIn: excludeIds };
      }
    }

    const foods = await this.prisma.food.findMany({
      where,
      take: limit,
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          foodForm: true,
          foodGroup: true,
          ingredientList: true,
          dishPriority: true,
          foodTranslations: {
            where: { locale: 'en-US' },
            select: { name: true },
            take: 1,
          },
        },
        orderBy: [
          { dishPriority: 'desc' },
          { commonalityScore: 'desc' },
        ],
      });

    const jobs: ImageEnrichmentJobPayload[] = foods.map((f) => ({
      foodId: f.id,
      foodCode: f.code,
      foodName: f.name,
      foodNameEn: f.foodTranslations[0]?.name ?? undefined,
      category: f.category ?? undefined,
      foodForm: f.foodForm ?? undefined,
      foodGroup: f.foodGroup ?? undefined,
      ingredientList: f.ingredientList?.length ? f.ingredientList : undefined,
      force,
      premium: (f.dishPriority ?? 0) >= premiumThreshold,
    }));

    const queueOpts = QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_IMAGE_GENERATION];

    const results = await this.queueProducer.enqueueBulk(
      QUEUE_NAMES.FOOD_IMAGE_GENERATION,
      jobs.map((data) => ({
        name: 'generate-food-image',
        data,
        opts: {
          attempts: queueOpts.maxRetries + 1,
          backoff: {
            type: queueOpts.backoffType,
            delay: queueOpts.backoffDelay,
          },
        },
      })),
    );

    const enqueued = results.filter((r) => r.mode !== 'sync').length;
    this.logger.log(`批量入队图片生成: ${enqueued}/${foods.length} 条`);

    return {
      enqueued,
      skipped: foods.length - enqueued,
      foodIds: foods.map((f) => f.id),
    };
  }

  // ─── 单条立即同步生成 ─────────────────────────────────────────────────────

  async enrichNow(foodId: string, force = false) {
    const food = await this.prisma.food.findUniqueOrThrow({
      where: { id: foodId },
      select: {
        id: true,
        code: true,
        name: true,
        category: true,
        foodForm: true,
        foodGroup: true,
        ingredientList: true,
        dishPriority: true,
        foodTranslations: {
          where: { locale: 'en-US' },
          select: { name: true },
          take: 1,
        },
      },
    });

    return this.imageEnrichment.enrich({
      foodId: food.id,
      foodCode: food.code,
      foodName: food.name,
      foodNameEn: food.foodTranslations[0]?.name ?? undefined,
      category: food.category ?? undefined,
      foodForm: food.foodForm ?? undefined,
      foodGroup: food.foodGroup ?? undefined,
      ingredientList: food.ingredientList?.length ? food.ingredientList : undefined,
      force,
      premium: (food.dishPriority ?? 0) >= 80,
    });
  }

  // ─── 队列状态 & 最近结果 ──────────────────────────────────────────────────

  async jobs(limit = 30): Promise<ImageEnrichmentJobsResult> {
    const [counts, activeJobs, recentDbJobs] = await Promise.all([
      // BullMQ 仍用于统计 waiting/active/delayed 等实时队列数
      this.imageQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      this.imageQueue.getActive(),
      // 最近结果改从 DB 读取，不受 BullMQ 内存上限约束
      this.prisma.foodImageEnrichmentJob.findMany({
        where: { status: { in: ['completed', 'failed'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          foodId: true,
          status: true,
          errorMessage: true,
          finishedAt: true,
          createdAt: true,
          candidates: {
            // 取候选表中任意有效状态的最优图（按分数降序）
            where: { status: { in: ['uploaded', 'review_needed', 'approved'] } },
            orderBy: { finalScore: 'desc' },
            take: 1,
            select: {
              storedUrl: true,
              storedThumbnailUrl: true,
              qualityScore: true,
              status: true,
            },
          },
          food: { select: { name: true } },
        },
      }),
    ]);

    const recent: ImageEnrichmentJobsResult['recent'] = recentDbJobs.map((j) => {
      const best = j.candidates[0];
      return {
        jobId: j.id,
        foodId: j.foodId,
        foodName: j.food?.name ?? '',
        imageUrl: best?.storedUrl ?? null,
        thumbnailUrl: best?.storedThumbnailUrl ?? null,
        qualityScore: best?.qualityScore ?? -1,
        candidateStatus: best?.status ?? null,
        status: j.status as 'completed' | 'failed',
        finishedAt: j.finishedAt
          ? new Date(j.finishedAt).getTime()
          : new Date((j as any).createdAt).getTime(),
        error: j.errorMessage ?? undefined,
      };
    });

    return {
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      },
      active: activeJobs.map((j) => ({
        jobId: String(j.id),
        foodId: j.data?.foodId ?? '',
        foodName: j.data?.foodName ?? '',
        startedAt: j.processedOn ?? Date.now(),
      })),
      recent,
    };
  }

  // ─── 清空图片字段 ─────────────────────────────────────────────────────────

  async clearImages(opts: {
    foodGroup?: string | string[];
    primarySource?: string | string[];
    isVerified?: boolean;
    dishType?: string | string[];
    limit?: number;
  }): Promise<{ cleared: number }> {
    const { foodGroup, primarySource, isVerified, dishType, limit = 10000 } = opts;

    const where: Record<string, any> = {
      status: 'active',
      OR: [{ imageUrl: { not: null } }, { thumbnailUrl: { not: null } }],
    };
    if (foodGroup && (!Array.isArray(foodGroup) || foodGroup.length > 0)) where.foodGroup = Array.isArray(foodGroup) ? { in: foodGroup } : foodGroup;
    if (primarySource && (!Array.isArray(primarySource) || primarySource.length > 0)) where.primarySource = Array.isArray(primarySource) ? { in: primarySource } : primarySource;
    if (isVerified !== undefined) where.isVerified = isVerified;
    if (dishType && (!Array.isArray(dishType) || dishType.length > 0)) where.foodForm = Array.isArray(dishType) ? { in: dishType } : dishType;

    // 先查 id 列表（避免全表 updateMany 无 limit 控制）
    const ids = await this.prisma.food.findMany({
      where,
      take: limit,
      select: { id: true },
    });

    if (ids.length === 0) return { cleared: 0 };

    const { count } = await this.prisma.food.updateMany({
      where: { id: { in: ids.map((r) => r.id) } },
      data: { imageUrl: null, thumbnailUrl: null },
    });

    this.logger.log(`清空图片字段: ${count} 条`);
    return { cleared: count };
  }

  // ─── 候选图列表 ───────────────────────────────────────────────────────────

  async candidates(opts: {
    foodId?: string;
    status?: string | string[];
    page?: number;
    pageSize?: number;
  }): Promise<ImageEnrichmentCandidatesResult> {
    const { foodId, status, page = 1, pageSize = 30 } = opts;

    const where: Record<string, any> = {};
    if (foodId) where.foodId = foodId;
    if (status) where.status = Array.isArray(status) ? { in: status } : status;

    const [total, rows] = await Promise.all([
      this.prisma.foodImageCandidate.count({ where }),
      this.prisma.foodImageCandidate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          foodId: true,
          jobId: true,
          storedUrl: true,
          storedThumbnailUrl: true,
          source: true,
          qualityScore: true,
          matchScore: true,
          finalScore: true,
          aiReason: true,
          isFoodImage: true,
          isMatchedFood: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          food: { select: { name: true } },
        },
      }),
    ]);

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        foodId: r.foodId,
        foodName: r.food?.name ?? '',
        jobId: r.jobId,
        storedUrl: r.storedUrl,
        storedThumbnailUrl: r.storedThumbnailUrl,
        source: r.source,
        qualityScore: r.qualityScore,
        matchScore: r.matchScore,
        finalScore: r.finalScore,
        aiReason: r.aiReason,
        isFoodImage: r.isFoodImage,
        isMatchedFood: r.isMatchedFood,
        status: r.status,
        rejectionReason: r.rejectionReason,
        createdAt: new Date(r.createdAt).getTime(),
      })),
    };
  }

  // ─── 批量审批候选图 ───────────────────────────────────────────────────────

  async approveCandidates(
    candidateIds: string[],
  ): Promise<ImageEnrichmentApproveResult[]> {
    const results: ImageEnrichmentApproveResult[] = [];

    for (const candidateId of candidateIds) {
      const candidate = await this.prisma.foodImageCandidate.findUniqueOrThrow({
        where: { id: candidateId },
        select: {
          id: true,
          foodId: true,
          storedUrl: true,
          storedThumbnailUrl: true,
          status: true,
        },
      });

      if (!candidate.storedUrl) {
        throw new Error(`候选图 ${candidateId} 缺少 storedUrl，无法写回`);
      }

      // 将 storedUrl 写入 foods 主表（候选目录 → 正式图片）
      await this.prisma.$transaction([
        this.prisma.food.update({
          where: { id: candidate.foodId },
          data: {
            imageUrl: candidate.storedUrl,
            thumbnailUrl: candidate.storedThumbnailUrl ?? null,
          },
        }),
        this.prisma.foodImageCandidate.update({
          where: { id: candidateId },
          data: { status: 'approved' },
        }),
      ]);

      this.logger.log(`approve candidateId=${candidateId} foodId=${candidate.foodId}`);
      results.push({
        candidateId,
        foodId: candidate.foodId,
        imageUrl: candidate.storedUrl,
        thumbnailUrl: candidate.storedThumbnailUrl ?? null,
      });
    }

    return results;
  }

  // ─── 批量拒绝候选图 ───────────────────────────────────────────────────────

  async rejectCandidates(
    candidateIds: string[],
    reason?: string,
  ): Promise<ImageEnrichmentRejectResult[]> {
    await this.prisma.foodImageCandidate.updateMany({
      where: { id: { in: candidateIds } },
      data: {
        status: 'rejected',
        rejectionReason: reason ?? null,
      },
    });

    this.logger.log(`reject ${candidateIds.length} 张候选图`);
    return candidateIds.map((id) => ({ candidateId: id, status: 'rejected' as const }));
  }
}
