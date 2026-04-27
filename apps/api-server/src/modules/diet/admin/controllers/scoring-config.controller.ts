import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { ScoringConfigService } from '../../app/recommendation/context/scoring-config.service';
import { DailyScoreWeightsConfig } from '../../app/recommendation/context/scoring-config.service';
import { ScoringConfigSnapshot } from '../../app/recommendation/types/recommendation.types';
import { ApiResponse } from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n';

/**
 * V6.7 Phase 1-B: 评分参数中心化管理 — Admin 端点
 *
 * GET  /api/admin/scoring-config — 查看当前评分配置
 * PUT  /api/admin/scoring-config — 更新评分配置（partial merge）
 */
@ApiTags('管理后台 - 评分参数配置')
@Controller('admin/scoring-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ScoringConfigController {
  constructor(
    private readonly scoringConfigService: ScoringConfigService,
    private readonly i18n: I18nService,
  ) {}

  @Get()
  @ApiOperation({
    summary: '查看当前评分配置',
    description:
      '返回当前生效的 ScoringConfigSnapshot，包含 FoodScorer/RecallMerger/RealisticFilter/MealComposition/CF/Lifestyle 等全部参数',
  })
  async getConfig(): Promise<ApiResponse> {
    const config = await this.scoringConfigService.getConfig();
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.scoringConfigOk'),
      data: {
        config,
        defaults: this.scoringConfigService.getDefaults(),
      },
    };
  }

  @Put()
  @ApiOperation({
    summary: '更新评分配置（partial merge）',
    description:
      '支持部分更新：只传需要修改的字段，其余保持当前值。嵌套对象（如 executabilitySubWeights）也支持部分更新。',
  })
  async updateConfig(
    @Body() body: Partial<ScoringConfigSnapshot>,
  ): Promise<ApiResponse> {
    const config = await this.scoringConfigService.updateConfig(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.scoringConfigUpdated'),
      data: config,
    };
  }

  // ─── V1.5: 每日评分权重配置 ───

  @Get('daily-score-weights')
  @ApiOperation({
    summary: '查看每日评分权重配置',
    description:
      '返回当前 daily_score_weights 配置 + 硬编码默认值。若 current 为 null，表示使用默认权重。',
  })
  async getDailyScoreWeights(): Promise<ApiResponse> {
    const config = await this.scoringConfigService.getDailyScoreWeights();
    const defaults = this.scoringConfigService.getDailyScoreWeightsDefaults();
    return {
      success: true,
      code: HttpStatus.OK,
      message: config
        ? this.i18n.t('diet.dailyWeightsOk')
        : this.i18n.t('diet.dailyWeightsUsingDefault'),
      data: {
        current: config,
        defaults,
        effectiveSource: config ? 'config' : 'default',
      },
    };
  }

  @Get('daily-score-weights/defaults')
  @ApiOperation({
    summary: '查看每日评分权重默认值',
    description:
      '返回硬编码的默认 goalWeights + healthConditionMultipliers，供 Admin 参考。',
  })
  async getDailyScoreWeightsDefaults(): Promise<ApiResponse> {
    const defaults = this.scoringConfigService.getDailyScoreWeightsDefaults();
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.defaultWeightsOk'),
      data: defaults,
    };
  }

  @Put('daily-score-weights')
  @ApiOperation({
    summary: '更新每日评分权重配置',
    description:
      '写入完整的 DailyScoreWeightsConfig（version + goalWeights + healthConditionMultipliers）。生效延迟约 1-5 分钟（缓存 TTL）。',
  })
  async updateDailyScoreWeights(
    @Body() body: DailyScoreWeightsConfig,
  ): Promise<ApiResponse> {
    // V1.6: 先验证
    const errors = this.scoringConfigService.validateDailyScoreWeights(body);
    if (errors.length > 0) {
      throw new BadRequestException({
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: this.i18n.t('diet.weightValidationFailed'),
        data: { errors },
      });
    }

    const config =
      await this.scoringConfigService.updateDailyScoreWeights(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.dailyWeightsUpdated'),
      data: config,
    };
  }
}
