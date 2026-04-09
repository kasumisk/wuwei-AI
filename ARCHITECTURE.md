# 📁 项目架构概览

## 完整目录结构

```
new-platform/
├── apps/
│   ├── web/                           # Next.js C端主应用
│   │   ├── src/
│   │   │   ├── app/                  # App Router 页面
│   │   │   │   ├── globals.css       # 全局样式
│   │   │   │   ├── layout.tsx        # 根布局
│   │   │   │   └── page.tsx          # 首页
│   │   │   ├── components/           # React 组件
│   │   │   ├── lib/                  # 工具函数
│   │   │   ├── hooks/                # 自定义 Hooks
│   │   │   └── types/                # 类型定义
│   │   ├── public/                   # 静态资源
│   │   ├── next.config.mjs           # Next.js 配置
│   │   ├── tailwind.config.ts        # Tailwind 配置
│   │   ├── tsconfig.json             # TypeScript 配置
│   │   ├── vercel.json               # Vercel 部署配置
│   │   └── package.json
│   │
│   ├── admin/                         # Vite 后台管理系统
│   │   ├── src/
│   │   │   ├── pages/                # 页面组件
│   │   │   │   ├── Dashboard.tsx     # 数据看板
│   │   │   │   └── Login.tsx         # 登录页
│   │   │   ├── components/           # UI 组件
│   │   │   ├── layouts/              # 布局组件
│   │   │   │   └── MainLayout.tsx    # 主布局
│   │   │   ├── router/               # 路由配置
│   │   │   ├── store/                # 状态管理
│   │   │   ├── services/             # API 服务
│   │   │   ├── hooks/                # Hooks
│   │   │   ├── utils/                # 工具函数
│   │   │   ├── types/                # 类型定义
│   │   │   ├── App.tsx               # 应用入口
│   │   │   ├── main.tsx              # 主文件
│   │   │   └── index.css             # 全局样式
│   │   ├── public/                   # 静态资源
│   │   ├── index.html                # HTML 模板
│   │   ├── vite.config.ts            # Vite 配置
│   │   ├── tsconfig.json             # TypeScript 配置
│   │   ├── vercel.json               # Vercel 部署配置
│   │   └── package.json
│   │
│   └── api-server/                    # NestJS 后端服务
│       ├── src/
│       │   ├── modules/              # 业务模块
│       │   │   ├── auth/             # 认证模块
│       │   │   ├── users/            # 用户模块
│       │   │   └── admin/            # 管理员模块
│       │   ├── common/               # 公共模块
│       │   │   ├── guards/           # 守卫
│       │   │   ├── interceptors/     # 拦截器
│       │   │   ├── decorators/       # 装饰器
│       │   │   └── filters/          # 异常过滤器
│       │   ├── config/               # 配置
│       │   ├── app.module.ts         # 根模块
│       │   ├── app.controller.ts     # 根控制器
│       │   ├── app.service.ts        # 根服务
│       │   └── main.ts               # 入口文件
│       ├── nest-cli.json             # Nest CLI 配置
│       ├── tsconfig.json             # TypeScript 配置
│       └── package.json
│
├── packages/                          # 共享包
│   ├── database/                     # Prisma 数据库
│   │   ├── prisma/
│   │   │   └── schema.prisma         # 数据库 Schema
│   │   ├── src/
│   │   │   └── client.ts             # Prisma Client
│   │   └── package.json
│   │
│   ├── types/                        # 共享类型定义
│   │   ├── src/
│   │   │   └── index.ts              # 类型导出
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── utils/                        # 共享工具函数
│       ├── src/
│       │   └── index.ts              # 工具函数
│       ├── tsconfig.json
│       └── package.json
│
├── .github/                           # GitHub 配置
│   └── workflows/                    # GitHub Actions
│
├── turbo.json                        # Turborepo 配置
├── pnpm-workspace.yaml               # pnpm workspace 配置
├── package.json                      # 根 package.json
├── .gitignore                        # Git 忽略文件
├── .prettierrc                       # Prettier 配置
├── .prettierignore                   # Prettier 忽略
├── .env.example                      # 环境变量示例
├── README.md                         # 项目说明
└── QUICKSTART.md                     # 快速启动指南
```

## 技术栈分布

### 应用层

- **apps/web**: Next.js 15 + TypeScript + Tailwind CSS
- **apps/admin**: Vite 6 + React 19 + Ant Design
- **apps/api-server**: NestJS 10 + TypeScript

### 共享层

- **packages/database**: Prisma ORM + PostgreSQL
- **packages/types**: TypeScript 类型定义
- **packages/utils**: 通用工具函数

### 工程化

- **Monorepo**: Turborepo
- **包管理**: pnpm workspace
- **代码质量**: ESLint + Prettier
- **部署**: Vercel

## 端口分配

| 应用    | 端口 | 用途         |
| ------- | ---- | ------------ |
| Next.js | 3000 | C端主应用    |
| Vite    | 5173 | 后台管理系统 |
| NestJS  | 4000 | API 服务     |

## API 路由规划

### C端 API (Next.js)

```
/api/auth/*         - 用户认证
/api/user/*         - 用户信息
/api/posts/*        - 内容查询
```

### 管理后台 API (NestJS)

```
/api/admin/auth/*      - 管理员认证
/api/admin/users/*     - 用户管理
/api/admin/content/*   - 内容管理
/api/admin/analytics/* - 数据分析
/api/docs              - Swagger 文档
```

## 数据流向

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ├──────────────┐
       │              │
       ▼              ▼
┌────────────┐  ┌──────────────┐
│  Next.js   │  │  Vite Admin  │
│  (Port 3000)  │  (Port 5173)  │
└──────┬─────┘  └──────┬───────┘
       │              │
       │              │
       ▼              ▼
┌─────────────────────────────┐
│   NestJS API (Port 4000)    │
└──────────────┬──────────────┘
               │
               ▼
        ┌─────────────┐
        │  PostgreSQL │
        └─────────────┘
```

## 开发工作流

1. **启动开发环境**: `pnpm dev`
2. **修改代码**: 各应用支持热重载
3. **类型检查**: `pnpm type-check`
4. **代码检查**: `pnpm lint`
5. **格式化**: `pnpm format`
6. **构建**: `pnpm build`
7. **部署**: 推送到 Git 触发 Vercel 自动部署

## 部署架构

```
GitHub Repo
    │
    ├─────────────────┬─────────────────┐
    │                 │                 │
    ▼                 ▼                 ▼
Vercel Web       Vercel Admin      Railway API
(Next.js)         (Vite SPA)       (NestJS)
    │                 │                 │
    └─────────────────┴─────────────────┘
                      │
                      ▼
              Vercel Postgres
```

## 关键文件说明

- **turbo.json**: 定义任务依赖和缓存策略
- **pnpm-workspace.yaml**: 定义 workspace 包
- **.env.example**: 环境变量模板
- **vercel.json**: Vercel 部署配置
- **prisma/schema.prisma**: 数据库模型定义
