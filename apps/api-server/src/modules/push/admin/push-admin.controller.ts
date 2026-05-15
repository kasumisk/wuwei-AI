import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '../../../common/types/response.type';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { PushService } from '../push.service';
import { PushScheduler } from '../push-scheduler.service';
import { PushNotificationType } from '../push.types';

@ApiTags('管理后台 - Push')
@Controller('admin/push')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class PushAdminController {
  constructor(
    private readonly pushService: PushService,
    private readonly pushScheduler: PushScheduler,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: '获取 push 总览' })
  async getOverview(): Promise<ApiResponse> {
    const data = await this.pushService.getAdminOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Push 总览成功',
      data,
    };
  }

  @Get('devices')
  @ApiOperation({ summary: '获取 push 设备 token 列表' })
  async getDevices(
    @Query('userId') userId?: string,
    @Query('providerType') providerType?: string,
    @Query('pushRegion') pushRegion?: string,
    @Query('isActive') isActive?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    const data = await this.pushService.getAdminDevices({
      userId,
      providerType,
      pushRegion,
      isActive,
      limit,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Push 设备成功',
      data,
    };
  }

  @Get('logs')
  @ApiOperation({ summary: '获取 push 发送日志' })
  async getLogs(
    @Query('userId') userId?: string,
    @Query('notificationType') notificationType?: string,
    @Query('providerType') providerType?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    const data = await this.pushService.getAdminLogs({
      userId,
      notificationType,
      providerType,
      status,
      limit,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Push 日志成功',
      data,
    };
  }

  @Get('users/:userId/detail')
  @ApiOperation({ summary: '获取用户 push 偏好与最近设备/日志详情' })
  async getUserDetail(@Param('userId') userId: string): Promise<ApiResponse> {
    const data = await this.pushService.getAdminUserDetail(userId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Push 用户详情成功',
      data,
    };
  }

  @Get('providers/health')
  @ApiOperation({ summary: '获取 provider 健康与 fallback 信息' })
  async getProviderHealth(): Promise<ApiResponse> {
    const data = await this.pushService.getAdminProviderHealth();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 Push Provider 健康状态成功',
      data,
    };
  }

  @Delete('devices/:id')
  @ApiOperation({ summary: '禁用 push token' })
  async disableDevice(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.pushService.disableAdminDevice(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '禁用 Push token 成功',
      data,
    };
  }

  @Post('cron/trigger')
  @ApiOperation({ summary: '手动触发 push cron 任务' })
  async triggerCron(
    @Body()
    body: {
      cronName:
        | 'push.daily-check-in'
        | 'push.no-analysis-today'
        | 'push.weekly-report-ready';
    },
  ): Promise<ApiResponse> {
    const ctx = {
      trigger: 'manual' as const,
      triggeredAt: new Date().toISOString(),
    };

    switch (body.cronName) {
      case 'push.daily-check-in':
        await this.pushScheduler.runDailyCheckIn(ctx);
        break;
      case 'push.no-analysis-today':
        await this.pushScheduler.runNoAnalysisToday(ctx);
        break;
      case 'push.weekly-report-ready':
        await this.pushScheduler.runWeeklyReportReady(ctx);
        break;
    }

    return {
      success: true,
      code: HttpStatus.OK,
      message: 'Push cron 手动触发成功',
      data: {
        cronName: body.cronName,
        triggeredAt: ctx.triggeredAt,
      },
    };
  }

  @Post('logs/:id/retry')
  @ApiOperation({ summary: '重试失败 push 日志' })
  async retryLog(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.pushService.retryAdminLog(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'Push 日志重试成功',
      data,
    };
  }

  @Post('maintenance/cleanup-invalid-tokens')
  @ApiOperation({ summary: '批量清理无效 push token' })
  async cleanupInvalidTokens(
    @Body() body?: { limit?: number },
  ): Promise<ApiResponse> {
    const data = await this.pushService.cleanupInvalidTokens(body?.limit);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '无效 Push token 清理完成',
      data,
    };
  }

  @Post('test')
  @ApiOperation({ summary: '管理后台发送测试 push' })
  async testPush(
    @Body()
    body: {
      userId: string;
      type?: PushNotificationType;
      payload?: Record<string, string | number | boolean | null>;
    },
  ): Promise<ApiResponse> {
    const data = await this.pushService.send({
      userId: body.userId,
      type: body.type ?? PushNotificationType.DAILY_CHECK_IN,
      payload: { target: 'home', ...body.payload },
      force: true,
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: '测试 Push 已提交',
      data,
    };
  }
}
