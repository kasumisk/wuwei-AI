import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import { globalMessage } from '@/utils/message';
import { useUserStore } from '@/store/userStore';
import type { ApiResponse } from '@ai-platform/shared';

// 获取 token 的辅助函数
const getToken = (): string | null => {
  return useUserStore.getState().token;
};

// 清除用户信息的辅助函数
const clearUserInfo = (): void => {
  useUserStore.getState().logout();
};

// 创建 axios 实例
const createAxiosInstance = (): AxiosInstance => {
  const instance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
    timeout: 10000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // 请求拦截器
  instance.interceptors.request.use(
    (config) => {
      // 添加 token
      const token = getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      // 添加请求时间戳（防止缓存）
      if (config.method === 'get') {
        config.params = {
          ...config.params,
          _t: Date.now(),
        };
      }

      // 开发环境打印请求信息
      if (import.meta.env.DEV) {
        console.log('🚀 Request:', {
          url: config.url,
          method: config.method,
          params: config.params,
          data: config.data,
        });
      }

      return config;
    },
    (error) => {
      console.error('Request Error:', error);
      return Promise.reject(error);
    }
  );

  // 响应拦截器
  instance.interceptors.response.use(
    (response) => {
      const { data } = response as { data: ApiResponse };

      // 开发环境打印响应信息
      if (import.meta.env.DEV) {
        console.log('📦 Response:', {
          url: response.config.url,
          data,
        });
      }

      // 处理业务成功
      if (data.success === true || data.code === 200 || data.code === 0) {
        return data.data;
      }

      // 处理401未授权
      if (data.code === 401) {
        globalMessage.error(data.message || '登录已过期，请重新登录');
        clearUserInfo();
        window.location.href = '/login';
        return Promise.reject(data.message);
      }

      // 处理其他业务错误
      const errorMessage = data.message || '请求失败';
      globalMessage.error(errorMessage);
      return Promise.reject(new Error(errorMessage));
    },
    (error) => {
      // 处理 HTTP 错误
      const { response, code, message: errorMessage } = error;

      if (code === 'ECONNABORTED') {
        globalMessage.error('请求超时，请重试');
      } else if (response) {
        const { status, data } = response;

        switch (status) {
          case 401:
            globalMessage.error('登录已过期，请重新登录');
            clearUserInfo();
            window.location.href = '/login';
            break;
          case 403:
            globalMessage.error('没有权限访问该资源');
            break;
          case 404:
            globalMessage.error('请求的资源不存在');
            break;
          case 500:
            globalMessage.error('服务器内部错误');
            break;
          default:
            globalMessage.error(data?.message || `请求失败: ${status}`);
        }
      } else {
        globalMessage.error(errorMessage || '网络错误，请检查网络连接');
      }

      return Promise.reject(error);
    }
  );

  return instance;
};

// 创建实例
export const httpClient = createAxiosInstance();

// 封装常用的请求方法
export const request = {
  // GET 请求
  get: <T = unknown>(url: string, params?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    httpClient.get(url, { params, ...config }),

  // POST 请求
  post: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    httpClient.post(url, data, config),

  // PUT 请求
  put: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    httpClient.put(url, data, config),

  // DELETE 请求
  delete: <T = unknown>(url: string, params?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    httpClient.delete(url, { params, ...config }),

  // PATCH 请求
  patch: <T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> =>
    httpClient.patch(url, data, config),

  // 文件上传
  upload: <T = unknown>(
    url: string,
    file: File | FormData,
    config?: AxiosRequestConfig
  ): Promise<T> => {
    const formData = file instanceof FormData ? file : new FormData();
    if (file instanceof File) {
      formData.append('file', file);
    }

    return httpClient.post(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      ...config,
    });
  },

  // 下载文件
  download: (url: string, params?: unknown, filename?: string): Promise<void> => {
    return httpClient
      .get(url, {
        params,
        responseType: 'blob',
      })
      .then((response: unknown) => {
        const blob = new Blob([response as BlobPart]);
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = filename || 'download';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
      });
  },
};

export default request;
