'use client';

import { useCallback } from 'react';
import { useAuthStore } from '@/store/auth';
import {
  anonymousLogin,
  googleLogin,
  loginWithFirebase as apiLoginWithFirebase,
  emailLogin,
  emailRegister,
  getProfile,
  logout as apiLogout,
  sendPhoneCode as apiSendPhoneCode,
  phoneLogin as apiPhoneLogin,
  getWechatAuthUrl as apiGetWechatAuthUrl,
  wechatLogin as apiWechatLogin,
  type AppLoginResponse,
} from '@/lib/api/app-auth';

/**
 * 生成或获取设备 ID
 */
function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let deviceId = localStorage.getItem('app_device_id');
  if (!deviceId) {
    deviceId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem('app_device_id', deviceId);
  }
  return deviceId;
}

/**
 * App 用户认证 hook
 */
export function useAuth() {
  const { user, token, initialized, loading, setAuth, clearAuth, setLoading, setInitialized } =
    useAuthStore();

  const isLoggedIn = !!token && !!user;

  /** 处理登录成功响应 */
  const handleLoginResponse = useCallback(
    (res: AppLoginResponse) => {
      setAuth(res.user, res.token);
      return res;
    },
    [setAuth],
  );

  /** 匿名登录 */
  const loginAnonymously = useCallback(async () => {
    setLoading(true);
    try {
      const res = await anonymousLogin(getDeviceId());
      return handleLoginResponse(res);
    } finally {
      setLoading(false);
    }
  }, [handleLoginResponse, setLoading]);

  /** Google 登录 */
  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      setLoading(true);
      try {
        const res = await googleLogin(idToken);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** Firebase 登录（Google/Email via Firebase） */
  const loginWithFirebase = useCallback(
    async (firebaseToken: string) => {
      setLoading(true);
      try {
        const res = await apiLoginWithFirebase(firebaseToken);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** 邮箱密码登录 */
  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const res = await emailLogin(email, password);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** 邮箱注册 */
  const registerWithEmail = useCallback(
    async (email: string, password: string, nickname?: string) => {
      setLoading(true);
      try {
        const res = await emailRegister(email, password, nickname);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** 退出登录 */
  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // 即使 API 调用失败也清除本地状态
    }
    clearAuth();
  }, [clearAuth]);

  /** 发送手机验证码 */
  const sendPhoneCode = useCallback(async (phone: string) => {
    setLoading(true);
    try {
      return await apiSendPhoneCode(phone);
    } finally {
      setLoading(false);
    }
  }, [setLoading]);

  /** 手机验证码登录 */
  const loginWithPhone = useCallback(
    async (phone: string, code: string) => {
      setLoading(true);
      try {
        const res = await apiPhoneLogin(phone, code, getDeviceId());
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** 获取微信授权 URL */
  const getWechatAuthUrl = useCallback(
    async (redirectUri: string, state?: string) => {
      return await apiGetWechatAuthUrl(redirectUri, state);
    },
    [],
  );

  /** 微信 code 登录 */
  const loginWithWechat = useCallback(
    async (code: string) => {
      setLoading(true);
      try {
        const res = await apiWechatLogin(code);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading],
  );

  /** 恢复登录态（初始化时调用） */
  const restoreAuth = useCallback(async () => {
    if (initialized) return;
    if (!token) {
      setInitialized();
      return;
    }
    try {
      const profile = await getProfile();
      setAuth(profile, token);
    } catch {
      clearAuth();
    }
    setInitialized();
  }, [initialized, token, setAuth, clearAuth, setInitialized]);

  return {
    user,
    token,
    isLoggedIn,
    initialized,
    loading,
    loginAnonymously,
    loginWithGoogle,
    loginWithFirebase,
    loginWithEmail,
    registerWithEmail,
    sendPhoneCode,
    loginWithPhone,
    getWechatAuthUrl,
    loginWithWechat,
    logout,
    restoreAuth,
  };
}
