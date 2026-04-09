import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { UserProfileService } from './user-profile.service';
import { ProfileInferenceService } from './profile-inference.service';
import { CollectionTriggerService } from './collection-trigger.service';
import {
  OnboardingStep1Dto,
  OnboardingStep2Dto,
  OnboardingStep3Dto,
  OnboardingStep4Dto,
  UpdateDeclaredProfileDto,
} from './dto/user-profile.dto';

@ApiTags('用户画像')
@Controller('app/user-profile')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class UserProfileController {
  constructor(
    private readonly userProfileService: UserProfileService,
    private readonly profileInferenceService: ProfileInferenceService,
    private readonly collectionTriggerService: CollectionTriggerService,
  ) {}

  // ==================== 引导流 API ====================

  /**
   * 分步保存引导数据
   * POST /api/app/user-profile/onboarding/step/:step
   */
  @Post('onboarding/step/:step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '分步保存引导数据（step 1-4）' })
  async saveOnboardingStep(
    @Param('step', ParseIntPipe) step: number,
    @Body() body: any,
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    if (step < 1 || step > 4) {
      throw new BadRequestException('Step 必须为 1-4');
    }

    // 根据步骤验证具体的 DTO 类型由 pipe 处理，这里按步骤转换
    const result = await this.userProfileService.saveOnboardingStep(
      user.id,
      step,
      body,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: `步骤 ${step} 保存成功`,
      data: result,
    };
  }

  /**
   * 跳过引导步骤
   * POST /api/app/user-profile/onboarding/skip/:step
   */
  @Post('onboarding/skip/:step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '跳过引导步骤（仅 step 3-4 可跳过）' })
  async skipOnboardingStep(
    @Param('step', ParseIntPipe) step: number,
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    if (step < 3 || step > 4) {
      throw new BadRequestException('仅 Step 3 和 Step 4 可跳过');
    }

    const result = await this.userProfileService.skipOnboardingStep(
      user.id,
      step,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: `步骤 ${step} 已跳过`,
      data: result,
    };
  }

  // ==================== 档案管理 API ====================

  /**
   * 获取完整画像（声明 + 行为 + 推断 + 元数据）
   * GET /api/app/user-profile/full
   */
  @Get('full')
  @ApiOperation({ summary: '获取完整用户画像（三层聚合）' })
  async getFullProfile(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const profile = await this.userProfileService.getFullProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: profile,
    };
  }

  /**
   * 更新声明数据（部分更新）
   * PATCH /api/app/user-profile/declared
   */
  @Patch('declared')
  @ApiOperation({ summary: '更新声明数据（部分更新）' })
  async updateDeclaredProfile(
    @Body() dto: UpdateDeclaredProfileDto,
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.updateDeclaredProfile(
      user.id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新成功',
      data: profile,
    };
  }

  /**
   * 获取补全建议
   * GET /api/app/user-profile/completion-suggestions
   */
  @Get('completion-suggestions')
  @ApiOperation({ summary: '获取档案补全建议' })
  async getCompletionSuggestions(
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    const result = await this.userProfileService.getCompletionSuggestions(
      user.id,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: result,
    };
  }

  // ==================== 推断 API ====================

  /**
   * 手动触发推断更新
   * POST /api/app/user-profile/infer/refresh
   */
  @Post('infer/refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动触发推断数据更新' })
  async refreshInference(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const inferred = await this.profileInferenceService.refreshInference(
      user.id,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '推断已更新',
      data: inferred,
    };
  }

  /**
   * 获取目标迁移建议
   * GET /api/app/user-profile/goal-transition
   */
  @Get('goal-transition')
  @ApiOperation({ summary: '获取目标迁移建议' })
  async getGoalTransitionSuggestion(
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    const suggestion =
      await this.profileInferenceService.getGoalTransitionSuggestion(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: suggestion,
    };
  }

  // ==================== 持续收集 API ====================

  /**
   * 获取字段收集提醒
   * GET /api/app/user-profile/collection-triggers
   */
  @Get('collection-triggers')
  @ApiOperation({ summary: '获取字段收集提醒（App 打开时调用）' })
  async getCollectionTriggers(
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    const reminders =
      await this.collectionTriggerService.checkCollectionTriggers(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: reminders,
    };
  }
}
