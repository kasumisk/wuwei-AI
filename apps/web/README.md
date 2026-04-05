# ShadcnNext - Next.js 15 全栈项目模板

一个生产就绪的 Next.js 15 项目模板，集成了现代化的开发工具和最佳实践。

## ✨ 技术栈

- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS + shadcn/ui
- **状态管理**: 
  - Zustand (全局 UI 状态)
  - @tanstack/react-query (服务器状态)
- **国际化**: next-intl
- **主题**: next-themes (亮/暗模式)
- **PWA**: next-pwa
- **表单**: react-hook-form + zod
- **图标**: lucide-react
- **包管理**: pnpm

## 📁 项目结构

```
src/
├── app/                      # Next.js App Router
│   ├── [locale]/            # 国际化路由
│   │   ├── layout.tsx       # 布局组件
│   │   └── page.tsx         # 首页
│   ├── globals.css          # 全局样式
│   └── page.tsx             # 根页面重定向
├── components/
│   ├── ui/                  # shadcn/ui 组件
│   ├── common/              # 通用组件
│   └── features/            # 功能模块组件
├── lib/
│   ├── api/                 # API 客户端
│   ├── hooks/               # 自定义 Hooks
│   ├── i18n/                # 国际化配置
│   ├── react-query/         # React Query 配置
│   ├── validations/         # Zod 验证模式
│   ├── constants/           # 常量定义
│   └── utils.ts             # 工具函数
├── store/                   # Zustand 状态管理
├── types/                   # TypeScript 类型
├── providers/               # React Context Providers
└── messages/                # 国际化翻译文件
    ├── en.json
    └── zh.json
```

## 🚀 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

访问 [http://localhost:3000](http://localhost:3000)

### 构建生产版本

```bash
pnpm build
pnpm start
```

## 🎨 shadcn/ui 使用

添加新组件：

```bash
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add dialog
```

## 🌍 国际化

支持的语言：
- 英语 (en)
- 简体中文 (zh)

添加翻译：编辑 `messages/[locale].json` 文件

使用翻译：

```tsx
import { useTranslations } from 'next-intl';

const t = useTranslations();
t('common.welcome');
```

## 🎭 主题切换

使用 `next-themes` 实现亮/暗模式切换：

```tsx
import { ThemeToggle } from '@/components/common/theme-toggle';

<ThemeToggle />
```

## 📱 PWA 支持

PWA 配置位于 `public/manifest.json`

构建时会自动生成 Service Worker

## 🔄 状态管理

### Zustand (全局 UI 状态)

```tsx
import { useUIStore } from '@/store';

const { sidebarOpen, toggleSidebar } = useUIStore();
```

### React Query (服务器状态)

```tsx
import { useQuery } from '@tanstack/react-query';

const { data, isLoading } = useQuery({
  queryKey: ['users'],
  queryFn: fetchUsers,
});
```

## 📝 表单验证

使用 react-hook-form + zod：

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { userSchema } from '@/lib/validations/auth';

const form = useForm({
  resolver: zodResolver(userSchema),
});
```

## 🛠️ 可用脚本

- `pnpm dev` - 启动开发服务器
- `pnpm build` - 构建生产版本
- `pnpm start` - 启动生产服务器
- `pnpm lint` - 运行 ESLint
- `pnpm type-check` - TypeScript 类型检查

## 📦 推荐的 shadcn/ui 组件

```bash
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add dropdown-menu
pnpm dlx shadcn@latest add form
pnpm dlx shadcn@latest add input
pnpm dlx shadcn@latest add label
pnpm dlx shadcn@latest add select
pnpm dlx shadcn@latest add toast
pnpm dlx shadcn@latest add tabs
pnpm dlx shadcn@latest add avatar
pnpm dlx shadcn@latest add badge
```

## 📄 License

MIT
