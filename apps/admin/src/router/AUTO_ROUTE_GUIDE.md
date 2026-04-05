# 自动路由配置系统使用指南

## 🌟 概述

该系统实现了基于文件结构的自动路由生成，支持手动配置覆盖自动配置，大大简化了路由管理。

## 🚀 核心特性

- **📁 基于文件结构自动生成路由**：根据 `src/pages/` 目录结构自动生成路由配置
- **🔧 手动配置覆盖**：支持手动配置覆盖自动生成的配置，优先级更高
- **🌲 嵌套菜单支持**：支持多级嵌套菜单结构
- **🎨 动态图标**：支持字符串配置图标，自动转换为 Ant Design 图标组件
- **🔐 权限控制**：支持路由级别的权限控制
- **📱 菜单管理**：自动生成侧边栏菜单，支持隐藏、排序等配置

## 📚 使用方法

### 1. 页面组件中配置路由

在页面组件中导出 `routeConfig` 对象：

```tsx
// src/pages/dashboard/index.tsx
export const routeConfig = {
  name: 'dashboard',
  title: '导航栏',
  icon: 'DashboardOutlined',
  requireAuth: true,
  hideInMenu: false,
};

const Dashboard = () => {
  return <div>导航内容</div>;
};

export default Dashboard;
```

### 2. 嵌套路由配置

通过 `parentPath` 属性配置父子关系：

```tsx
// src/pages/user/list.tsx
export const routeConfig = {
  name: 'userList',
  title: '用户列表',
  icon: 'UserOutlined',
  requireAuth: true,
  // parentPath: '/user', // 可选：手动指定父路径
};

// src/pages/user/form.tsx
export const routeConfig = {
  name: 'userForm',
  title: '用户表单',
  icon: 'FormOutlined',
  requireAuth: true,
  // parentPath: '/user', // 可选：手动指定父路径
};
```

### 3. 手动配置覆盖

在 `src/utils/routeUtils.ts` 中的 `manualRouteConfigs` 对象中添加手动配置：

```tsx
const manualRouteConfigs: Record<string, ManualRouteConfig> = {
  '/dashboard': {
    meta: {
      title: '导航栏',
      icon: 'DashboardOutlined',
      order: 1, // 菜单排序
    },
  },
  '/user': {
    meta: {
      title: '用户管理',
      icon: 'UserOutlined',
      order: 2,
    },
  },
  '/user/list': {
    meta: {
      title: '用户列表',
      parentPath: '/user', // 指定父路径
    },
  },
};
```

## 🔧 配置选项

### RouteConfig 类型

```tsx
interface RouteConfig {
  path: string;                 // 路由路径
  name: string;                 // 路由名称
  component: React.ComponentType; // 组件
  meta?: {
    title: string;              // 显示标题
    icon?: string;              // 图标名称
    hideInMenu?: boolean;       // 是否在菜单中隐藏
    requireAuth?: boolean;      // 是否需要认证
    roles?: string[];           // 允许的角色
    order?: number;             // 菜单排序
    parentPath?: string;        // 父路径
  };
  children?: RouteConfig[];     // 子路由
}
```

### ManualRouteConfig 类型

```tsx
interface ManualRouteConfig {
  meta?: {
    title?: string;             // 覆盖标题
    icon?: string;              // 覆盖图标
    hideInMenu?: boolean;       // 覆盖菜单显示
    requireAuth?: boolean;      // 覆盖认证要求
    roles?: string[];           // 覆盖角色要求
    order?: number;             // 覆盖排序
    parentPath?: string;        // 覆盖父路径
  };
  redirect?: string;            // 重定向路径
  disabled?: boolean;           // 是否禁用
}
```

## 📁 文件路径映射

| 文件路径 | 生成的路由路径 | 说明 |
|---------|---------------|------|
| `/src/pages/dashboard/index.tsx` | `/dashboard` | 目录下的 index.tsx |
| `/src/pages/user/list.tsx` | `/user/list` | 直接文件名 |
| `/src/pages/user/form.tsx` | `/user/form` | 直接文件名 |
| `/src/pages/settings/index.tsx` | `/settings` | 目录下的 index.tsx |

## 🎨 支持的图标

所有 Ant Design 图标都支持，使用字符串形式配置：

```tsx
// 常用图标示例
icon: 'DashboardOutlined'    // 导航栏
icon: 'UserOutlined'         // 用户
icon: 'FormOutlined'         // 表单
icon: 'SettingOutlined'      // 设置
icon: 'TableOutlined'        // 表格
icon: 'BarChartOutlined'     // 图表
icon: 'FileOutlined'         // 文件
icon: 'FolderOutlined'       // 文件夹
```

## 🔐 权限控制

### 基础权限

```tsx
export const routeConfig = {
  name: 'admin',
  title: '管理页面',
  requireAuth: true,           // 需要登录
  roles: ['admin', 'manager'], // 允许的角色
};
```

### 菜单控制

```tsx
export const routeConfig = {
  name: 'hidden',
  title: '隐藏页面',
  hideInMenu: true,            // 不在菜单中显示
};
```

## 🌲 嵌套菜单配置

### 自动嵌套（推荐）

基于文件路径自动生成嵌套结构：

```
src/pages/
├── user/
│   ├── list.tsx       → /user/list
│   ├── form.tsx       → /user/form
│   └── profile.tsx    → /user/profile
└── system/
    ├── roles.tsx      → /system/roles
    └── permissions.tsx → /system/permissions
```

### 手动指定父路径

```tsx
// 在 routeUtils.ts 中配置
const manualRouteConfigs = {
  '/user': {
    meta: {
      title: '用户管理',
      icon: 'UserOutlined',
    },
  },
  '/user/list': {
    meta: {
      parentPath: '/user',     // 手动指定父路径
    },
  },
};
```

## 📋 最佳实践

### 1. 命名规范

- 路由名称使用 camelCase：`userList`, `userForm`
- 文件名使用 kebab-case：`user-list.tsx`, `user-form.tsx`
- 目录名使用 kebab-case：`user-management/`

### 2. 菜单排序

```tsx
const manualRouteConfigs = {
  '/dashboard': { meta: { order: 1 } },
  '/user': { meta: { order: 2 } },
  '/system': { meta: { order: 3 } },
  '/settings': { meta: { order: 999 } }, // 最后显示
};
```

### 3. 图标选择

- 导航`DashboardOutlined`
- 用户管理：`UserOutlined`, `TeamOutlined`
- 表单：`FormOutlined`, `EditOutlined`
- 列表：`TableOutlined`, `UnorderedListOutlined`
- 设置：`SettingOutlined`
- 系统：`ControlOutlined`

### 4. 权限设计

```tsx
// 公开页面
export const routeConfig = {
  requireAuth: false,
};

// 需要登录
export const routeConfig = {
  requireAuth: true,
};

// 角色限制
export const routeConfig = {
  requireAuth: true,
  roles: ['admin'],
};
```

## 🛠️ 开发调试

### 查看生成的路由

打开浏览器控制台，可以看到自动生成的路由配置：

```
🚀 自动生成的路由配置: [...]
🌳 嵌套路由结构: [...]
```

### 常见问题

1. **路由没有生成**：检查页面组件是否正确导出 `default`
2. **菜单没有显示**：检查 `hideInMenu` 配置
3. **图标没有显示**：检查图标名称是否正确
4. **嵌套结构错误**：检查 `parentPath` 配置

## 🔄 迁移指南

### 从手动路由迁移

1. 删除 `router/index.tsx` 中的手动路由配置
2. 在页面组件中添加 `routeConfig` 导出
3. 在 `routeUtils.ts` 中添加需要覆盖的手动配置

### 配置验证

运行项目后检查：
- [ ] 所有页面路由正常访问
- [ ] 菜单显示正确
- [ ] 图标显示正常
- [ ] 权限控制生效

## 📖 API 参考

### 核心函数

```tsx
// 生成路由配置
const routes = generateRoutes();

// 构建嵌套结构
const nestedRoutes = buildNestedRoutes(routes);

// 生成菜单项
const menuItems = generateMenuItems(nestedRoutes);

// 转换为 React Router 格式
const routerConfig = convertToReactRouterConfig(routes);
```

### 工具函数

```tsx
// 根据路径查找路由
const route = findRouteByPath(routes, '/user/list');

// 获取面包屑
const breadcrumbs = getBreadcrumbs(routes, '/user/list');
```

---

## 🎯 总结

通过这套自动路由系统，你可以：

1. **🎯 专注业务开发**：不再需要手动维护路由配置
2. **🔧 灵活配置**：支持手动覆盖，满足复杂需求
3. **📱 自动化菜单**：菜单结构自动生成，支持嵌套
4. **🛡️ 权限控制**：内置权限控制机制
5. **🎨 美观界面**：自动处理图标和样式

现在就开始使用吧！🚀