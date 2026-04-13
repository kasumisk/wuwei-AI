/**
 * V8.0 Food Enrichment Controller（Admin API）
 *
 * ── 原有端点 ──
 * POST /admin/food-pipeline/enrichment/scan            — 扫描缺失字段统计
 * POST /admin/food-pipeline/enrichment/enqueue         — 批量入队补全任务
 * GET  /admin/food-pipeline/enrichment/jobs            — 查看队列任务状态
 * GET  /admin/food-pipeline/enrichment/stats           — 队列统计概览
 * POST /admin/food-pipeline/enrichment/clean           — 清理已完成/失败任务
 * GET  /admin/food-pipeline/enrichment/staged          — 查询暂存待审核列表
 * POST /admin/food-pipeline/enrichment/staged/:id/approve   — 审核通过（入库）
 * POST /admin/food-pipeline/enrichment/staged/:id/reject    — 审核拒绝
 * POST /admin/food-pipeline/enrichment/staged/batch-approve — 批量审核通过
 * GET  /admin/food-pipeline/enrichment/history         — 补全历史（审计日志）
 *
 * ── V7.9 新增端点 ──
 * POST /admin/food-pipeline/enrichment/enqueue-staged  — 分阶段批量入队
 * GET  /admin/food-pipeline/enrichment/progress        — 全库补全进度统计
 * POST /admin/food-pipeline/enrichment/retry-failed    — 批量重试失败任务
 * GET  /admin/food-pipeline/enrichment/completeness/:id — 单食物完整度评分
 *
 * ── V8.0 新增端点 ──
 * GET  /admin/food-pipeline/enrichment/staged/:id/preview — 暂存预览（对比当前值与建议值）
 * POST /admin/food-pipeline/enrichment/staged/batch-preview — 批量暂存预览（最多50条）
 * POST /admin/food-pipeline/enrichment/:foodId/enrich-now — 单条食物立即补全（同步执行）
 * GET  /admin/food-pipeline/enrichment/completeness-distribution — 全库完整度分布统计
 *
 * ── V8.0 增强 ──
 * POST enqueue / enqueue-staged 新增 maxCompleteness 参数（按完整度上限筛选入队）
 * POST staged/:id/approve 新增 selectedFields 参数（字段级选择性入库）
 *
 * ── V8.3 新增/增强 ──
 * POST /admin/food-pipeline/enrichment/retry-failed       — 增强：支持 source 参数（queue/database/both）
 * POST /admin/food-pipeline/enrichment/recalculate-completeness — 批量重算全库完整度和状态
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../modules/auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../modules/rbac/admin/roles.guard';
import { Roles } from '../../modules/rbac/admin/roles.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { QUEUE_NAMES, QUEUE_DEFAULT_OPTIONS } from '../../core/queue';
import {
  FoodEnrichmentService,
  ENRICHABLE_FIELDS,
  ENRICHMENT_STAGES,
  type EnrichableField,
  type EnrichmentTarget,
} from '../services/food-enrichment.service';

@ApiTags('管理后台 - 食物数据管道')
@Controller('admin/food-pipeline/enrichment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FoodEnrichmentController {
  constructor(
    private readonly enrichmentService: FoodEnrichmentService,
    @InjectQueue(QUEUE_NAMES.FOOD_ENRICHMENT)
    private readonly enrichmentQueue: Queue,
  ) {}

  // ==================== 扫描缺失字段 ====================

  @Post('scan')
  @ApiOperation({ summary: '扫描 foods 及关联表缺失字段统计' })
  async scan(): Promise<ApiResponse> {
    const stats = await this.enrichmentService.scanMissingFields();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '扫描完成',
      data: stats,
    };
  }

  // ==================== 批量入队 ====================

  @Post('enqueue')
  @ApiOperation({ summary: '批量入队 AI 补全任务' })
  async enqueue(
    @Body()
    body: {
      fields?: EnrichableField[];
      limit?: number;
      offset?: number;
      /** 目标：foods / translations / regional */
      target?: EnrichmentTarget;
      /** translations 时必填 */
      locale?: string;
      /** regional 时必填 */
      region?: string;
      /** 是否 staging 模式（先暂存，不直接落库） */
      staged?: boolean;
      /** V8.0: 仅入队完整度 <= 此值的食物（0-100） */
      maxCompleteness?: number;
    },
  ): Promise<ApiResponse> {
    const fields =
      body.fields ?? (ENRICHABLE_FIELDS as unknown as EnrichableField[]);
    const limit = body.limit ?? 50;
    const offset = body.offset ?? 0;
    const target = body.target ?? 'foods';

    let foods: { id: string; name: string; missingFields: EnrichableField[] }[];

    if (target === 'translations' || target === 'regional') {
      // V8.1: 修复 SQL 注入 — 移除字符串插值，使用 service 层参数化查询
      foods = await this.enrichmentService.getFoodsNeedingRelatedEnrichment(
        target,
        limit,
        offset,
        body.locale,
        body.region,
      );
    } else {
      foods = await this.enrichmentService.getFoodsNeedingEnrichment(
        fields,
        limit,
        offset,
        body.maxCompleteness,
      );
    }

    if (foods.length === 0) {
      return {
        success: true,
        code: HttpStatus.OK,
        message: '没有需要补全的食物',
        data: { enqueued: 0 },
      };
    }

    const jobs = foods.map((food) => ({
      name: 'enrich',
      data: {
        foodId: food.id,
        fields: target === 'foods' ? food.missingFields : [],
        target,
        staged: body.staged ?? false,
        locale: body.locale,
        region: body.region,
      },
      opts: {
        attempts:
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1,
        backoff: {
          type: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffType,
          delay:
            QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffDelay,
        },
        removeOnComplete: 200,
        removeOnFail: 100,
      },
    }));

    await this.enrichmentQueue.addBulk(jobs);

    return {
      success: true,
      code: HttpStatus.OK,
      message: `已入队 ${foods.length} 个${target}补全任务${body.staged ? '（Staging 模式）' : ''}`,
      data: {
        enqueued: foods.length,
        target,
        staged: body.staged ?? false,
        foodNames: foods.slice(0, 10).map((f) => f.name),
      },
    };
  }

  // ==================== 队列任务列表 ====================

  @Get('jobs')
  @ApiOperation({ summary: '查看补全队列任务列表' })
  async getJobs(
    @Query('status')
    status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<ApiResponse> {
    const take = Number(limit) || 20;
    const skip = Number(offset) || 0;

    let jobs: any[] = [];
    if (!status || status === 'waiting') {
      jobs = await this.enrichmentQueue.getWaiting(skip, skip + take - 1);
    } else if (status === 'active') {
      jobs = await this.enrichmentQueue.getActive(skip, skip + take - 1);
    } else if (status === 'completed') {
      jobs = await this.enrichmentQueue.getCompleted(skip, skip + take - 1);
    } else if (status === 'failed') {
      jobs = await this.enrichmentQueue.getFailed(skip, skip + take - 1);
    } else if (status === 'delayed') {
      jobs = await this.enrichmentQueue.getDelayed(skip, skip + take - 1);
    }

    const data = jobs.map((job) => ({
      id: job.id,
      foodId: job.data?.foodId,
      fields: job.data?.fields,
      target: job.data?.target ?? 'foods',
      staged: job.data?.staged ?? false,
      locale: job.data?.locale ?? null,
      region: job.data?.region ?? null,
      status: job.finishedOn
        ? 'completed'
        : job.failedReason
          ? 'failed'
          : 'pending',
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      returnValue: job.returnvalue ?? null,
      timestamp: job.timestamp,
      processedOn: job.processedOn ?? null,
      finishedOn: job.finishedOn ?? null,
    }));

    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== 队列统计（V8.2: 增加历史统计） ====================

  @Get('stats')
  @ApiOperation({ summary: '补全队列统计概览（V8.2: 含历史统计）' })
  async getStats(): Promise<ApiResponse> {
    const [waiting, active, completed, failed, delayed, historical] =
      await Promise.all([
        this.enrichmentQueue.getWaitingCount(),
        this.enrichmentQueue.getActiveCount(),
        this.enrichmentQueue.getCompletedCount(),
        this.enrichmentQueue.getFailedCount(),
        this.enrichmentQueue.getDelayedCount(),
        this.enrichmentService.getEnrichmentHistoricalStats(),
      ]);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: {
        queue: { waiting, active, completed, failed, delayed },
        historical,
      },
    };
  }

  // ==================== 清理队列 ====================

  @Post('clean')
  @ApiOperation({ summary: '清理已完成/失败的队列任务' })
  async clean(
    @Body() body: { grace?: number; type?: 'completed' | 'failed' },
  ): Promise<ApiResponse> {
    const grace = body.grace ?? 0;
    const type = body.type ?? 'completed';
    const cleaned = await this.enrichmentQueue.clean(grace, 100, type);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已清理 ${cleaned.length} 个任务`,
      data: { cleaned: cleaned.length },
    };
  }

  // ==================== Staging 暂存列表 ====================

  @Get('staged')
  @ApiOperation({ summary: '查询 AI 暂存待审核列表' })
  async getStaged(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('foodId') foodId?: string,
    @Query('target') target?: EnrichmentTarget,
  ): Promise<ApiResponse> {
    const data = await this.enrichmentService.getStagedEnrichments({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      foodId,
      target,
    });
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== V8.0: 暂存预览（对比当前值与AI建议值）====================

  @Get('staged/:id/preview')
  @ApiOperation({ summary: 'V8.0 预览暂存AI补全数据（对比当前值与建议值）' })
  async previewStaged(@Param('id') id: string): Promise<ApiResponse> {
    try {
      const data = await this.enrichmentService.getEnrichmentPreview(id);
      return {
        success: true,
        code: HttpStatus.OK,
        message: '获取成功',
        data,
      };
    } catch (e) {
      return {
        success: false,
        code: HttpStatus.NOT_FOUND,
        message: (e as Error).message,
        data: null,
      };
    }
  }

  // ==================== V8.0 P3-A: 批量暂存预览 ====================

  @Post('staged/batch-preview')
  @ApiOperation({
    summary: 'V8.0 批量预览暂存数据（最多50条，用于批量审核前对比）',
  })
  async batchPreviewStaged(
    @Body() body: { ids: string[] },
  ): Promise<ApiResponse> {
    if (!body.ids || body.ids.length === 0) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: '请提供至少一个暂存记录ID',
        data: null,
      };
    }
    const data = await this.enrichmentService.getBatchEnrichmentPreview(
      body.ids,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `批量预览完成：${data.summary.success} 成功，${data.summary.failed} 失败`,
      data,
    };
  }

  // ==================== 审核通过 ====================

  @Post('staged/:id/approve')
  @ApiOperation({ summary: '审核通过：将暂存结果入库（支持字段级选择）' })
  async approveStaged(
    @Param('id') id: string,
    @Body()
    body: { /** V8.0: 可选，只入库指定的字段 */ selectedFields?: string[] },
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.enrichmentService.approveStaged(
      id,
      operator,
      body?.selectedFields,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '审核通过，数据已入库',
      data,
    };
  }

  // ==================== 审核拒绝 ====================

  @Post('staged/:id/reject')
  @ApiOperation({ summary: '审核拒绝：丢弃暂存结果' })
  async rejectStaged(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    await this.enrichmentService.rejectStaged(
      id,
      reason ?? '人工拒绝',
      operator,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '已拒绝',
      data: null,
    };
  }

  // ==================== 批量审核通过 ====================

  @Post('staged/batch-approve')
  @ApiOperation({ summary: '批量审核通过' })
  async batchApprove(
    @Body() body: { ids: string[] },
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.enrichmentService.batchApproveStaged(
      body.ids,
      operator,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `批量审核完成：${data.success} 通过，${data.failed} 失败`,
      data,
    };
  }

  // ==================== V8.2: 批量审核拒绝 ====================

  @Post('staged/batch-reject')
  @ApiOperation({ summary: 'V8.2 批量审核拒绝' })
  async batchReject(
    @Body() body: { ids: string[]; reason: string },
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.enrichmentService.batchRejectStaged(
      body.ids,
      body.reason || '批量拒绝',
      operator,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `批量拒绝完成：${data.success} 拒绝，${data.failed} 失败`,
      data,
    };
  }

  // ==================== V8.0: 回退补全（重置已补全字段，可重新补全）====================
  // 注意：batch 路由必须在 :id 路由之前声明，否则 NestJS 会把 "batch" 当作 :id 参数匹配

  @Post('rollback/batch')
  @ApiOperation({
    summary: 'V8.0 批量回退补全记录',
  })
  async batchRollbackEnrichment(
    @Body() body: { ids: string[] },
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.enrichmentService.batchRollbackEnrichment(
      body.ids,
      operator,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `批量回退完成：${data.success} 成功，${data.failed} 失败`,
      data,
    };
  }

  @Post('rollback/:id')
  @ApiOperation({
    summary:
      'V8.0 回退单条补全记录（清除已补全字段，使食物可重新进入补全队列）',
  })
  async rollbackEnrichment(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const operator: string = req.user?.username ?? 'admin';
      const data = await this.enrichmentService.rollbackEnrichment(
        id,
        operator,
      );
      return {
        success: true,
        code: HttpStatus.OK,
        message: data.rolledBack ? `回退成功：${data.detail}` : data.detail,
        data,
      };
    } catch (error) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: error instanceof Error ? error.message : '回退失败',
        data: null,
      };
    }
  }

  // ==================== 补全历史（审计日志）====================

  @Get('history')
  @ApiOperation({ summary: '补全操作历史（审计日志）' })
  async getHistory(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('foodId') foodId?: string,
    @Query('action') action?: string,
  ): Promise<ApiResponse> {
    const data = await this.enrichmentService.getEnrichmentHistory({
      foodId,
      action,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== V7.9: 分阶段批量入队 ====================

  @Post('enqueue-staged')
  @ApiOperation({ summary: 'V8.1 分阶段批量入队补全任务（增强筛选）' })
  async enqueueStagedEnrichment(
    @Body()
    body: {
      /** 指定阶段编号 1-5，默认全部阶段 */
      stages?: number[];
      /** 限制入队食物数 */
      limit?: number;
      offset?: number;
      /** 是否 staging 模式 */
      staged?: boolean;
      /** V8.0: 仅入队完整度 <= 此值的食物（0-100） */
      maxCompleteness?: number;
      /** V8.1: 按食物分类筛选（如 meat/vegetable/grain） */
      category?: string;
      /** V8.1: 按数据来源筛选（如 usda/ai_enrichment/manual） */
      primarySource?: string;
      /** V8.1: 仅入队缺失指定字段的食物（逗号分隔或数组，如 "protein,fat" 或 ["protein","fat"]） */
      missingFields?: string | string[];
    },
  ): Promise<ApiResponse> {
    const stages = body.stages ?? ENRICHMENT_STAGES.map((s) => s.stage);
    const limit = body.limit ?? 50;
    const offset = body.offset ?? 0;

    // 验证阶段编号
    const validStages = stages.filter(
      (s) => s >= 1 && s <= ENRICHMENT_STAGES.length,
    );
    if (validStages.length === 0) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: `无效的阶段编号，有效范围 1-${ENRICHMENT_STAGES.length}`,
        data: null,
      };
    }

    // 收集所有目标阶段涉及的字段，查询缺失这些字段的食物
    let targetFields = ENRICHMENT_STAGES.filter((s) =>
      validStages.includes(s.stage),
    ).flatMap((s) => s.fields);

    // V8.1: 如果传了 missingFields 参数，取交集（仅筛选用户指定的字段）
    if (body.missingFields) {
      const requestedFields = Array.isArray(body.missingFields)
        ? body.missingFields
        : body.missingFields.split(',').map((f) => f.trim());
      const validRequested = requestedFields.filter((f) =>
        (ENRICHABLE_FIELDS as readonly string[]).includes(f),
      );
      if (validRequested.length > 0) {
        targetFields = targetFields.filter((f) =>
          validRequested.includes(f),
        ) as typeof targetFields;
        // 如果交集为空，使用用户指定的有效字段
        if (targetFields.length === 0) {
          targetFields = validRequested as typeof targetFields;
        }
      }
    }

    const foods = await this.enrichmentService.getFoodsNeedingEnrichment(
      targetFields as unknown as EnrichableField[],
      limit,
      offset,
      body.maxCompleteness,
      body.category,
      body.primarySource,
    );

    if (foods.length === 0) {
      return {
        success: true,
        code: HttpStatus.OK,
        message: '没有需要分阶段补全的食物',
        data: { enqueued: 0 },
      };
    }

    const jobs = foods.map((food) => ({
      name: 'enrich-staged',
      data: {
        foodId: food.id,
        target: 'foods' as const,
        staged: body.staged ?? false,
        stages: validStages,
      },
      opts: {
        attempts:
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1,
        backoff: {
          type: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffType,
          delay:
            QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffDelay,
        },
        removeOnComplete: 200,
        removeOnFail: 100,
      },
    }));

    await this.enrichmentQueue.addBulk(jobs);

    return {
      success: true,
      code: HttpStatus.OK,
      message: `已入队 ${foods.length} 个分阶段补全任务（阶段 ${validStages.join(',')}）${body.staged ? '（Staging 模式）' : ''}`,
      data: {
        enqueued: foods.length,
        stages: validStages,
        stageNames: ENRICHMENT_STAGES.filter((s) =>
          validStages.includes(s.stage),
        ).map((s) => s.name),
        staged: body.staged ?? false,
        foodNames: foods.slice(0, 10).map((f) => f.name),
      },
    };
  }

  // ==================== V7.9: 全库补全进度 ====================

  @Get('progress')
  @ApiOperation({ summary: 'V7.9 全库数据补全进度统计' })
  async getProgress(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getEnrichmentProgress();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== V7.9: 批量重试失败任务 ====================

  @Post('retry-failed')
  @ApiOperation({
    summary: 'V8.3 批量重试失败的补全任务（支持队列重试和数据库重入队）',
  })
  async retryFailed(
    @Body()
    body: {
      limit?: number;
      /** V8.1: 仅重试指定食物的失败任务 */
      foodId?: string;
      /** V8.1: 仅重试包含指定字段的失败任务（逗号分隔或数组） */
      fields?: string | string[];
      /** V8.3: 从数据库 enrichment_status='failed'/'rejected' 的食物重新入队 */
      source?: 'queue' | 'database' | 'both';
    },
  ): Promise<ApiResponse> {
    const limit = body.limit ?? 50;
    const source = body.source ?? 'both';
    let retriedFromQueue = 0;
    let enqueuedFromDb = 0;
    const errors: string[] = [];

    // 1. 从队列重试（原有逻辑）
    if (source === 'queue' || source === 'both') {
      const failedJobs = await this.enrichmentQueue.getFailed(0, limit - 1);

      let targetJobs = failedJobs;
      if (body.foodId) {
        targetJobs = targetJobs.filter(
          (job) => job.data?.foodId === body.foodId,
        );
      }
      if (body.fields) {
        const requestedFields = Array.isArray(body.fields)
          ? body.fields
          : body.fields.split(',').map((f) => f.trim());
        if (requestedFields.length > 0) {
          targetJobs = targetJobs.filter((job) => {
            const jobFields: string[] = job.data?.fields ?? [];
            return requestedFields.some((f) => jobFields.includes(f));
          });
        }
      }

      for (const job of targetJobs) {
        try {
          await job.retry();
          retriedFromQueue++;
        } catch (e) {
          errors.push(`queue:jobId=${job.id}: ${(e as Error).message}`);
        }
      }
    }

    // 2. V8.3: 从数据库中查找 enrichment_status = 'failed' 或 'rejected' 的食物重新入队
    if (source === 'database' || source === 'both') {
      const dbLimit =
        source === 'both' ? Math.max(1, limit - retriedFromQueue) : limit;

      const failedFoods = await this.enrichmentService.getFailedFoods(
        dbLimit,
        body.foodId,
      );

      const queueOpts = QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT];
      for (const food of failedFoods) {
        try {
          await this.enrichmentQueue.add(
            'enrichment',
            {
              foodId: food.id,
              target: 'foods' as EnrichmentTarget,
              staged: false,
            },
            {
              attempts: queueOpts.maxRetries + 1,
              backoff: {
                type: queueOpts.backoffType,
                delay: queueOpts.backoffDelay,
              },
              removeOnComplete: 200,
              removeOnFail: 100,
            },
          );
          // 重置状态为 pending
          await this.enrichmentService.resetEnrichmentStatus(food.id);
          enqueuedFromDb++;
        } catch (e) {
          errors.push(`db:${food.name}(${food.id}): ${(e as Error).message}`);
        }
      }
    }

    const totalRetried = retriedFromQueue + enqueuedFromDb;
    return {
      success: true,
      code: HttpStatus.OK,
      message:
        totalRetried > 0
          ? `已重试 ${totalRetried} 个任务（队列${retriedFromQueue}，数据库${enqueuedFromDb}）${errors.length > 0 ? `，${errors.length} 个失败` : ''}`
          : '没有需要重试的失败任务',
      data: {
        retriedFromQueue,
        enqueuedFromDb,
        totalRetried,
        failedToRetry: errors.length,
        errors: errors.slice(0, 10),
      },
    };
  }

  // ==================== V7.9: 单食物完整度评分 ====================

  @Get('completeness/:id')
  @ApiOperation({ summary: 'V8.1 查询单个食物的数据完整度评分' })
  async getCompleteness(@Param('id') id: string): Promise<ApiResponse> {
    // V8.1: 修复封装泄漏 — 通过 service 方法获取而非直接访问 prisma
    const result = await this.enrichmentService.getCompletenessById(id);
    if (!result) {
      return {
        success: false,
        code: HttpStatus.NOT_FOUND,
        message: `食物 ${id} 不存在`,
        data: null,
      };
    }

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: result,
    };
  }

  // ==================== V8.0: 单条立即补全 ====================

  // ==================== V8.0: 全库完整度分布统计 ====================

  @Get('completeness-distribution')
  @ApiOperation({
    summary: 'V8.0 全库完整度分布统计（按0-20/20-40/40-60/60-80/80-100区间）',
  })
  async getCompletenessDistribution(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getCompletenessDistribution();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== V8.3: 批量重算完整度 ====================

  @Post('recalculate-completeness')
  @ApiOperation({
    summary:
      'V8.3 批量重算全库 data_completeness 和 enrichment_status（修复历史数据不一致）',
  })
  async recalculateCompleteness(
    @Body() body: { batchSize?: number },
  ): Promise<ApiResponse> {
    const batchSize = body?.batchSize ?? 200;
    const data =
      await this.enrichmentService.recalculateCompleteness(batchSize);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `重算完成：共 ${data.total} 条，更新 ${data.updated} 条${data.errors > 0 ? `，${data.errors} 条出错` : ''}`,
      data,
    };
  }

  // ==================== V8.0: 运维统计（补全成功率/通过率/按日趋势）====================

  @Get('operations-stats')
  @ApiOperation({
    summary: 'V8.0 补全运维统计（成功/暂存/审核通过率/平均置信度/按日趋势）',
  })
  async getOperationsStats(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getEnrichmentStatistics();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== V8.1: 全局任务总览 ====================

  @Get('task-overview')
  @ApiOperation({
    summary:
      'V8.1 全局补全任务总览（待审核数/完整度分布/状态分布/失败字段Top10/近7天趋势）',
  })
  async getTaskOverview(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getTaskOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== V8.0: 单条立即补全（端点）====================

  @Post(':foodId/enrich-now')
  @ApiOperation({
    summary: 'V8.0 单条食物立即补全（同步执行，不走队列）',
  })
  async enrichNow(
    @Param('foodId') foodId: string,
    @Body()
    body: {
      /** 指定阶段编号 1-5，默认自动检测需要补全的阶段 */
      stages?: number[];
      /** 指定要补全的字段（可选） */
      fields?: string[];
      /** 是否暂存模式，默认 false */
      staged?: boolean;
    },
  ): Promise<ApiResponse> {
    try {
      const result = await this.enrichmentService.enrichFoodNow(foodId, {
        stages: body.stages,
        fields: body.fields as any,
        staged: body.staged,
      });

      return {
        success: true,
        code: HttpStatus.OK,
        message:
          result.totalEnriched > 0
            ? `成功补全 ${result.totalEnriched} 个字段${result.totalFailed > 0 ? `，${result.totalFailed} 个失败` : ''}`
            : '无需补全（所有字段已有值）',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        code: HttpStatus.INTERNAL_SERVER_ERROR,
        message: error instanceof Error ? error.message : '补全失败',
        data: null,
      };
    }
  }
}
