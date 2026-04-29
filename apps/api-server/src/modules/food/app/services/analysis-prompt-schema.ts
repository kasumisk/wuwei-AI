/**
 * V5.2 P1.1 — Food Analysis Prompt Schema
 *
 * Shared prompt schema for text/image food analysis.
 * All nutrition fields aligned 1:1 with food enrichment pipeline's FIELD_DESC
 * (food-enrichment.service.ts) — same field names, units, and validation ranges.
 *
 * V5.2 Changes:
 * - Migrated all inline trilingual Records to labels files via cl()
 * - Fixed field names: fodmap→fodmapLevel, oxalate→oxalateLevel (DB alignment)
 * - Unified text/image prompt construction (single code path)
 *
 * Consumers:
 * - text-food-analysis.service.ts
 * - image-food-analysis.service.ts
 */

import {
  type Locale,
  getSupportedLocales,
} from '../../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../../../decision/i18n/decision-labels';

// ==================== Health Condition Instructions ====================

const LOCALES: Locale[] = ['zh-CN', 'en-US', 'ja-JP'];

/**
 * 健康状况追加指令配置（仅 condition + aliases，文案走 i18n key）
 *
 * Phase 11.B (V8): 改为懒加载 — 模块顶层不再 eager 调用 cl()，
 *   避免在 I18nService.onModuleInit 之前执行导致拿到 key 字面量。
 */
const HEALTH_CONDITION_DEFS: ReadonlyArray<{
  condition: string;
  aliases: string[];
  /** i18n key（不带 'decision.' 前缀，cl() 内部会补） */
  i18nKey: string;
}> = [
  { condition: 'diabetes', aliases: ['diabetes'], i18nKey: 'health.inst.diabetes' },
  { condition: 'hypertension', aliases: ['hypertension'], i18nKey: 'health.inst.hypertension' },
  { condition: 'cardiovascular', aliases: ['heart_disease', 'cardiovascular'], i18nKey: 'health.inst.cardiovascular' },
  { condition: 'gout', aliases: ['gout'], i18nKey: 'health.inst.gout' },
  { condition: 'ibs', aliases: ['IBS'], i18nKey: 'health.inst.ibs' },
  { condition: 'kidney_stones', aliases: ['kidney_stones'], i18nKey: 'health.inst.kidney_stones' },
  { condition: 'hyperlipidemia', aliases: ['hyperlipidemia'], i18nKey: 'health.inst.hyperlipidemia' },
];

interface HealthEstimationInstruction {
  condition: string;
  aliases: string[];
  instruction: Record<string, string>;
}

/** 缓存：首次构造后复用 */
let HEALTH_CONDITION_INSTRUCTIONS_CACHE: HealthEstimationInstruction[] | null =
  null;

function getHealthConditionInstructions(): HealthEstimationInstruction[] {
  if (HEALTH_CONDITION_INSTRUCTIONS_CACHE) return HEALTH_CONDITION_INSTRUCTIONS_CACHE;
  HEALTH_CONDITION_INSTRUCTIONS_CACHE = HEALTH_CONDITION_DEFS.map((def) => ({
    condition: def.condition,
    aliases: def.aliases,
    instruction: Object.fromEntries(LOCALES.map((l) => [l, cl(def.i18nKey, l)])),
  }));
  return HEALTH_CONDITION_INSTRUCTIONS_CACHE;
}

// ==================== Public API ====================

const FALLBACK_LOCALE: Locale = 'en-US';

function getNameFieldInstruction(locale?: Locale): string {
  const resolved = resolvePromptLocale(locale);

  switch (resolved) {
    case 'zh-CN':
      return [
        '字段约束：',
        '- 食物名只返回在 `name` 字段中',
        '- `name` 必须使用本次请求的当前响应语言',
        '- 不要返回 `nameEn`、`nameZh` 或其他额外命名字段',
      ].join('\n');
    case 'ja-JP':
      return [
        'フィールド制約:',
        '- 食品名は `name` フィールドのみに返すこと',
        '- `name` はこのリクエストの現在の応答言語を使うこと',
        '- `nameEn`、`nameZh`、その他の別名フィールドは返さないこと',
      ].join('\n');
    case 'en-US':
    default:
      return [
        'Field constraints:',
        '- Return food names only in the `name` field',
        '- `name` must use the current response language for this request',
        '- Do not return `nameEn`, `nameZh`, or any additional name fields',
      ].join('\n');
  }
}

function resolvePromptLocale(locale?: Locale): Locale {
  const resolvedLocale = locale ?? FALLBACK_LOCALE;
  return getSupportedLocales().includes(resolvedLocale)
    ? resolvedLocale
    : FALLBACK_LOCALE;
}

/**
 * Get LLM user message for text or image analysis
 */
export function getUserMessage(
  mode: 'text' | 'image',
  input: string,
  locale?: Locale,
): string {
  const key =
    mode === 'text' ? 'prompt.userMessage.text' : 'prompt.userMessage.image';
  // Templates use {{input}} (text mode) and {{hint}} (image mode); pass both.
  return cl(key, locale, { input, hint: input });
}

/**
 * Build complete food analysis base prompt (unified system role + JSON schema + rules)
 */
export function buildBasePrompt(
  _mode?: 'text' | 'image',
  locale?: Locale,
): string {
  return [
    cl('prompt.systemRole', locale),
    '',
    cl('prompt.jsonOnly', locale),
    cl('prompt.schema.foods', locale),
    '',
    cl('prompt.rules', locale),
    '',
    getNameFieldInstruction(locale),
  ].join('\n');
}

/**
 * Get goal-specific focus block for prompt
 */
export function getGoalFocusBlock(
  goalType: string,
  locale?: Locale,
): string {
  const loc = resolvePromptLocale(locale);
  const key = `goal.focus.${goalType}`;
  const result = cl(key, loc);
  // Fallback to health if key not found (cl returns key itself when missing)
  return result === key ? cl('goal.focus.health', loc) : result;
}

/**
 * V5.2: Build unified user context prompt block
 *
 * Includes: goal, budget status, nutrition priorities, health conditions, remaining budget
 */
export function buildUserContextPrompt(params: {
  goalType: string;
  nutritionPriority: string[];
  healthConditions: string[];
  budgetStatus: string;
  remainingCalories?: number;
  remainingProtein?: number;
  locale?: Locale;
}): string {
  const loc = resolvePromptLocale(params.locale);
  const lines: string[] = [cl('header.context', loc)];

  // Goal
  const goalKey = `goal.label.${params.goalType}`;
  const goalLabelRaw = cl(goalKey, loc);
  const goalLabel = goalLabelRaw === goalKey ? cl('goal.label.health', loc) : goalLabelRaw;
  lines.push(`- ${cl('prompt.contextLabel.goal', loc, { label: goalLabel })}`);

  // Budget status
  if (params.budgetStatus === 'over_limit') {
    lines.push(`- ⚠️ ${cl('budget.over_limit', loc)}`);
  } else if (params.budgetStatus === 'near_limit') {
    lines.push(`- ${cl('prompt.nearLimit', loc)}`);
  } else if (params.remainingCalories && params.remainingCalories > 0) {
    lines.push(
      `- ${cl('budget.has_remaining', loc, { remaining: params.remainingCalories })}`,
    );
  }

  // Nutrition priorities
  for (const priority of params.nutritionPriority) {
    const priorityKey = `priority.${priority}`;
    const priorityLabel = cl(priorityKey, loc);
    if (priorityLabel !== priorityKey) {
      lines.push(`- ${priorityLabel}`);
    }
  }

  // Health conditions
  for (const hci of getHealthConditionInstructions()) {
    if (hci.aliases.some((a) => params.healthConditions.includes(a))) {
      lines.push(`- ${hci.instruction[loc]}`);
    }
  }

  // Precision note for health conditions
  if (params.healthConditions.length > 0) {
    lines.push(`- ${cl('prompt.precisionNote', loc)}`);
  }

  if (lines.length === 1) return '';
  return '\n\n' + lines.join('\n');
}

/**
 * Build goal-aware complete prompt (text/image agnostic)
 */
export function buildGoalAwarePrompt(
  goalType: string,
  userContext: string,
  locale?: Locale,
): string {
  const basePrompt = buildBasePrompt(undefined, locale);
  const focusBlock = getGoalFocusBlock(goalType, locale);
  return [basePrompt, focusBlock, userContext].join('\n\n');
}
