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
  GetPaymentRecordsQueryDto,
  GetUsageQuotasQueryDto,
  GetTriggerStatsQueryDto,
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
}
