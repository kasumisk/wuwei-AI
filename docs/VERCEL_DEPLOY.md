# Vercel 部署指南

本文档介绍如何将项目部署到 Vercel。

## 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Vercel 部署架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────┐     ┌─────────────────┐              │
│   │   Next.js Web   │     │   Vite Admin    │              │
│   │   (app.domain)  │     │ (admin.domain)  │              │
│   └────────┬────────┘     └────────┬────────┘              │
│            │                       │                        │
│            │    Vercel Edge        │                        │
│            └───────────┬───────────┘                        │
│                        │                                    │
│              ┌─────────▼─────────┐                         │
│              │  NestJS API       │                         │
│              │  (Railway/Render) │                         │
│              └─────────┬─────────┘                         │
│                        │                                    │
│              ┌─────────▼─────────┐                         │
│              │  PostgreSQL       │                         │
│              │  (Vercel/Supabase)│                         │
│              └───────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 前提条件

1. 已安装 Vercel CLI: `pnpm add -g vercel`
2. 已登录 Vercel: `vercel login`
3. 项目代码已推送到 Git 仓库

## 方式一：使用 Vercel Dashboard（推荐新手）

### 部署 Next.js 主应用

1. 访问 [Vercel Dashboard](https://vercel.com/dashboard)
2. 点击 "Add New..." -> "Project"
3. 导入你的 Git 仓库
4. 配置项目：
   - **Framework Preset**: Next.js
   - **Root Directory**: `./` (保持默认)
   - **Build Command**: `pnpm turbo build --filter=@repo/web`
   - **Output Directory**: `apps/web/.next`
   - **Install Command**: `pnpm install`
5. 添加环境变量（在 Environment Variables 部分）
6. 点击 "Deploy"

### 部署 Vite Admin（需要创建单独项目）

1. 在 Vercel Dashboard 创建新项目
2. 导入同一个 Git 仓库
3. 配置项目：
   - **Framework Preset**: Other
   - **Root Directory**: `./` (保持默认)
   - **Build Command**: `pnpm turbo build --filter=@repo/admin`
   - **Output Directory**: `apps/admin/dist`
   - **Install Command**: `pnpm install`
4. 添加环境变量
5. 点击 "Deploy"

## 方式二：使用 Vercel CLI

### 初始化项目

```bash
# 登录 Vercel
vercel login

# 链接项目（首次部署时）
vercel link
```

### 部署 Next.js 主应用

```bash
# 预览部署
vercel

# 生产部署
vercel --prod
```

### 部署 Vite Admin

```bash
# 切换配置文件
cp vercel.admin.json vercel.json

# 部署
vercel --prod

# 恢复配置
git checkout vercel.json
```

### 使用部署脚本

```bash
# 部署 Next.js
pnpm deploy:web

# 部署 Admin
pnpm deploy:admin

# 预览部署
pnpm deploy:preview
```

## 方式三：GitHub Actions 自动部署

### 配置 GitHub Secrets

在 GitHub 仓库的 Settings -> Secrets and variables -> Actions 中添加：

| Secret 名称 | 说明 | 获取方式 |
|------------|------|---------|
| `VERCEL_TOKEN` | Vercel API Token | [Vercel Tokens](https://vercel.com/account/tokens) |
| `VERCEL_ORG_ID` | 组织/团队 ID | `vercel link` 后查看 `.vercel/project.json` |
| `VERCEL_PROJECT_ID_WEB` | Web 项目 ID | 同上 |
| `VERCEL_PROJECT_ID_ADMIN` | Admin 项目 ID | 同上 |

### 触发部署

- 推送到 `main` 分支且修改了相关文件时自动触发
- 可以手动触发 GitHub Actions

## 环境变量配置

### Next.js Web 应用

```env
# 必需
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=your-secret-key

# 数据库
DATABASE_URL=postgresql://...

# API 服务
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

### Vite Admin 应用

```env
# API 服务
VITE_API_URL=https://api.your-domain.com
VITE_APP_TITLE=后台管理系统
```

### 在 Vercel 中配置

1. 进入项目 Settings -> Environment Variables
2. 添加所需环境变量
3. 选择应用环境（Production/Preview/Development）

## 域名配置

### 添加自定义域名

1. 进入项目 Settings -> Domains
2. 添加域名
3. 配置 DNS 记录

### 推荐域名结构

| 应用 | 域名示例 |
|-----|---------|
| Next.js Web | `app.yourdomain.com` 或 `www.yourdomain.com` |
| Vite Admin | `admin.yourdomain.com` |
| API Server | `api.yourdomain.com` |

## 构建优化

### Turborepo 缓存

项目使用 Turborepo 实现增量构建，Vercel 会自动利用远程缓存：

```json
// turbo.json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    }
  }
}
```

### 仅构建变更应用

使用 `turbo-ignore` 可以跳过未变更的应用：

```json
// vercel.json
{
  "ignoreCommand": "npx turbo-ignore"
}
```

## NestJS API 部署

NestJS API 服务推荐部署到以下平台：

### Railway（推荐）

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 初始化项目
cd apps/api-server
railway init

# 部署
railway up
```

### Render

1. 访问 [Render Dashboard](https://dashboard.render.com/)
2. 创建 Web Service
3. 连接 Git 仓库
4. 配置：
   - **Root Directory**: `apps/api-server`
   - **Build Command**: `pnpm install && pnpm build`
   - **Start Command**: `node dist/main.js`

### Fly.io

```bash
# 安装 Fly CLI
curl -L https://fly.io/install.sh | sh

# 登录
fly auth login

# 初始化
cd apps/api-server
fly launch

# 部署
fly deploy
```

## 故障排查

### 构建失败

1. 检查 `pnpm-lock.yaml` 是否提交
2. 确认 Node.js 版本 >= 20
3. 查看构建日志定位错误

### 依赖安装失败

确保 `package.json` 中指定了正确的包管理器：

```json
{
  "packageManager": "pnpm@9.0.0"
}
```

### 环境变量未生效

1. 确认变量名称正确
2. 检查变量作用域（Production/Preview/Development）
3. 重新部署以应用新变量

### SPA 路由 404

对于 Vite Admin，确保配置了 rewrites：

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

## 常用命令

```bash
# 查看部署列表
vercel ls

# 查看部署日志
vercel logs [deployment-url]

# 回滚部署
vercel rollback

# 删除部署
vercel rm [deployment-url]

# 拉取环境变量
vercel env pull

# 添加环境变量
vercel env add

# 查看项目信息
vercel inspect
```

## 相关链接

- [Vercel 官方文档](https://vercel.com/docs)
- [Turborepo + Vercel](https://turbo.build/repo/docs/guides/ci-vendors/vercel)
- [Next.js 部署文档](https://nextjs.org/docs/deployment)
