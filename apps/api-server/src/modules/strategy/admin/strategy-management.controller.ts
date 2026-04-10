import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
}
