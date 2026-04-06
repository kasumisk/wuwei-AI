import { create } from 'zustand'
import Taro from '@tarojs/taro'
import type { UserInfo } from '@/types/api'
import { getToken, setToken, removeToken, setUserCache, getUserCache, clearAuth } from '@/utils/storage'
import * as authApi from '@/services/auth'

interface AuthState {
  token: string
  user: UserInfo | null
  isLoggedIn: boolean

  /** 微信小程序一键登录 */
  wxLogin: () => Promise<void>
  /** 手机号验证码登录 */
  phoneLogin: (phone: string, code: string) => Promise<void>
  /** 拉取用户信息 */
  fetchProfile: () => Promise<void>
  /** 退出登录 */
  logout: () => void
  /** 从缓存恢复登录态 */
  restore: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: '',
  user: null,
  isLoggedIn: false,

  restore() {
    const token = getToken()
    const user = getUserCache<UserInfo>()
    if (token) {
      set({ token, user, isLoggedIn: true })
    }
  },

  async wxLogin() {
    const { code } = await Taro.login()
    const res = await authApi.wechatMiniLogin(code)
    setToken(res.token)
    setUserCache(res.user)
    set({ token: res.token, user: res.user, isLoggedIn: true })
  },

  async phoneLogin(phone: string, code: string) {
    const res = await authApi.phoneLogin(phone, code)
    setToken(res.token)
    setUserCache(res.user)
    set({ token: res.token, user: res.user, isLoggedIn: true })
  },

  async fetchProfile() {
    const user = await authApi.getProfile()
    setUserCache(user)
    set({ user })
  },

  logout() {
    clearAuth()
    set({ token: '', user: null, isLoggedIn: false })
    Taro.redirectTo({ url: '/pages/login/index' })
  },
}))
