'use client';

import { useCallback } from 'react';
import { useAuthStore } from '../store/auth-store';
import appAuthService, { type AppLoginResponse } from '@/lib/api/user/auth';

function getDeviceId(): string {
  if (typeof window === 'undefined') return '';
  let deviceId = localStorage.getItem('app_device_id');
  if (!deviceId) {
    deviceId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem('app_device_id', deviceId);
  }
  return deviceId;
}

export function useAuth() {
  const {
    user,
    token,
    initialized,
    hydrated,
    loading,
    setAuth,
    clearAuth,
    setLoading,
    setInitialized,
  } =
    useAuthStore();

  const isLoggedIn = !!token && !!user;
  const isAnonymous = isLoggedIn && user?.authType === 'anonymous';

  const handleLoginResponse = useCallback(
    (res: AppLoginResponse) => {
      setAuth(res.user, res.token);
      return res;
    },
    [setAuth]
  );

  const loginAnonymously = useCallback(async () => {
    setLoading(true);
    try {
      const res = await appAuthService.anonymousLogin(getDeviceId());
      return handleLoginResponse(res);
    } finally {
      setLoading(false);
    }
  }, [handleLoginResponse, setLoading]);

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.googleLogin(idToken);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const loginWithFirebase = useCallback(
    async (firebaseToken: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.loginWithFirebase(firebaseToken);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const loginWithEmail = useCallback(
    async (email: string, password: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.emailLogin(email, password);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, nickname?: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.emailRegister(email, password, nickname);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const logout = useCallback(async () => {
    try {
      await appAuthService.logout();
    } catch {
      // 即使 API 调用失败也清除本地状态
    }
    clearAuth();
  }, [clearAuth]);

  const sendPhoneCode = useCallback(
    async (phone: string) => {
      setLoading(true);
      try {
        return await appAuthService.sendPhoneCode(phone);
      } finally {
        setLoading(false);
      }
    },
    [setLoading]
  );

  const loginWithPhone = useCallback(
    async (phone: string, code: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.phoneLogin(phone, code, getDeviceId());
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const getWechatAuthUrl = useCallback(async (redirectUri: string, state?: string) => {
    return await appAuthService.getWechatAuthUrl(redirectUri, state);
  }, []);

  const loginWithWechat = useCallback(
    async (code: string) => {
      setLoading(true);
      try {
        const res = await appAuthService.wechatLogin(code);
        return handleLoginResponse(res);
      } finally {
        setLoading(false);
      }
    },
    [handleLoginResponse, setLoading]
  );

  const loginWithWechatToken = useCallback(
    async (jwtToken: string) => {
      setLoading(true);
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('app_auth_token', jwtToken);
        }
        const profile = await appAuthService.getProfile();
        setAuth(profile, jwtToken);
      } catch {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('app_auth_token');
        }
        throw new Error('微信登录失败，请重试');
      } finally {
        setLoading(false);
      }
    },
    [setAuth, setLoading]
  );

  const restoreAuth = useCallback(async () => {
    // 等待 persist hydration 完成，避免刷新时 token 尚未恢复就被匿名登录覆盖。
    if (!hydrated) return;
    if (initialized) return;
    if (!token) {
      // 无 token: 自动匿名登录，让用户零门槛体验
      try {
        const res = await appAuthService.anonymousLogin(getDeviceId());
        setAuth(res.user, res.token);
      } catch {
        // 匿名登录失败（网络等）不阻塞，用户仍可浏览
      }
      setInitialized();
      return;
    }
    try {
      const profile = await appAuthService.getProfile();
      setAuth(profile, token);
    } catch {
      clearAuth();
    }
    setInitialized();
  }, [hydrated, initialized, token, setAuth, clearAuth, setInitialized]);

  return {
    user,
    token,
    isLoggedIn,
    isAnonymous,
    hydrated,
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
    loginWithWechatToken,
    logout,
    restoreAuth,
  };
}
