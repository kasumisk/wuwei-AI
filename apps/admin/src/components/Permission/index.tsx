import React from 'react';
import { usePermission } from '@/hooks/usePermission';

interface PermissionProps {
  /**
   * 需要的权限编码（满足任一即可）
   */
  permissions: string | string[];
  /**
   * 是否需要同时满足所有权限
   */
  requireAll?: boolean;
  /**
   * 有权限时渲染的内容
   */
  children: React.ReactNode;
  /**
   * 无权限时的回退内容
   */
  fallback?: React.ReactNode;
  /**
   * 无权限时是否隐藏（默认true）
   */
  hideOnNoPermission?: boolean;
}

/**
 * 权限控制组件
 * 根据用户权限决定是否渲染子组件
 *
 * @example
 * // 单个权限
 * <Permission permissions="user:create">
 *   <Button>创建用户</Button>
 * </Permission>
 *
 * @example
 * // 多个权限（满足任一即可）
 * <Permission permissions={['user:create', 'user:update']}>
 *   <Button>操作</Button>
 * </Permission>
 *
 * @example
 * // 多个权限（全部满足）
 * <Permission permissions={['user:create', 'user:update']} requireAll>
 *   <Button>操作</Button>
 * </Permission>
 *
 * @example
 * // 自定义无权限回退
 * <Permission permissions="user:delete" fallback={<span>无权限</span>}>
 *   <Button danger>删除</Button>
 * </Permission>
 */
export const Permission: React.FC<PermissionProps> = ({
  permissions,
  requireAll = false,
  children,
  fallback = null,
  hideOnNoPermission = true,
}) => {
  const { hasAllPermissions, hasAnyPermission, loading, isSuperAdmin } = usePermission();

  // 加载中时显示加载状态或直接显示（避免闪烁）
  if (loading) {
    return hideOnNoPermission ? null : <>{fallback}</>;
  }

  // 超级管理员拥有所有权限
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  // 检查权限
  const permissionList = Array.isArray(permissions) ? permissions : [permissions];
  const hasAccess = requireAll
    ? hasAllPermissions(permissionList)
    : hasAnyPermission(permissionList);

  if (hasAccess) {
    return <>{children}</>;
  }

  // 无权限
  return hideOnNoPermission ? null : <>{fallback}</>;
};

/**
 * 权限按钮包装组件
 * 为按钮添加权限控制，无权限时禁用按钮
 */
interface PermissionButtonProps extends PermissionProps {
  /**
   * 无权限时是否禁用而非隐藏
   */
  disableOnNoPermission?: boolean;
}

export const PermissionButton: React.FC<PermissionButtonProps> = ({
  permissions,
  requireAll = false,
  children,
  disableOnNoPermission = false,
  fallback,
}) => {
  const { hasAllPermissions, hasAnyPermission, loading, isSuperAdmin } = usePermission();

  if (loading) {
    return null;
  }

  // 超级管理员拥有所有权限
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  const permissionList = Array.isArray(permissions) ? permissions : [permissions];
  const hasAccess = requireAll
    ? hasAllPermissions(permissionList)
    : hasAnyPermission(permissionList);

  if (hasAccess) {
    return <>{children}</>;
  }

  // 无权限时禁用按钮
  if (disableOnNoPermission && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, {
      disabled: true,
      title: '没有操作权限',
    });
  }

  return fallback ? <>{fallback}</> : null;
};

export default Permission;
