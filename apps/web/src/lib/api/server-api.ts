import { HttpClient } from './http-client';
import { headers } from 'next/headers';
import { env } from '../env';

/**
 * 服务端 API 实例
 * 用于服务端的 API 调用（Server Components, API Routes, Server Actions）
 */
class ServerAPI extends HttpClient {
  constructor() {
    // 服务端可能需要调用内部或外部 API
    const baseURL = process.env.INTERNAL_API_URL || env.NEXT_PUBLIC_API_URL;
    super(baseURL, 30000);

    // 添加服务端特定的请求拦截器
    this.addRequestInterceptor({
      onFulfilled: async (config) => {
        // 在服务端从 headers 获取认证信息
        try {
          const headersList = await headers();
          const authorization = headersList.get('authorization');
          if (authorization) {
            config.headers.Authorization = authorization;
          }

          // 转发客户端 IP
          const forwardedFor = headersList.get('x-forwarded-for');
          if (forwardedFor) {
            config.headers['X-Forwarded-For'] = forwardedFor;
          }

          // 添加服务端标识
          config.headers['X-Client-Type'] = 'server';
        } catch {
          // headers() 在某些场景下可能不可用，静默处理
        }

        return config;
      },
    });
  }

  /**
   * 使用自定义 token 调用 API
   */
  public withToken(token: string) {
    const clonedInstance = { ...this };
    
    clonedInstance.addRequestInterceptor({
      onFulfilled: (config) => {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
        return config;
      },
    });

    return clonedInstance;
  }
}

// 导出单例
export const serverAPI = new ServerAPI();

// 导出便捷方法
export const serverGet = serverAPI.get.bind(serverAPI);
export const serverPost = serverAPI.post.bind(serverAPI);
export const serverPut = serverAPI.put.bind(serverAPI);
export const serverPatch = serverAPI.patch.bind(serverAPI);
export const serverDelete = serverAPI.delete.bind(serverAPI);
export const serverUpload = serverAPI.upload.bind(serverAPI);
export const serverDownload = serverAPI.download.bind(serverAPI);

// 导出带 token 的方法工厂
export const createServerAPIWithToken = (token: string) => {
  return serverAPI.withToken(token);
};
