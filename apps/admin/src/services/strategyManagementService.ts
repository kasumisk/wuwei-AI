import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 类型定义 ====================

export type StrategyScope = 'global' | 'goal_type' | 'experiment' | 'user';
export type StrategyStatus = 'draft' | 'active' | 'archived';
export type AssignmentType = 'experiment' | 'manual' | 'segment';

export type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';

export const SCORE_DIMENSION_NAMES = [
  'calories', 'protein', 'carbs', 'fat', 'quality', 'satiety',
  'glycemic', 'nutrientDensity', 'inflammation', 'fiber',
  'seasonality', 'executability', 'popularity', 'acquisition',
] as const;
export type StrategyScoreDimension = (typeof SCORE_DIMENSION_NAMES)[number];

export interface RankPolicyConfig {
  baseWeights?: Partial<Record<GoalType, number[]>>;
  mealModifiers?: Record<string, Partial<Record<StrategyScoreDimension, number>>>;
  statusModifiers?: Record<string, Partial<Record<StrategyScoreDimension, number>>>;
}

export interface RecallPolicyConfig {
  sources?: {
    rule?: { enabled?: boolean };
    vector?: { enabled?: boolean; weight?: number };
    cf?: { enabled?: boolean; weight?: number };
    popular?: { enabled?: boolean; weight?: number };
  };
  shortTermRejectThreshold?: number;
}

export interface BoostPolicyConfig {
  preference?: {
    lovesMultiplier?: number;
    avoidsMultiplier?: number;
  };
  cfBoostCap?: number;
  shortTerm?: {
    boostRange?: [number, number];
    singleRejectPenalty?: number;
  };
  similarityPenaltyCoeff?: number;
}

export interface ExplorationPolicyConfig {
  baseMin?: number;
  baseMax?: number;
  maturityShrink?: number;
  matureThreshold?: number;
}

export interface MealPolicyConfig {
  mealRoles?: Record<string, string[]>;
  roleCategories?: Record<string, string[]>;
  mealRatios?: Partial<Record<GoalType, Record<string, number>>>;
  macroRanges?: Partial<Record<GoalType, { carb: [number, number]; fat: [number, number] }>>;
}

export type MultiObjectiveDimension = 'health' | 'taste' | 'cost' | 'convenience';

export interface MultiObjectiveConfig {
  enabled?: boolean;
  preferences?: Partial<Record<MultiObjectiveDimension, number>>;
  paretoFrontLimit?: number;
  tastePreference?: {
    spicy?: number;
    sweet?: number;
    salty?: number;
    sour?: number;
    umami?: number;
    bitter?: number;
  };
  costSensitivity?: number;
}

export interface AssemblyPolicyConfig {
  preferRecipe?: boolean;
  diversityLevel?: 'low' | 'medium' | 'high';
}

export interface ExplainPolicyConfig {
  detailLevel?: 'simple' | 'standard' | 'detailed';
  showNutritionRadar?: boolean;
}

export interface RealismConfig {
  enabled?: boolean;
  commonalityThreshold?: number;
  budgetFilterEnabled?: boolean;
  cookTimeCapEnabled?: boolean;
  weekdayCookTimeCap?: number;
  weekendCookTimeCap?: number;
  executabilityWeightMultiplier?: number;
  canteenMode?: boolean;
}

export interface StrategyConfig {
  rank?: RankPolicyConfig;
  recall?: RecallPolicyConfig;
  boost?: BoostPolicyConfig;
  meal?: MealPolicyConfig;
  multiObjective?: MultiObjectiveConfig;
  exploration?: ExplorationPolicyConfig;
  assembly?: AssemblyPolicyConfig;
  explain?: ExplainPolicyConfig;
  realism?: RealismConfig;
}

export interface StrategyDto {
  id: string;
  name: string;
  description: string | null;
  scope: StrategyScope;
  scopeTarget: string | null;
  config: StrategyConfig;
  status: StrategyStatus;
  version: number;
  priority: number;
  createdAt: string;
  updatedAt: string;
  activeAssignmentCount?: number;
}

export interface GetStrategiesQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  scope?: StrategyScope | '';
  status?: StrategyStatus | '';
}

export interface StrategiesListResponse {
  list: StrategyDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateStrategyDto {
  name: string;
  description?: string;
  scope: StrategyScope;
  scopeTarget?: string;
  config: StrategyConfig;
  priority?: number;
}

export interface UpdateStrategyDto {
  name?: string;
  description?: string;
  config?: StrategyConfig;
  priority?: number;
}

export interface AssignStrategyDto {
  userId: string;
  assignmentType: AssignmentType;
  source?: string;
  activeFrom?: string;
  activeUntil?: string;
}

export interface StrategyAssignmentDto {
  id: string;
  userId: string;
  strategyId: string;
  assignmentType: AssignmentType;
  source: string | null;
  isActive: boolean;
  activeFrom: string | null;
  activeUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetAssignmentsQuery {
  page?: number;
  pageSize?: number;
  isActive?: boolean;
  assignmentType?: AssignmentType | '';
}

export interface AssignmentsListResponse {
  list: StrategyAssignmentDto[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface StrategyOverview {
  totalStrategies: number;
  activeStrategies: number;
  draftStrategies: number;
  archivedStrategies: number;
  totalActiveAssignments: number;
  scopeDistribution: Array<{ scope: string; count: string }>;
}

// ==================== Query Keys ====================

const _all = ['strategies'] as const;

export const strategyQueryKeys = {
  all: _all,
  list: (params?: GetStrategiesQuery) => [..._all, 'list', params] as const,
  detail: (id: string) => [..._all, 'detail', id] as const,
  overview: [..._all, 'overview'] as const,
  assignments: (strategyId: string, params?: GetAssignmentsQuery) =>
    [..._all, 'assignments', strategyId, params] as const,
};

// ==================== API ====================

export const strategyApi = {
  /** 获取策略列表 */
  getStrategies: (params?: GetStrategiesQuery): Promise<StrategiesListResponse> =>
    request.get(PATH.ADMIN.STRATEGIES, params),

  /** 获取策略详情 */
  getStrategyById: (id: string): Promise<StrategyDto> =>
    request.get(`${PATH.ADMIN.STRATEGIES}/${id}`),

  /** 创建策略 */
  createStrategy: (data: CreateStrategyDto): Promise<StrategyDto> =>
    request.post(PATH.ADMIN.STRATEGIES, data),

  /** 更新策略 */
  updateStrategy: (id: string, data: UpdateStrategyDto): Promise<StrategyDto> =>
    request.put(`${PATH.ADMIN.STRATEGIES}/${id}`, data),

  /** 激活策略 */
  activateStrategy: (id: string): Promise<StrategyDto> =>
    request.post(`${PATH.ADMIN.STRATEGIES}/${id}/activate`),

  /** 归档策略 */
  archiveStrategy: (id: string): Promise<StrategyDto> =>
    request.post(`${PATH.ADMIN.STRATEGIES}/${id}/archive`),

  /** 获取策略概览 */
  getOverview: (): Promise<StrategyOverview> => request.get(`${PATH.ADMIN.STRATEGIES}/overview`),

  /** 分配策略给用户 */
  assignStrategy: (strategyId: string, data: AssignStrategyDto): Promise<StrategyAssignmentDto> =>
    request.post(`${PATH.ADMIN.STRATEGIES}/${strategyId}/assign`, data),

  /** 获取策略的分配列表 */
  getAssignments: (
    strategyId: string,
    params?: GetAssignmentsQuery
  ): Promise<AssignmentsListResponse> =>
    request.get(`${PATH.ADMIN.STRATEGIES}/${strategyId}/assignments`, params),

  /** 取消策略分配 */
  removeAssignment: (
    strategyId: string,
    assignmentId: string,
    data: { userId: string }
  ): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.STRATEGIES}/${strategyId}/assignments/${assignmentId}`, { data }),
};

// ==================== React Query Hooks ====================

export const useStrategies = (
  params?: GetStrategiesQuery,
  options?: Omit<UseQueryOptions<StrategiesListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyQueryKeys.list(params),
    queryFn: () => strategyApi.getStrategies(params),
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useStrategyDetail = (
  id: string,
  enabled = true,
  options?: Omit<UseQueryOptions<StrategyDto>, 'queryKey' | 'queryFn' | 'enabled'>
) =>
  useQuery({
    queryKey: strategyQueryKeys.detail(id),
    queryFn: () => strategyApi.getStrategyById(id),
    enabled,
    staleTime: 2 * 60 * 1000,
    ...options,
  });

export const useStrategyOverview = (
  options?: Omit<UseQueryOptions<StrategyOverview>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyQueryKeys.overview,
    queryFn: () => strategyApi.getOverview(),
    staleTime: 5 * 60 * 1000,
    ...options,
  });

export const useStrategyAssignments = (
  strategyId: string,
  params?: GetAssignmentsQuery,
  options?: Omit<UseQueryOptions<AssignmentsListResponse>, 'queryKey' | 'queryFn'>
) =>
  useQuery({
    queryKey: strategyQueryKeys.assignments(strategyId, params),
    queryFn: () => strategyApi.getAssignments(strategyId, params),
    staleTime: 2 * 60 * 1000,
    enabled: !!strategyId,
    ...options,
  });

export const useCreateStrategy = (
  options?: UseMutationOptions<StrategyDto, Error, CreateStrategyDto>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => strategyApi.createStrategy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.all });
    },
    ...options,
  });
};

export const useUpdateStrategy = (
  options?: UseMutationOptions<StrategyDto, Error, { id: string; data: UpdateStrategyDto }>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => strategyApi.updateStrategy(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.detail(id) });
    },
    ...options,
  });
};

export const useActivateStrategy = (options?: UseMutationOptions<StrategyDto, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => strategyApi.activateStrategy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.all });
    },
    ...options,
  });
};

export const useArchiveStrategy = (options?: UseMutationOptions<StrategyDto, Error, string>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => strategyApi.archiveStrategy(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.all });
    },
    ...options,
  });
};

export const useAssignStrategy = (
  options?: UseMutationOptions<
    StrategyAssignmentDto,
    Error,
    { strategyId: string; data: AssignStrategyDto }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, data }) => strategyApi.assignStrategy(strategyId, data),
    onSuccess: (_, { strategyId }) => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.assignments(strategyId) });
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.detail(strategyId) });
    },
    ...options,
  });
};

export const useRemoveAssignment = (
  options?: UseMutationOptions<
    { message: string },
    Error,
    { strategyId: string; assignmentId: string; userId: string }
  >
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ strategyId, assignmentId, userId }) =>
      strategyApi.removeAssignment(strategyId, assignmentId, { userId }),
    onSuccess: (_, { strategyId }) => {
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.assignments(strategyId) });
      queryClient.invalidateQueries({ queryKey: strategyQueryKeys.detail(strategyId) });
    },
    ...options,
  });
};

export default strategyApi;
