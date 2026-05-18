import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../../common/types/response.type';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import {
  AddAdminFeedbackNoteDto,
  GetAdminFeedbackQueryDto,
  UpdateAdminFeedbackStatusDto,
} from '../dto/feedback.dto';
import { FeedbackService } from '../feedback.service';
import { CurrentUser } from '../../auth/admin/current-user.decorator';

@ApiTags('管理后台 - 用户反馈')
@Controller('admin/feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FeedbackAdminController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get('statistics')
  @ApiOperation({ summary: '获取用户反馈统计' })
  async getStatistics(): Promise<ApiResponse> {
    const data = await this.feedbackService.getAdminStats();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户反馈统计成功',
      data,
    };
  }

  @Get()
  @ApiOperation({ summary: '获取用户反馈列表' })
  async findAll(@Query() query: GetAdminFeedbackQueryDto): Promise<ApiResponse> {
    const data = await this.feedbackService.findAdminList(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户反馈列表成功',
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取用户反馈详情' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.feedbackService.findAdminOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户反馈详情成功',
      data,
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新用户反馈处理状态' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAdminFeedbackStatusDto,
  ): Promise<ApiResponse> {
    const data = await this.feedbackService.updateAdminStatus(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新用户反馈状态成功',
      data,
    };
  }

  @Patch(':id/notes')
  @ApiOperation({ summary: '添加用户反馈跟进记录' })
  async addNote(
    @Param('id') id: string,
    @Body() dto: AddAdminFeedbackNoteDto,
    @CurrentUser() user: { id?: string; username?: string; role?: string },
  ): Promise<ApiResponse> {
    const data = await this.feedbackService.addAdminNote(id, dto, user);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '添加用户反馈跟进记录成功',
      data,
    };
  }
}
