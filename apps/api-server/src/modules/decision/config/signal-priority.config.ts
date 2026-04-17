/**
 * V2.7 信号优先级仲裁矩阵
 *
 * 格式：goalType → { signal → 优先级数值 (越高越优先) }
 *
 * 用于 DecisionSummaryService.resolveCoachFocus() 在多信号并存时
 * 根据用户目标选出最关键的教练重点。
 */

export type SignalPriorityMap = Record<string, number>;

export const SIGNAL_PRIORITY_MATRIX: Record<string, SignalPriorityMap> = {
  /** 减脂：超限 > 临近限制 > 脂肪超标 > 碳水超标 > 晚餐窗口 > 蛋白缺口 > 餐次不足 */
  fat_loss: {
    health_constraint: 110,
    over_limit: 100,
    near_limit: 90,
    fat_excess: 80,
    carb_excess: 75,
    late_night_window: 65,
    protein_gap: 55,
    meal_count_low: 40,
    under_target: 30,
  },
  /** 增肌：蛋白缺口 > 餐次不足 > 未达目标 > 超限 > 脂肪超标 > 晚餐窗口 */
  muscle_gain: {
    health_constraint: 110,
    protein_gap: 100,
    meal_count_low: 90,
    under_target: 80,
    over_limit: 65,
    fat_excess: 50,
    late_night_window: 40,
    near_limit: 35,
    carb_excess: 30,
  },
  /** 健康维持：超限 > 脂肪超标 > 晚餐窗口 > 蛋白缺口 > 临近限制 */
  health: {
    health_constraint: 120,
    over_limit: 90,
    fat_excess: 80,
    late_night_window: 75,
    protein_gap: 65,
    near_limit: 55,
    carb_excess: 50,
    meal_count_low: 40,
    under_target: 30,
  },
  /** 维持体重：超限 > 临近限制 > 脂肪超标 > 蛋白缺口 */
  maintenance: {
    health_constraint: 95,
    over_limit: 85,
    near_limit: 70,
    fat_excess: 60,
    protein_gap: 55,
    carb_excess: 50,
    late_night_window: 45,
    meal_count_low: 35,
    under_target: 30,
  },
};

/** 没有匹配 goalType 时的默认优先级 */
export const DEFAULT_SIGNAL_PRIORITY: SignalPriorityMap = {
  health_constraint: 100,
  over_limit: 85,
  near_limit: 70,
  fat_excess: 65,
  carb_excess: 60,
  protein_gap: 55,
  late_night_window: 50,
  meal_count_low: 40,
  under_target: 30,
};

/**
 * 获取目标类型下指定信号的优先级分值
 */
export function getSignalPriority(signal: string, goalType?: string): number {
  const matrix =
    (goalType && SIGNAL_PRIORITY_MATRIX[goalType]) || DEFAULT_SIGNAL_PRIORITY;
  return matrix[signal] ?? 0;
}
