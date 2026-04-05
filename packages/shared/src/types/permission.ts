/**
 * RBAC 权限管理相关类型定义
 */

/**
 * 权限类型枚举
 * - menu: 菜单权限，控制页面/菜单显示
 * - operation: 操作权限，控制按钮显示 + API访问
 */
export enum PermissionType {
  MENU = 'menu',
  OPERATION = 'operation',
}

/**
 * 权限状态枚举
 */
export enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * 角色状态枚举
 */
export enum RoleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

/**
 * HTTP 方法枚举 (用于 RBAC 权限)
 * 注意：与 api.ts 中的 HttpMethod 类型不同，这是枚举
 */
export enum RbacHttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}
