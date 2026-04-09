import Taro from '@tarojs/taro';
import { getToken, clearAuth } from '@/utils/storage';
import type { ApiResponse } from '@/types/api';

const BASE_URL = process.env.TARO_APP_API_URL || 'https://uway-api.dev-net.uk/api';

interface RequestOptions {
  url: string;
  method?: keyof Taro.request.Method;
  data?: any;
  header?: Record<string, string>;
  /** 是否跳过自动带 token */
  noAuth?: boolean;
}

async function request<T = any>(options: RequestOptions): Promise<T> {
  const { url, method = 'GET', data, header = {}, noAuth } = options;

  if (!noAuth) {
    const token = getToken();
    if (token) {
      header['Authorization'] = `Bearer ${token}`;
    }
  }

  header['Content-Type'] = header['Content-Type'] || 'application/json';

  try {
    const res = await Taro.request({
      url: `${BASE_URL}${url}`,
      method: method as any,
      data,
      header,
    });

    const body = res.data as ApiResponse<T>;

    if (res.statusCode === 401) {
      clearAuth();
      Taro.reLaunch({ url: '/pages/login/index' });
      return Promise.reject(new Error('未授权，请重新登录'));
    }

    if (!body.success) {
      return Promise.reject(new Error(body.message || '请求失败'));
    }

    return body.data;
  } catch (err: any) {
    const msg = err?.errMsg || err?.message || '网络请求失败';
    Taro.showToast({ title: msg, icon: 'none', duration: 2000 });
    return Promise.reject(err);
  }
}

export function get<T = any>(url: string, data?: any, opts?: Partial<RequestOptions>) {
  return request<T>({ url, method: 'GET', data, ...opts });
}

export function post<T = any>(url: string, data?: any, opts?: Partial<RequestOptions>) {
  return request<T>({ url, method: 'POST', data, ...opts });
}

export function put<T = any>(url: string, data?: any, opts?: Partial<RequestOptions>) {
  return request<T>({ url, method: 'PUT', data, ...opts });
}

export function del<T = any>(url: string, data?: any, opts?: Partial<RequestOptions>) {
  return request<T>({ url, method: 'DELETE', data, ...opts });
}

export default request;
