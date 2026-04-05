/**
 * 角色管理相关 DTO
 */
import type { RoleStatus } from '../../types/permission';

/**
 * 创建角色请求
 */
export interface CreateRoleDto {
  /** 角色编码，如 ADMIN, OPERATOR */
  code: string;
  /** 角色名称 */
  name: string;
  /** 父角色ID（用于角色继承） */
  parentId?: string;
  /** 角色描述 */
  description?: string;
  /** 角色状态 */
  status?: RoleStatus;
  /** 排序值 */
  sort?: number;
}

/**
 * 更新角色请求
 */
export interface UpdateRoleDto {
  /** 角色名称 */
  name?: string;
  /** 父角色ID */
  parentId?: string | null;
  /** 角色描述 */
  description?: string;
  /** 角色状态 */
  status?: RoleStatus;
  /** 排序值 */
  sort?: number;
}

/**
 * 角色查询参数
 */
export interface RoleQueryDto {
  /** 按角色编码模糊查询 */
  code?: string;
  /** 按角色名称模糊查询 */
  name?: string;
  /** 按状态过滤 */
  status?: RoleStatus;
  /** 页码，从1开始 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
}

/**
 * 为角色分配权限
 */
export interface AssignPermissionsDto {
  /** 权限ID列表 */
  permissionIds: string[];
}

/**
 * 应用权限模板到角色
 */
export interface ApplyTemplateDto {
  /** 模板编码 */
  templateCode: string;
  /** 要应用的模块列表（用于展开通配符） */
  modules?: string[];
}

/**
 * 为用户分配角色
 */
export interface AssignUserRolesDto {
  /** 用户ID */
  userId: string;
  /** 角色ID列表 */
  roleIds: string[];
}

/**
 * 角色信息响应
 */
export interface RoleInfoDto {
  /** 角色ID */
  id: string;
  /** 角色编码 */
  code: string;
  /** 角色名称 */
  name: string;
  /** 父角色ID */
  parentId?: string | null;
  /** 父角色编码 */
  parentCode?: string | null;
  /** 角色描述 */
  description?: string | null;
  /** 角色状态 */
  status: RoleStatus;
  /** 是否系统角色 */
  isSystem: boolean;
  /** 排序值 */
  sort: number;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
  /** 子角色列表（用于树形展示） */
  children?: RoleInfoDto[];
}

/**
 * 角色列表响应
 */
export interface RolesListResponseDto {
  /** 角色列表 */
  list: RoleInfoDto[];
  /** 总数 */
  total: number;
  /** 当前页码 */
  page: number;
  /** 每页数量 */
  pageSize: number;
}

/**
 * 角色权限信息响应
 */
export interface RolePermissionsResponseDto {
  /** 角色ID */
  roleId: string;
  /** 角色自身权限ID列表 */
  ownPermissionIds: string[];
  /** 继承的权限ID列表 */
  inheritedPermissionIds: string[];
  /** 所有权限Code列表（包含继承） */
  allPermissionCodes: string[];
}
