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
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { SubscriptionManagementService } from './subscription-management.service';
import {
  GetSubscriptionPlansQueryDto,
  CreateSubscriptionPlanDto,
  UpdateSubscriptionPlanDto,
  GetSubscriptionsQueryDto,
  ExtendSubscriptionDto,
  ChangeSubscriptionPlanDto,
  SubscriptionResyncDto,
  AdminSubscriptionActionDto,
  GrantManualEntitlementDto,
  RevokeManualEntitlementDto,
  GetPaymentRecordsQueryDto,
  GetUsageQuotasQueryDto,
  GetTriggerStatsQueryDto,
  GetSubscriptionTimelineQueryDto,
  GetSubscriptionAnomaliesQueryDto,
  GetSubscriptionMaintenanceJobsQueryDto,
  GetSubscriptionMaintenanceDlqQueryDto,
} from './dto/subscription-management.dto';
import { ApiResponse } from '../../../common/types/response.type';
import { I18nService } from '../../../core/i18n/i18n.service';

@ApiTags('管理后台 - 订阅管理')
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class SubscriptionManagementController {
  constructor(
    private readonly subscriptionManagementService: SubscriptionManagementService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 订阅计划管理 ====================

  @Get('plans')
  @ApiOperation({ summary: '获取订阅计划列表' })
  async findPlans(
    @Query() query: GetSubscriptionPlansQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.findPlans(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchPlansSuccess'),
      data,
    };
  }

  @Post('plans')
  @ApiOperation({ summary: '创建订阅计划' })
  async createPlan(
    @Body() dto: CreateSubscriptionPlanDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.createPlan(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('subscription.controller.createPlanSuccess'),
      data,
    };
  }

  @Get('plans/:id')
  @ApiOperation({ summary: '查询单个订阅计划' })
  async findPlanById(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.findPlanById(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Put('plans/:id')
  @ApiOperation({ summary: '更新订阅计划' })
  async updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionPlanDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.updatePlan(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.updatePlanSuccess'),
      data,
    };
  }

  // ==================== 订阅概览统计 ====================

  @Get('overview')
  @ApiOperation({ summary: '获取订阅概览统计' })
  async getOverview(): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionOverview();
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchOverviewSuccess'),
      data,
    };
  }

  // ==================== 支付记录 ====================

  @Get('payments')
  @ApiOperation({ summary: '获取支付记录列表' })
  async findPaymentRecords(
    @Query() query: GetPaymentRecordsQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.findPaymentRecords(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchPaymentsSuccess'),
      data,
    };
  }

  // ==================== 用量配额 ====================

  @Get('usage-quotas')
  @ApiOperation({ summary: '获取用户用量配额' })
  async getUserUsageQuotas(
    @Query() query: GetUsageQuotasQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getUserUsageQuotas(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchQuotaSuccess'),
      data,
    };
  }

  @Put('usage-quotas/:id/reset')
  @ApiOperation({ summary: '重置用量配额' })
  async resetUsageQuota(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.resetUsageQuota(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.resetQuotaSuccess'),
      data,
    };
  }

  // ==================== 付费墙触发统计 ====================

  @Get('trigger-stats')
  @ApiOperation({ summary: '获取付费墙触发统计' })
  async getTriggerStats(
    @Query() query: GetTriggerStatsQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getTriggerStats(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchTriggerStatsSuccess'),
      data,
    };
  }

  @Get('anomalies')
  @ApiOperation({ summary: '获取订阅异常看板' })
  async getSubscriptionAnomalies(
    @Query() query: GetSubscriptionAnomaliesQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionAnomalies(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Get('maintenance/jobs')
  @ApiOperation({ summary: '获取订阅维护任务列表' })
  async getSubscriptionMaintenanceJobs(
    @Query() query: GetSubscriptionMaintenanceJobsQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionMaintenanceJobs(
        query,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Get('maintenance/jobs/:jobId')
  @ApiOperation({ summary: '获取订阅维护任务详情' })
  async getSubscriptionMaintenanceJob(
    @Param('jobId') jobId: string,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionMaintenanceJob(
        jobId,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Get('maintenance/dlq')
  @ApiOperation({ summary: '获取订阅维护 DLQ 列表' })
  async getSubscriptionMaintenanceDlq(
    @Query() query: GetSubscriptionMaintenanceDlqQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionMaintenanceDlq(
        query,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Post('maintenance/dlq/:dlqId/replay')
  @ApiOperation({ summary: '重放订阅维护 DLQ 任务' })
  async replaySubscriptionMaintenanceDlq(
    @Param('dlqId') dlqId: string,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.replaySubscriptionMaintenanceDlq(
        dlqId,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'DLQ 任务已重放',
      data,
    };
  }

  @Post('maintenance/dlq/:dlqId/discard')
  @ApiOperation({ summary: '丢弃订阅维护 DLQ 任务' })
  async discardSubscriptionMaintenanceDlq(
    @Param('dlqId') dlqId: string,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.discardSubscriptionMaintenanceDlq(
        dlqId,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'DLQ 任务已丢弃',
      data,
    };
  }

  @Post('operations/rebuild-entitlements')
  @ApiOperation({ summary: '重建当前有效订阅的用户权益快照' })
  async rebuildUserEntitlements(): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.rebuildUserEntitlements();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '用户权益快照已重建',
      data,
    };
  }

  // ==================== 用户订阅管理 ====================

  @Get()
  @ApiOperation({ summary: '获取用户订阅列表' })
  async findSubscriptions(
    @Query() query: GetSubscriptionsQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.findSubscriptions(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSubsListSuccess'),
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取订阅详情' })
  async getSubscriptionDetail(@Param('id') id: string): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionDetail(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSubsDetailSuccess'),
      data,
    };
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: '获取订阅时间线' })
  async getSubscriptionTimeline(
    @Param('id') id: string,
    @Query() query: GetSubscriptionTimelineQueryDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.getSubscriptionTimeline(
        id,
        query,
      );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Post(':id/resync')
  @ApiOperation({ summary: '手动触发订阅重同步' })
  async resyncSubscription(
    @Param('id') id: string,
    @Body() dto: SubscriptionResyncDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.resyncSubscription(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.fetchSuccess'),
      data,
    };
  }

  @Put(':id/extend')
  @ApiOperation({ summary: '延长订阅' })
  async extendSubscription(
    @Param('id') id: string,
    @Body() dto: ExtendSubscriptionDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.extendSubscription(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.extendSubsSuccess'),
      data,
    };
  }

  @Put(':id/change-plan')
  @ApiOperation({ summary: '变更订阅计划' })
  async changeSubscriptionPlan(
    @Param('id') id: string,
    @Body() dto: ChangeSubscriptionPlanDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.changeSubscriptionPlan(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('subscription.controller.changePlanSuccess'),
      data,
    };
  }

  @Post(':id/refund')
  @ApiOperation({ summary: '标记订阅为退款并撤销权益' })
  async refundSubscription(
    @Param('id') id: string,
    @Body() dto: AdminSubscriptionActionDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.refundSubscription(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '订阅已标记为退款',
      data,
    };
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: '撤销订阅访问权限' })
  async revokeSubscription(
    @Param('id') id: string,
    @Body() dto: AdminSubscriptionActionDto,
  ): Promise<ApiResponse> {
    const data = await this.subscriptionManagementService.revokeSubscription(
      id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '订阅访问权限已撤销',
      data,
    };
  }

  @Post(':id/manual-entitlements')
  @ApiOperation({ summary: '手动授予用户权益' })
  async grantManualEntitlement(
    @Param('id') id: string,
    @Body() dto: GrantManualEntitlementDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.grantManualEntitlement(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '用户权益已授予',
      data,
    };
  }

  @Post(':id/manual-entitlements/revoke')
  @ApiOperation({ summary: '撤销手动授予的用户权益' })
  async revokeManualEntitlement(
    @Param('id') id: string,
    @Body() dto: RevokeManualEntitlementDto,
  ): Promise<ApiResponse> {
    const data =
      await this.subscriptionManagementService.revokeManualEntitlement(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '手动权益已撤销',
      data,
    };
  }
}
