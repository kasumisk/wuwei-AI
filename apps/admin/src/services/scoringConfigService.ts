import request from '@/utils/request';
import { PATH } from './path';
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

// ==================== 类型定义 ====================

export interface ExecutabilitySubWeights {
  commonality: number;
  cost: number;
  cookTime: number;
  skill: number;
}

export interface CompositionWeights {
  ingredientDiversity: number;
  cookingMethodDiversity: number;
  flavorHarmony: number;
  nutritionComplementarity: number;
  textureDiversity: number;
}

export interface ScoringConfigSnapshot {
  // FoodScorer
  executabilitySubWeights?: ExecutabilitySubWeights;
  nrf93SigmoidCenter?: number;
  nrf93SigmoidSlope?: number;
  inflammationCenter?: number;
  inflammationSlope?: number;
  addedSugarPenaltyPerGrams?: number;
  confidenceFloor?: number;
  novaBase?: number[];
  energySigmaRatios?: Record<string, number>;
  // RecallMerger
  semanticOnlyWeight?: number;
  cfOnlyWeight?: number;
  maxCandidatesPerCategoryForNonRule?: number;
  // RealisticFilter
  minCandidates?: number;
  canteenCommonalityThreshold?: number;
  // MealComposition
  compositionWeights?: CompositionWeights;
  // ReplacementFeedback
  replacedFromMultiplier?: number;
  replacedToMultiplier?: number;
  replacementDecayDays?: number;
  replacementMinFrequency?: number;
  // CF
  cfUserBasedWeight?: number;
  cfItemBasedWeight?: number;
  // Lifestyle
  lifestyleSleepPoorTryptophanBoost?: number;
  lifestyleSleepPoorMagnesiumBoost?: number;
  lifestyleStressHighVitCBoost?: number;
  // Allow extra fields from v6.8+
  [key: string]: unknown;
}

export interface ScoringConfigResponse {
  config: ScoringConfigSnapshot;
  defaults: ScoringConfigSnapshot;
}

// ── V1.7: 每日评分权重类型 ──

/** 8 个评分维度 key */
export const SCORE_DIMENSIONS = [
  'energy',
  'proteinRatio',
  'macroBalance',
  'foodQuality',
  'satiety',
  'stability',
  'glycemicImpact',
  'mealQuality',
] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  energy: '热量达成',
  proteinRatio: '蛋白质比例',
  macroBalance: '宏量均衡',
  foodQuality: '食物质量',
  satiety: '饱腹感',
  stability: '习惯稳定性',
  glycemicImpact: '血糖影响',
  mealQuality: '餐食质量',
};

export const SCORE_DIMENSION_DESCRIPTIONS: Record<ScoreDimension, string> = {
  energy: '热量摄入与目标的接近程度，使用高斯钟形函数，偏差越大分数越低',
  proteinRatio: '蛋白质占总热量比例是否在目标范围内（减脂 25-35%，增肌 25-40%）',
  macroBalance: '碳水化合物和脂肪的比例均衡度',
  foodQuality: '食物营养密度（1-10 对数映射到 0-100）',
  satiety: '饱腹感指数，影响下餐进食量控制',
  stability: '饮食习惯稳定性，综合连胜天数和餐次规律',
  glycemicImpact: '血糖负荷（GL = GI × 碳水/100）影响评分，越低越好',
  mealQuality: '每餐决策综合质量（健康比例 × 40 + 平均分 × 0.4 + 决策奖励 × 20）',
};

export const GOAL_TYPE_LABELS: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '健康维护',
  habit: '习惯养成',
};

export interface DailyScoreWeightsConfig {
  version: string;
  updatedAt: string;
  goalWeights: Record<string, Record<string, number>>;
  healthConditionMultipliers: Record<string, Record<string, number>>;
}

export interface DailyScoreWeightsResponse {
  current: DailyScoreWeightsConfig | null;
  defaults: {
    goalWeights: Record<string, Record<string, number>>;
    healthConditionMultipliers: Record<string, Record<string, number>>;
  };
  effectiveSource: 'config' | 'default';
}

// ==================== Query Keys ====================

const _all = ['scoring-config'] as const;

export const scoringConfigQueryKeys = {
  all: _all,
  config: [..._all, 'config'] as const,
  dailyScoreWeights: [..._all, 'daily-score-weights'] as const,
  dailyScoreWeightsDefaults: [..._all, 'daily-score-weights-defaults'] as const,
};

// ==================== API Functions ====================

export const scoringConfigApi = {
  getConfig: (): Promise<ScoringConfigResponse> => request.get(PATH.ADMIN.SCORING_CONFIG),

  updateConfig: (data: Partial<ScoringConfigSnapshot>): Promise<ScoringConfigSnapshot> =>
    request.put(PATH.ADMIN.SCORING_CONFIG, data),

  // V1.7: Daily Score Weights
  getDailyScoreWeights: (): Promise<DailyScoreWeightsResponse> =>
    request.get(PATH.ADMIN.DAILY_SCORE_WEIGHTS),

  getDailyScoreWeightsDefaults: (): Promise<{
    goalWeights: Record<string, Record<string, number>>;
    healthConditionMultipliers: Record<string, Record<string, number>>;
  }> => request.get(PATH.ADMIN.DAILY_SCORE_WEIGHTS_DEFAULTS),

  updateDailyScoreWeights: (data: DailyScoreWeightsConfig): Promise<DailyScoreWeightsConfig> =>
    request.put(PATH.ADMIN.DAILY_SCORE_WEIGHTS, data),
};

// ==================== React Query Hooks ====================

export const useScoringConfig = (
  options?: Omit<UseQueryOptions<ScoringConfigResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: scoringConfigQueryKeys.config,
    queryFn: () => scoringConfigApi.getConfig(),
    staleTime: 10 * 60 * 1000,
    ...options,
  });

export const useUpdateScoringConfig = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<ScoringConfigSnapshot>) => scoringConfigApi.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scoringConfigQueryKeys.config });
    },
  });
};

// V1.7: Daily Score Weights Hooks

export const useDailyScoreWeights = (
  options?: Omit<UseQueryOptions<DailyScoreWeightsResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: scoringConfigQueryKeys.dailyScoreWeights,
    queryFn: () => scoringConfigApi.getDailyScoreWeights(),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useUpdateDailyScoreWeights = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: DailyScoreWeightsConfig) => scoringConfigApi.updateDailyScoreWeights(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scoringConfigQueryKeys.dailyScoreWeights });
    },
  });
};
