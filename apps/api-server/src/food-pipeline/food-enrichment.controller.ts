/**
 * V6.6 Food Enrichment Controller（Admin API）
 *
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
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/admin/jwt-auth.guard';
import { RolesGuard } from '../modules/rbac/admin/roles.guard';
import { Roles } from '../modules/rbac/admin/roles.decorator';
import { ApiResponse } from '../common/types/response.type';
import { QUEUE_NAMES, QUEUE_DEFAULT_OPTIONS } from '../core/queue';
import {
  FoodEnrichmentService,
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type EnrichmentTarget,
} from './services/food-enrichment.service';

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
    },
  ): Promise<ApiResponse> {
    const fields =
      body.fields ?? (ENRICHABLE_FIELDS as unknown as EnrichableField[]);
    const limit = body.limit ?? 50;
    const offset = body.offset ?? 0;
    const target = body.target ?? 'foods';

    let foods: { id: string; name: string; missingFields: EnrichableField[] }[];

    if (target === 'translations' || target === 'regional') {
      // 查询没有对应翻译/地区信息的食物
      const sql =
        target === 'translations'
          ? `SELECT id, name FROM foods WHERE NOT EXISTS (
               SELECT 1 FROM food_translations ft WHERE ft.food_id = foods.id
               ${body.locale ? `AND ft.locale = '${body.locale}'` : ''}
             ) ORDER BY created_at DESC LIMIT $1 OFFSET $2`
          : `SELECT id, name FROM foods WHERE NOT EXISTS (
               SELECT 1 FROM food_regional_info fri WHERE fri.food_id = foods.id
               ${body.region ? `AND fri.region = '${body.region}'` : ''}
             ) ORDER BY created_at DESC LIMIT $1 OFFSET $2`;

      const rows = (await (
        this.enrichmentService as any
      ).prisma.$queryRawUnsafe(sql, limit, offset)) as {
        id: string;
        name: string;
      }[];

      foods = rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        missingFields: [],
      }));
    } else {
      foods = await this.enrichmentService.getFoodsNeedingEnrichment(
        fields,
        limit,
        offset,
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

  // ==================== 队列统计 ====================

  @Get('stats')
  @ApiOperation({ summary: '补全队列统计概览' })
  async getStats(): Promise<ApiResponse> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.enrichmentQueue.getWaitingCount(),
      this.enrichmentQueue.getActiveCount(),
      this.enrichmentQueue.getCompletedCount(),
      this.enrichmentQueue.getFailedCount(),
      this.enrichmentQueue.getDelayedCount(),
    ]);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: { waiting, active, completed, failed, delayed },
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

  // ==================== 审核通过 ====================

  @Post('staged/:id/approve')
  @ApiOperation({ summary: '审核通过：将暂存结果入库' })
  async approveStaged(
    @Param('id') id: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.enrichmentService.approveStaged(id, operator);
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
}
