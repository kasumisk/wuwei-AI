import { get, post } from './request'
import type { FoodLibraryItem, FoodCategory } from '@/types/api'

/** 搜索食物库 */
export function search(q: string, limit = 20) {
  return get<{ items: FoodLibraryItem[]; total: number }>(
    '/foods/search',
    { q, limit },
  )
}

/** 获取热门食物 */
export function getPopular(category?: string, limit = 20) {
  const params: any = { limit }
  if (category) params.category = category
  return get<FoodLibraryItem[]>('/foods/popular', params)
}

/** 获取所有分类 */
export function getCategories() {
  return get<FoodCategory[]>('/foods/categories')
}

/** 获取食物详情 */
export function getByName(name: string) {
  return get<{ food: FoodLibraryItem; relatedFoods: FoodLibraryItem[] }>(
    `/foods/by-name/${encodeURIComponent(name)}`,
  )
}

/** 从食物库添加到今日记录 */
export function addFromLibrary(foodId: string, grams: number, mealType: string) {
  return post('/app/food/records/from-library', { foodId, grams, mealType })
}

/** 获取常吃食物 */
export function getFrequentFoods(limit = 10) {
  return get<FoodLibraryItem[]>('/app/food/frequent-foods', { limit })
}
