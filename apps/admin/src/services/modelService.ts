/**
 * 模型管理服务
 * 使用 React Query 进行状态管理
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  GetModelsQueryDto,
  CreateModelDto,
  UpdateModelDto,
  TestModelDto,
  ModelInfoDto,
  ModelsListResponseDto,
  TestModelResponseDto,
  CapabilityType,
  ModelStatus,
} from '@ai-platform/shared';
import request from '../utils/request';
import { PATH } from './path';

// 重新导出共享类型供页面使用
export type {
  ModelInfoDto,
  CapabilityType,
  ModelStatus,
  GetModelsQueryDto,
  CreateModelDto,
  UpdateModelDto,
};

// ==================== Query Keys ====================

export const modelQueryKeys = {
  models: ['models'] as const,
  modelList: (params?: GetModelsQueryDto) => [...modelQueryKeys.models, 'list', params] as const,
  model: (id: string) => [...modelQueryKeys.models, 'detail', id] as const,
  modelsByProvider: (providerId: string) =>
    [...modelQueryKeys.models, 'provider', providerId] as const,
  modelsByCapability: (capabilityType: string) =>
    [...modelQueryKeys.models, 'capability', capabilityType] as const,
};

// ==================== API Functions ====================

export const modelApi = {
  /**
   * 获取模型列表
   */
  getModels: async (params?: GetModelsQueryDto): Promise<ModelsListResponseDto> => {
    return await request.get<ModelsListResponseDto>(PATH.ADMIN.MODELS, params);
  },

  /**
   * 获取模型详情
   */
  getModelById: async (id: string): Promise<ModelInfoDto> => {
    return await request.get<ModelInfoDto>(`${PATH.ADMIN.MODELS}/${id}`);
  },

  /**
   * 创建模型
   */
  createModel: async (data: CreateModelDto): Promise<ModelInfoDto> => {
    return await request.post<ModelInfoDto>(`${PATH.ADMIN.MODELS}`, data);
  },

  /**
   * 更新模型
   */
  updateModel: async (id: string, data: UpdateModelDto): Promise<ModelInfoDto> => {
    return await request.put<ModelInfoDto>(`${PATH.ADMIN.MODELS}/${id}`, data);
  },

  /**
   * 删除模型
   */
  deleteModel: async (id: string): Promise<void> => {
    await request.delete(`${PATH.ADMIN.MODELS}/${id}`);
  },

  /**
   * 测试模型
   */
  testModel: async (data: TestModelDto): Promise<TestModelResponseDto> => {
    return await request.post<TestModelResponseDto>(`${PATH.ADMIN.MODELS}/test`, data);
  },

  /**
   * 按提供商获取模型
   */
  getModelsByProvider: async (providerId: string): Promise<ModelInfoDto[]> => {
    return await request.get<ModelInfoDto[]>(`${PATH.ADMIN.MODELS}/provider/${providerId}`);
  },

  /**
   * 按能力类型获取可用模型
   */
  getModelsByCapability: async (capabilityType: string): Promise<ModelInfoDto[]> => {
    return await request.get<ModelInfoDto[]>(`${PATH.ADMIN.MODELS}/capability/${capabilityType}`);
  },
};

// ==================== React Query Hooks ====================

/**
 * 获取模型列表
 */
export const useModels = (params?: GetModelsQueryDto, options?: any) => {
  return useQuery({
    queryKey: modelQueryKeys.modelList(params),
    queryFn: () => modelApi.getModels(params),
    staleTime: 2 * 60 * 1000, // 2分钟
    ...options,
  });
};

/**
 * 获取模型详情
 */
export const useModel = (id: string, options?: any) => {
  return useQuery({
    queryKey: modelQueryKeys.model(id),
    queryFn: () => modelApi.getModelById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5分钟
    ...options,
  });
};

/**
 * 按提供商获取模型
 */
export const useModelsByProvider = (providerId: string, options?: any) => {
  return useQuery({
    queryKey: modelQueryKeys.modelsByProvider(providerId),
    queryFn: () => modelApi.getModelsByProvider(providerId),
    enabled: !!providerId,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

/**
 * 按能力类型获取可用模型
 */
export const useModelsByCapability = (capabilityType: string, options?: any) => {
  return useQuery({
    queryKey: modelQueryKeys.modelsByCapability(capabilityType),
    queryFn: () => modelApi.getModelsByCapability(capabilityType),
    enabled: !!capabilityType,
    staleTime: 10 * 60 * 1000, // 10分钟
    ...options,
  });
};

/**
 * 创建模型
 */
export const useCreateModel = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: modelApi.createModel,
    onSuccess: (data: ModelInfoDto) => {
      // 创建成功后，使相关缓存失效
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.models,
      });
      // 刷新该提供商的模型列表
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.modelsByProvider(data.providerId),
      });
    },
    ...options,
  });
};

/**
 * 更新模型
 */
export const useUpdateModel = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateModelDto }) =>
      modelApi.updateModel(id, data),
    onSuccess: (data: ModelInfoDto, variables) => {
      // 更新成功后，使相关缓存失效
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.model(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.models,
      });
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.modelsByProvider(data.providerId),
      });
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.modelsByCapability(data.capabilityType),
      });
    },
    ...options,
  });
};

/**
 * 删除模型
 */
export const useDeleteModel = (options?: any) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: modelApi.deleteModel,
    onSuccess: () => {
      // 删除成功后，使模型列表缓存失效
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.models,
      });
    },
    ...options,
  });
};

/**
 * 测试模型
 */
export const useTestModel = (options?: any) => {
  return useMutation({
    mutationFn: modelApi.testModel,
    ...options,
  });
};

// ==================== Utility Hooks ====================

/**
 * 模型变更工具 Hook
 * 用于手动触发缓存刷新
 */
export const useModelMutations = () => {
  const queryClient = useQueryClient();

  return {
    invalidateModels: () => {
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.models,
      });
    },
    invalidateModel: (id: string) => {
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.model(id),
      });
    },
    invalidateModelsByProvider: (providerId: string) => {
      queryClient.invalidateQueries({
        queryKey: modelQueryKeys.modelsByProvider(providerId),
      });
    },
  };
};
