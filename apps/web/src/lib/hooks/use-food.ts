'use client';

/**
 * @deprecated Use feature-specific hooks instead:
 * - useHomeData() from @/features/home/hooks/use-home-data
 * - useFoodAnalysis() from @/features/food-analysis/hooks/use-food-analysis
 * - useProfile() from @/features/profile/hooks/use-profile
 * - useChallenges() from @/features/challenge/hooks/use-challenges
 */
import { useState, useCallback } from 'react';
import {
  foodService,
  type AnalysisResult,
  type FoodRecord,
  type DailySummary,
  type UserProfile,
  type FoodItem,
  type DailySummaryRecord,
  type MealSuggestion,
  type DailyPlanData,
  type BehaviorProfile,
  type ProactiveReminder,
  type Achievement,
  type UserAchievement,
  type ChallengeItem,
  type UserChallengeItem,
  type StreakStatus,
} from '@/lib/api/food';

/**
 * 饮食记录 + AI 分析 hook
 */
export function useFood() {
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  /** 上传图片 AI 分析 */
  const analyzeImage = useCallback(
    async (file: File, mealType?: string): Promise<AnalysisResult> => {
      setAnalyzing(true);
      try {
        return await foodService.analyzeImage(file, mealType);
      } finally {
        setAnalyzing(false);
      }
    },
    []
  );

  /** 保存饮食记录 */
  const saveRecord = useCallback(
    async (data: {
      requestId?: string;
      imageUrl?: string;
      foods: FoodItem[];
      totalCalories: number;
      mealType?: string;
      advice?: string;
      isHealthy?: boolean;
      decision?: string;
      riskLevel?: string;
      reason?: string;
      suggestion?: string;
      insteadOptions?: string[];
      compensation?: { diet?: string; activity?: string; nextMeal?: string };
      contextComment?: string;
      encouragement?: string;
    }): Promise<FoodRecord> => {
      setLoading(true);
      try {
        return await foodService.saveRecord(data);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /** 获取今日记录 */
  const getTodayRecords = useCallback(async (): Promise<FoodRecord[]> => {
    return foodService.getTodayRecords();
  }, []);

  /** 分页查询记录 */
  const getRecords = useCallback(
    async (params?: { page?: number; limit?: number; date?: string }) => {
      return foodService.getRecords(params);
    },
    []
  );

  /** 删除记录 */
  const deleteRecord = useCallback(async (id: string): Promise<void> => {
    setLoading(true);
    try {
      await foodService.deleteRecord(id);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 获取今日汇总 */
  const getTodaySummary = useCallback(async (): Promise<DailySummary> => {
    return foodService.getTodaySummary();
  }, []);

  /** 获取最近 N 天汇总 */
  const getRecentSummaries = useCallback(async (days?: number): Promise<DailySummaryRecord[]> => {
    return foodService.getRecentSummaries(days);
  }, []);

  /** 获取用户档案 */
  const getProfile = useCallback(async (): Promise<UserProfile | null> => {
    return foodService.getProfile();
  }, []);

  /** 保存用户档案 */
  const saveProfile = useCallback(async (data: Partial<UserProfile>): Promise<UserProfile> => {
    setLoading(true);
    try {
      return await foodService.saveProfile(data);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 获取下一餐推荐 */
  const getMealSuggestion = useCallback(async (): Promise<MealSuggestion> => {
    return foodService.getMealSuggestion();
  }, []);

  // ── V2: 每日计划 ──
  const getDailyPlan = useCallback(async (): Promise<DailyPlanData> => {
    return foodService.getDailyPlan();
  }, []);

  const adjustDailyPlan = useCallback(async (reason: string) => {
    return foodService.adjustDailyPlan(reason);
  }, []);

  // ── V3: 行为建模 ──
  const getBehaviorProfile = useCallback(async (): Promise<BehaviorProfile> => {
    return foodService.getBehaviorProfile();
  }, []);

  const proactiveCheck = useCallback(async (): Promise<{ reminder: ProactiveReminder | null }> => {
    return foodService.proactiveCheck();
  }, []);

  const decisionFeedback = useCallback(
    async (recordId: string, followed: boolean, feedback: 'helpful' | 'unhelpful' | 'wrong') => {
      return foodService.decisionFeedback(recordId, followed, feedback);
    },
    []
  );

  // ── V4: 游戏化 ──
  const getAchievements = useCallback(async (): Promise<{
    all: Achievement[];
    unlocked: UserAchievement[];
  }> => {
    return foodService.getAchievements();
  }, []);

  const getChallenges = useCallback(async (): Promise<{
    available: ChallengeItem[];
    active: UserChallengeItem[];
  }> => {
    return foodService.getChallenges();
  }, []);

  const joinChallenge = useCallback(async (challengeId: string): Promise<UserChallengeItem> => {
    return foodService.joinChallenge(challengeId);
  }, []);

  const getStreak = useCallback(async (): Promise<StreakStatus> => {
    return foodService.getStreak();
  }, []);

  // ── V5: 教练风格 ──
  const updateCoachStyle = useCallback(async (style: 'strict' | 'friendly' | 'data') => {
    return foodService.updateCoachStyle(style);
  }, []);

  return {
    loading,
    analyzing,
    analyzeImage,
    saveRecord,
    getTodayRecords,
    getRecords,
    deleteRecord,
    getTodaySummary,
    getRecentSummaries,
    getProfile,
    saveProfile,
    getMealSuggestion,
    // V2
    getDailyPlan,
    adjustDailyPlan,
    // V3
    getBehaviorProfile,
    proactiveCheck,
    decisionFeedback,
    // V4
    getAchievements,
    getChallenges,
    joinChallenge,
    getStreak,
    // V5
    updateCoachStyle,
  };
}
