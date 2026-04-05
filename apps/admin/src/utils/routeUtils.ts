import React from 'react';
import type { RouteConfig, MenuItem, ManualRouteConfig } from '@/types/route';

// 手动路由配置 - 用于覆盖自动生成的配置
const manualRouteConfigs: Record<string, ManualRouteConfig> = {
  
};

// 检测动态路由参数
function detectDynamicParams(filePath: string): { isDynamic: boolean; params: string[]; dynamicPath: string } {
  // 检测文件名中的 [param] 或 $param 模式
  const dynamicPattern = /\[([^\]]+)\]|\$([^/]+)/g;
  const params: string[] = [];
  let isDynamic = false;
  
  let dynamicPath = filePath;
  let match;
  
  while ((match = dynamicPattern.exec(filePath)) !== null) {
    isDynamic = true;
    const param = match[1] || match[2]; // [param] 或 $param
    params.push(param);
    // 替换为 React Router 的动态参数格式
    dynamicPath = dynamicPath.replace(match[0], `:${param}`);
  }
  
  return { isDynamic, params, dynamicPath };
}

// 自动扫描 pages 目录生成路由配置
export function generateRoutes(): RouteConfig[] {
  // 使用 Vite 的 glob import 功能扫描页面文件
  const modules = import.meta.glob('/src/pages/**/*.tsx', { eager: true });
  const routes: RouteConfig[] = [];


  Object.entries(modules).forEach(([path, module]) => {
    
    // 从文件路径提取路由信息
    const routePath = path
      .replace('/src/pages', '')
      .replace(/\/index\.tsx$/, '')
      .replace(/\.tsx$/, '')
      .toLowerCase();


    // 检测动态路由参数
    const { isDynamic, params, dynamicPath } = detectDynamicParams(routePath);
    
    
    // 使用动态路径（包含参数）
    const finalPath = dynamicPath || routePath || '/';


    // 获取组件和元数据
    const moduleDefault = (module as { default?: React.ComponentType }).default;
    const routeConfig = (module as { 
      routeConfig?: {
        name?: string;
        title?: string;
        icon?: string;
        order?: number;
        hideInMenu?: boolean;
        requireAuth?: boolean;
        requireAdmin?: boolean;
        roles?: string[];
        permissions?: string[];
        meta?: Record<string, unknown>;
      }
    }).routeConfig;

    // 只有当组件存在且导出了 routeConfig 时才生成路由
    if (moduleDefault && routeConfig) {
      
      // 获取手动配置
      const manualConfig = manualRouteConfigs[finalPath];
      
      // 合并配置：手动配置优先
      const mergedMeta = {
        title: manualConfig?.meta?.title || routeConfig.title || routeConfig.name || finalPath,
        icon: manualConfig?.meta?.icon || routeConfig.icon,
        hideInMenu: manualConfig?.meta?.hideInMenu ?? routeConfig.hideInMenu ?? (isDynamic ? true : false), // 动态路由默认隐藏
        requireAuth: manualConfig?.meta?.requireAuth ?? routeConfig.requireAuth ?? true,
        requireAdmin: manualConfig?.meta?.requireAdmin ?? routeConfig.requireAdmin ?? false,
        roles: manualConfig?.meta?.roles || routeConfig.roles || [],
        permissions: manualConfig?.meta?.permissions || routeConfig.permissions || [],
        order: manualConfig?.meta?.order ?? routeConfig.order ?? 999,
        parentPath: manualConfig?.meta?.parentPath,
        isDynamic,
        params,
        ...(routeConfig.meta || {}),
      };

      const route = {
        path: finalPath,
        name: routeConfig.name || path.split('/').pop()?.replace('.tsx', '') || 'Unknown',
        component: moduleDefault,
        meta: mergedMeta,
        priority: isDynamic ? 2 : 1, // 静态路由优先级高于动态路由
      };

      routes.push(route);
    } else {
      // 记录被跳过的文件原因
      if (!moduleDefault) {
        console.log(`⚠️  Skipped ${path}: No default export found`);
      } else if (!routeConfig) {
        console.log(`⚠️  Skipped ${path}: No routeConfig export found`);
      }
    }
  });


  return routes.sort((a, b) => {
    // 首先按优先级排序（静态路由优先）
    const priorityA = a.priority ?? 999;
    const priorityB = b.priority ?? 999;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // 然后按 order 排序
    const orderA = a.meta?.order ?? 999;
    const orderB = b.meta?.order ?? 999;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    // 最后按路径排序
    return a.path.localeCompare(b.path);
  });
}

// 构建嵌套路由结构（支持多层嵌套）
export function buildNestedRoutes(routes: RouteConfig[]): RouteConfig[] {
  const routeMap = new Map<string, RouteConfig>();
  const rootRoutes: RouteConfig[] = [];
  
  
  // 创建路由映射
  routes.forEach(route => {
    routeMap.set(route.path, { ...route, children: [] });
  });
  
  
  // 按路径深度排序，确保父路径先处理
  const sortedRoutes = [...routes].sort((a, b) => {
    const depthA = a.path.split('/').length;
    const depthB = b.path.split('/').length;
    return depthA - depthB;
  });
  
  // 自动推断多层嵌套关系并构建结构
  sortedRoutes.forEach(route => {
    const pathParts = route.path.split('/').filter(Boolean);
    let parentPath = route.meta?.parentPath;
    
    // 如果没有手动设置 parentPath，自动推断多层嵌套
    if (!parentPath && pathParts.length > 1) {
      // 从最近的父路径开始查找
      for (let i = pathParts.length - 1; i > 0; i--) {
        const potentialParentPath = '/' + pathParts.slice(0, i).join('/');
        if (routeMap.has(potentialParentPath)) {
          parentPath = potentialParentPath;
          break;
        }
      }
    }
    
    if (parentPath && routeMap.has(parentPath)) {
      const parent = routeMap.get(parentPath)!;
      const child = routeMap.get(route.path)!;
      if (!parent.children) parent.children = [];
      parent.children.push(child);
    } else {
      // 只有顶级路径（一个路径段）才作为根路由
      if (pathParts.length === 1) {
        rootRoutes.push(routeMap.get(route.path)!);
      } else {
        // 如果找不到父路径，但有多个路径段，需要创建中间父节点
        const parentSegments = pathParts.slice(0, -1);
        let currentParentPath = '';
        let currentParent: RouteConfig | null = null;
        
        // 逐级创建父节点
        for (let i = 0; i < parentSegments.length; i++) {
          currentParentPath += '/' + parentSegments[i];
          
          if (!routeMap.has(currentParentPath)) {
            // 创建虚拟父节点
            const virtualParent: RouteConfig = {
              path: currentParentPath,
              name: parentSegments[i],
              component: (() => null) as React.ComponentType,
              meta: {
                title: parentSegments[i].charAt(0).toUpperCase() + parentSegments[i].slice(1),
                hideInMenu: false,
                requireAuth: true,
                order: 999,
              },
              children: [],
            };
            routeMap.set(currentParentPath, virtualParent);
            
            // 将虚拟父节点添加到其父节点或根节点
            if (i === 0) {
              rootRoutes.push(virtualParent);
            } else {
              const grandParentPath = '/' + parentSegments.slice(0, i).join('/');
              const grandParent = routeMap.get(grandParentPath);
              if (grandParent) {
                if (!grandParent.children) grandParent.children = [];
                grandParent.children.push(virtualParent);
              }
            }
          }
          currentParent = routeMap.get(currentParentPath)!;
        }
        
        // 将当前路由添加到最终父节点
        if (currentParent) {
          const child = routeMap.get(route.path)!;
          if (!currentParent.children) currentParent.children = [];
          currentParent.children.push(child);
        }
      }
    }
  });
  
  // 递归排序所有层级的路由
  const sortRoutesByOrder = (routes: RouteConfig[]): RouteConfig[] => {
    return routes.sort((a, b) => {
      const orderA = a.meta?.order ?? 999;
      const orderB = b.meta?.order ?? 999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.path.localeCompare(b.path);
    }).map(route => {
      if (route.children && route.children.length > 0) {
        route.children = sortRoutesByOrder(route.children);
      }
      return route;
    });
  };
  
  return sortRoutesByOrder(rootRoutes);
}



// 将路由配置转换为 React Router 格式
export function convertToReactRouterConfig(routes: RouteConfig[]): Array<{
  path: string;
  element: React.ReactElement;
  children?: Array<{
    path: string;
    element: React.ReactElement;
    children?: unknown;
  }>;
}> {
  return routes.map(route => ({
    path: route.path,
    element: React.createElement(route.component),
    children: route.children ? convertToReactRouterConfig(route.children) : undefined,
  }));
}

// 根据路由配置生成菜单项（支持嵌套结构）
export function generateMenuItems(routes: RouteConfig[]): MenuItem[] {
  const menuItems = routes
    .filter(route => !route.meta?.hideInMenu)
    .map(route => {
      const hasChildren = route.children && route.children.length > 0;
      const visibleChildren = hasChildren 
        ? generateMenuItems(route.children!.filter(child => !child.meta?.hideInMenu))
        : undefined;
      
      // 只有当父菜单本身也设置为 hideInMenu 时才隐藏
      // 如果父菜单是有效页面，即使子菜单都隐藏了，父菜单也应该显示
      
      return {
        key: route.path,
        label: route.meta?.title || route.name,
        icon: route.meta?.icon,
        path: route.path,
        children: visibleChildren && visibleChildren.length > 0 ? visibleChildren : undefined,
        // 保留 order 信息用于排序
        order: route.meta?.order ?? 999,
      } as MenuItem & { order: number };
    })
    .filter((item): item is MenuItem & { order: number } => item !== null)
    .sort((a, b) => {
      // 按 order 排序
      if (a.order !== b.order) {
        return a.order - b.order;
      }
      return a.key.localeCompare(b.key);
    })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ order, ...item }) => item as MenuItem); // 移除临时的 order 属性
    
  return menuItems;
}

// 根据路径查找路由配置
export function findRouteByPath(routes: RouteConfig[], path: string): RouteConfig | null {
  for (const route of routes) {
    if (route.path === path) {
      return route;
    }
    if (route.children) {
      const found = findRouteByPath(route.children, path);
      if (found) return found;
    }
  }
  return null;
}

// 获取面包屑路径
export function getBreadcrumbs(routes: RouteConfig[], currentPath: string): MenuItem[] {
  const breadcrumbs: MenuItem[] = [];
  
  function findPath(routes: RouteConfig[], path: string, currentBreadcrumbs: MenuItem[]): boolean {
    for (const route of routes) {
      const newBreadcrumbs = [...currentBreadcrumbs, {
        key: route.path,
        label: route.meta?.title || route.name,
        path: route.path,
      }];

      if (route.path === path) {
        breadcrumbs.push(...newBreadcrumbs);
        return true;
      }

      if (route.children && findPath(route.children, path, newBreadcrumbs)) {
        return true;
      }
    }
    return false;
  }

  findPath(routes, currentPath, []);
  return breadcrumbs;
}