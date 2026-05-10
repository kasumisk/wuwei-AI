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
import { UserContextBuilderService } from '../../../../decision/analyze/user-context-builder.service';
import { AnalysisPromptSchemaService } from '../analysis-prompt-schema.service';
import type { Locale } from '../../../../diet/app/recommendation/utils/i18n-messages';
import type { UnifiedUserContext } from '../../../../decision/types/analysis-result.types';

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
    private readonly userContextBuilder: UserContextBuilderService,
    private readonly promptSchema: AnalysisPromptSchemaService,
  ) {}

  async build(
    userId: string | undefined,
    locale?: Locale,
    prebuiltCtx?: UnifiedUserContext,
  ): Promise<BuiltImagePrompt> {
    const ctx = prebuiltCtx ?? (await this.userContextBuilder.build(userId));

    // Vision API is used only for food recognition + weight estimation.
    // Coaching context belongs in the decision pipeline — NOT here. Including it
    // causes the model to generate 1000+ coaching tokens instead of the ~100
    // needed for food identification, inflating latency from ~1s to 9-23s.
    return {
      systemPrompt: this.promptSchema.buildPhase1Prompt(locale),
      goalType: ctx.goalType,
      profile: ctx.profile,
      healthConditions: ctx.healthConditions || [],
      nutritionPriority: ctx.nutritionPriority || [],
      budgetStatus: ctx.budgetStatus || 'under_target',
    };
  }
}
