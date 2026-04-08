import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { ContentManagementService } from '../services/content-management.service';
import {
  GetFoodRecordsQueryDto,
  GetDailyPlansQueryDto,
  GetCoachConversationsQueryDto,
  GetRecommendationFeedbackQueryDto,
  GetAiDecisionLogsQueryDto,
} from '../dto/content-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('管理后台 - 饮食记录 & 计划 & AI日志')
@Controller('admin/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class ContentManagementController {
  constructor(
    private readonly contentService: ContentManagementService,
  ) {}

  // ==================== 饮食记录 ====================

  @Get('food-records')
  @ApiOperation({ summary: '获取饮食记录列表' })
  async findFoodRecords(@Query() query: GetFoodRecordsQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findFoodRecords(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('food-records/statistics')
  @ApiOperation({ summary: '获取饮食记录统计' })
  async getFoodRecordStatistics(): Promise<ApiResponse> {
    const data = await this.contentService.getFoodRecordStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('food-records/:id')
  @ApiOperation({ summary: '获取饮食记录详情' })
  async getFoodRecordDetail(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.getFoodRecordDetail(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Delete('food-records/:id')
  @ApiOperation({ summary: '删除饮食记录' })
  async deleteFoodRecord(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.deleteFoodRecord(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 每日计划 ====================

  @Get('daily-plans')
  @ApiOperation({ summary: '获取每日计划列表' })
  async findDailyPlans(@Query() query: GetDailyPlansQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findDailyPlans(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('daily-plans/:id')
  @ApiOperation({ summary: '获取每日计划详情' })
  async getDailyPlanDetail(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.getDailyPlanDetail(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== AI 对话 ====================

  @Get('conversations')
  @ApiOperation({ summary: '获取AI对话列表' })
  async findConversations(@Query() query: GetCoachConversationsQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findConversations(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('conversations/statistics')
  @ApiOperation({ summary: '获取AI对话统计' })
  async getConversationStatistics(): Promise<ApiResponse> {
    const data = await this.contentService.getConversationStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '获取AI对话详情（含消息）' })
  async getConversationDetail(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.getConversationDetail(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除AI对话' })
  async deleteConversation(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.contentService.deleteConversation(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 推荐反馈 ====================

  @Get('recommendation-feedback')
  @ApiOperation({ summary: '获取推荐反馈列表' })
  async findRecommendationFeedback(@Query() query: GetRecommendationFeedbackQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findRecommendationFeedback(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('recommendation-feedback/statistics')
  @ApiOperation({ summary: '获取推荐反馈统计' })
  async getFeedbackStatistics(): Promise<ApiResponse> {
    const data = await this.contentService.getFeedbackStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== AI决策日志 ====================

  @Get('ai-decision-logs')
  @ApiOperation({ summary: '获取AI决策日志列表' })
  async findAiDecisionLogs(@Query() query: GetAiDecisionLogsQueryDto): Promise<ApiResponse> {
    const data = await this.contentService.findAiDecisionLogs(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('ai-decision-logs/statistics')
  @ApiOperation({ summary: '获取AI决策日志统计' })
  async getAiLogStatistics(): Promise<ApiResponse> {
    const data = await this.contentService.getAiLogStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }
}
