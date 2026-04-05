import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  rbacPermissionApi,
  type UserPermissionsResponseDto,
} from '@/services/rbacPermissionService';
import { useUserStore } from '@/store/userStore';

// 缓存键
const PERMISSION_QUERY_KEY = ['user', 'permissions'] as const;

/**
 * 权限 Hook
 * 提供用户权限检查功能
 */
export function usePermission() {
  const { user, token } = useUserStore();
  const isAuthenticated = !!token && !!user;

  // 获取用户权限
  const {
    data: permissionData,
    isLoading: loading,
    refetch,
  } = useQuery<UserPermissionsResponseDto>({
    queryKey: [...PERMISSION_QUERY_KEY, user?.id],
    queryFn: () => rbacPermissionApi.getUserPermissions(),
    enabled: isAuthenticated && !!user?.id,
    staleTime: 5 * 60 * 1000, // 5分钟
    gcTime: 10 * 60 * 1000, // 10分钟
  });

  // 用户权限列表
  const permissions = useMemo(() => {
    return permissionData?.permissions || [];
  }, [permissionData?.permissions]);

  // 用户角色列表
  const roles = useMemo(() => {
    return permissionData?.roles || [];
  }, [permissionData?.roles]);

  // 菜单列表
  const menus = useMemo(() => {
    return permissionData?.menus || [];
  }, [permissionData?.menus]);

  // 是否是超级管理员
  const isSuperAdmin = useMemo(() => {
    return permissionData?.isSuperAdmin || false;
  }, [permissionData?.isSuperAdmin]);

  /**
   * 权限匹配（支持通配符）
   */
  const matchPermission = useCallback((required: string, userPermission: string): boolean => {
    if (userPermission === '*') return true;
    if (userPermission === required) return true;

    // 通配符匹配: user:* 匹配 user:create
    if (userPermission.endsWith(':*')) {
      const prefix = userPermission.slice(0, -1); // 去掉 *
      return required.startsWith(prefix);
    }

    // 前缀通配符: *:list 匹配 user:list
    if (userPermission.startsWith('*:')) {
      const suffix = userPermission.slice(2); // 去掉 *:
      return required.endsWith(':' + suffix);
    }

    return false;
  }, []);

  /**
   * 检查是否有指定权限
   */
  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (isSuperAdmin) return true;
      return permissions.some((p) => matchPermission(permission, p));
    },
    [permissions, isSuperAdmin, matchPermission]
  );

  /**
   * 检查是否有任一指定权限
   */
  const hasAnyPermission = useCallback(
    (permissionList: string[]): boolean => {
      if (isSuperAdmin) return true;
      return permissionList.some((p) => hasPermission(p));
    },
    [hasPermission, isSuperAdmin]
  );

  /**
   * 检查是否有所有指定权限
   */
  const hasAllPermissions = useCallback(
    (permissionList: string[]): boolean => {
      if (isSuperAdmin) return true;
      return permissionList.every((p) => hasPermission(p));
    },
    [hasPermission, isSuperAdmin]
  );

  /**
   * 检查是否有指定角色
   */
  const hasRole = useCallback(
    (roleCode: string): boolean => {
      return roles.some((r) => r.code === roleCode);
    },
    [roles]
  );

  /**
   * 检查是否有任一指定角色
   */
  const hasAnyRole = useCallback(
    (roleCodes: string[]): boolean => {
      return roleCodes.some((code) => hasRole(code));
    },
    [hasRole]
  );

  /**
   * 刷新权限
   */
  const refreshPermissions = useCallback(() => {
    return refetch();
  }, [refetch]);

  return {
    // 状态
    loading,
    permissions,
    roles,
    menus,
    isSuperAdmin,

    // 权限检查方法
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,

    // 角色检查方法
    hasRole,
    hasAnyRole,

    // 操作
    refreshPermissions,

    // 原始数据
    permissionData,
  };
}

/**
 * 权限指令 - 简化的权限检查
 * @example
 * const can = useCanPermission();
 * if (can('user:create')) { ... }
 */
export function useCanPermission() {
  const { hasPermission, isSuperAdmin } = usePermission();
  return useCallback(
    (permission: string) => {
      if (isSuperAdmin) return true;
      return hasPermission(permission);
    },
    [hasPermission, isSuperAdmin]
  );
}

export default usePermission;
