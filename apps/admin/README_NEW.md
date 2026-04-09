# Admin Pro - 现代化后台管理系统

基于 Vite + React 18 + TypeScript + Ant Design Pro 构建的现代化后台管理系统。

## ✨ 特性

### 核心功能

- 🚀 **现代技术栈**: Vite + React 18 + TypeScript + Ant Design Pro
- 📱 **响应式设计**: 支持桌面和移动端
- 🎨 **主题定制**: 支持亮色/暗色主题切换，自定义主题色
- 🌐 **国际化**: 支持中文/英文多语言切换
- 🔐 **权限控制**: 基于角色和权限的访问控制

### 核心组件

- 📑 **多标签页**: 支持页面标签的增删切换，保持页面状态
- 🛣️ **自动路由**: 基于文件系统自动生成路由配置
- 📊 **状态管理**: 使用 Zustand 进行全局状态管理，支持持久化
- 📝 **表单封装**: 可复用的表单组件，支持验证和布局
- 📋 **表格封装**: 增强型表格组件，支持工具栏和操作
- 🎯 **请求封装**: 基于 Axios 的请求拦截和错误处理
- 🛡️ **错误边界**: 全局错误捕获和友好的错误提示

### 页面功能

- 📈 **导航栏**: 数据展示和统计图表
- 👥 **用户管理**: 用户列表和表单操作
- 📊 **图表展示**: 数据可视化展示
- ⚙️ **系统设置**: 主题、语言等系统配置

## 🚀 快速开始

### 环境要求

- Node.js >= 16
- pnpm >= 7

### 安装依赖

```bash
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

### 构建生产版本

```bash
pnpm build
```

### 预览生产版本

```bash
pnpm preview
```

## 📁 项目结构

```
src/
├── components/          # 公共组件
│   ├── AuthWrapper/     # 权限控制组件
│   ├── BaseForm/        # 基础表单组件
│   ├── BaseTable/       # 基础表格组件
│   ├── ErrorBoundary/   # 错误边界组件
│   └── TabsView/        # 多标签页组件
├── hooks/               # 自定义 Hooks
│   └── useI18n.ts       # 国际化 Hook
├── layouts/             # 布局组件
│   └── BasicLayout.tsx  # 基础布局
├── locales/             # 国际化文件
│   └── index.ts         # 语言包
├── pages/               # 页面组件
│   ├── dashboard/       # 导航栏
│   ├── user/           # 用户管理
│   ├── charts/         # 图表页面
│   └── settings/       # 设置页面
├── router/              # 路由配置
│   └── index.tsx        # 路由定义
├── store/               # 状态管理
│   ├── userStore.ts     # 用户状态
│   ├── tabStore.ts      # 标签页状态
│   ├── themeStore.ts    # 主题状态
│   └── index.ts         # 状态导出
├── types/               # 类型定义
│   └── route.ts         # 路由类型
└── utils/               # 工具函数
    ├── request.ts       # 请求封装
    └── routeUtils.ts    # 路由工具
```

## 🔧 技术栈

### 核心依赖

- **框架**: React 18.3+
- **构建工具**: Vite 7.1+
- **语言**: TypeScript 5.8+
- **UI 库**: Ant Design 5.27+
- **UI 组件**: Ant Design Pro Components 2.8+
- **路由**: React Router DOM 7.9+
- **状态管理**: Zustand 5.0+
- **HTTP 客户端**: Axios 1.12+
- **数据请求**: TanStack React Query 5.89+

### 开发工具

- **代码规范**: ESLint + TypeScript ESLint
- **样式处理**: CSS Modules
- **图标**: Ant Design Icons
- **日期处理**: Day.js

## 📋 状态管理

项目使用 Zustand 进行状态管理，包含以下 Store：

### 用户状态 (userStore)

- 用户信息管理
- 登录状态
- 权限角色

### 标签页状态 (tabStore)

- 标签页增删
- 标签页切换
- 状态持久化

### 主题状态 (themeStore)

- 主题模式切换
- 主题色配置
- 侧边栏状态
- 语言设置

## 🎨 主题配置

系统支持：

- 🌞 亮色/暗色主题切换
- 🎨 自定义主题色
- 📱 响应式布局
- 🌐 多语言支持

## 🔐 权限控制

使用 `AuthWrapper` 组件和 `useAuth` Hook 进行权限控制：

```tsx
import AuthWrapper, { useAuth } from '@/components/AuthWrapper';

// 组件级权限控制
<AuthWrapper roles={['admin']} permissions={['user:create']}>
  <Button>管理员专用按钮</Button>
</AuthWrapper>;

// Hook 方式权限检查
const { hasRole, hasPermission } = useAuth();
if (hasRole('admin')) {
  // 管理员逻辑
}
```

## 🌐 国际化

使用 `useI18n` Hook 进行国际化：

```tsx
import { useI18n } from '@/hooks/useI18n';

const { t } = useI18n();
return <div>{t('dashboard')}</div>;
```

## 📝 路由配置

支持两种路由配置方式：

### 1. 文件系统路由（推荐）

在页面组件中导出 `routeConfig`：

```tsx
export const routeConfig = {
  name: 'userList',
  title: '用户列表',
  icon: 'user',
  requireAuth: true,
  roles: ['admin'],
};
```

### 2. 手动路由配置

在 `router/index.tsx` 中手动定义路由。

## 🚀 部署

### 构建

```bash
pnpm build
```

构建产物在 `dist` 目录中，可以部署到任何静态文件服务器。

### 环境变量

创建 `.env.local` 文件配置环境变量：

```env
VITE_API_BASE_URL=https://api.example.com
VITE_APP_TITLE=Admin Pro
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License
