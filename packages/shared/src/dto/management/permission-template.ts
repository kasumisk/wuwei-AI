/**
 * 权限模板相关 DTO
 * 权限模板用于快速为角色分配一组预定义的权限
 */

/**
 * 创建权限模板请求
 */
export interface CreatePermissionTemplateDto {
  /** 模板编码，如 READONLY, CRUD */
  code: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /**
   * 权限模式列表
   * 支持通配符，如 ["*:list", "*:detail", "user:create"]
   * *:list 会展开为所有模块的 list 权限
   */
  permissionPatterns: string[];
}

/**
 * 更新权限模板请求
 */
export interface UpdatePermissionTemplateDto {
  /** 模板名称 */
  name?: string;
  /** 模板描述 */
  description?: string;
  /** 权限模式列表 */
  permissionPatterns?: string[];
}

/**
 * 权限模板查询参数
 */
export interface PermissionTemplateQueryDto {
  /** 按编码模糊查询 */
  code?: string;
  /** 按名称模糊查询 */
  name?: string;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/**
 * 权限模板信息响应
 */
export interface PermissionTemplateInfoDto {
  /** 模板ID */
  id: string;
  /** 模板编码 */
  code: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string | null;
  /** 权限模式列表 */
  permissionPatterns: string[];
  /** 是否系统模板（不可删除） */
  isSystem: boolean;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
}

/**
 * 权限模板列表响应
 */
export interface PermissionTemplatesListResponseDto {
  /** 模板列表 */
  list: PermissionTemplateInfoDto[];
  /** 总数 */
  total: number;
}

/**
 * 模板预览请求（预览展开后的权限）
 */
export interface TemplatePreviewDto {
  /** 权限模式列表 */
  permissionPatterns: string[];
  /** 要展开的模块列表 */
  modules?: string[];
}

/**
 * 模板预览响应
 */
export interface TemplatePreviewResponseDto {
  /** 展开后的权限Code列表 */
  expandedPermissions: string[];
  /** 匹配的权限数量 */
  matchCount: number;
}
