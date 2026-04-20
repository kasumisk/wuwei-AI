import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';
import { GamificationService } from './gamification.service';
import { RequireFeature } from '../../subscription/app/decorators/require-feature.decorator';
import { GatedFeature } from '../../subscription/subscription.types';

@ApiTags('App 游戏化')
@Controller('app')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  /**
   * 获取成就列表
   * GET /api/app/achievements
   */
  @Get('achievements')
  @ApiOperation({ summary: '获取成就列表' })
  async getAchievements(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.gamificationService.getAchievements(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * 获取挑战列表
   * GET /api/app/challenges
   */
  @Get('challenges')
  @ApiOperation({ summary: '获取挑战列表' })
  async getChallenges(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.gamificationService.getChallenges(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * 参加挑战
   * POST /api/app/challenges/:id/join
   */
  @Post('challenges/:id/join')
  @RequireFeature(GatedFeature.ADVANCED_CHALLENGES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '参加挑战' })
  async joinChallenge(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const userChallenge = await this.gamificationService.joinChallenge(
      user.id,
      id,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '已参加挑战',
      data: userChallenge,
    };
  }

  /**
   * 获取连胜状态
   * GET /api/app/streak
   */
  @Get('streak')
  @ApiOperation({ summary: '获取连胜状态' })
  async getStreak(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.gamificationService.getStreakStatus(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
