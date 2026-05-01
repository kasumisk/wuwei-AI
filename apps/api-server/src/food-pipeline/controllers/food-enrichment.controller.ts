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
 *
 * ── V8.4 新增 ──
 * GET  /admin/food-pipeline/enrichment/dashboard-poll     — 聚合轮询（queue+historical+recentLogs+byStatus，前端单接口轮询）
 * GET  /admin/food-pipeline/enrichment/history/:logId/diff — 历史 change_log 字段级对比（ai_enrichment 类型）
 * GET  /admin/food-pipeline/enrichment/batch-status       — 批量入队后进度快照（队列计数+DB分布汇总）
 * GET  /admin/food-pipeline/enrichment/review-stats       — 审核细粒度报表（通过率/拒绝率/置信度分布/按日趋势/积压列表）
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
import { localesToFoodRegions } from '../../common/utils/locale-region.util';

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
      /** translations 时可多选 */
      locales?: string[];
      /** @deprecated regional 目标现在优先使用 locales 映射地区 */
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
    const regionalRegions =
      target === 'regional'
        ? localesToFoodRegions(body.locales).concat(
            body.region ? [body.region] : [],
          )
        : [];

    let foods: { id: string; name: string; missingFields: EnrichableField[] }[];

    if (target === 'translations' || target === 'regional') {
      // V8.1: 修复 SQL 注入 — 移除字符串插值，使用 service 层参数化查询
      foods = await this.enrichmentService.getFoodsNeedingRelatedEnrichment(
        target,
        limit,
        offset,
        body.locales,
        target === 'regional'
          ? [...new Set(regionalRegions)]
          : body.region,
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
        locales: body.locales,
        region: body.region,
        regions: target === 'regional' ? [...new Set(regionalRegions)] : undefined,
      },
      opts: {
        // V8.4: jobId 幂等去重 — 同一 foodId 在队列中只保留一个 job
        // BullMQ 若 jobId 已存在且仍在 waiting/active 状态，则忽略本次 add
        // 注意：BullMQ jobId 不允许含 ":"，使用 "_" 作分隔符
        jobId: `enrich_${food.id}`,
        attempts:
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1,
        backoff: {
          type: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffType,
          delay:
            QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffDelay,
        },
        removeOnComplete: 1000,
        removeOnFail: 500,
      },
    }));

    // FIX: 入队前清除 failed/stalled 的旧 job，防止 jobId 幂等机制阻塞重新入队
    // BullMQ 对 failed/completed 的 job 仍保留 jobId 记录（受 removeOnFail/removeOnComplete 上限控制）
    // 若旧 job 仍在 Redis 中，addBulk 会静默跳过，导致实际 waiting 数为 0
    // 分批并发（每批 100 条），避免大量入队时一次性打出数万个 Redis 请求导致超时
    const CHUNK_SIZE = 100;
    for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
      const chunk = jobs.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (job) => {
          const existing = await this.enrichmentQueue.getJob(job.opts.jobId);
          if (existing) {
            const state = await existing.getState();
            // 只移除终态（failed/completed）或卡住的 job，不移除 waiting/active
            if (
              state === 'failed' ||
              state === 'completed' ||
              state === 'unknown'
            ) {
              await existing.remove();
            }
          }
        }),
      );
    }

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
  @ApiOperation({
    summary: '查看补全队列任务列表（支持分页，返回 total）',
    description:
      'limit 默认 20，最大 500。注意：completed/failed 状态受 removeOnComplete/removeOnFail 配置影响，Redis 中仅保留最新的 1000 条；waiting 队列无此限制。',
  })
  async getJobs(
    @Query('status')
    status?: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed',
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<ApiResponse> {
    const take = Math.min(Number(limit) || 20, 500);
    const skip = Number(offset) || 0;

    let jobs: any[] = [];
    let total = 0;

    try {
      if (!status || status === 'waiting') {
        [jobs, total] = await Promise.all([
          this.enrichmentQueue.getWaiting(skip, skip + take - 1),
          this.enrichmentQueue.getWaitingCount(),
        ]);
      } else if (status === 'active') {
        [jobs, total] = await Promise.all([
          this.enrichmentQueue.getActive(skip, skip + take - 1),
          this.enrichmentQueue.getActiveCount(),
        ]);
      } else if (status === 'completed') {
        [jobs, total] = await Promise.all([
          this.enrichmentQueue.getCompleted(skip, skip + take - 1),
          this.enrichmentQueue.getCompletedCount(),
        ]);
      } else if (status === 'failed') {
        [jobs, total] = await Promise.all([
          this.enrichmentQueue.getFailed(skip, skip + take - 1),
          this.enrichmentQueue.getFailedCount(),
        ]);
      } else if (status === 'delayed') {
        [jobs, total] = await Promise.all([
          this.enrichmentQueue.getDelayed(skip, skip + take - 1),
          this.enrichmentQueue.getDelayedCount(),
        ]);
      }
    } catch {
      // Redis 不可用时降级返回空列表
      jobs = [];
      total = 0;
    }

    const list = jobs.map((job) => ({
      id: job.id,
      foodId: job.data?.foodId,
      fields: job.data?.fields,
      target: job.data?.target ?? 'foods',
      staged: job.data?.staged ?? false,
      locales: job.data?.locales ?? null,
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

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: {
        list,
        total,
        page: Math.floor(skip / take) + 1,
        pageSize: take,
        offset: skip,
        hasMore: skip + list.length < total,
      },
    };
  }

  // ==================== 队列统计（V8.2: 增加历史统计） ====================

  @Get('stats')
  @ApiOperation({
    summary: '补全队列统计概览（V8.4: Redis 不可用时降级返回 0）',
  })
  async getStats(): Promise<ApiResponse> {
    // V8.4: BullMQ 队列统计独立捕获，Redis 不可用时降级为 0，不影响 DB 侧历史统计
    const safeQueueStat = async (
      fn: () => Promise<number>,
    ): Promise<number> => {
      try {
        return await fn();
      } catch {
        return 0;
      }
    };

    const [waiting, active, completed, failed, delayed, historical] =
      await Promise.all([
        safeQueueStat(() => this.enrichmentQueue.getWaitingCount()),
        safeQueueStat(() => this.enrichmentQueue.getActiveCount()),
        safeQueueStat(() => this.enrichmentQueue.getCompletedCount()),
        safeQueueStat(() => this.enrichmentQueue.getFailedCount()),
        safeQueueStat(() => this.enrichmentQueue.getDelayedCount()),
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
  @ApiOperation({
    summary: '清理队列任务（V8.4: 支持 type=all 一次性清理全部状态）',
    description:
      'type: completed | failed | all（默认 completed）。grace: 毫秒，只清理超过此年龄的任务（默认 0）。limit: 单次最多清理数量（默认 1000）。',
  })
  async clean(
    @Body()
    body: {
      grace?: number;
      type?: 'completed' | 'failed' | 'all';
      limit?: number;
    },
  ): Promise<ApiResponse> {
    const grace = body.grace ?? 0;
    const limit = body.limit ?? 1000;
    const type = body.type ?? 'completed';

    let totalCleaned = 0;

    if (type === 'all') {
      const [completedIds, failedIds] = await Promise.all([
        this.enrichmentQueue.clean(grace, limit, 'completed'),
        this.enrichmentQueue.clean(grace, limit, 'failed'),
      ]);
      totalCleaned = completedIds.length + failedIds.length;
    } else {
      const ids = await this.enrichmentQueue.clean(grace, limit, type);
      totalCleaned = ids.length;
    }

    return {
      success: true,
      code: HttpStatus.OK,
      message: `已清理 ${totalCleaned} 个任务`,
      data: { cleaned: totalCleaned, type },
    };
  }

  @Post('drain')
  @ApiOperation({
    summary: '清空 waiting 队列（V8.4 新增）',
    description:
      '将所有 waiting 状态的任务从队列中移除（drain）。不影响 active/completed/failed 任务。',
  })
  async drain(): Promise<ApiResponse> {
    await this.enrichmentQueue.drain();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '已清空 waiting 队列',
      data: {},
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
        targetFields = targetFields.filter((f) => validRequested.includes(f));
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
        // V8.4: jobId 幂等去重 — 同一 foodId 在队列中只保留一个分阶段补全 job
        jobId: `enrich_staged_${food.id}`,
        attempts:
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1,
        backoff: {
          type: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffType,
          delay:
            QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffDelay,
        },
        removeOnComplete: 1000,
        removeOnFail: 500,
      },
    }));

    // FIX: 入队前清除 failed/stalled 的旧 job，防止 jobId 幂等机制阻塞重新入队
    // 分批并发（每批 100 条），避免大量入队时一次性打出数万个 Redis 请求导致超时
    const STAGED_CHUNK_SIZE = 100;
    for (let i = 0; i < jobs.length; i += STAGED_CHUNK_SIZE) {
      const chunk = jobs.slice(i, i + STAGED_CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (job) => {
          const existing = await this.enrichmentQueue.getJob(job.opts.jobId);
          if (existing) {
            const state = await existing.getState();
            if (
              state === 'failed' ||
              state === 'completed' ||
              state === 'unknown'
            ) {
              await existing.remove();
            }
          }
        }),
      );
    }

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

  // ==================== V8.9: 强制重新补全（按指定字段） ====================

  @Post('re-enqueue')
  @ApiOperation({
    summary:
      'V8.9 强制按指定字段重新入队（全库或筛选范围，忽略字段是否已有值）',
    description: `
      与 /enqueue 的区别：
        - /enqueue 只入队"字段为 NULL"的食物
        - /re-enqueue 不论字段是否已有值，强制将全部（或筛选后的）食物重新入队
      支持 clearFields=true：入队前先把指定字段清空，允许 AI 重新补全
      fields 必填，且必须是 ENRICHABLE_FIELDS 中的有效字段名
    `,
  })
  async reEnqueue(
    @Body()
    body: {
      /** 必填：要重新补全的字段列表 */
      fields: EnrichableField[];
      /** 最多入队食物数（0 或不传 = 全部） */
      limit?: number;
      /** 按食物分类筛选（如 protein/veggie/grain） */
      category?: string;
      /** 按数据来源筛选 */
      primarySource?: string;
      /** 入队前先将指定字段清空（默认 false，设为 true 则强制让 AI 重新生成） */
      clearFields?: boolean;
      /** 是否 staging 模式（默认 false） */
      staged?: boolean;
    },
  ): Promise<ApiResponse> {
    // 1. 校验 fields
    if (!body.fields || body.fields.length === 0) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: 'fields 不能为空，请至少指定一个要重新补全的字段',
        data: null,
      };
    }
    const validFields = body.fields.filter((f) =>
      (ENRICHABLE_FIELDS as readonly string[]).includes(f),
    );
    if (validFields.length === 0) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: `无效的字段名，有效字段请参考 ENRICHABLE_FIELDS`,
        data: null,
      };
    }

    // 2. 查询目标食物（不过滤字段是否为 NULL）
    const foods = await this.enrichmentService.getALLFoodsForReEnqueue(
      validFields,
      {
        limit: body.limit,
        category: body.category,
        primarySource: body.primarySource,
      },
    );

    if (foods.length === 0) {
      return {
        success: true,
        code: HttpStatus.OK,
        message: '没有符合条件的食物',
        data: { enqueued: 0 },
      };
    }

    // 3. 可选：先清空指定字段
    let cleared = 0;
    if (body.clearFields) {
      const result = await this.enrichmentService.clearFieldsForFoods(
        foods.map((f) => f.id),
        validFields,
      );
      cleared = result.cleared;
    }

    // 4. 构建队列任务（每条食物独立 job，jobId 幂等去重）
    const jobs = foods.map((food) => ({
      name: 'enrich',
      data: {
        foodId: food.id,
        fields: validFields,
        target: 'foods' as const,
        staged: body.staged ?? false,
        // V2.1: re-enqueue 使用 direct_fields 模式，跳过5阶段流程直接补全指定字段
        mode: 'direct_fields' as const,
      },
      opts: {
        // 强制重入队：jobId 加上时间戳后缀，绕过幂等去重（允许重复入队）
        jobId: `re_enrich_${food.id}_${Date.now()}`,
        attempts:
          QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].maxRetries + 1,
        backoff: {
          type: QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffType,
          delay:
            QUEUE_DEFAULT_OPTIONS[QUEUE_NAMES.FOOD_ENRICHMENT].backoffDelay,
        },
        removeOnComplete: 1000,
        removeOnFail: 500,
      },
    }));

    await this.enrichmentQueue.addBulk(jobs);

    return {
      success: true,
      code: HttpStatus.OK,
      message: `已强制入队 ${foods.length} 个食物补全任务（字段：${validFields.join(', ')}）${body.clearFields ? `，已清空 ${cleared} 条记录的指定字段` : ''}${body.staged ? '（Staging 模式）' : ''}`,
      data: {
        enqueued: foods.length,
        fields: validFields,
        cleared,
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
          // V8.4: 先重置状态（防止 add 成功但 reset 失败导致下次重复入队）
          await this.enrichmentService.resetEnrichmentStatus(food.id);
          // FIX: 入队前清除旧 job，防止 jobId 幂等机制静默跳过（与 /enqueue 路径保持一致）
          const retryJobId = `enrich_${food.id}`;
          const existingJob = await this.enrichmentQueue.getJob(retryJobId);
          if (existingJob) {
            const state = await existingJob.getState();
            if (
              state === 'failed' ||
              state === 'completed' ||
              state === 'unknown'
            ) {
              await existingJob.remove();
            }
          }
          await this.enrichmentQueue.add(
            'enrich',
            {
              foodId: food.id,
              target: 'foods' as EnrichmentTarget,
              staged: false,
            },
            {
              jobId: retryJobId,
              attempts: queueOpts.maxRetries + 1,
              backoff: {
                type: queueOpts.backoffType,
                delay: queueOpts.backoffDelay,
              },
              removeOnComplete: 1000,
              removeOnFail: 500,
            },
          );
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

  // ==================== V8.4: 审核统计报表 ====================

  @Get('review-stats')
  @ApiOperation({
    summary:
      'V8.4 审核统计细粒度报表（待审核数/通过率/拒绝率/平均置信度/置信度分布/按日趋势/积压列表）',
  })
  async getReviewStats(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getReviewStats();
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

  // ==================== V8.4: 聚合轮询端点 ====================

  @Get('dashboard-poll')
  @ApiOperation({
    summary:
      'V8.4 聚合轮询（一次返回队列状态+历史统计+最近日志+状态分布，前端单接口轮询即可）',
  })
  async getDashboardPoll(): Promise<ApiResponse> {
    const safeQueueStat = async (
      fn: () => Promise<number>,
    ): Promise<number> => {
      try {
        return await fn();
      } catch {
        return 0;
      }
    };

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      safeQueueStat(() => this.enrichmentQueue.getWaitingCount()),
      safeQueueStat(() => this.enrichmentQueue.getActiveCount()),
      safeQueueStat(() => this.enrichmentQueue.getCompletedCount()),
      safeQueueStat(() => this.enrichmentQueue.getFailedCount()),
      safeQueueStat(() => this.enrichmentQueue.getDelayedCount()),
    ]);

    const data = await this.enrichmentService.getDashboardPoll({
      waiting,
      active,
      completed,
      failed,
      delayed,
    });
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== V8.4: 历史日志字段级对比 ====================

  @Get('history/:logId/diff')
  @ApiOperation({
    summary:
      'V8.4 历史 change_log 字段级对比（仅支持 ai_enrichment / ai_enrichment_approved 类型）',
  })
  async getHistoryLogDiff(@Param('logId') logId: string): Promise<ApiResponse> {
    try {
      const data = await this.enrichmentService.getHistoryLogDiff(logId);
      return { success: true, code: HttpStatus.OK, message: '获取成功', data };
    } catch (error) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: error instanceof Error ? error.message : '获取失败',
        data: null,
      };
    }
  }

  // ==================== V8.4: 批量任务进度快照 ====================

  @Get('batch-status')
  @ApiOperation({
    summary:
      'V8.4 批量补全进度快照（队列实时计数 + DB 补全状态分布，入队后轮询此接口追踪进度）',
  })
  async getBatchStatus(): Promise<ApiResponse> {
    const safeQueueStat = async (
      fn: () => Promise<number>,
    ): Promise<number> => {
      try {
        return await fn();
      } catch {
        return 0;
      }
    };

    const [waiting, active, completed, failed, delayed, historical] =
      await Promise.all([
        safeQueueStat(() => this.enrichmentQueue.getWaitingCount()),
        safeQueueStat(() => this.enrichmentQueue.getActiveCount()),
        safeQueueStat(() => this.enrichmentQueue.getCompletedCount()),
        safeQueueStat(() => this.enrichmentQueue.getFailedCount()),
        safeQueueStat(() => this.enrichmentQueue.getDelayedCount()),
        this.enrichmentService.getEnrichmentHistoricalStats(),
      ]);

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: {
        /** 队列实时状态（Redis，不可用时降级为 0）*/
        queue: { waiting, active, completed, failed, delayed },
        /** 已处理统计（来自 DB foods 表，始终准确）*/
        processed: {
          total: historical.total,
          enriched: historical.enriched,
          pending: historical.pending,
          failed: historical.failed,
          staged: historical.staged,
          avgCompleteness: historical.avgCompleteness,
        },
        /** 估算剩余：等待中 + 活跃中 = 队列中尚未处理 */
        remaining: waiting + active,
        /** 估算完成率（基于 DB 数据）*/
        completionRate:
          historical.total > 0
            ? Math.round((historical.enriched / historical.total) * 100)
            : 0,
      },
    };
  }
}
