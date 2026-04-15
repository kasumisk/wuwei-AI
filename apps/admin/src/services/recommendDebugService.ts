import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

// --- Trace 相关类型 ---
export interface PipelineStageTrace {
  stage:
    | 'recall'
    | 'realistic_filter'
    | 'rank'
    | 'health_modifier'
    | 'scoring_chain'
    | 'rerank'
    | 'assemble';
  durationMs: number;
  inputCount: number;
  outputCount: number;
  details?: Record<string, unknown>;
}

export interface PipelineTraceSummary {
  totalDurationMs: number;
  candidateFlowPath: string;
  strategyName: string;
  sceneName: string;
  realismLevel: string;
  degradations: string[];
  cacheHit: boolean;
}

export interface PipelineTrace {
  traceId: string;
  userId: string;
  mealType: string;
  startedAt: number;
  completedAt?: number;
  stages: PipelineStageTrace[];
  summary?: PipelineTraceSummary;
  stageBuffer?: Record<string, unknown>;
}

export interface TraceListItem {
  id: string;
  userId: string;
  mealType: string;
  goalType: string;
  channel: string;
  strategyName: string | null;
  sceneName: string | null;
  realismLevel: string | null;
  candidateFlow: string | null;
  totalDurationMs: number | null;
  durationMs: number | null;
  cacheHit: boolean | null;
  foodPoolSize: number | null;
  createdAt: string;
}

export interface TraceListResponse {
  data: TraceListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TraceListQueryDto {
  userId?: string;
  mealType?: string;
  sceneName?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export interface TraceDetail {
  id: string;
  userId: string;
  mealType: string;
  goalType: string;
  channel: string;
  strategyId: string | null;
  strategyVersion: string | null;
  experimentId: string | null;
  groupId: string | null;
  pipelineSnapshot: Record<string, unknown>;
  topFoods: Array<Record<string, unknown>>;
  scoreStats: { min: number; max: number; avg: number; std: number; count: number } | null;
  foodPoolSize: number | null;
  filtersApplied: Record<string, unknown> | null;
  durationMs: number | null;
  traceData: PipelineTrace | null;
  strategyName: string | null;
  sceneName: string | null;
  realismLevel: string | null;
  candidateFlow: string | null;
  totalDurationMs: number | null;
  cacheHit: boolean | null;
  degradations: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// --- Score Breakdown 相关类型 ---
export interface ScoreBreakdownDto {
  userId: string;
  foodId: string;
  mealType?: string;
  goalType?: string;
}

export interface ScoreDimensionDetail {
  raw: number;
  weighted: number;
  weight: number;
}

export interface ScoreChainAdjustment {
  factorName: string;
  multiplier: number;
  additive: number;
  reason: string;
}

export interface ScoreBreakdownResult {
  userId: string;
  foodId: string;
  foodName: string;
  mealType: string;
  goalType: string;
  baseScore: number;
  dimensions: Record<string, ScoreDimensionDetail>;
  chainResult: {
    baseScore: number;
    finalScore: number;
    adjustments: ScoreChainAdjustment[];
  };
  healthModifier: {
    finalMultiplier: number;
    isVetoed: boolean;
    modifiers: Array<Record<string, unknown>>;
  };
  finalScore: number;
  servingInfo: Record<string, unknown>;
  strategy: {
    strategyId: string | undefined;
    strategyName: string | undefined;
  };
}

// --- Strategy Diff 相关类型 ---
export interface StrategyDiffDto {
  userId: string;
  strategyIdA: string;
  strategyIdB: string;
  mealType?: string;
  goalType?: string;
}

export interface StrategyDiffFoodItem {
  name: string;
  score: number;
  calories: number;
}

export interface StrategyDiffResult {
  userId: string;
  mealType: string;
  goalType: string;
  strategyA: { id: string; name: string; config: Record<string, unknown> };
  strategyB: { id: string; name: string; config: Record<string, unknown> };
  comparison: {
    totalFoodsA: number;
    totalFoodsB: number;
    commonCount: number;
    onlyInA: StrategyDiffFoodItem[];
    onlyInB: StrategyDiffFoodItem[];
    common: StrategyDiffFoodItem[];
  };
  resultA: StrategyDiffFoodItem[];
  resultB: StrategyDiffFoodItem[];
  note: string;
}

// --- Pipeline Stats 相关类型 ---
export interface PipelineStatsQueryDto {
  days?: number;
  mealType?: string;
  sceneName?: string;
}

export interface PipelineStageStats {
  avgDurationMs: number;
  avgOutputCount: number;
  sampleCount: number;
}

export interface PipelineStatsResult {
  days: number;
  traceCount: number;
  avgTotalDurationMs?: number;
  cacheHitRate?: number;
  degradationRate?: number;
  stageStats?: Record<string, PipelineStageStats>;
  sceneCounts?: Record<string, number>;
  mealTypeCounts?: Record<string, number>;
  message?: string;
}

// --- 原有类型 ---
export interface SimulateRecommendDto {
  userId: string;
  mealType: string;
  goalType?: string;
  consumedCalories?: number;
  consumedProtein?: number;
}

export interface SimulateRecommendResult {
  userId: string;
  mealType: string;
  goalType: string;
  input: {
    consumed: { calories: number; protein: number };
    target: { calories: number; protein: number; fat: number; carbs: number };
    dailyTarget: { calories: number; protein: number };
    userProfile: {
      allergens: string[];
      dietaryRestrictions: string[];
      healthConditions: string[];
      regionCode: string;
    };
  };
  result: Record<string, unknown>;
  performance: { elapsedMs: number };
  note: string;
}

export interface WhyNotDto {
  userId: string;
  foodName: string;
  mealType: string;
  goalType?: string;
}

export interface WhyNotResult {
  userId: string;
  queryFoodName: string;
  mealType: string;
  goalType: string;
  foodName: string;
  found: boolean;
  score: number;
  reason: string;
  alternatives: Array<{
    foodId: string;
    name: string;
    category: string;
    score: number;
    servingCalories: number;
    servingProtein: number;
  }>;
}

export interface UserStrategyResult {
  userId: string;
  goalType: string;
  hasProfile: boolean;
  resolvedStrategy: {
    strategyId: string;
    strategyName: string;
    sources: string[];
    config: Record<string, unknown>;
    resolvedAt: number;
  };
  experimentAssignment: {
    experimentId: string;
    experimentName: string;
    groupName: string;
    scoreWeightOverrides: Record<string, number[]> | null;
    mealWeightOverrides: Record<string, Record<string, number>> | null;
  } | null;
  experimentStrategy: {
    config: Record<string, unknown>;
    experimentId: string;
    groupName: string;
  } | null;
}

export interface QualityOverview {
  dateRange: { from: string; to: string };
  totalFeedbacks: number;
  acceptanceRate: number;
  replacementRate: number;
  skipRate: number;
  activeUsers: number;
  avgDailyFeedbacks: number;
}

export interface AcceptanceByDimension {
  dimension: string;
  total: number;
  accepted: number;
  rate: number;
}

export interface DailyTrend {
  date: string;
  total: number;
  accepted: number;
  replaced: number;
  skipped: number;
  acceptanceRate: number;
}

export interface PlanCoverage {
  dateRange: { from: string; to: string };
  totalPlans: number;
  adjustedPlans: number;
  avgPlanCalories: number;
  uniqueUsers: number;
}

export interface QualityDashboard {
  days: number;
  overview: QualityOverview;
  byGoal: AcceptanceByDimension[];
  byMeal: AcceptanceByDimension[];
  trend: DailyTrend[];
  planCoverage: PlanCoverage;
}

// ==================== Query Keys ====================

const _all = ['recommendation-debug'] as const;

export const recommendDebugQueryKeys = {
  all: _all,
  userStrategy: (userId: string, goalType?: string) =>
    [..._all, 'user-strategy', userId, goalType] as const,
  qualityDashboard: (days?: number) => [..._all, 'quality-dashboard', days] as const,
  traces: (query?: TraceListQueryDto) => [..._all, 'traces', query] as const,
  traceDetail: (traceId: string) => [..._all, 'trace', traceId] as const,
  pipelineStats: (query?: PipelineStatsQueryDto) =>
    [..._all, 'pipeline-stats', query] as const,
};

// ==================== API ====================

export const recommendDebugApi = {
  /** 模拟推荐 */
  simulateRecommend: (data: SimulateRecommendDto): Promise<SimulateRecommendResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/simulate`, data),

  /** 反向解释 */
  whyNot: (data: WhyNotDto): Promise<WhyNotResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/why-not`, data),

  /** 获取用户当前策略 */
  getUserStrategy: (userId: string, goalType?: string): Promise<UserStrategyResult> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/user-strategy/${userId}`, {
      ...(goalType ? { goalType } : {}),
    }),

  /** 推荐质量仪表盘 */
  getQualityDashboard: (days?: number): Promise<QualityDashboard> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/quality-dashboard`, {
      ...(days ? { days } : {}),
    }),

  /** 评分拆解 - 查看食物14维评分 + 10因子链 */
  scoreBreakdown: (data: ScoreBreakdownDto): Promise<ScoreBreakdownResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/score-breakdown`, data),

  /** 策略对比 - 两个策略对同一用户的推荐结果差异 */
  strategyDiff: (data: StrategyDiffDto): Promise<StrategyDiffResult> =>
    request.post(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/strategy-diff`, data),

  /** 推荐追踪列表 */
  getTraces: (query?: TraceListQueryDto): Promise<TraceListResponse> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/traces`, query),

  /** 推荐追踪详情 */
  getTraceDetail: (traceId: string): Promise<TraceDetail> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/trace/${traceId}`),

  /** Pipeline 统计 */
  getPipelineStats: (query?: PipelineStatsQueryDto): Promise<PipelineStatsResult> =>
    request.get(`${PATH.ADMIN.RECOMMENDATION_DEBUG}/pipeline-stats`, query),
};

// ==================== React Query Hooks ====================

export const useUserStrategy = (
  userId: string,
  goalType?: string,
  options?: Omit<UseQueryOptions<UserStrategyResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.userStrategy(userId, goalType),
    queryFn: () => recommendDebugApi.getUserStrategy(userId, goalType),
    enabled: !!userId,
    staleTime: 30 * 1000,
    ...options,
  });

export const useQualityDashboard = (
  days?: number,
  options?: Omit<UseQueryOptions<QualityDashboard>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.qualityDashboard(days),
    queryFn: () => recommendDebugApi.getQualityDashboard(days),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useSimulateRecommend = (
  options?: UseMutationOptions<SimulateRecommendResult, Error, SimulateRecommendDto>
) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.simulateRecommend(data),
    ...options,
  });

export const useWhyNot = (options?: UseMutationOptions<WhyNotResult, Error, WhyNotDto>) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.whyNot(data),
    ...options,
  });

// --- 新增 Hooks ---

/** 评分拆解 Mutation */
export const useScoreBreakdown = (
  options?: UseMutationOptions<ScoreBreakdownResult, Error, ScoreBreakdownDto>
) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.scoreBreakdown(data),
    ...options,
  });

/** 策略对比 Mutation */
export const useStrategyDiff = (
  options?: UseMutationOptions<StrategyDiffResult, Error, StrategyDiffDto>
) =>
  useMutation({
    mutationFn: (data) => recommendDebugApi.strategyDiff(data),
    ...options,
  });

/** 推荐追踪列表 Query */
export const useTraces = (
  query?: TraceListQueryDto,
  options?: Omit<UseQueryOptions<TraceListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.traces(query),
    queryFn: () => recommendDebugApi.getTraces(query),
    staleTime: 30 * 1000,
    ...options,
  });

/** 推荐追踪详情 Query */
export const useTraceDetail = (
  traceId: string,
  options?: Omit<UseQueryOptions<TraceDetail>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.traceDetail(traceId),
    queryFn: () => recommendDebugApi.getTraceDetail(traceId),
    enabled: !!traceId,
    staleTime: 60 * 1000,
    ...options,
  });

/** Pipeline 统计 Query */
export const usePipelineStats = (
  query?: PipelineStatsQueryDto,
  options?: Omit<UseQueryOptions<PipelineStatsResult>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: recommendDebugQueryKeys.pipelineStats(query),
    queryFn: () => recommendDebugApi.getPipelineStats(query),
    staleTime: 60 * 1000,
    ...options,
  });
