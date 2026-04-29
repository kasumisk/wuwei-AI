/**
 * 图片分析 prompt 构建
 *
 * 把原 image-food-analysis.service.ts 中重复出现两次（executeAnalysisBundle / analyzeImageToFoods）
 * 的 prompt 拼装逻辑提取为单一来源。
 *
 * 输入：userId + locale
 * 输出：systemPrompt（送给 Vision API）和派生的 userId/goalType（供调用方做评分等后续处理）。
 */
import { Injectable } from '@nestjs/common';
import { BehaviorService } from '../../../../diet/app/services/behavior.service';
import { UserContextBuilderService } from '../../../../decision/analyze/user-context-builder.service';
import { buildTonePrompt } from '../../../../coach/app/config/coach-tone.config';
import { AnalysisPromptSchemaService } from '../analysis-prompt-schema.service';
import type { Locale } from '../../../../diet/app/recommendation/utils/i18n-messages';

export interface BuiltImagePrompt {
  systemPrompt: string;
  goalType: string;
  profile: any;
  healthConditions: string[];
  nutritionPriority: string[];
  budgetStatus: string;
}

@Injectable()
export class ImagePromptBuilder {
  constructor(
    private readonly behaviorService: BehaviorService,
    private readonly userContextBuilder: UserContextBuilderService,
    private readonly promptSchema: AnalysisPromptSchemaService,
  ) {}

  async build(
    userId: string | undefined,
    locale?: Locale,
  ): Promise<BuiltImagePrompt> {
    const ctx = await this.userContextBuilder.build(userId);
    const userContext = this.userContextBuilder.formatAsPromptString(ctx);

    const [behaviorContext, personaPrompt] = await Promise.all([
      this.loadBehaviorContext(userId),
      this.loadPersonaPrompt(userId, ctx.goalType, locale),
    ]);

    const userContextBlock = this.promptSchema.buildUserContextPrompt({
      goalType: ctx.goalType,
      nutritionPriority: ctx.nutritionPriority || [],
      healthConditions: ctx.healthConditions || [],
      budgetStatus: ctx.budgetStatus || 'under_target',
      locale,
    });

    const fullContext = [
      personaPrompt,
      userContext,
      behaviorContext,
      userContextBlock,
    ]
      .filter(Boolean)
      .join('\n\n');

    return {
      systemPrompt: this.promptSchema.buildGoalAwarePrompt(
        ctx.goalType,
        fullContext,
        locale,
      ),
      goalType: ctx.goalType,
      profile: ctx.profile,
      healthConditions: ctx.healthConditions || [],
      nutritionPriority: ctx.nutritionPriority || [],
      budgetStatus: ctx.budgetStatus || 'under_target',
    };
  }

  private async loadBehaviorContext(userId?: string): Promise<string> {
    if (!userId) return '';
    return this.behaviorService.getBehaviorContext(userId).catch(() => '');
  }

  private async loadPersonaPrompt(
    userId: string | undefined,
    goalType: string,
    locale?: Locale,
  ): Promise<string> {
    if (!userId) return '';
    const profile = await this.behaviorService
      .getProfile(userId)
      .catch(() => null);
    const style = profile?.coachStyle || 'friendly';
    return buildTonePrompt(style, goalType, locale);
  }
}
