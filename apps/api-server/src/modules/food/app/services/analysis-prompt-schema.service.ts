/**
 * V13.3 — Food Analysis Prompt Schema Service
 *
 * Shared prompt schema for text/image food analysis（service 化版本）。
 * 取代旧 analysis-prompt-schema.ts 中的纯函数 + cl()，
 * 改为 @Injectable 注入 I18nService，统一 i18n 路径。
 *
 * Consumers:
 * - text-food-analysis.service.ts
 * - image-prompt.builder.ts
 * - vision-api.client.ts
 */

import { Injectable } from '@nestjs/common';
import {
  type Locale,
  getSupportedLocales,
} from '../../../diet/app/recommendation/utils/i18n-messages';
import { I18nService, I18nLocale } from '../../../../core/i18n';

// ==================== Health Condition Definitions ====================

const LOCALES: I18nLocale[] = ['zh-CN', 'en-US', 'ja-JP'];

/**
 * 健康状况追加指令配置（仅 condition + aliases，文案走 i18n key）
 */
const HEALTH_CONDITION_DEFS: ReadonlyArray<{
  condition: string;
  aliases: string[];
  /** i18n key（会加 'decision.' 前缀） */
  i18nKey: string;
}> = [
  {
    condition: 'diabetes',
    aliases: ['diabetes'],
    i18nKey: 'health.inst.diabetes',
  },
  {
    condition: 'hypertension',
    aliases: ['hypertension'],
    i18nKey: 'health.inst.hypertension',
  },
  {
    condition: 'cardiovascular',
    aliases: ['heart_disease', 'cardiovascular'],
    i18nKey: 'health.inst.cardiovascular',
  },
  { condition: 'gout', aliases: ['gout'], i18nKey: 'health.inst.gout' },
  { condition: 'ibs', aliases: ['IBS'], i18nKey: 'health.inst.ibs' },
  {
    condition: 'kidney_stones',
    aliases: ['kidney_stones'],
    i18nKey: 'health.inst.kidney_stones',
  },
  {
    condition: 'hyperlipidemia',
    aliases: ['hyperlipidemia'],
    i18nKey: 'health.inst.hyperlipidemia',
  },
];

interface HealthEstimationInstruction {
  condition: string;
  aliases: string[];
  instruction: Record<string, string>;
}

const FALLBACK_LOCALE: Locale = 'en-US';

// ==================== Service ====================

@Injectable()
export class AnalysisPromptSchemaService {
  /** 缓存：首次构造后复用 */
  private healthConditionCache: HealthEstimationInstruction[] | null = null;

  constructor(private readonly i18n: I18nService) {}

  // ─── Internal helpers ───

  private resolvePromptLocale(locale?: Locale): Locale {
    const resolvedLocale = locale ?? FALLBACK_LOCALE;
    return getSupportedLocales().includes(resolvedLocale)
      ? resolvedLocale
      : FALLBACK_LOCALE;
  }

  private getHealthConditionInstructions(): HealthEstimationInstruction[] {
    if (this.healthConditionCache) return this.healthConditionCache;
    this.healthConditionCache = HEALTH_CONDITION_DEFS.map((def) => ({
      condition: def.condition,
      aliases: def.aliases,
      instruction: Object.fromEntries(
        LOCALES.map((l) => [l, this.i18n.t(`decision.${def.i18nKey}`, l)]),
      ),
    }));
    return this.healthConditionCache;
  }

  // ─── Public API ───

  /**
   * Get LLM user message for text or image analysis
   */
  getUserMessage(
    mode: 'text' | 'image',
    input: string,
    locale?: Locale,
  ): string {
    const key =
      mode === 'text'
        ? 'decision.prompt.userMessage.text'
        : 'decision.prompt.userMessage.image';
    const loc = (locale ?? this.i18n.currentLocale()) as I18nLocale;
    // Templates use {{input}} (text mode) and {{hint}} (image mode); pass both.
    return this.i18n.t(key, loc, { input, hint: input });
  }

  /**
   * Build complete food analysis base prompt (unified system role + JSON schema + rules + name-field constraint)
   */
  buildBasePrompt(_mode?: 'text' | 'image', locale?: Locale): string {
    const loc = (locale ?? this.i18n.currentLocale()) as I18nLocale;
    return [
      this.i18n.t('decision.prompt.systemRole', loc),
      '',
      this.i18n.t('decision.prompt.jsonOnly', loc),
      this.i18n.t('decision.prompt.schema.foods', loc),
      '',
      this.i18n.t('decision.prompt.rules', loc),
      '',
      this.i18n.t('decision.prompt.nameField', loc),
    ].join('\n');
  }

  /**
   * Get goal-specific focus block for prompt
   */
  getGoalFocusBlock(goalType: string, locale?: Locale): string {
    const loc = this.resolvePromptLocale(locale) as I18nLocale;
    // i18n-allow-dynamic
    const key = `decision.goal.focus.${goalType}`;
    const result = this.i18n.t(key, loc);
    // 未命中时 t() 返回 key 字面量；fallback 到 health
    return result === key
      ? this.i18n.t('decision.goal.focus.health', loc)
      : result;
  }

  /**
   * Build unified user context prompt block
   */
  buildUserContextPrompt(params: {
    goalType: string;
    nutritionPriority: string[];
    healthConditions: string[];
    budgetStatus: string;
    remainingCalories?: number;
    remainingProtein?: number;
    locale?: Locale;
  }): string {
    const loc = this.resolvePromptLocale(params.locale) as I18nLocale;
    const lines: string[] = [this.i18n.t('decision.header.context', loc)];

    // Goal
    // i18n-allow-dynamic
    const goalKey = `decision.goal.label.${params.goalType}`;
    const goalLabelRaw = this.i18n.t(goalKey, loc);
    const goalLabel =
      goalLabelRaw === goalKey
        ? this.i18n.t('decision.goal.label.health', loc)
        : goalLabelRaw;
    lines.push(
      `- ${this.i18n.t('decision.prompt.contextLabel.goal', loc, { label: goalLabel })}`,
    );

    // Budget status
    if (params.budgetStatus === 'over_limit') {
      lines.push(`- ⚠️ ${this.i18n.t('decision.budget.over_limit', loc)}`);
    } else if (params.budgetStatus === 'near_limit') {
      lines.push(`- ${this.i18n.t('decision.prompt.nearLimit', loc)}`);
    } else if (params.remainingCalories && params.remainingCalories > 0) {
      lines.push(
        `- ${this.i18n.t('decision.budget.has_remaining', loc, { remaining: params.remainingCalories })}`,
      );
    }

    // Nutrition priorities
    for (const priority of params.nutritionPriority) {
      // i18n-allow-dynamic
      const priorityKey = `decision.priority.${priority}`;
      const priorityLabel = this.i18n.t(priorityKey, loc);
      if (priorityLabel !== priorityKey) {
        lines.push(`- ${priorityLabel}`);
      }
    }

    // Health conditions
    for (const hci of this.getHealthConditionInstructions()) {
      if (hci.aliases.some((a) => params.healthConditions.includes(a))) {
        lines.push(`- ${hci.instruction[loc]}`);
      }
    }

    // Precision note for health conditions
    if (params.healthConditions.length > 0) {
      lines.push(`- ${this.i18n.t('decision.prompt.precisionNote', loc)}`);
    }

    if (lines.length === 1) return '';
    return '\n\n' + lines.join('\n');
  }

  /**
   * Build goal-aware complete prompt (text/image agnostic)
   */
  buildGoalAwarePrompt(
    goalType: string,
    userContext: string,
    locale?: Locale,
  ): string {
    const basePrompt = this.buildBasePrompt(undefined, locale);
    const focusBlock = this.getGoalFocusBlock(goalType, locale);
    return [basePrompt, focusBlock, userContext].join('\n\n');
  }
}
