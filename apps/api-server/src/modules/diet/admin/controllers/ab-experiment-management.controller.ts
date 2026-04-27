import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../../rbac/admin/roles.guard';
import { Roles } from '../../../rbac/admin/roles.decorator';
import { ABExperimentManagementService } from '../services/ab-experiment-management.service';
import {
  GetExperimentsQueryDto,
  CreateExperimentDto,
  UpdateExperimentDto,
  UpdateExperimentStatusDto,
} from '../dto/ab-experiment-management.dto';
import { ApiResponse } from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n';

@ApiTags('管理后台 - A/B 实验管理')
@Controller('admin/ab-experiments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ABExperimentManagementController {
  constructor(
    private readonly abExperimentService: ABExperimentManagementService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 列表 ====================

  @Get()
  @ApiOperation({ summary: '获取A/B实验列表' })
  async findAll(@Query() query: GetExperimentsQueryDto): Promise<ApiResponse> {
    const data = await this.abExperimentService.findExperiments(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentListOk'),
      data,
    };
  }

  // ==================== 统计概览 ====================

  @Get('overview')
  @ApiOperation({ summary: '获取A/B实验统计概览' })
  async getOverview(): Promise<ApiResponse> {
    const data = await this.abExperimentService.getOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentOverviewOk'),
      data,
    };
  }

  // ==================== 详情 ====================

  @Get(':id')
  @ApiOperation({ summary: '获取A/B实验详情' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.abExperimentService.getExperimentDetail(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentDetailOk'),
      data,
    };
  }

  // ==================== 创建 ====================

  @Post()
  @ApiOperation({ summary: '创建A/B实验' })
  async create(@Body() dto: CreateExperimentDto): Promise<ApiResponse> {
    const data = await this.abExperimentService.createExperiment(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('diet.experimentCreated'),
      data,
    };
  }

  // ==================== 更新 ====================

  @Put(':id')
  @ApiOperation({ summary: '更新A/B实验' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExperimentDto,
  ): Promise<ApiResponse> {
    const data = await this.abExperimentService.updateExperiment(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentUpdated'),
      data,
    };
  }

  // ==================== 更新状态 ====================

  @Post(':id/status')
  @ApiOperation({ summary: '更新A/B实验状态（启动/暂停/完成）' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateExperimentStatusDto,
  ): Promise<ApiResponse> {
    const data = await this.abExperimentService.updateExperimentStatus(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentStatusUpdated'),
      data,
    };
  }

  // ==================== 指标收集 ====================

  @Get(':id/metrics')
  @ApiOperation({ summary: '收集A/B实验各组指标' })
  async getMetrics(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.abExperimentService.getExperimentMetrics(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentMetricsOk'),
      data,
    };
  }

  // ==================== 分析报告 ====================

  @Get(':id/analysis')
  @ApiOperation({ summary: '获取A/B实验分析报告（含卡方检验）' })
  async getAnalysis(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.abExperimentService.getExperimentAnalysis(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('diet.experimentAnalysisOk'),
      data,
    };
  }
}
