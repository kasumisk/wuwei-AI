import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { GamificationService } from '../services/gamification.service';

@ApiTags('Gamification')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/gamification')
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  @Get('achievements')
  @ApiOperation({ summary: '获取用户成就列表' })
  getAchievements(@CurrentUser('id') userId: string) {
    return this.gamificationService.getUserAchievements(userId);
  }

  @Get('challenges')
  @ApiOperation({ summary: '获取可用挑战' })
  getActiveChallenges() {
    return this.gamificationService.getActiveChallenges();
  }

  @Get('challenges/mine')
  @ApiOperation({ summary: '获取我参加的挑战' })
  getMyChallenges(@CurrentUser('id') userId: string) {
    return this.gamificationService.getUserChallenges(userId);
  }

  @Post('challenges/:id/join')
  @ApiOperation({ summary: '参加挑战' })
  joinChallenge(
    @CurrentUser('id') userId: string,
    @Param('id') challengeId: string,
  ) {
    return this.gamificationService.joinChallenge(userId, challengeId);
  }

  @Post('challenges/:id/progress')
  @ApiOperation({ summary: '更新挑战进度' })
  updateProgress(
    @CurrentUser('id') userId: string,
    @Param('id') userChallengeId: string,
    @Body() body: { increment?: number },
  ) {
    return this.gamificationService.updateProgress(userId, userChallengeId, body.increment);
  }
}
