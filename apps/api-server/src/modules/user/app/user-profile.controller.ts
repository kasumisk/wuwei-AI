import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
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
  UpdateRecommendationPreferencesDto,
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
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    body:
      | OnboardingStep1Dto
      | OnboardingStep2Dto
      | OnboardingStep3Dto
      | OnboardingStep4Dto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    if (step < 1 || step > 4) {
      throw new BadRequestException('Step 必须为 1-4');
    }

    // NestJS ValidationPipe 在 union type 下不会按 step 选择 DTO，
    // 需要手动用 plainToInstance + validate 来按步骤验证
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');

    const dtoClassMap: Record<number, new () => any> = {
      1: OnboardingStep1Dto,
      2: OnboardingStep2Dto,
      3: OnboardingStep3Dto,
      4: OnboardingStep4Dto,
    };
    const DtoClass = dtoClassMap[step];
    const dtoInstance = plainToInstance(DtoClass, body);
    const errors = await validate(dtoInstance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      const messages = errors
        .map((e) => Object.values(e.constraints || {}).join(', '))
        .join('; ');
      throw new BadRequestException(`步骤 ${step} 数据验证失败: ${messages}`);
    }

    const result = await this.userProfileService.saveOnboardingStep(
      user.id,
      step,
      dtoInstance,
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
    @CurrentAppUser() user: AppUserPayload,
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
  async getFullProfile(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
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
    @CurrentAppUser() user: AppUserPayload,
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

  // ==================== V6.5 推荐偏好 API ====================

  /**
   * 更新推荐偏好设置
   * PUT /api/app/user-profile/recommendation-preferences
   *
   * 三个维度均为可选：
   * - popularityPreference: popular / balanced / adventurous
   * - cookingEffort: quick / moderate / elaborate
   * - budgetSensitivity: budget / moderate / unlimited
   */
  @Put('recommendation-preferences')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '更新推荐偏好设置（大众化/烹饪投入/预算）' })
  async updateRecommendationPreferences(
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: UpdateRecommendationPreferencesDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const prefs = await this.userProfileService.updateRecommendationPreferences(
      user.id,
      dto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '推荐偏好更新成功',
      data: prefs,
    };
  }

  /**
   * 获取推荐偏好设置
   * GET /api/app/user-profile/recommendation-preferences
   */
  @Get('recommendation-preferences')
  @ApiOperation({ summary: '获取推荐偏好设置' })
  async getRecommendationPreferences(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const prefs = await this.userProfileService.getRecommendationPreferences(
      user.id,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: prefs,
    };
  }

  /**
   * 获取补全建议
   * GET /api/app/user-profile/completion-suggestions
   */
  @Get('completion-suggestions')
  @ApiOperation({ summary: '获取档案补全建议' })
  async getCompletionSuggestions(
    @CurrentAppUser() user: AppUserPayload,
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
  async refreshInference(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
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
    @CurrentAppUser() user: AppUserPayload,
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
    @CurrentAppUser() user: AppUserPayload,
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
