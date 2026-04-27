import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { StrategyManagementService } from './strategy-management.service';
import {
  GetStrategiesQueryDto,
  CreateStrategyDto,
  UpdateStrategyDto,
  AssignStrategyDto,
  GetAssignmentsQueryDto,
  RemoveAssignmentDto,
  UpdateRealismConfigDto,
  ApplyRealismToSegmentDto,
  StrategySimulateDto,
  TuningReviewDto,
  TuningPendingQueryDto,
} from './dto/strategy-management.dto';
import { ApiResponse } from '../../../common/types/response.type';
import { CurrentUser } from '../../auth/admin/current-user.decorator';

@ApiTags('管理后台 - 推荐策略管理')
@Controller('admin/strategies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class StrategyManagementController {
  constructor(
    private readonly strategyManagementService: StrategyManagementService,
  ) {}

  // ==================== 策略 CRUD ====================

  @Get()
  @ApiOperation({ summary: '获取策略列表' })
  async findAll(
    @Query() query: GetStrategiesQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.findStrategies(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.fetchListSuccess'),
      data,
    };
  }

  @Get('overview')
  @ApiOperation({ summary: '获取策略统计概览' })
  async getOverview(@I18n() i18n: I18nContext): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getStrategyOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.fetchOverviewSuccess'),
      data,
    };
  }

  // ==================== V7.9 P2-10: 调优审核（静态路由，必须在 :id 之前） ====================

  @Get('auto-tune/pending')
  @ApiOperation({ summary: '获取待审核的自动调优建议列表' })
  async getPendingTunings(
    @Query() query: TuningPendingQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getPendingTunings(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.pendingTuningsSuccess'),
      data,
    };
  }

  @Post('auto-tune/:tuningId/approve')
  @ApiOperation({ summary: '批准自动调优建议' })
  async approveTuning(
    @Param('tuningId') tuningId: string,
    @Body() dto: TuningReviewDto,
    @CurrentUser() admin: any,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const adminUserId = admin?.id || admin?.sub || 'unknown';
    const data = await this.strategyManagementService.approveTuning(
      tuningId,
      adminUserId,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.tuningApproved'),
      data,
    };
  }

  @Post('auto-tune/:tuningId/reject')
  @ApiOperation({ summary: '拒绝自动调优建议' })
  async rejectTuning(
    @Param('tuningId') tuningId: string,
    @Body() dto: TuningReviewDto,
    @CurrentUser() admin: any,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const adminUserId = admin?.id || admin?.sub || 'unknown';
    const data = await this.strategyManagementService.rejectTuning(
      tuningId,
      adminUserId,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.tuningRejected'),
      data,
    };
  }

  // ==================== 策略详情（参数路由） ====================

  @Get(':id')
  @ApiOperation({ summary: '获取策略详情' })
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getStrategyDetail(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.fetchDetailSuccess'),
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: '创建策略' })
  async create(
    @Body() dto: CreateStrategyDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.createStrategy(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('strategy.strategy.createSuccess'),
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新策略' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStrategyDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.updateStrategy(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.updateSuccess'),
      data,
    };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: '激活策略' })
  async activate(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.activateStrategy(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.activateSuccess'),
      data,
    };
  }

  @Post(':id/archive')
  @ApiOperation({ summary: '归档策略' })
  async archive(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.archiveStrategy(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.archiveSuccess'),
      data,
    };
  }

  // ==================== 策略分配 ====================

  @Post(':id/assign')
  @ApiOperation({ summary: '分配策略给用户' })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignStrategyDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.assignStrategy(id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('strategy.strategy.assignSuccess'),
      data,
    };
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: '获取策略的分配列表' })
  async getAssignments(
    @Param('id') id: string,
    @Query() query: GetAssignmentsQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getAssignments(id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.fetchListSuccess'),
      data,
    };
  }

  @Delete(':id/assignments/:assignmentId')
  @ApiOperation({ summary: '取消策略分配' })
  async removeAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: RemoveAssignmentDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.removeAssignment(
      id,
      assignmentId,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.removeAssignmentSuccess'),
      data,
    };
  }

  // ==================== V6.5 Phase 3H: Realism 配置管理 ====================

  @Get('realism/overview')
  @ApiOperation({ summary: '获取所有活跃策略的 Realism 配置概览' })
  async getRealismOverview(@I18n() i18n: I18nContext): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getRealismOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.fetchOverviewSuccess'),
      data,
    };
  }

  @Patch(':id/realism')
  @ApiOperation({ summary: '更新策略的 Realism 配置' })
  async updateRealism(
    @Param('id') id: string,
    @Body() dto: UpdateRealismConfigDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.updateStrategyRealism(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.realismUpdateSuccess'),
      data,
    };
  }

  @Post(':id/realism/preset')
  @ApiOperation({ summary: '将预设 Realism 配置应用到策略' })
  @ApiQuery({
    name: 'preset',
    required: true,
    description: '预设名称',
    enum: ['warm_start', 're_engage', 'precision', 'discovery'],
  })
  async applyRealismPreset(
    @Param('id') id: string,
    @Query('preset') preset: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.applyRealismPreset(
      id,
      preset,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.realismPresetApplied', { preset }),
      data,
    };
  }

  @Post('realism/apply-to-segment')
  @ApiOperation({ summary: '按分群批量应用 Realism 配置' })
  async applyRealismToSegment(
    @Body() dto: ApplyRealismToSegmentDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data =
      await this.strategyManagementService.applyRealismToSegment(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.realismSegmentApplied', {
        segment: dto.segment,
      }),
      data,
    };
  }

  // ==================== V7.9 P2-06: 策略模拟推荐 ====================

  @Post(':id/simulate')
  @ApiOperation({ summary: '模拟指定策略的推荐效果' })
  async simulateStrategy(
    @Param('id') id: string,
    @Body() dto: StrategySimulateDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.simulateStrategy(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.simulateSuccess'),
      data,
    };
  }

  // ==================== V7.9 P2-07: 策略参数 Diff ====================

  @Get(':id/diff')
  @ApiOperation({ summary: '对比两个策略的 9 维配置差异' })
  @ApiQuery({
    name: 'compareWith',
    required: true,
    description: '要对比的另一个策略 ID',
  })
  async diffStrategies(
    @Param('id') id: string,
    @Query('compareWith') compareWith: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.diffStrategies(
      id,
      compareWith,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('strategy.strategy.diffSuccess'),
      data,
    };
  }
}
