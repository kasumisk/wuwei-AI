import { Controller, Get, Put, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { UserProfileService } from '../services/user-profile.service';
import { UpdateProfileDto, OnboardingStepDto } from '../dto/user-profile.dto';

@ApiTags('User Profile')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/profile')
export class UserProfileController {
  constructor(private readonly profileService: UserProfileService) {}

  @Get()
  @ApiOperation({ summary: '获取用户档案' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.profileService.getOrCreate(userId);
  }

  @Put()
  @ApiOperation({ summary: '更新用户档案' })
  updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.profileService.update(userId, dto);
  }

  @Post('onboarding')
  @ApiOperation({ summary: '引导步骤提交' })
  onboardingStep(
    @CurrentUser('id') userId: string,
    @Body() dto: OnboardingStepDto,
  ) {
    return this.profileService.onboardingStep(userId, dto);
  }

  @Get('behavior')
  @ApiOperation({ summary: '获取行为画像' })
  getBehavior(@CurrentUser('id') userId: string) {
    return this.profileService.getBehavior(userId);
  }

  @Get('completeness')
  @ApiOperation({ summary: '获取档案完整度' })
  async getCompleteness(@CurrentUser('id') userId: string) {
    const profile = await this.profileService.getOrCreate(userId);
    const completeness = this.profileService.getProfileCompleteness(profile);
    return { completeness };
  }
}
