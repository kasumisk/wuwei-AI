import { get, post, put, del } from './request';
import Taro from '@tarojs/taro';
import type {
  FoodRecord,
  AnalysisResult,
  DailySummary,
  UserProfile,
  DailyPlan,
  MealSuggestion,
} from '@/types/api';

const API_BASE_URL = process.env.TARO_APP_API_URL || 'https://uway-api.dev-net.uk/api';

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 上传图片并分析食物（异步队列 + 轮询）
 *
 * 后端 POST /app/food/analyze 返回 { requestId, status: 'processing', imageUrl }
 * 需要轮询 GET /app/food/analyze/:requestId 直到 completed / failed
 */
export async function analyzeImage(filePath: string, mealType: string): Promise<AnalysisResult> {
  const token = Taro.getStorageSync('app_auth_token') || '';

  // 1. 提交分析任务
  const uploadRes = await Taro.uploadFile({
    url: `${API_BASE_URL}/app/food/analyze`,
    filePath,
    name: 'file',
    formData: { mealType },
    header: {
      Authorization: `Bearer ${token}`,
    },
  });
  const submitBody = JSON.parse(uploadRes.data);
  if (!submitBody.success) throw new Error(submitBody.message || '分析提交失败');

  const { requestId, imageUrl } = submitBody.data as {
    requestId: string;
    status: string;
    imageUrl: string;
  };

  // 2. 轮询获取结果（最多 60 秒，间隔 2 秒）
  const maxAttempts = 30;
  const pollInterval = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(pollInterval);

    const pollResult = await get<{
      requestId: string;
      status: string;
      error?: string;
      // completed 时返回的旧格式字段
      foods?: AnalysisResult['foods'];
      totalCalories?: number;
      advice?: string;
      isHealthy?: boolean;
      imageUrl?: string;
    }>(`/app/food/analyze/${requestId}`);

    if (pollResult.status === 'completed') {
      return {
        foods: pollResult.foods || [],
        totalCalories: pollResult.totalCalories || 0,
        advice: pollResult.advice,
        isHealthy: pollResult.isHealthy,
        imageUrl: pollResult.imageUrl || imageUrl,
      };
    }

    if (pollResult.status === 'failed') {
      throw new Error(pollResult.error || 'AI 分析失败');
    }

    // status === 'processing' → 继续轮询
  }

  throw new Error('分析超时，请稍后重试');
}

/** 保存食物记录 */
export function saveRecord(data: {
  foods: any[];
  totalCalories: number;
  mealType: string;
  imageUrl?: string;
  source?: string;
  advice?: string;
  isHealthy?: boolean;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  avgQuality?: number;
  avgSatiety?: number;
}) {
  return post<FoodRecord>('/app/food/records', data);
}

/** 获取今日记录 */
export function getTodayRecords() {
  return get<FoodRecord[]>('/app/food/records/today');
}

/** 获取历史记录 */
export function getRecords(page = 1, limit = 20, date?: string) {
  const params: any = { page, limit };
  if (date) params.date = date;
  return get<{ items: FoodRecord[]; total: number }>('/app/food/records', params);
}

/** 更新记录 */
export function updateRecord(id: string, data: Partial<FoodRecord>) {
  return put<FoodRecord>(`/app/food/records/${id}`, data);
}

/** 删除记录 */
export function deleteRecord(id: string) {
  return del(`/app/food/records/${id}`);
}

/** 今日摘要 */
export function getTodaySummary() {
  return get<DailySummary>('/app/food/summary/today');
}

/** 近N天摘要 */
export function getRecentSummaries(days = 7) {
  return get<DailySummary[]>('/app/food/summary/recent', { days });
}

/** 获取健康档案 */
export function getProfile() {
  return get<UserProfile>('/app/food/profile');
}

/** 保存健康档案 */
export function saveProfile(data: Partial<UserProfile>) {
  return put<UserProfile>('/app/food/profile', data);
}

/** 获取今日饮食计划 */
export function getDailyPlan() {
  return get<DailyPlan>('/app/food/daily-plan');
}

/** 获取下一餐推荐 */
export function getMealSuggestion() {
  return get<MealSuggestion>('/app/food/meal-suggestion');
}
