/**
 * 用户管理相关的 DTO
 */

import type { UserRole } from '../../types/user';

// 管理模块专用的用户状态枚举
export enum ManagementUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

/**
 * 获取用户列表查询参数
 */
export interface GetUsersQueryDto {
  /** 页码 */
  page?: number;
  /** 每页数量 */
  pageSize?: number;
  /** 搜索关键词 */
  keyword?: string;
  /** 角色筛选 */
  role?: UserRole;
  /** 状态筛选 */
  status?: ManagementUserStatus;
}

/**
 * 创建用户
 */
export interface CreateUserDto {
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 密码 */
  password: string;
  /** 角色 */
  role: UserRole;
  /** 昵称 */
  nickname?: string;
  /** 手机号 */
  phone?: string;
}

/**
 * 更新用户
 */
export interface UpdateUserDto {
  /** 邮箱 */
  email?: string;
  /** 昵称 */
  nickname?: string;
  /** 手机号 */
  phone?: string;
  /** 角色 */
  role?: UserRole;
  /** 状态 */
  status?: ManagementUserStatus;
  /** 头像 */
  avatar?: string;
}

/**
 * 重置密码
 */
export interface ResetPasswordDto {
  /** 新密码 */
  newPassword: string;
}

/**
 * 用户信息（响应）
 */
export interface UserInfoDto {
  /** 用户ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email?: string;
  /** 昵称 */
  nickname?: string;
  /** 手机号 */
  phone?: string;
  /** 角色（旧字段，兼容性保留） */
  role: UserRole;
  /** 状态 */
  status: ManagementUserStatus;
  /** 头像 */
  avatar?: string;
  /** 是否管理员 */
  isAdmin: boolean;
  /** RBAC 角色列表 */
  rbacRoles?: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  /** 最后登录时间 */
  lastLoginAt?: Date | string;
  /** 创建时间 */
  createdAt: Date | string;
  /** 更新时间 */
  updatedAt: Date | string;
}

/**
 * 用户列表响应
 */
export interface UsersListResponseDto {
  /** 用户列表 */
  list: UserInfoDto[];
  /** 总数 */
  total: number;
  /** 当前页 */
  page: number;
  /** 每页数量 */
  pageSize: number;
  /** 总页数 */
  totalPages: number;
}
