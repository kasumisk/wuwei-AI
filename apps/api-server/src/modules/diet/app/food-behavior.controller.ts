import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';
import { BehaviorService } from './behavior.service';
import { DecisionFeedbackDto } from './food.dto';

@ApiTags('App 行为建模')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodBehaviorController {
  constructor(private readonly behaviorService: BehaviorService) {}

  /**
   * 获取行为画像
   * GET /api/app/food/behavior-profile
   */
  @Get('behavior-profile')
  @ApiOperation({ summary: '获取用户行为画像' })
  async getBehaviorProfile(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const profile = await this.behaviorService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: profile,
    };
  }

  /**
   * 主动提醒检查
   * GET /api/app/food/proactive-check
   */
  @Get('proactive-check')
  @ApiOperation({ summary: '主动提醒检查' })
  async proactiveCheck(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const reminder = await this.behaviorService.proactiveCheck(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '检查完成',
      data: { reminder },
    };
  }

  /**
   * AI 决策反馈
   * POST /api/app/food/decision-feedback
   */
  @Post('decision-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI 决策反馈' })
  async decisionFeedback(
    @Body() dto: DecisionFeedbackDto,
  ): Promise<ApiResponse> {
    await this.behaviorService.logFeedback(
      dto.recordId,
      dto.followed,
      dto.feedback,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '反馈已记录',
      data: null,
    };
  }
}
