export interface RouteConfig {
  path: string;
  name: string;
  component: React.ComponentType;
  meta?: {
    title: string;
    icon?: string | React.ReactElement;
    hideInMenu?: boolean;
    requireAuth?: boolean;
    roles?: string[];
    order?: number; // 菜单排序
    parentPath?: string; // 父路径，用于构建嵌套菜单
    isDynamic?: boolean; // 是否为动态路由
    params?: string[]; // 动态路由参数名称
  };
  children?: RouteConfig[];
  // 用于排序，静态路由优先级高于动态路由
  priority?: number;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: string | React.ReactElement;
  path?: string;
  children?: MenuItem[];
}

// 手动路由配置类型（用于覆盖自动生成的配置）
export interface ManualRouteConfig {
  meta?: {
    title?: string;
    icon?: string | React.ReactElement;
    hideInMenu?: boolean;
    requireAuth?: boolean;
    requireAdmin?: boolean;
    roles?: string[];
    permissions?: string[];
    order?: number;
    parentPath?: string;
    isDynamic?: boolean;
    params?: string[];
  };
  // 可以扩展更多覆盖选项
  redirect?: string;
  disabled?: boolean;
  priority?: number;
}