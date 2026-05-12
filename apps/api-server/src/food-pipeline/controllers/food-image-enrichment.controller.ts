/**
 * FoodImageEnrichmentController
 *
 * Admin API — 食物图片 AI 补全管理
 *
 * POST /admin/food-pipeline/image-enrichment/scan         — 扫描缺图统计
 * POST /admin/food-pipeline/image-enrichment/enqueue      — 批量入队生成
 * POST /admin/food-pipeline/image-enrichment/:foodId/now  — 单条立即同步生成
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
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../modules/auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../modules/rbac/admin/roles.guard';
import { Roles } from '../../modules/rbac/admin/roles.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { FoodImageEnrichmentAdminService } from '../services/image-enrichment/food-image-enrichment-admin.service';

@ApiTags('管理后台 - 食物图片补全')
@Controller('admin/food-pipeline/image-enrichment')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FoodImageEnrichmentController {
  constructor(private readonly service: FoodImageEnrichmentAdminService) {}

  // ─── 扫描 ─────────────────────────────────────────────────────────────────

  @Get('scan')
  @ApiOperation({ summary: '扫描缺图统计（缺图数 / 覆盖率）' })
  async scan(): Promise<ApiResponse> {
    const data = await this.service.scan();
    return { success: true, code: HttpStatus.OK, message: '扫描完成', data };
  }

  // ─── 批量入队 ─────────────────────────────────────────────────────────────

  @Post('enqueue')
  @ApiOperation({ summary: '批量入队图片生成任务' })
  async enqueue(
    @Body()
    body: {
      onlyMissing?: boolean;
      /** USDA 食物组分类（foodGroup 字段），支持多选 */
      foodGroup?: string | string[];
      /** 数据来源，支持多选，如 usda / cfsb / manual / ai */
      primarySource?: string | string[];
      isVerified?: boolean;
      /** 菜品类型，支持多选 */
      dishType?: string | string[];
      minDishPriority?: number;
      maxDishPriority?: number;
      premiumThreshold?: number;
      limit?: number;
      force?: boolean;
    },
  ): Promise<ApiResponse> {
    const data = await this.service.enqueue(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已入队 ${data.enqueued} 条图片生成任务`,
      data,
    };
  }

  // ─── 队列状态 & 最近结果 ──────────────────────────────────────────────────

  @Post('queue/clear')
  @ApiOperation({ summary: '清空图片生成队列（waiting / delayed / active）' })
  async clearQueue(): Promise<ApiResponse> {
    const data = await this.service.clearQueue();
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已清空队列，共移除 ${data.cleared} 个任务`,
      data,
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: '队列状态 + 最近完成/失败任务（含图片URL）' })
  async jobs(): Promise<ApiResponse> {
    const data = await this.service.jobs();
    return { success: true, code: HttpStatus.OK, message: 'ok', data };
  }

  // ─── 清空图片字段 ──────────────────────────────────────────────────────────

  @Post('clear')
  @ApiOperation({
    summary: '清空已有图片字段（imageUrl / thumbnailUrl），用于重置重跑',
  })
  async clearImages(
    @Body()
    body: {
      foodGroup?: string | string[];
      primarySource?: string | string[];
      isVerified?: boolean;
      dishType?: string | string[];
      limit?: number;
    },
  ): Promise<ApiResponse> {
    const data = await this.service.clearImages(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已清空 ${data.cleared} 条食物的图片字段`,
      data,
    };
  }

  // ─── 单条立即生成 ─────────────────────────────────────────────────────────

  @Post(':foodId/now')
  @ApiOperation({ summary: '单条食物立即同步生成图片（测试/紧急补图）' })
  async enrichNow(
    @Param('foodId', ParseUUIDPipe) foodId: string,
    @Body() body: { force?: boolean },
  ): Promise<ApiResponse> {
    const data = await this.service.enrichNow(foodId, body.force ?? false);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.skipped ? `已跳过: ${data.skipReason}` : '图片生成完成',
      data,
    };
  }

  // ─── 候选图列表 ───────────────────────────────────────────────────────────

  @Get('candidates')
  @ApiOperation({ summary: '候选图列表（支持按 foodId / status 过滤，分页）' })
  async candidates(
    @Query('foodId') foodId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse> {
    const data = await this.service.candidates({
      foodId,
      status: status ? status.split(',') : undefined,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Math.min(Number(pageSize), 100) : 30,
    });
    return { success: true, code: HttpStatus.OK, message: 'ok', data };
  }

  // ─── 批量审批候选图 ───────────────────────────────────────────────────────

  @Post('candidates/approve')
  @ApiOperation({ summary: '批量审批候选图 → 写入 foods.image_url' })
  async approveCandidates(
    @Body() body: { candidateIds: string[] },
  ): Promise<ApiResponse> {
    const data = await this.service.approveCandidates(body.candidateIds);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已审批 ${data.length} 张候选图`,
      data,
    };
  }

  // ─── 批量拒绝候选图 ───────────────────────────────────────────────────────

  @Post('candidates/reject')
  @ApiOperation({ summary: '批量拒绝候选图' })
  async rejectCandidates(
    @Body() body: { candidateIds: string[]; reason?: string },
  ): Promise<ApiResponse> {
    const data = await this.service.rejectCandidates(
      body.candidateIds,
      body.reason,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已拒绝 ${data.length} 张候选图`,
      data,
    };
  }
}
