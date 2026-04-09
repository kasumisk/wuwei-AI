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

/** 上传图片并分析食物 */
export async function analyzeImage(filePath: string, mealType: string): Promise<AnalysisResult> {
  const token = Taro.getStorageSync('app_auth_token') || '';
  const res = await Taro.uploadFile({
    url: `${API_BASE_URL}/app/food/analyze`,
    filePath,
    name: 'file',
    formData: { mealType },
    header: {
      Authorization: `Bearer ${token}`,
    },
  });
  const body = JSON.parse(res.data);
  if (!body.success) throw new Error(body.message || '分析失败');
  return body.data;
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
