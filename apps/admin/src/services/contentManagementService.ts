import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';

// ==================== 饮食记录类型 ====================

export interface FoodRecordDto {
  id: string;
  userId: string;
  imageUrl?: string;
  source: string;
  foods: Array<{
    name: string;
    calories: number;
    quantity?: string;
    category?: string;
    protein?: number;
    fat?: number;
    carbs?: number;
  }>;
  totalCalories: number;
  mealType: string;
  decision: string;
  riskLevel?: string;
  nutritionScore: number;
  recordedAt: string;
  createdAt: string;
  user?: { id: string; nickname?: string; email?: string };
}

export interface GetFoodRecordsQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  mealType?: string;
  startDate?: string;
  endDate?: string;
  keyword?: string;
}

// ==================== 每日计划类型 ====================

export interface DailyPlanDto {
  id: string;
  userId: string;
  date: string;
  morningPlan: any;
  lunchPlan: any;
  dinnerPlan: any;
  snackPlan: any;
  adjustments: any[];
  strategy: string;
  totalBudget: number;
  createdAt: string;
}

export interface GetDailyPlansQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  startDate?: string;
  endDate?: string;
}

// ==================== AI对话类型 ====================

export interface ConversationDto {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; nickname?: string; email?: string };
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    tokensUsed: number;
    createdAt: string;
  }>;
}

export interface GetConversationsQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  keyword?: string;
}

// ==================== 推荐反馈类型 ====================

export interface RecommendationFeedbackDto {
  id: string;
  userId: string;
  mealType: string;
  foodName: string;
  action: string;
  replacementFood?: string;
  recommendationScore?: number;
  goalType?: string;
  createdAt: string;
}

export interface GetRecommendationFeedbackQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  action?: string;
  mealType?: string;
}

// ==================== AI决策日志类型 ====================

export interface AiDecisionLogDto {
  id: string;
  userId: string;
  recordId?: string;
  decision?: string;
  riskLevel?: string;
  inputContext?: any;
  fullResponse?: any;
  userFollowed?: boolean;
  userFeedback?: string;
  createdAt: string;
}

export interface GetAiDecisionLogsQuery {
  page?: number;
  pageSize?: number;
  userId?: string;
  decision?: string;
  riskLevel?: string;
}

// ==================== 通用列表响应  ====================

interface ListResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ==================== Query Keys ====================

export const contentQueryKeys = {
  foodRecords: {
    all: ['foodRecords'] as const,
    list: (params?: GetFoodRecordsQuery) => ['foodRecords', 'list', params] as const,
    statistics: ['foodRecords', 'statistics'] as const,
  },
  dailyPlans: {
    all: ['dailyPlans'] as const,
    list: (params?: GetDailyPlansQuery) => ['dailyPlans', 'list', params] as const,
  },
  conversations: {
    all: ['conversations'] as const,
    list: (params?: GetConversationsQuery) => ['conversations', 'list', params] as const,
    detail: (id: string) => ['conversations', 'detail', id] as const,
    statistics: ['conversations', 'statistics'] as const,
  },
  feedback: {
    all: ['recommendationFeedback'] as const,
    list: (params?: GetRecommendationFeedbackQuery) =>
      ['recommendationFeedback', 'list', params] as const,
    statistics: ['recommendationFeedback', 'statistics'] as const,
  },
  aiLogs: {
    all: ['aiDecisionLogs'] as const,
    list: (params?: GetAiDecisionLogsQuery) => ['aiDecisionLogs', 'list', params] as const,
    statistics: ['aiDecisionLogs', 'statistics'] as const,
  },
};

// ==================== API ====================

export const contentApi = {
  // 饮食记录
  getFoodRecords: (params?: GetFoodRecordsQuery): Promise<ListResponse<FoodRecordDto>> =>
    request.get(PATH.ADMIN.CONTENT_FOOD_RECORDS, params),
  getFoodRecordDetail: (id: string): Promise<FoodRecordDto> =>
    request.get(`${PATH.ADMIN.CONTENT_FOOD_RECORDS}/${id}`),
  getFoodRecordStatistics: (): Promise<any> =>
    request.get(`${PATH.ADMIN.CONTENT_FOOD_RECORDS}/statistics`),
  deleteFoodRecord: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.CONTENT_FOOD_RECORDS}/${id}`),

  // 每日计划
  getDailyPlans: (params?: GetDailyPlansQuery): Promise<ListResponse<DailyPlanDto>> =>
    request.get(PATH.ADMIN.CONTENT_DAILY_PLANS, params),
  getDailyPlanDetail: (id: string): Promise<DailyPlanDto> =>
    request.get(`${PATH.ADMIN.CONTENT_DAILY_PLANS}/${id}`),

  // AI 对话
  getConversations: (params?: GetConversationsQuery): Promise<ListResponse<ConversationDto>> =>
    request.get(PATH.ADMIN.CONTENT_CONVERSATIONS, params),
  getConversationDetail: (id: string): Promise<ConversationDto> =>
    request.get(`${PATH.ADMIN.CONTENT_CONVERSATIONS}/${id}`),
  getConversationStatistics: (): Promise<any> =>
    request.get(`${PATH.ADMIN.CONTENT_CONVERSATIONS}/statistics`),
  deleteConversation: (id: string): Promise<{ message: string }> =>
    request.delete(`${PATH.ADMIN.CONTENT_CONVERSATIONS}/${id}`),

  // 推荐反馈
  getRecommendationFeedback: (
    params?: GetRecommendationFeedbackQuery
  ): Promise<ListResponse<RecommendationFeedbackDto>> =>
    request.get(PATH.ADMIN.CONTENT_RECOMMENDATION_FEEDBACK, params),
  getFeedbackStatistics: (): Promise<any> =>
    request.get(`${PATH.ADMIN.CONTENT_RECOMMENDATION_FEEDBACK}/statistics`),

  // AI 决策日志
  getAiDecisionLogs: (params?: GetAiDecisionLogsQuery): Promise<ListResponse<AiDecisionLogDto>> =>
    request.get(PATH.ADMIN.CONTENT_AI_DECISION_LOGS, params),
  getAiLogStatistics: (): Promise<any> =>
    request.get(`${PATH.ADMIN.CONTENT_AI_DECISION_LOGS}/statistics`),
};

// ==================== React Query Hooks ====================

export const useDeleteFoodRecord = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => contentApi.deleteFoodRecord(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contentQueryKeys.foodRecords.all }),
    ...options,
  });
};

export const useDeleteConversation = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => contentApi.deleteConversation(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: contentQueryKeys.conversations.all }),
    ...options,
  });
};
