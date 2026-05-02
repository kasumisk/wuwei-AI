/**
 * V6 Phase 1.11 — 通知 App 控制器
 *
 * 提供给 App 端的通知 API:
 * - GET  /api/app/notifications          获取站内信列表（分页）
 * - GET  /api/app/notifications/unread    获取未读数量
 * - POST /api/app/notifications/:id/read  标记单条已读
 * - POST /api/app/notifications/read-all  标记全部已读
 * - POST /api/app/notifications/device    注册设备推送令牌
 * - DELETE /api/app/notifications/device  注销设备推送令牌
 * - GET  /api/app/notifications/preference  获取通知偏好
 * - PUT  /api/app/notifications/preference  更新通知偏好
 */
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { NotificationService } from './notification.service';
import { DevicePlatform } from '../notification.types';
import {
  ResponseWrapper,
  ApiResponse,
} from '../../../common/types/response.type';
import { I18nService } from '../../../core/i18n/i18n.service';

// ─── DTO ───

class RegisterDeviceDto {
  @IsString()
  token: string;

  @IsString()
  deviceId: string;

  @IsIn(['ios', 'android', 'web'])
  platform: DevicePlatform;
}

class DeactivateDeviceDto {
  @IsString()
  deviceId: string;
}

class UpdatePreferenceDto {
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledTypes?: string[];

  @IsOptional()
  @IsString()
  quietStart?: string;

  @IsOptional()
  @IsString()
  quietEnd?: string;
}

class NotificationListQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

@ApiTags('App 通知')
@Controller('app/notifications')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly i18n: I18nService,
  ) {}

  // ─── 站内信 ───

  @Get()
  @ApiOperation({ summary: '获取站内信列表（分页）' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getNotifications(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: NotificationListQueryDto,
  ): Promise<ApiResponse> {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 50);
    const data = await this.notificationService.getNotifications(
      user.id,
      page,
      limit,
    );
    return ResponseWrapper.success(
      data,
      this.i18n.t('notification.message.fetchSuccess'),
    );
  }

  @Get('unread')
  @ApiOperation({ summary: '获取未读通知数量' })
  async getUnreadCount(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const count = await this.notificationService.getUnreadCount(user.id);
    return ResponseWrapper.success(
      { unreadCount: count },
      this.i18n.t('notification.message.fetchSuccess'),
    );
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '标记单条通知为已读' })
  async markAsRead(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.notificationService.markAsRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记全部通知为已读' })
  async markAllAsRead(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const count = await this.notificationService.markAllAsRead(user.id);
    return ResponseWrapper.success(
      { markedCount: count },
      this.i18n.t('notification.message.operationSuccess'),
    );
  }

  // ─── 设备令牌 ───

  @Post('device')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '注册/更新推送设备令牌' })
  async registerDevice(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: RegisterDeviceDto,
  ): Promise<ApiResponse> {
    const token = await this.notificationService.registerDeviceToken(
      user.id,
      dto.token,
      dto.deviceId,
      dto.platform,
    );
    return ResponseWrapper.success(
      {
        id: token.id,
        deviceId: token.deviceId,
        platform: token.platform,
      },
      this.i18n.t('notification.message.registerSuccess'),
    );
  }

  @Delete('device')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '注销推送设备令牌（登出时调用）' })
  async deactivateDevice(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: DeactivateDeviceDto,
  ): Promise<void> {
    await this.notificationService.deactivateDeviceToken(user.id, dto.deviceId);
  }

  // ─── 通知偏好 ───

  @Get('preference')
  @ApiOperation({ summary: '获取通知偏好设置' })
  async getPreference(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const pref = await this.notificationService.getPreference(user.id);
    return ResponseWrapper.success(
      {
        pushEnabled: pref.pushEnabled,
        enabledTypes: pref.enabledTypes,
        quietStart: pref.quietStart,
        quietEnd: pref.quietEnd,
      },
      this.i18n.t('notification.message.fetchSuccess'),
    );
  }

  @Put('preference')
  @ApiOperation({ summary: '更新通知偏好设置' })
  async updatePreference(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: UpdatePreferenceDto,
  ): Promise<ApiResponse> {
    const updates: Partial<{
      pushEnabled: boolean;
      enabledTypes: string[];
      quietStart: string | null;
      quietEnd: string | null;
    }> = {};
    if (dto.pushEnabled !== undefined) updates.pushEnabled = dto.pushEnabled;
    if (dto.enabledTypes !== undefined) updates.enabledTypes = dto.enabledTypes;
    if (dto.quietStart !== undefined) updates.quietStart = dto.quietStart;
    if (dto.quietEnd !== undefined) updates.quietEnd = dto.quietEnd;

    const pref = await this.notificationService.updatePreference(
      user.id,
      updates,
    );
    return ResponseWrapper.success(
      {
        pushEnabled: pref.pushEnabled,
        enabledTypes: pref.enabledTypes,
        quietStart: pref.quietStart,
        quietEnd: pref.quietEnd,
      },
      this.i18n.t('notification.message.updateSuccess'),
    );
  }
}
