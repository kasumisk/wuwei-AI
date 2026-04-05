'use client';

/**
 * App 文件上传 API 服务
 * 对接 api-server 的 /api/app/files/* 端点
 */

import { clientAPI } from './client-api';

// ==================== 类型定义 ====================

export type FileCategory = 'general' | 'app-package' | 'image' | 'avatar' | 'document';

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  md5: string;
  mimeType: string;
  originalName: string;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  key: string;
  url: string;
  expiresIn: number;
}

// ==================== 文件上传服务 ====================

export const appFileService = {
  /**
   * 上传文件（通过服务器中转）
   */
  upload: async (
    file: File,
    category: FileCategory = 'image',
    onProgress?: (percent: number) => void,
  ): Promise<UploadResult> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('category', category);

    const response = await clientAPI.upload<UploadResult>('/app/files/upload', formData, {
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
          onProgress(percent);
        }
      },
    });

    return response.data;
  },

  /**
   * 获取预签名上传 URL（客户端直传到 S3/R2）
   */
  getPresignedUrl: async (
    fileName: string,
    mimeType: string,
    category: FileCategory = 'image',
  ): Promise<PresignedUploadResult> => {
    const response = await clientAPI.post<PresignedUploadResult>('/app/files/presigned-url', {
      fileName,
      mimeType,
      category,
    });

    return response.data;
  },

  /**
   * 使用预签名 URL 直传文件到 S3/R2
   * 1. 先从服务端获取预签名 URL
   * 2. 客户端直接 PUT 到该 URL
   */
  directUpload: async (
    file: File,
    category: FileCategory = 'image',
  ): Promise<{ key: string; url: string }> => {
    // 获取预签名 URL
    const presigned = await appFileService.getPresignedUrl(file.name, file.type, category);

    // 直传到 S3/R2
    await fetch(presigned.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type,
      },
    });

    return {
      key: presigned.key,
      url: presigned.url,
    };
  },
};

export default appFileService;
