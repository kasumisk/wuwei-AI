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

import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../../../decision/i18n/decision-labels';
import {
  GOAL_FOCUS_BLOCKS,
  HEALTH_CONDITION_INSTRUCTIONS,
  PRIORITY_LABELS,
  BUDGET_STATUS_LABELS,
  GOAL_LABELS,
  CONTEXT_HEADER,
} from '../../../decision/i18n/prompt-labels';

// ==================== Public API ====================

/**
 * Get LLM user message for text or image analysis
 */
export function getUserMessage(
  mode: 'text' | 'image',
  input: string,
  locale: Locale = 'zh-CN',
): string {
  const key = mode === 'text' ? 'prompt.userMessage.text' : 'prompt.userMessage.image';
  return cl(key, locale).replace('{input}', input).replace('{hint}', input);
}

/**
 * Build complete food analysis base prompt (unified system role + JSON schema + rules)
 */
export function buildBasePrompt(
  _mode?: 'text' | 'image',
  locale: Locale = 'zh-CN',
): string {
  return [
    cl('prompt.systemRole', locale),
    '',
    cl('prompt.jsonOnly', locale),
    cl('prompt.schema.foods', locale),
    '',
    cl('prompt.rules', locale),
  ].join('\n');
}

/**
 * Get goal-specific focus block for prompt
 */
export function getGoalFocusBlock(
  goalType: string,
  locale: Locale = 'zh-CN',
): string {
  const loc = locale in GOAL_FOCUS_BLOCKS.health ? locale : 'zh-CN';
  const block = GOAL_FOCUS_BLOCKS[goalType] || GOAL_FOCUS_BLOCKS.health;
  return block[loc];
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
  const locale = params.locale || 'zh-CN';
  const loc = locale in CONTEXT_HEADER ? locale : 'zh-CN';
  const lines: string[] = [CONTEXT_HEADER[loc]];

  // Goal
  const goalLabel =
    GOAL_LABELS[params.goalType]?.[loc] || GOAL_LABELS.health[loc];
  lines.push(
    `- ${locale === 'en-US' ? 'Goal' : locale === 'ja-JP' ? '目標' : '目标'}：${goalLabel}`,
  );

  // Budget status
  if (params.budgetStatus === 'over_limit') {
    lines.push(`- ⚠️ ${BUDGET_STATUS_LABELS.over_limit[loc]}`);
  } else if (params.budgetStatus === 'near_limit') {
    lines.push(`- ${cl('prompt.nearLimit', locale)}`);
  } else if (params.remainingCalories && params.remainingCalories > 0) {
    lines.push(
      `- ${BUDGET_STATUS_LABELS.has_remaining[loc].replace('{remaining}', String(params.remainingCalories))}`,
    );
  }

  // Nutrition priorities
  for (const priority of params.nutritionPriority) {
    if (PRIORITY_LABELS[priority]) {
      lines.push(`- ${PRIORITY_LABELS[priority][loc]}`);
    }
  }

  // Health conditions
  for (const hci of HEALTH_CONDITION_INSTRUCTIONS) {
    if (hci.aliases.some((a) => params.healthConditions.includes(a))) {
      lines.push(`- ${hci.instruction[loc]}`);
    }
  }

  // Precision note for health conditions
  if (params.healthConditions.length > 0) {
    lines.push(`- ${cl('prompt.precisionNote', locale)}`);
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
  locale: Locale = 'zh-CN',
): string {
  const basePrompt = buildBasePrompt(undefined, locale);
  const focusBlock = getGoalFocusBlock(goalType, locale);
  return [basePrompt, focusBlock, userContext].join('\n\n');
}
