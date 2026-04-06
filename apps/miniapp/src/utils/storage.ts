import Taro from '@tarojs/taro'

const TOKEN_KEY = 'app_auth_token'
const USER_KEY = 'app_user_info'

export function getToken(): string {
  return Taro.getStorageSync(TOKEN_KEY) || ''
}

export function setToken(token: string): void {
  Taro.setStorageSync(TOKEN_KEY, token)
}

export function removeToken(): void {
  Taro.removeStorageSync(TOKEN_KEY)
}

export function getUserCache<T = any>(): T | null {
  const data = Taro.getStorageSync(USER_KEY)
  return data || null
}

export function setUserCache<T = any>(user: T): void {
  Taro.setStorageSync(USER_KEY, user)
}

export function removeUserCache(): void {
  Taro.removeStorageSync(USER_KEY)
}

export function clearAuth(): void {
  removeToken()
  removeUserCache()
}
