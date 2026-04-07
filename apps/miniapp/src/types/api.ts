/** API 统一响应格式 */
export interface ApiResponse<T = any> {
  success: boolean
  code: number
  message: string
  data: T
}

/** 用户信息 */
export interface UserInfo {
  id: string
  authType: string
  email?: string
  phone?: string
  nickname?: string
  avatar?: string
  status: string
  emailVerified: boolean
  phoneVerified?: boolean
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

/** 登录响应 */
export interface LoginResponse {
  token: string
  user: UserInfo
  isNewUser: boolean
}

/** 食物条目 */
export interface FoodItem {
  name: string
  calories: number
  quantity?: string
  category?: string
}

/** 分析结果 */
export interface AnalysisResult {
  foods: FoodItem[]
  totalCalories: number
  advice?: string
  isHealthy?: boolean
}

/** 食物记录 */
export interface FoodRecord {
  id: string
  userId: string
  imageUrl?: string
  source: 'screenshot' | 'camera' | 'manual'
  foods: FoodItem[]
  totalCalories: number
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  advice?: string
  isHealthy?: boolean
  recordedAt: string
  createdAt: string
  updatedAt: string
}

/** 每日摘要 */
export interface DailySummary {
  date: string
  totalCalories: number
  mealCount: number
  calorieGoal?: number
  meals?: {
    breakfast: number
    lunch: number
    dinner: number
    snack: number
  }
}

/** 健康档案 */
export interface UserProfile {
  id?: string
  userId?: string
  gender?: 'male' | 'female'
  birthYear?: number
  heightCm?: number
  weightKg?: number
  targetWeightKg?: number
  activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active'
  dailyCalorieGoal?: number
  createdAt?: string
  updatedAt?: string
}

/** 食物库条目 */
export interface FoodLibraryItem {
  id: string
  name: string
  aliases?: string[]
  category: string
  caloriesPer100g: number
  proteinPer100g?: number
  fatPer100g?: number
  carbsPer100g?: number
  fiberPer100g?: number
  standardServingG?: number
  standardServingDesc?: string
  searchWeight?: number
  isVerified?: boolean
}

/** 教练消息 */
export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/** 教练对话 */
export interface CoachConversation {
  id: string
  title?: string
  createdAt: string
  updatedAt: string
}

/** 每日问候 */
export interface DailyGreeting {
  greeting: string
  suggestions?: string[]
}

/** 食物分类 */
export interface FoodCategory {
  name: string
  count: number
}
