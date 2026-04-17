/**
 * V2.4 Scoring Module Types
 *
 * 评分系统的核心类型定义：
 * - NutritionScore: 用户当前摄入与目标的对标评分
 * - Issue: 识别出的营养问题
 * - ActionDirection: 决策建议方向
 */

export interface NutritionScore {
  // 当前摄入 vs 目标
  consumed: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber?: number;
  };

  target: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber?: number;
  };

  remaining: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber?: number;
  };

  // 进度状态 (三态评价)
  status: 'under' | 'balanced' | 'over';

  // 宏量均衡度 (0-100)
  macroBalance: number;

  // 问题识别
  issues: Issue[];

  // 决策建议方向
  actionDirection: 'must_eat' | 'should_eat' | 'can_skip' | 'should_avoid';

  // 置信度权重 (0-1)
  confidence: number;

  // 时间戳
  timestamp: Date;
}

export interface Issue {
  type: 'calories' | 'protein' | 'fat' | 'carbs' | 'fiber' | 'other';
  status: 'deficit' | 'excess';
  value: number; // 当前 vs 目标的差值
  severity: 'low' | 'medium' | 'high';
  msg_i18n: string; // i18n key, e.g., "scoring.issue.protein_deficit_high"
}

export interface ActionDirectionContext {
  currentCalorieDeficit: number;
  proteinDeficit: number;
  fatStatus: 'deficit' | 'excess' | 'balanced';
  carbStatus: 'deficit' | 'excess' | 'balanced';
  userProfile: any; // 从 UserProfile 读取
  foodNutrition: any; // 要评估的食物营养
}
