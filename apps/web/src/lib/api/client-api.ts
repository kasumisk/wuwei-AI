'use client';

import { HttpClient } from './http-client';
import { env } from '../env';

/**
 * 客户端 API 实例
 * 用于浏览器端的 API 调用
 */
class ClientAPI extends HttpClient {
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

        // 添加客户端特定的 headers
        config.headers['X-Client-Type'] = 'web';
        config.headers['X-Request-ID'] = this.generateRequestId();

        return config;
      },
    });

    // 添加客户端特定的响应拦截器
    this.addResponseInterceptor({
      onRejected: (error) => {
        // 处理特定错误码
        if (error.statusCode === 401) {
          // 未授权，清除 token 并跳转登录
          this.clearAuthToken();
          // window.location.href = '/login';
        }

        // 可以在这里集成 Toast 通知
        if (error.statusCode >= 500) {
          // toast.error('服务器错误，请稍后重试');
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
    return localStorage.getItem('auth_token');
  }

  /**
   * 清除认证 token
   */
  private clearAuthToken(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem('auth_token');
  }

  /**
   * 设置认证 token
   */
  public setAuthToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem('auth_token', token);
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
