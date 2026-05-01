/**
 * V5 Phase 3.4 — 用户分段逻辑（升级版）
 *
 * V4 → V5 变更:
 *   - 新增 'new_user' 分段（使用天数 <7）
 *   - 新增 'returning_user' 分段（>14天不活跃后回归）
 *   - muscle_builder 交叉分类：低依从时也标记 binge_risk
 *   - 返回 SegmentResult（含 confidence 和 secondaryFlags）
 *
 * 分段结果：
 *   - new_user             : 使用天数 <7
 *   - muscle_builder       : 增肌目标（可能同时带 binge_risk 标记）
 *   - disciplined_loser    : 减脂+高依从
 *   - active_maintainer    : 非减脂+高依从
 *   - binge_risk           : 低依从+足够数据
 *   - returning_user       : 曾超过 14 天不活跃后回归
 *   - casual_maintainer    : 其他
 */

/** 用户分段枚举（字面量联合类型，兼容 DB varchar） */
export type UserSegment =
  | 'new_user'
  | 'muscle_builder'
  | 'disciplined_loser'
  | 'active_maintainer'
  | 'binge_risk'
  | 'returning_user'
  | 'casual_maintainer';

/** 分段结果（含置信度和交叉标记） */
export interface SegmentResult {
  /** 主分段 */
  segment: UserSegment;
  /** 置信度 0-1 */
  confidence: number;
  /** 交叉标记（如 muscle_builder 同时具有 binge_risk） */
  secondaryFlags: string[];
}

/** 分段输入行为数据 */
export interface SegmentBehaviorInput {
  avgComplianceRate?: number;
  totalRecords?: number;
  /** 距上次记录的天数（由调用方计算传入） */
  daysSinceLastRecord?: number;
  /** 用户使用天数（首次记录至今） */
  usageDays?: number;
  /**
   * P3-2.4: 用户区域代码（'US' / 'CN' / 'US-CA' 等）
   * 用于按 region 调整 segment 阈值（详见 regional-defaults.REGION_SEGMENT_TUNING）
   * 缺省时使用 DEFAULT_REGION_SEGMENT_TUNING（与历史行为完全一致）
   */
  regionCode?: string | null;
}

import { getRegionSegmentTuning } from '../../../../common/config/regional-defaults';

/**
 * 推断用户分段
 *
 * @param goal     用户目标 (GoalType: 'fat_loss' | 'muscle_gain' | 'health' | 'habit')
 * @param behavior 行为画像数据（可为 null，表示无行为数据）
 * @returns SegmentResult
 */
export function inferUserSegment(
  goal: string,
  behavior: SegmentBehaviorInput | null,
): SegmentResult {
  const compliance = Number(behavior?.avgComplianceRate ?? 0);
  const records = behavior?.totalRecords ?? 0;
  const daysSinceActive = behavior?.daysSinceLastRecord ?? 0;
  const usageDays = behavior?.usageDays ?? 0;
  // P3-2.4: 按 region 取 tuning（缺省 = DEFAULT_REGION_SEGMENT_TUNING）
  const tuning = getRegionSegmentTuning(behavior?.regionCode);
  const flags: string[] = [];

  // 新用户（使用天数 < region.newUserUsageDays）
  if (usageDays < tuning.newUserUsageDays && records < 14) {
    return { segment: 'new_user', confidence: 0.9, secondaryFlags: [] };
  }

  // 回归用户（不活跃天数 > region.returningInactiveDays 且 有足够历史数据）
  if (daysSinceActive > tuning.returningInactiveDays && records > 20) {
    return { segment: 'returning_user', confidence: 0.8, secondaryFlags: [] };
  }

  // 暴食风险检测（独立判定，也用于交叉标记）
  if (compliance < 0.4 && records >= 14) {
    flags.push('binge_risk');
  }

  // 增肌目标（可能同时携带 binge_risk 交叉标记）
  if (goal === 'muscle_gain') {
    return {
      segment: 'muscle_builder',
      confidence: 0.95,
      secondaryFlags: flags,
    };
  }

  // 高依从用户（阈值按 region 调整）
  if (compliance >= tuning.highComplianceThreshold) {
    return {
      segment: goal === 'fat_loss' ? 'disciplined_loser' : 'active_maintainer',
      confidence: Math.min(1, compliance),
      secondaryFlags: flags,
    };
  }

  // 独立暴食风险
  if (flags.includes('binge_risk')) {
    return { segment: 'binge_risk', confidence: 0.85, secondaryFlags: [] };
  }

  return {
    segment: 'casual_maintainer',
    confidence: 0.6,
    secondaryFlags: flags,
  };
}
