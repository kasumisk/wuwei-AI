/**
 * V5.1 P3.1/P3.3/P3.4/P3.5 — Prompt i18n labels
 *
 * All locale-keyed label blocks used by LLM prompt construction.
 * Previously held inline trilingual Records; now derived via cl() from labels-*.ts.
 *
 * Public API is unchanged — callers continue to import the same named exports.
 */

import { cl } from './decision-labels';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

const LOCALES: Locale[] = ['zh-CN', 'en-US', 'ja-JP'];

// ==================== Goal Focus Blocks (P3.4) ====================

export const GOAL_FOCUS_BLOCKS: Record<string, Record<string, string>> = {
  fat_loss: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.focus.fat_loss', l)]),
  ),
  muscle_gain: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.focus.muscle_gain', l)]),
  ),
  health: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.focus.health', l)]),
  ),
  habit: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.focus.habit', l)]),
  ),
};

// ==================== Health Condition Instructions (P3.3) ====================

export interface HealthEstimationInstruction {
  condition: string;
  aliases: string[];
  instruction: Record<string, string>;
}

export const HEALTH_CONDITION_INSTRUCTIONS: HealthEstimationInstruction[] = [
  {
    condition: 'diabetes',
    aliases: ['diabetes'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.diabetes', l)]),
    ),
  },
  {
    condition: 'hypertension',
    aliases: ['hypertension'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.hypertension', l)]),
    ),
  },
  {
    condition: 'cardiovascular',
    aliases: ['heart_disease', 'cardiovascular'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.cardiovascular', l)]),
    ),
  },
  {
    condition: 'gout',
    aliases: ['gout'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.gout', l)]),
    ),
  },
  {
    condition: 'ibs',
    aliases: ['IBS'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.ibs', l)]),
    ),
  },
  {
    condition: 'kidney_stones',
    aliases: ['kidney_stones'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.kidney_stones', l)]),
    ),
  },
  {
    condition: 'hyperlipidemia',
    aliases: ['hyperlipidemia'],
    instruction: Object.fromEntries(
      LOCALES.map((l) => [l, cl('health.inst.hyperlipidemia', l)]),
    ),
  },
];

// ==================== Priority Labels (P3.5) ====================

export const PRIORITY_LABELS: Record<string, Record<string, string>> = {
  protein_gap: Object.fromEntries(
    LOCALES.map((l) => [l, cl('priority.protein_gap', l)]),
  ),
  fat_excess: Object.fromEntries(
    LOCALES.map((l) => [l, cl('priority.fat_excess', l)]),
  ),
  carb_excess: Object.fromEntries(
    LOCALES.map((l) => [l, cl('priority.carb_excess', l)]),
  ),
};

// ==================== Budget Status Labels (P3.5) ====================

export const BUDGET_STATUS_LABELS: Record<string, Record<string, string>> = {
  over_limit: Object.fromEntries(
    LOCALES.map((l) => [l, cl('budget.over_limit', l)]),
  ),
  has_remaining: Object.fromEntries(
    LOCALES.map((l) => [l, cl('budget.has_remaining', l)]),
  ),
};

// ==================== Goal Labels (P3.5) ====================

export const GOAL_LABELS: Record<string, Record<string, string>> = {
  fat_loss: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.label.fat_loss', l)]),
  ),
  muscle_gain: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.label.muscle_gain', l)]),
  ),
  health: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.label.health', l)]),
  ),
  habit: Object.fromEntries(
    LOCALES.map((l) => [l, cl('goal.label.habit', l)]),
  ),
};

// ==================== Context / Precision Headers (P3.5) ====================

export const CONTEXT_HEADER: Record<string, string> = Object.fromEntries(
  LOCALES.map((l) => [l, cl('header.context', l)]),
);

export const PRECISION_HEADER: Record<string, string> = Object.fromEntries(
  LOCALES.map((l) => [l, cl('header.precision', l)]),
);

// ==================== Coach Prompt Templates (P3.1) ====================

export interface CoachPromptTemplate {
  headline: string;
  guidance: string;
  close: string;
}

export const COACH_PROMPT_TEMPLATES: Record<string, CoachPromptTemplate> =
  Object.fromEntries(
    LOCALES.map((l) => [
      l,
      {
        headline: cl('prompt.headline', l),
        guidance: cl('prompt.guidance', l),
        close: cl('prompt.close', l),
      },
    ]),
  );
