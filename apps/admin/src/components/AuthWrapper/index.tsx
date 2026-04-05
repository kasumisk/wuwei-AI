import React from 'react';
import { useUserStore } from '@/store';

interface AuthWrapperProps {
  roles?: string[];
  permissions?: string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

const AuthWrapper: React.FC<AuthWrapperProps> = ({
  roles = [],
  permissions = [],
  fallback = null,
  children,
}) => {
  const { user } = useUserStore();

  // 检查角色权限
  const hasRole = (requiredRoles: string[]): boolean => {
    if (!user || requiredRoles.length === 0) return true;
    return requiredRoles.includes(user.role);
  };

  // 检查功能权限（暂时始终返回true，待实现权限系统）
  const hasPermission = (requiredPermissions: string[]): boolean => {
    if (!user || requiredPermissions.length === 0) return true;
    // TODO: 实现基于角色的权限检查
    return true;
  };

  // 权限验证
  const hasAccess = hasRole(roles) && hasPermission(permissions);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};

export default AuthWrapper;
