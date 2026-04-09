# 🚀 快速启动指南

## 1. 安装依赖

项目使用 pnpm 作为包管理器，运行以下命令安装所有依赖：

```bash
pnpm install
```

**注意**: 首次安装可能需要 5-10 分钟，取决于网络速度。

## 2. 配置环境变量

复制环境变量示例文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置必要的环境变量：

```env
# 数据库连接（必需）
DATABASE_URL="postgresql://user:password@localhost:5432/platform?schema=public"

# NextAuth 配置（必需）
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="生成一个随机字符串"

# JWT 配置（必需）
JWT_SECRET="生成一个随机字符串"
```

**生成随机密钥**：

```bash
# 在 macOS/Linux 上
openssl rand -base64 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 3. 初始化数据库

如果你使用本地 PostgreSQL：

```bash
# 生成 Prisma Client
pnpm db:generate

# 运行数据库迁移
pnpm db:migrate
```

如果使用 Vercel Postgres 或 Supabase，请先在对应平台创建数据库，然后复制连接字符串到 `.env` 文件。

## 4. 启动开发服务器

### 方式 1: 同时启动所有服务（推荐）

```bash
pnpm dev
```

这将启动：

- Next.js 主应用: http://localhost:3000
- Vite 后台管理: http://localhost:5173
- NestJS API 服务: http://localhost:4000

### 方式 2: 单独启动某个应用

```bash
# 仅启动 Next.js
pnpm dev --filter=web

# 仅启动后台管理
pnpm dev --filter=admin

# 仅启动 API 服务
pnpm dev --filter=api-server
```

## 5. 访问应用

- **C端主应用**: http://localhost:3000
- **后台管理系统**: http://localhost:5173
- **API 文档**: http://localhost:4000/api/docs
- **API 健康检查**: http://localhost:4000/api/health

## 6. 验证安装

运行类型检查确保一切正常：

```bash
pnpm type-check
```

运行代码检查：

```bash
pnpm lint
```

## 常见问题

### Q1: pnpm install 失败

确保你安装了正确版本的 Node.js 和 pnpm：

```bash
node --version  # 应该 >= 20.0.0
pnpm --version  # 应该 >= 9.0.0
```

### Q2: 数据库连接失败

检查：

1. PostgreSQL 是否已启动
2. DATABASE_URL 连接字符串是否正确
3. 数据库是否已创建

### Q3: 端口被占用

如果端口冲突，可以修改端口：

- Next.js: 修改 `apps/web/package.json` 中的 dev 脚本，添加 `-p 3001`
- Vite: 修改 `apps/admin/vite.config.ts` 中的 `server.port`
- NestJS: 修改 `.env` 中的 `PORT` 变量

### Q4: Prisma Client 未生成

手动生成：

```bash
cd packages/database
pnpm db:generate
```

## 下一步

项目成功启动后，你可以：

1. 查看架构文档: `README.md`
2. 开始开发新功能
3. 配置 Vercel 部署
4. 添加认证功能
5. 连接真实数据库

## 需要帮助？

- 查看主 README: `README.md`
- 检查各应用的 package.json 了解可用脚本
- 查看 Turborepo 文档: https://turbo.build/repo/docs
