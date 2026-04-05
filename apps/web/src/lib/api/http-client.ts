import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { APIError } from './error-handler';
import { logger } from '../monitoring/logger';

// 请求配置接口
export interface RequestConfig extends AxiosRequestConfig {
  skipErrorHandler?: boolean; // 跳过全局错误处理
  showErrorToast?: boolean; // 是否显示错误提示
  retryCount?: number; // 重试次数
  retryDelay?: number; // 重试延迟（毫秒）
}

// 响应数据格式
export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
  success: boolean;
}

// 请求拦截器配置
export interface RequestInterceptor {
  onFulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig | Promise<InternalAxiosRequestConfig>;
  onRejected?: (error: AxiosError) => AxiosError;
}

// 响应拦截器配置
export interface ResponseInterceptor {
  onFulfilled?: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>;
  onRejected?: (error: APIError) => APIError;
}

/**
 * 基础 Axios 实例配置类
 */
export class HttpClient {
  private instance: AxiosInstance;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor(baseURL: string, timeout: number = 30000) {
    // 创建 axios 实例
    this.instance = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // 初始化拦截器
    this.initializeInterceptors();
  }

  /**
   * 初始化拦截器
   */
  private initializeInterceptors() {
    // 请求拦截器
    this.instance.interceptors.request.use(
      async (config) => {
        // 添加时间戳防止缓存
        if (config.method === 'get') {
          config.params = {
            ...config.params,
            _t: Date.now(),
          };
        }

        // 执行自定义请求拦截器
        let processedConfig = config;
        for (const interceptor of this.requestInterceptors) {
          if (interceptor.onFulfilled) {
            processedConfig = await interceptor.onFulfilled(processedConfig);
          }
        }

        // 仅在开发环境记录请求日志
        if (process.env.NODE_ENV === 'development') {
          logger.debug('API Request', {
            url: config.url,
            method: config.method,
            params: config.params,
          });
        }

        return processedConfig;
      },
      (error) => {
        logger.error('Request Error', { error });
        return Promise.reject(error);
      }
    );

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => {
        // 仅在开发环境记录响应日志
        if (process.env.NODE_ENV === 'development') {
          logger.debug('API Response', {
            url: response.config.url,
            status: response.status,
          });
        }

        // 执行自定义响应拦截器
        let processedResponse = response;
        for (const interceptor of this.responseInterceptors) {
          if (interceptor.onFulfilled) {
            processedResponse = interceptor.onFulfilled(processedResponse) as AxiosResponse;
          }
        }

        return processedResponse;
      },
      async (error: AxiosError) => {
        return this.handleError(error);
      }
    );
  }

  /**
   * 错误处理
   */
  private async handleError(error: AxiosError): Promise<never> {
    const config = error.config as RequestConfig;

    // 处理重试逻辑
    if (config?.retryCount && config.retryCount > 0) {
      const retryDelay = config.retryDelay || 1000;
      await this.delay(retryDelay);
      config.retryCount--;
      return this.instance.request(config);
    }

    // 构造错误信息
    let apiError: APIError;

    if (error.response) {
      // 服务器返回错误
      const { status, data } = error.response;
      apiError = APIError.fromResponse(status, data as Record<string, unknown>);
      
      logger.error('API Error Response', {
        url: error.config?.url,
        status,
        data,
      });
    } else if (error.request) {
      // 请求发出但没有收到响应
      apiError = new APIError(0, '网络错误，请检查您的网络连接');
      logger.error('Network Error', { error: error.message });
    } else {
      // 请求配置出错
      apiError = new APIError(0, '请求配置错误');
      logger.error('Request Config Error', { error: error.message });
    }

    // 执行自定义错误拦截器
    for (const interceptor of this.responseInterceptors) {
      if (interceptor.onRejected) {
        interceptor.onRejected(apiError);
      }
    }

    return Promise.reject(apiError);
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 添加请求拦截器
   */
  public addRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
    return this;
  }

  /**
   * 添加响应拦截器
   */
  public addResponseInterceptor(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
    return this;
  }

  /**
   * 获取 axios 实例
   */
  public getInstance(): AxiosInstance {
    return this.instance;
  }

  /**
   * GET 请求
   */
  public async get<T = unknown>(
    url: string,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.get<ApiResponse<T>>(url, config);
    return response.data;
  }

  /**
   * POST 请求
   */
  public async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.post<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * PUT 请求
   */
  public async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.put<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * PATCH 请求
   */
  public async patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.patch<ApiResponse<T>>(url, data, config);
    return response.data;
  }

  /**
   * DELETE 请求
   */
  public async delete<T = unknown>(
    url: string,
    config?: RequestConfig
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.delete<ApiResponse<T>>(url, config);
    return response.data;
  }

  /**
   * 上传文件
   */
  public async upload<T = unknown>(
    url: string,
    formData: FormData,
    config?: RequestConfig & {
      onUploadProgress?: (progressEvent: { loaded: number; total?: number }) => void;
    }
  ): Promise<ApiResponse<T>> {
    const response = await this.instance.post<ApiResponse<T>>(url, formData, {
      ...config,
      headers: {
        'Content-Type': 'multipart/form-data',
        ...config?.headers,
      },
    });
    return response.data;
  }

  /**
   * 下载文件
   */
  public async download(
    url: string,
    config?: RequestConfig & {
      onDownloadProgress?: (progressEvent: { loaded: number; total?: number }) => void;
    }
  ): Promise<Blob> {
    const response = await this.instance.get(url, {
      ...config,
      responseType: 'blob',
    });
    return response.data;
  }
}
