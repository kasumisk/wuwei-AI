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
} from './dto/strategy-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

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
  async findAll(@Query() query: GetStrategiesQueryDto): Promise<ApiResponse> {
    const data = await this.strategyManagementService.findStrategies(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取策略列表成功',
      data,
    };
  }

  @Get('overview')
  @ApiOperation({ summary: '获取策略统计概览' })
  async getOverview(): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getStrategyOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取策略概览成功',
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取策略详情' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getStrategyDetail(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取策略详情成功',
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: '创建策略' })
  async create(@Body() dto: CreateStrategyDto): Promise<ApiResponse> {
    const data = await this.strategyManagementService.createStrategy(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '策略创建成功',
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新策略' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStrategyDto,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.updateStrategy(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '策略更新成功',
      data,
    };
  }

  @Post(':id/activate')
  @ApiOperation({ summary: '激活策略' })
  async activate(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.strategyManagementService.activateStrategy(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '策略已激活',
      data,
    };
  }

  @Post(':id/archive')
  @ApiOperation({ summary: '归档策略' })
  async archive(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.strategyManagementService.archiveStrategy(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '策略已归档',
      data,
    };
  }

  // ==================== 策略分配 ====================

  @Post(':id/assign')
  @ApiOperation({ summary: '分配策略给用户' })
  async assign(
    @Param('id') id: string,
    @Body() dto: AssignStrategyDto,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.assignStrategy(id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '策略分配成功',
      data,
    };
  }

  @Get(':id/assignments')
  @ApiOperation({ summary: '获取策略的分配列表' })
  async getAssignments(
    @Param('id') id: string,
    @Query() query: GetAssignmentsQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getAssignments(id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取分配列表成功',
      data,
    };
  }

  @Delete(':id/assignments/:assignmentId')
  @ApiOperation({ summary: '取消策略分配' })
  async removeAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() dto: RemoveAssignmentDto,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.removeAssignment(
      id,
      assignmentId,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '分配已取消',
      data,
    };
  }

  // ==================== V6.5 Phase 3H: Realism 配置管理 ====================

  @Get('realism/overview')
  @ApiOperation({
    summary: '获取所有活跃策略的 Realism 配置概览',
    description: '返回系统默认值、预设值、以及每个活跃策略当前的 realism 配置',
  })
  async getRealismOverview(): Promise<ApiResponse> {
    const data = await this.strategyManagementService.getRealismOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Realism 配置概览成功',
      data,
    };
  }

  @Patch(':id/realism')
  @ApiOperation({
    summary: '更新策略的 Realism 配置',
    description:
      '只修改 config.realism 子字段，不影响策略其他配置维度。支持部分更新。',
  })
  async updateRealism(
    @Param('id') id: string,
    @Body() dto: UpdateRealismConfigDto,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.updateStrategyRealism(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'Realism 配置更新成功',
      data,
    };
  }

  @Post(':id/realism/preset')
  @ApiOperation({
    summary: '将预设 Realism 配置应用到策略',
    description: '可选预设: warm_start, re_engage, precision, discovery',
  })
  @ApiQuery({
    name: 'preset',
    required: true,
    description: '预设名称',
    enum: ['warm_start', 're_engage', 'precision', 'discovery'],
  })
  async applyRealismPreset(
    @Param('id') id: string,
    @Query('preset') preset: string,
  ): Promise<ApiResponse> {
    const data = await this.strategyManagementService.applyRealismPreset(
      id,
      preset,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `已应用预设 "${preset}"`,
      data,
    };
  }

  @Post('realism/apply-to-segment')
  @ApiOperation({
    summary: '按分群批量应用 Realism 配置',
    description: '查找匹配分群名称的所有活跃策略，批量更新 realism 配置',
  })
  async applyRealismToSegment(
    @Body() dto: ApplyRealismToSegmentDto,
  ): Promise<ApiResponse> {
    const data =
      await this.strategyManagementService.applyRealismToSegment(dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `Realism 配置已应用到分群 "${dto.segment}"`,
      data,
    };
  }
}
