# 🚀 快速开始指南

## 项目已配置完成 ✅

恭喜！你的 Next.js 项目已经完全配置好，包含以下功能：

### ✨ 已集成的功能

- ✅ **Next.js 15+** (App Router)
- ✅ **shadcn/ui** + Tailwind CSS
- ✅ **React Query** (数据获取)
- ✅ **Zustand** (状态管理)
- ✅ **next-intl** (国际化 中/英)
- ✅ **next-themes** (主题切换)
- ✅ **next-pwa** (PWA 支持)
- ✅ **TypeScript** (类型安全)

---

## 📝 立即开始开发

### 1. 查看运行效果

开发服务器已经在运行：
```
🌐 本地地址: http://localhost:3000
```

访问查看：
- `/zh` - 中文版本
- `/en` - 英文版本

### 2. 测试功能

#### 🎨 主题切换
点击右上角的月亮/太阳图标切换深色/浅色主题

#### 🌍 语言切换
点击右上角的语言图标在中英文之间切换

#### 🐻 Zustand 测试
点击 "Zustand Test" 按钮查看状态管理效果

#### 🔄 React Query 测试
查看用户列表卡片，数据自动从 API 获取并缓存

---

## 🛠️ 常用命令

```bash
# 开发模式
pnpm dev

# 构建生产版本
pnpm build

# 启动生产服务器
pnpm start

# 代码检查
pnpm lint

# 类型检查
pnpm type-check
```

---

## 📦 添加 shadcn/ui 组件

需要更多 UI 组件时：

```bash
# 查看所有可用组件
pnpm dlx shadcn@latest add

# 添加特定组件
pnpm dlx shadcn@latest add dialog
pnpm dlx shadcn@latest add dropdown-menu
pnpm dlx shadcn@latest add form
pnpm dlx shadcn@latest add input
pnpm dlx shadcn@latest add table
```

---

## 📂 主要文件位置

### 创建新页面
```
src/app/[locale]/your-page/page.tsx
```

### 创建新 API
```
src/app/api/your-endpoint/route.ts
```

### 添加翻译
```
messages/zh.json  # 中文
messages/en.json  # 英文
```

### 创建新组件
```
src/components/features/your-component.tsx  # 功能组件
src/components/common/your-component.tsx     # 通用组件
```

### 添加自定义 Hook
```
src/lib/hooks/use-your-hook.ts
```

---

## 🎯 开发示例

### 示例 1: 创建新页面

1. 创建页面文件：
```tsx
// src/app/[locale]/about/page.tsx
'use client';

import { useTranslations } from 'next-intl';

export default function AboutPage() {
  const t = useTranslations();
  
  return (
    <div>
      <h1>{t('about.title')}</h1>
    </div>
  );
}
```

2. 添加翻译：
```json
// messages/zh.json
{
  "about": {
    "title": "关于我们"
  }
}
```

### 示例 2: 使用 React Query

```tsx
// src/lib/hooks/use-posts.ts
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api/client';

export function usePosts() {
  return useQuery({
    queryKey: ['posts'],
    queryFn: () => api.get('/api/posts'),
  });
}

// 在组件中使用
const { data, isLoading } = usePosts();
```

### 示例 3: 使用 Zustand

```tsx
// src/store/index.ts
interface AppState {
  count: number;
  increment: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

// 在组件中使用
const { count, increment } = useAppStore();
```

---

## 🎨 自定义主题

编辑 `src/app/globals.css` 修改颜色：

```css
:root {
  --primary: 222.2 47.4% 11.2%;
  --secondary: 210 40% 96.1%;
  /* ... 其他颜色 */
}
```

---

## 📱 PWA 配置

编辑 `public/manifest.json` 自定义 PWA：

```json
{
  "name": "你的应用名称",
  "short_name": "简称",
  "theme_color": "#000000"
}
```

添加图标：
- `public/icon-192x192.png`
- `public/icon-512x512.png`

---

## 🔐 环境变量

编辑 `.env.local`：

```env
NEXT_PUBLIC_APP_NAME=你的应用名
NEXT_PUBLIC_API_URL=https://api.example.com
```

---

## 📚 更多资源

- [项目架构文档](./ARCHITECTURE.md)
- [Next.js 文档](https://nextjs.org/docs)
- [shadcn/ui 组件库](https://ui.shadcn.com)
- [React Query 文档](https://tanstack.com/query)
- [Zustand 文档](https://zustand-demo.pmnd.rs)

---

## 💡 提示

1. **Server Components 优先**：默认使用服务器组件，需要交互时添加 `'use client'`
2. **数据获取**：API 数据用 React Query，全局 UI 状态用 Zustand
3. **类型安全**：充分利用 TypeScript，定义清晰的类型
4. **组件复用**：优先创建可复用组件
5. **性能优化**：使用 Next.js Image、动态导入等优化手段

---

## 🎉 开始构建你的应用吧！

有问题？查看：
- 控制台错误信息
- TypeScript 类型提示
- ESLint 警告

祝开发愉快！🚀
