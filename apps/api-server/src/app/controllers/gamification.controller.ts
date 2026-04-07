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
import { AppJwtAuthGuard } from '../guards/app-jwt-auth.guard';
import { CurrentAppUser } from '../decorators/current-app-user.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { GamificationService } from '../services/gamification.service';

@ApiTags('App 游戏化')
@Controller('app')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class GamificationController {
  constructor(
    private readonly gamificationService: GamificationService,
  ) {}

  /**
   * 获取成就列表
   * GET /api/app/achievements
   */
  @Get('achievements')
  @ApiOperation({ summary: '获取成就列表' })
  async getAchievements(@CurrentAppUser() user: any): Promise<ApiResponse> {
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
  async getChallenges(@CurrentAppUser() user: any): Promise<ApiResponse> {
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '参加挑战' })
  async joinChallenge(
    @CurrentAppUser() user: any,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const userChallenge = await this.gamificationService.joinChallenge(user.id, id);
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
  async getStreak(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const data = await this.gamificationService.getStreakStatus(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
