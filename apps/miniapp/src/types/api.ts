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
