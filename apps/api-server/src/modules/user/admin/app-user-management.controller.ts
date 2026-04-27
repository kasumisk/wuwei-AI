import {
  Controller,
  Get,
  Put,
  Post,
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
import { I18n, I18nContext } from '../../../core/i18n';
import { AppUserManagementService } from './app-user-management.service';
import {
  GetAppUsersQueryDto,
  UpdateAppUserByAdminDto,
} from './dto/app-user-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - App 用户管理')
@Controller('admin/app-users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class AppUserManagementController {
  constructor(
    private readonly appUserManagementService: AppUserManagementService,
  ) {}

  /**
   * 获取 App 用户列表
   */
  @Get()
  @ApiOperation({ summary: '获取 App 用户列表' })
  async findAll(
    @Query() query: GetAppUsersQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.appUserListFetched'),
      data,
    };
  }

  /**
   * 获取 App 用户统计
   */
  @Get('statistics')
  @ApiOperation({ summary: '获取 App 用户统计' })
  async getStatistics(@I18n() i18n: I18nContext): Promise<ApiResponse> {
    const data = await this.appUserManagementService.getStatistics();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.statsFetched'),
      data,
    };
  }

  /**
   * 获取 App 用户详情
   */
  @Get(':id')
  @ApiOperation({ summary: '获取 App 用户详情' })
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.appUserDetailFetched'),
      data,
    };
  }

  /**
   * 更新 App 用户信息
   */
  @Put(':id')
  @ApiOperation({ summary: '更新 App 用户信息' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAppUserByAdminDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.update(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.userUpdated'),
      data,
    };
  }

  /**
   * 封禁 App 用户
   */
  @Post(':id/ban')
  @ApiOperation({ summary: '封禁 App 用户' })
  async ban(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.ban(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }

  /**
   * 解封 App 用户
   */
  @Post(':id/unban')
  @ApiOperation({ summary: '解封 App 用户' })
  async unban(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.unban(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }

  /**
   * 删除 App 用户
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除 App 用户' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }

  /**
   * 获取用户行为画像
   */
  @Get(':id/behavior-profile')
  @ApiOperation({ summary: '获取用户行为画像（食物偏好、依从率、连续打卡等）' })
  async getBehaviorProfile(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.getBehaviorProfile(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.behaviorProfileFetched'),
      data,
    };
  }

  /**
   * 获取用户推断画像
   */
  @Get(':id/inferred-profile')
  @ApiOperation({
    summary: '获取用户推断画像（BMR/TDEE、宏量素目标、流失风险、目标进度等）',
  })
  async getInferredProfile(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.getInferredProfile(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.inferredProfileFetched'),
      data,
    };
  }
}
