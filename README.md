# Platform - 企业级全栈平台

基于 Turborepo + Next.js + Vite + NestJS 构建的企业级全栈平台架构。

## 🏗️ 项目架构

```
new-platform/
├── apps/
│   ├── web/              # Next.js C端主应用 (http://localhost:3000)
│   ├── admin/            # Vite 后台管理系统 (http://localhost:5173)
│   └── api-server/       # NestJS 独立后端服务 (http://localhost:4000)
├── packages/
│   ├── database/         # Prisma 数据库配置
│   ├── types/            # 共享 TypeScript 类型
│   └── utils/            # 共享工具函数
└── ...
```

## 📦 技术栈

### C端主应用 (apps/web)
- **框架**: Next.js 15 (App Router)
- **语言**: TypeScript
- **样式**: Tailwind CSS
- **状态管理**: Zustand + TanStack Query
- **认证**: NextAuth.js v5

### 后台管理系统 (apps/admin)
- **构建**: Vite 6
- **框架**: React 19
- **UI**: Ant Design 5
- **路由**: React Router v7
- **状态管理**: Zustand + TanStack Query

### 后端服务 (apps/api-server)
- **框架**: NestJS 10
- **API**: RESTful + Swagger
- **认证**: JWT + Passport
- **验证**: class-validator

### 数据层
- **ORM**: Prisma
- **数据库**: PostgreSQL

### 工程化
- **Monorepo**: Turborepo
- **包管理**: pnpm
- **代码规范**: ESLint + Prettier
- **部署**: Vercel

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制环境变量示例文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置数据库连接和其他必要的环境变量。

### 3. 初始化数据库

```bash
# 生成 Prisma Client
pnpm db:generate

# 运行数据库迁移
pnpm db:migrate
```

### 4. 启动开发服务器

```bash
# 同时启动所有应用
pnpm dev
```

访问地址：
- C端主应用: http://localhost:3000
- 后台管理: http://localhost:5173
- API 服务: http://localhost:4000
- API 文档: http://localhost:4000/api/docs

## 📝 可用命令

```bash
# 开发
pnpm dev              # 启动所有应用开发模式
pnpm dev --filter=web # 仅启动 Next.js 应用

# 构建
pnpm build            # 构建所有应用
pnpm build --filter=admin # 仅构建后台管理

# 测试
pnpm test             # 运行所有测试
pnpm lint             # 代码检查
pnpm format           # 格式化代码

# 数据库
pnpm db:generate      # 生成 Prisma Client
pnpm db:migrate       # 运行数据库迁移
pnpm db:studio        # 打开 Prisma Studio

# 清理
pnpm clean            # 清理所有构建产物
```

## 🌐 部署

### Vercel 部署

#### 1. Next.js 主应用

在 Vercel 中创建新项目，配置：
- **Framework Preset**: Next.js
- **Root Directory**: `apps/web`
- **Build Command**: `pnpm turbo build --filter=web`
- **Output Directory**: `apps/web/.next`

#### 2. Vite 后台管理

在 Vercel 中创建新项目，配置：
- **Framework Preset**: Other
- **Root Directory**: `apps/admin`
- **Build Command**: `pnpm turbo build --filter=admin`
- **Output Directory**: `apps/admin/dist`

#### 3. NestJS 后端服务

推荐部署到 Railway / Render / Fly.io：

```bash
# 使用 Railway
railway login
railway init
railway up
```

或使用 Vercel Serverless Functions（适合轻量级 API）。

### 环境变量配置

在 Vercel 项目设置中配置以下环境变量：

```
DATABASE_URL=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
JWT_SECRET=
```

## 📂 项目结构说明

### apps/web - Next.js 主应用
```
src/
├── app/              # App Router 页面
├── components/       # React 组件
├── lib/             # 工具函数和配置
├── hooks/           # 自定义 Hooks
└── types/           # 类型定义
```

### apps/admin - Vite 后台管理
```
src/
├── pages/           # 页面组件
├── components/      # UI 组件
├── layouts/         # 布局组件
├── router/          # 路由配置
├── store/           # 状态管理
├── services/        # API 服务
└── utils/           # 工具函数
```

### apps/api-server - NestJS 后端
```
src/
├── modules/         # 业务模块
├── common/          # 公共模块
├── config/          # 配置
└── main.ts          # 入口文件
```

## 🛠️ 开发指南

### 添加新的共享包

1. 在 `packages/` 下创建新目录
2. 创建 `package.json` 和 `tsconfig.json`
3. 在需要使用的应用中添加依赖：

```json
{
  "dependencies": {
    "@repo/your-package": "workspace:*"
  }
}
```

### 数据库 Schema 修改

1. 编辑 `packages/database/prisma/schema.prisma`
2. 运行迁移：`pnpm db:migrate`
3. 更新代码中的类型引用

## 📚 相关文档

- [Next.js 文档](https://nextjs.org/docs)
- [Vite 文档](https://vitejs.dev/)
- [NestJS 文档](https://docs.nestjs.com/)
- [Prisma 文档](https://www.prisma.io/docs)
- [Turborepo 文档](https://turbo.build/repo/docs)
- [Ant Design 文档](https://ant.design/)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 License

MIT
