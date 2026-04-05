import { request } from "@/utils/request";
import { PATH } from "./path";
import {
  useMutation,
  type UseMutationOptions,
} from "@tanstack/react-query";

// 上传参数接口
export interface UploadParams {
  file: File;
  category?: 'general' | 'app-package' | 'image' | 'avatar' | 'document';
}

// 上传结果接口
export interface UploadResult {
  key: string;
  url: string;
  size: number;
  md5: string;
  mimeType: string;
  originalName: string;
}

// 预签名上传参数
export interface PresignedUploadParams {
  fileName: string;
  mimeType: string;
  category?: 'general' | 'app-package' | 'image' | 'avatar' | 'document';
}

// 预签名上传结果
export interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  url: string;
  expiresIn: number;
}

// 管理员API服务
export const adminApi = {
  // 上传文件（通过服务器中转）
  uploadFile: (params: UploadParams): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.category) {
      formData.append('category', params.category);
    }
    return request.post<UploadResult>(PATH.FILE_S3, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      timeout: 120000,
    });
  },

  // 获取预签名上传URL（客户端直传）
  getPresignedUrl: (params: PresignedUploadParams): Promise<PresignedUploadResult> => {
    return request.post<PresignedUploadResult>(PATH.FILE_PRESIGNED, params);
  },
};

// 上传文件 Hook
export const useUploadFile = (
  options?: UseMutationOptions<UploadResult, Error, UploadParams>
) => {
  return useMutation({
    mutationFn: (params: UploadParams) => adminApi.uploadFile(params),
    ...options,
  });
};

// 兼容旧接口
export const useUploadImage = useUploadFile;