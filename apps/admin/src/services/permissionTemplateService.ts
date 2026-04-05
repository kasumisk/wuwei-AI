import request from '@/utils/request';
import { PATH } from './path';
import {
  useQuery,
  useQueryClient,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  CreatePermissionTemplateDto,
  UpdatePermissionTemplateDto,
  PermissionTemplateQueryDto,
  PermissionTemplateInfoDto,
  PermissionTemplatesListResponseDto,
  TemplatePreviewDto,
  TemplatePreviewResponseDto,
} from '@ai-platform/shared';

// 导出共享类型供外部使用
export type {
  CreatePermissionTemplateDto,
  UpdatePermissionTemplateDto,
  PermissionTemplateQueryDto,
  PermissionTemplateInfoDto,
  PermissionTemplatesListResponseDto,
  TemplatePreviewDto,
  TemplatePreviewResponseDto,
};

// 查询键工厂
export const permissionTemplateQueryKeys = {
  templates: ['permissionTemplates'] as const,
  templateList: (params?: PermissionTemplateQueryDto) =>
    [...permissionTemplateQueryKeys.templates, 'list', params] as const,
  template: (id: string) => [...permissionTemplateQueryKeys.templates, 'detail', id] as const,
};

// Permission Template API 服务
export const permissionTemplateApi = {
  /**
   * 获取权限模板列表
   * @param params 查询参数
   */
  getTemplates: (
    params?: PermissionTemplateQueryDto
  ): Promise<PermissionTemplatesListResponseDto> => {
    return request.get(PATH.ADMIN.PERMISSION_TEMPLATES, params);
  },

  /**
   * 获取权限模板详情
   * @param id 模板ID
   */
  getTemplateById: (id: string): Promise<PermissionTemplateInfoDto> => {
    return request.get(`${PATH.ADMIN.PERMISSION_TEMPLATES}/${id}`);
  },

  /**
   * 创建权限模板
   * @param data 创建模板参数
   */
  createTemplate: (data: CreatePermissionTemplateDto): Promise<PermissionTemplateInfoDto> => {
    return request.post(PATH.ADMIN.PERMISSION_TEMPLATES, data);
  },

  /**
   * 更新权限模板
   * @param id 模板ID
   * @param data 更新模板参数
   */
  updateTemplate: (
    id: string,
    data: UpdatePermissionTemplateDto
  ): Promise<PermissionTemplateInfoDto> => {
    return request.put(`${PATH.ADMIN.PERMISSION_TEMPLATES}/${id}`, data);
  },

  /**
   * 删除权限模板
   * @param id 模板ID
   */
  deleteTemplate: (id: string): Promise<{ message: string }> => {
    return request.delete(`${PATH.ADMIN.PERMISSION_TEMPLATES}/${id}`);
  },

  /**
   * 预览模板展开后的权限
   * @param data 预览参数
   */
  previewTemplate: (data: TemplatePreviewDto): Promise<TemplatePreviewResponseDto> => {
    return request.post(`${PATH.ADMIN.PERMISSION_TEMPLATES}/preview`, data);
  },
};

// ==================== React Query Hooks ====================

// 获取权限模板列表
export const usePermissionTemplates = (
  params?: PermissionTemplateQueryDto,
  options?: Omit<UseQueryOptions<PermissionTemplatesListResponseDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: permissionTemplateQueryKeys.templateList(params),
    queryFn: () => permissionTemplateApi.getTemplates(params),
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 获取权限模板详情
export const usePermissionTemplate = (
  id: string,
  options?: Omit<UseQueryOptions<PermissionTemplateInfoDto>, 'queryKey' | 'queryFn'>
) => {
  return useQuery({
    queryKey: permissionTemplateQueryKeys.template(id),
    queryFn: () => permissionTemplateApi.getTemplateById(id),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
    ...options,
  });
};

// 创建权限模板
export const useCreatePermissionTemplate = (
  options?: UseMutationOptions<PermissionTemplateInfoDto, Error, CreatePermissionTemplateDto>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => permissionTemplateApi.createTemplate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permissionTemplateQueryKeys.templates });
    },
    ...options,
  });
};

// 更新权限模板
export const useUpdatePermissionTemplate = (
  options?: UseMutationOptions<
    PermissionTemplateInfoDto,
    Error,
    { id: string; data: UpdatePermissionTemplateDto }
  >
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => permissionTemplateApi.updateTemplate(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: permissionTemplateQueryKeys.templates });
      queryClient.invalidateQueries({
        queryKey: permissionTemplateQueryKeys.template(variables.id),
      });
    },
    ...options,
  });
};

// 删除权限模板
export const useDeletePermissionTemplate = (
  options?: UseMutationOptions<{ message: string }, Error, string>
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => permissionTemplateApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: permissionTemplateQueryKeys.templates });
    },
    ...options,
  });
};

// 预览模板
export const usePreviewTemplate = (
  options?: UseMutationOptions<TemplatePreviewResponseDto, Error, TemplatePreviewDto>
) => {
  return useMutation({
    mutationFn: (data) => permissionTemplateApi.previewTemplate(data),
    ...options,
  });
};

// 工具函数：手动更新缓存
export const usePermissionTemplateMutations = () => {
  const queryClient = useQueryClient();

  return {
    refetchTemplates: (params?: PermissionTemplateQueryDto) => {
      return queryClient.invalidateQueries({
        queryKey: permissionTemplateQueryKeys.templateList(params),
      });
    },
    refetchTemplate: (id: string) => {
      return queryClient.invalidateQueries({
        queryKey: permissionTemplateQueryKeys.template(id),
      });
    },
  };
};

export default permissionTemplateApi;
