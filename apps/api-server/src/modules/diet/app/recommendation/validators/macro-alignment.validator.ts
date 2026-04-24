/**
 * 四宏量对齐度校验器（P0-4 配套）
 *
 * 背景：
 *   2026-04 分析文档《推荐引擎营养目标偏差分析.md》发现日计划输出存在
 *   protein −37% / fat +73% 的严重偏差，原因是 pipeline 多处截断只看 calories+protein，
 *   fat/carbs 完全失控。本模块给日计划输出做一个**端到端的四维度贴合度体检**，
 *   把下游偏差从“到了线上才报警”提前到“构建完 plan 立刻暴露”。
 *
 * 定义的三层容错区间（来源：分析文档 §5 验收标准）：
 *   - Green  : |dev| <= 5%      → 完美贴合
 *   - Yellow : 5% < |dev| <= 15% → 可接受，但需关注
 *   - Red    : |dev| > 15%       → 需要修复
 *
 * 使用方式：
 *   const r = validateMacroAlignment(actualTotals, dailyTarget);
 *   if (r.zone === 'red') throw new Error(r.summary);
 */

import { MealTarget } from '../types/meal.types';

/** 四宏量维度名 */
export type MacroDimension = 'calories' | 'protein' | 'fat' | 'carbs';

/** 贴合度区间 */
export type MacroAlignmentZone = 'green' | 'yellow' | 'red';

/** 单个维度的偏差结果 */
export interface MacroDimensionResult {
  dimension: MacroDimension;
  /** 实际值 */
  actual: number;
  /** 目标值 */
  target: number;
  /** 带符号的相对偏差（actual 高于 target 为正，低于为负） */
  deviation: number;
  /** 绝对值偏差，用于区间判定 */
  absDeviation: number;
  /** 本维度的区间判定 */
  zone: MacroAlignmentZone;
}

/** 校验产出的违规描述（仅在 yellow/red 维度产生） */
export interface MacroAlignmentViolation {
  dimension: MacroDimension;
  zone: MacroAlignmentZone;
  message: string;
}

/** 校验总结果 */
export interface MacroAlignmentReport {
  /** 整体区间（取所有维度中最差的） */
  zone: MacroAlignmentZone;
  /** 逐维度结果 */
  dimensions: MacroDimensionResult[];
  /** 需要关注/修复的维度列表 */
  violations: MacroAlignmentViolation[];
  /** 人类可读摘要 */
  summary: string;
}

/** Green / Yellow 阈值（绝对偏差比例） */
export const MACRO_ZONE_THRESHOLDS = {
  green: 0.05, // ±5%
  yellow: 0.15, // ±15%
} as const;

/**
 * 四宏量对齐度校验
 *
 * @param actual     实际日累计营养（通常来自 daily-plan 聚合 / AccumulatedNutrition）
 * @param target     日目标（来自 NutritionScoreService.calculateDailyGoals）
 * @returns          体检报告；调用方根据 `zone` 决定拦截/告警/通过
 */
export function validateMacroAlignment(
  actual: Pick<MealTarget, 'calories' | 'protein' | 'fat' | 'carbs'>,
  target: Pick<MealTarget, 'calories' | 'protein' | 'fat' | 'carbs'>,
): MacroAlignmentReport {
  const dims: MacroDimension[] = ['calories', 'protein', 'fat', 'carbs'];

  const dimensions: MacroDimensionResult[] = dims.map((d) =>
    buildDimensionResult(d, actual[d] ?? 0, target[d] ?? 0),
  );

  const overallZone = rollupZone(dimensions.map((x) => x.zone));

  const violations: MacroAlignmentViolation[] = dimensions
    .filter((x) => x.zone !== 'green')
    .map((x) => ({
      dimension: x.dimension,
      zone: x.zone,
      message: formatViolationMessage(x),
    }));

  return {
    zone: overallZone,
    dimensions,
    violations,
    summary: buildSummary(overallZone, dimensions, violations),
  };
}

// ─── 内部实现 ───

function buildDimensionResult(
  dimension: MacroDimension,
  actual: number,
  target: number,
): MacroDimensionResult {
  // target=0 不参与评判（降级为 green），否则会出现 Infinity
  if (target <= 0) {
    return {
      dimension,
      actual,
      target,
      deviation: 0,
      absDeviation: 0,
      zone: 'green',
    };
  }
  const deviation = (actual - target) / target;
  const absDeviation = Math.abs(deviation);
  // 用 1e-9 容差避免浮点误差把边界值推到下一档（例如 144*0.95 = 136.7999... → absDev 0.0500000001）
  const EPS = 1e-9;
  const zone: MacroAlignmentZone =
    absDeviation <= MACRO_ZONE_THRESHOLDS.green + EPS
      ? 'green'
      : absDeviation <= MACRO_ZONE_THRESHOLDS.yellow + EPS
        ? 'yellow'
        : 'red';
  return { dimension, actual, target, deviation, absDeviation, zone };
}

function rollupZone(zones: MacroAlignmentZone[]): MacroAlignmentZone {
  if (zones.some((z) => z === 'red')) return 'red';
  if (zones.some((z) => z === 'yellow')) return 'yellow';
  return 'green';
}

function formatViolationMessage(d: MacroDimensionResult): string {
  const sign = d.deviation >= 0 ? '+' : '';
  const pct = (d.deviation * 100).toFixed(1);
  return `${d.dimension}: ${d.actual} / ${d.target} (${sign}${pct}%, ${d.zone})`;
}

function buildSummary(
  zone: MacroAlignmentZone,
  dims: MacroDimensionResult[],
  violations: MacroAlignmentViolation[],
): string {
  if (zone === 'green') {
    return '宏量对齐度 OK（四维度均在 ±5% 内）';
  }
  const parts = violations.map((v) => v.message).join('; ');
  const prefix = zone === 'red' ? '[RED] 宏量严重偏离' : '[YELLOW] 宏量需关注';
  // 同时附一下所有维度的偏差，便于排查
  const allDims = dims
    .map((d) => {
      const sign = d.deviation >= 0 ? '+' : '';
      return `${d.dimension}${sign}${(d.deviation * 100).toFixed(1)}%`;
    })
    .join(', ');
  return `${prefix} — ${parts} | all: ${allDims}`;
}
