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

// ==================== Query Keys ====================

const _all = ['scoring-config'] as const;

export const scoringConfigQueryKeys = {
  all: _all,
  config: [..._all, 'config'] as const,
};

// ==================== API Functions ====================

export const scoringConfigApi = {
  getConfig: (): Promise<ScoringConfigResponse> => request.get(PATH.ADMIN.SCORING_CONFIG),

  updateConfig: (data: Partial<ScoringConfigSnapshot>): Promise<ScoringConfigSnapshot> =>
    request.put(PATH.ADMIN.SCORING_CONFIG, data),
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
