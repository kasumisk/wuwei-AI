/**
 * API 模块统一导出
 */

// 客户端 API（用于客户端组件）
export {
  clientAPI,
  clientGet,
  clientPost,
  clientPut,
  clientPatch,
  clientDelete,
  clientUpload,
  clientDownload,
} from './client-api';

// 服务端 API（用于服务端组件、API Routes、Server Actions）
export {
  serverAPI,
  serverGet,
  serverPost,
  serverPut,
  serverPatch,
  serverDelete,
  serverUpload,
  serverDownload,
  createServerAPIWithToken,
} from './server-api';

// 类型定义
export type {
  RequestConfig,
  ApiResponse,
  RequestInterceptor,
  ResponseInterceptor,
} from './http-client';

// 错误处理
export { APIError, getErrorMessage } from './error-handler';

// HTTP 客户端基类（用于自定义扩展）
export { HttpClient } from './http-client';
