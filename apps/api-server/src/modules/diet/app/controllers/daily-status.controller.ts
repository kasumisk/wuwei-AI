import { Controller, Get, Query, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../../common/types/response.type';
import { I18nService } from '../../../../core/i18n';
import { DailyStatusQueryDto } from '../dto/daily-status.dto';
import { DailyStatusService } from '../services/daily-status.service';

@ApiTags('App 每日状态')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class DailyStatusController {
  constructor(
    private readonly dailyStatusService: DailyStatusService,
    private readonly i18n: I18nService,
  ) {}

  @Get('daily-status')
  @ApiOperation({ summary: '获取指定日期首页状态' })
  async getDailyStatus(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: DailyStatusQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.dailyStatusService.getStatus(user.id, query.date, {
      timezone: query.timezone,
      records: query.records ?? 'compact',
    });
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('common.ok'),
      data,
    };
  }
}
