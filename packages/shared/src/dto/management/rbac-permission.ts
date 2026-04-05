/**
 * RBAC 权限管理相关 DTO
 * 注意：这是 RBAC 权限系统的权限管理，与客户端能力权限 permission.ts 不同
 */
import type { PermissionType, PermissionStatus, RbacHttpMethod } from '../../types/permission';

/**
 * 创建权限请求
 */
export interface CreateRbacPermissionDto {
  /** 权限编码，如 user:create, user:list */
  code: string;
  /** 权限名称 */
  name: string;
  /** 权限类型 */
  type: PermissionType;
  /** HTTP方法（operation类型时有效） */
  action?: RbacHttpMethod;
  /** API资源路径（operation类型时有效） */
  resource?: string;
  /** 父权限ID */
  parentId?: string;
  /** 图标（menu类型时有效） */
  icon?: string;
  /** 权限描述 */
  description?: string;
  /** 排序值 */
  sort?: number;
}

/**
 * 更新权限请求
 */
export interface UpdateRbacPermissionDto {
  /** 权限名称 */
  name?: string;
  /** 权限类型 */
  type?: PermissionType;
  /** HTTP方法 */
  action?: RbacHttpMethod;
  /** API资源路径 */
  resource?: string;
  /** 父权限ID */
  parentId?: string | null;
  /** 图标 */
  icon?: string;
  /** 权限描述 */
  description?: string;
  /** 权限状态 */
  status?: PermissionStatus;
  /** 排序值 */
  sort?: number;
}

/**
 * 权限查询参数
 */
export interface RbacPermissionQueryDto {
  /** 按权限编码模糊查询 */
  code?: string;
  /** 按权限名称模糊查询 */
  name?: string;
  /** 按类型过滤 */
  type?: PermissionType;
  /** 按状态过滤 */
  status?: PermissionStatus;
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/**
 * 权限信息响应
 */
export interface RbacPermissionInfoDto {
  /** 权限ID */
  id: string;
  /** 权限编码 */
  code: string;
  /** 权限名称 */
  name: string;
  /** 权限类型 */
  type: PermissionType;
  /** HTTP方法 */
  action?: RbacHttpMethod | null;
  /** API资源路径 */
  resource?: string | null;
  /** 父权限ID */
  parentId?: string | null;
  /** 图标 */
  icon?: string | null;
  /** 权限描述 */
  description?: string | null;
  /** 权限状态 */
  status: PermissionStatus;
  /** 是否系统权限 */
  isSystem: boolean;
  /** 排序值 */
  sort: number;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
  /** 子权限列表（用于树形展示） */
  children?: RbacPermissionInfoDto[];
}

/**
 * 权限列表响应
 */
export interface RbacPermissionsListResponseDto {
  /** 权限列表 */
  list: RbacPermissionInfoDto[];
  /** 总数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/**
 * 菜单项
 */
export interface MenuItemDto {
  /** 菜单路径 */
  path: string;
  /** 菜单名称 */
  name: string;
  /** 图标 */
  icon?: string;
  /** 权限编码 */
  permissionCode?: string;
  /** 子菜单 */
  children?: MenuItemDto[];
}

/**
 * 用户权限响应（登录后获取）
 */
export interface UserPermissionsResponseDto {
  /** 用户基本信息 */
  user: {
    id: string;
    username: string;
    nickname?: string;
  };
  /** 用户角色列表 */
  roles: {
    id: string;
    code: string;
    name: string;
    parentCode?: string | null;
  }[];
  /** 用户权限Code列表（用于权限校验） */
  permissions: string[];
  /** 用户可访问的菜单（用于生成侧边栏） */
  menus: MenuItemDto[];
  /** 是否超级管理员 */
  isSuperAdmin: boolean;
}

/**
 * 批量操作权限请求
 */
export interface BatchPermissionDto {
  /** 权限ID列表 */
  ids: string[];
}
