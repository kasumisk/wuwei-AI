import {
  Controller,
  Get,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { AnalysisRecordManagementService } from './analysis-record-management.service';
import {
  GetAnalysisRecordsQueryDto,
  ReviewAnalysisRecordDto,
} from './dto/analysis-record-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - 分析记录管理')
@Controller('admin/analysis-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class AnalysisRecordManagementController {
  constructor(
    private readonly analysisService: AnalysisRecordManagementService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取分析记录列表' })
  async findAnalysisRecords(
    @Query() query: GetAnalysisRecordsQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.analysisService.findAnalysisRecords(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('statistics')
  @ApiOperation({ summary: '分析记录统计' })
  async getStatistics(): Promise<ApiResponse> {
    const data = await this.analysisService.getAnalysisStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('popular-foods')
  @ApiOperation({ summary: '热门分析食物排名' })
  async getPopularFoods(@Query('limit') limit?: string): Promise<ApiResponse> {
    const data = await this.analysisService.getPopularAnalyzedFoods(
      limit ? parseInt(limit, 10) : 20,
    );
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取分析记录详情' })
  async getDetail(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.analysisService.getAnalysisRecordDetail(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Put(':id/review')
  @ApiOperation({ summary: '人工审核分析记录' })
  async reviewRecord(
    @Param('id') id: string,
    @Body() dto: ReviewAnalysisRecordDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const adminUserId = req.user?.id || req.user?.sub;
    const data = await this.analysisService.reviewAnalysisRecord(
      id,
      dto,
      adminUserId,
    );
    return { success: true, code: HttpStatus.OK, message: '审核成功', data };
  }
}
