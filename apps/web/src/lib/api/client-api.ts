'use client';

import { HttpClient } from './http-client';
import { env } from '../env';
import { getClientAcceptLanguage } from '../i18n/accept-language';
import { useAuthStore } from '@/features/auth/store/auth-store';
import { useSubscriptionStore } from '@/features/subscription/store/subscription-store';
import { useDismissStore } from '@/store';
import { queryClient } from '@/lib/react-query/client';
import { useToastStore } from '@/lib/hooks/use-toast';

/**
 * 客户端 API 实例
 * 用于浏览器端的 API 调用
 */
class ClientAPI extends HttpClient {
  /** 防止 401 重复跳转 */
  private isRedirectingToLogin = false;

  constructor() {
    super(env.NEXT_PUBLIC_API_URL, 30000);

    // 添加客户端特定的请求拦截器
    this.addRequestInterceptor({
      onFulfilled: (config) => {
        // 添加认证 token
        const token = this.getAuthToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }

        // 注入 Accept-Language，server 端 i18n 中间件读取此头决定响应语言
        config.headers['Accept-Language'] = getClientAcceptLanguage();

        // 添加客户端特定的 headers
        config.headers['X-Client-Type'] = 'web';
        config.headers['X-Request-ID'] = this.generateRequestId();

        return config;
      },
    });

    // 添加客户端特定的响应拦截器
    this.addResponseInterceptor({
      onRejected: (error) => {
        // 处理 401 未授权：清除登录态并跳转登录页
        if (error.statusCode === 401) {
          this.clearAuthToken();
          // 同时清除 Zustand auth state
          try {
            useAuthStore.getState().clearAuth();
            // 清除 React Query 缓存，防止账号切换后数据污染
            queryClient.clear();
            // 重置其他用户相关的 zustand store
            useSubscriptionStore.getState().reset();
            useDismissStore.getState().resetAllDismissed();
          } catch {
            // auth store 可能尚未初始化，忽略
          }
          // 跳转登录页（防止并发请求重复跳转）
          if (typeof window !== 'undefined' && !this.isRedirectingToLogin) {
            this.isRedirectingToLogin = true;
            // 获取当前 locale 前缀以支持国际化路由
            const { pathname } = window.location;
            // 不在登录页时才跳转，避免死循环
            if (!pathname.endsWith('/login')) {
              const localeMatch = pathname.match(/^\/(en|zh|fr|ja)(\/|$)/);
              const prefix = localeMatch ? `/${localeMatch[1]}` : '';
              window.location.href = `${prefix}/login`;
            } else {
              this.isRedirectingToLogin = false;
            }
          }
        }

        // 处理 500+ 服务端错误：显示 Toast 通知
        if (error.statusCode >= 500) {
          try {
            useToastStore.getState().addToast({
              title: '服务器错误',
              description: '服务暂时不可用，请稍后重试',
              variant: 'destructive',
              duration: 5000,
            });
          } catch {
            // toast store 可能尚未初始化，忽略
          }
        }

        return error;
      },
    });
  }

  /**
   * 获取认证 token
   */
  private getAuthToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('app_auth_token');
  }

  /**
   * 清除认证 token
   */
  private clearAuthToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('app_auth_token');
  }

  /**
   * 设置认证 token
   */
  public setAuthToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('app_auth_token', token);
  }

  /**
   * 生成请求 ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 导出单例
export const clientAPI = new ClientAPI();

// 导出便捷方法
export const clientGet = clientAPI.get.bind(clientAPI);
export const clientPost = clientAPI.post.bind(clientAPI);
export const clientPut = clientAPI.put.bind(clientAPI);
export const clientPatch = clientAPI.patch.bind(clientAPI);
export const clientDelete = clientAPI.delete.bind(clientAPI);
export const clientUpload = clientAPI.upload.bind(clientAPI);
export const clientDownload = clientAPI.download.bind(clientAPI);
