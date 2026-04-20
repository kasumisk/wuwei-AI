/**
 * V4.4: 用户上下文相关类型（从 analysis-result.types.ts 拆分）
 */

/** V3.0: 四维宏量槽位感知 */
export interface MacroSlotStatus {
  calories: 'deficit' | 'ok' | 'excess';
  protein: 'deficit' | 'ok' | 'excess';
  fat: 'deficit' | 'ok' | 'excess';
  carbs: 'deficit' | 'ok' | 'excess';
  /** 缺口最大的宏量（影响决策优先级） */
  dominantDeficit?: 'protein' | 'fat' | 'carbs' | 'calories';
  /** 超标最大的宏量 */
  dominantExcess?: 'protein' | 'fat' | 'carbs' | 'calories';
}

/** V3.0: 驱动决策的信号追踪条目 */
export interface SignalTraceItem {
  /** 信号键（如 'protein_gap'） */
  signal: string;
  /** 优先级分值（来自 signal-priority.config） */
  priority: number;
  /** 信号来源 */
  source: 'user_context' | 'nutrition' | 'health_constraint' | 'time_window';
  /** 人类可读描述 */
  description: string;
}

/** V3.0: 结构化解释节点（供 coach 按步骤输出逻辑清晰的解释） */
export interface ExplanationNode {
  /** 步骤序号（1-based） */
  step: number;
  /** 来源标注（如 'nutrition_analysis' | 'user_goal' | 'health_constraint'） */
  source: string;
  /** 节点内容 */
  content: string;
  /** 重要程度 */
  weight?: 'high' | 'medium' | 'low';
}

/**
 * V2.0: 统一用户上下文接口
 */
export interface UnifiedUserContext {
  userId?: string;
  goalType: string;
  goalLabel: string;
  todayCalories: number;
  todayProtein: number;
  todayFat: number;
  todayCarbs: number;
  goalCalories: number;
  goalProtein: number;
  goalFat: number;
  goalCarbs: number;
  remainingCalories: number;
  remainingProtein: number;
  remainingFat: number;
  remainingCarbs: number;
  mealCount: number;
  /** 餐次类型（breakfast/lunch/dinner/snack） */
  mealType?: string;
  profile?: any;
  /** 当前本地小时 (0-23) */
  localHour: number;
  /** 用户过敏原列表 */
  allergens: string[];
  /** 用户饮食限制 */
  dietaryRestrictions: string[];
  /** 用户健康状况 */
  healthConditions: string[];
  /** V2.6: 当前热量预算状态 */
  budgetStatus?: 'under_target' | 'near_limit' | 'over_limit';
  /** V2.6: 当前最值得优先修正的营养方向 */
  nutritionPriority?: string[];
  /** V2.6: 决策层可直接消费的上下文信号 */
  contextSignals?: string[];
  /** V3.0: 四维宏量槽位状态（各宏量独立的 deficit/ok/excess） */
  macroSlotStatus?: MacroSlotStatus;

  /** V4.0: 目标执行进度（来自 GoalTrackerService） */
  goalProgress?: {
    executionRate: number; // 0-1
    streakDays: number;
    calorieCompliance: number; // 0-1
    proteinCompliance: number; // 0-1
  };

  /** V4.0: 7天短期行为画像（来自 RealtimeProfileService） */
  shortTermBehavior?: {
    recentRejectionPatterns: string[];
    intakeTrends: 'increasing' | 'stable' | 'decreasing';
    bingeRiskHours: number[];
    activeTimeSlots: string[];
  };

  /** V4.0: 目标阶段权重调整（来自 GoalPhaseService） */
  phaseWeightAdjustment?: Partial<Record<string, number>>;

  /** V4.2: 上下文构建完整度（标记哪些信号源成功/失败） */
  contextCompleteness?: {
    availableSignals: string[];
    missingSignals: string[];
    completenessRatio: number;
  };
}
