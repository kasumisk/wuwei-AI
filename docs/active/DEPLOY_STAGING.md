# EatCheck API Server — Staging 部署手册

> 适用于 **staging GCP VM + pm2** 的部署流程。生产仍走 Cloud Run + Dockerfile（不在此文档范围）。

---

## 1. 架构概览

```
┌────────────────┐   git push   ┌──────────────────────────────────────┐       ┌─────────────────────┐
│ 开发机 / CI    │──────────────>│ GitHub (origin/main)                 │       │ Vercel Prisma       │
│                │              └──────────────────────────────────────┘       │ Postgres (staging)  │
│ build-staging  │   gcloud ssh  ┌──────────────────────────────────────┐       │                     │
│   .sh          │──────────────>│ GCP VM: openclaw (asia-east2-a)      │──SQL──>│ RedisLabs           │
│                │              │  /home/xiehaiji/wuwei-api            │       │ (staging instance)  │
└────────────────┘              │   ├── pm2 fork: wuwei-api            │       │                     │
                                │   └── pm2 fork: wuwei-api-worker     │       │ Cloudflare R2       │
                                └──────────────────────────────────────┘       └─────────────────────┘
```

- **HTTP 主服务**：pm2 fork 模式，`dist/main.js`，监听 `PORT=3006`，进程名 `wuwei-api`
- **BullMQ Worker**：pm2 fork 模式，`dist/worker.js`，无 HTTP 监听，进程名 `wuwei-api-worker`
- **环境隔离**：`NODE_ENV=development`（staging），独立 Vercel Prisma Postgres、独立 RedisLabs 实例

---

## 2. VM 基本信息

| 项 | 值 |
|---|---|
| GCP 项目 | `flutter-scaffold-4fd6c` |
| 实例名 | `openclaw` |
| Zone | `asia-east2-a` |
| 登录用户 | `xiehaiji` |
| 代码目录 | `/home/xiehaiji/wuwei-api` |
| pm2 主进程名 | `wuwei-api` |
| pm2 Worker 名 | `wuwei-api-worker` |
| 运行端口 | `3006` |

---

## 3. 部署流程

### 3.1 一键部署（推荐）

```bash
# 在仓库根执行，会自动 git push → SSH 进 VM → git pull + build + pm2 restart
bash apps/api-server/scripts/build-staging.sh

# 跳过 git push（VM 已是最新代码时使用）
bash apps/api-server/scripts/build-staging.sh --no-push

# 或通过 pnpm 脚本
pnpm --filter api-server run build:staging
```

**前置条件**：
- 本机已安装 `gcloud` CLI 并登录（`gcloud auth login`）
- 本地工作区无未提交的修改（脚本会检查）

### 3.2 脚本执行步骤详解

```
[1/3] git push origin <当前分支>
[2/3] gcloud compute ssh xiehaiji@openclaw
      → source ~/.nvm/nvm.sh
      → cd /home/xiehaiji/wuwei-api
      → git fetch origin && git reset --hard origin/main
      → pnpm install --frozen-lockfile
      → pnpm --filter @ai-platform/constants run build
      → pnpm --filter @ai-platform/shared run build
      → cd apps/api-server
      → npx prisma generate
      → pnpm run build
      → pm2 restart wuwei-api
[3/3] 验证：pm2 show wuwei-api（status / restarts / uptime / pid）
```

### 3.3 SSH 连接方式切换

默认使用 `gcloud compute ssh`，也可以切换为普通 SSH：

```bash
# 使用 ~/.ssh/config 里的 openclaw Host 条目
SSH_MODE=ssh bash apps/api-server/scripts/build-staging.sh
```

---

## 4. 一次性 VM 准备

> 假设 VM 是 Ubuntu 22.04 LTS，已安装 nvm。

### 4.1 安装 Node + pnpm + pm2

```bash
# Node（通过 nvm，与 Dockerfile 对齐）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22
nvm use 22
nvm alias default 22

# pnpm + pm2
npm install -g pnpm pm2

# pm2 开机自启
pm2 startup systemd -u $USER --hp $HOME
# 按提示执行输出的 sudo 命令

# pm2 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### 4.2 克隆代码与配置 .env

```bash
cd ~
git clone https://github.com/kasumisk/wuwei-AI.git wuwei-api
cd wuwei-api/apps/api-server

# .env.staging 已含所有 staging 凭据，直接软链为运行时 .env
ln -sf .env.staging .env
```

> `.env.staging` 文件已包含：DB_HOST/DB_PASSWORD（Vercel Prisma Postgres）、REDIS_URL（RedisLabs）、各 API Key 等，**不要提交到 git**。

### 4.3 初始启动

```bash
cd ~/wuwei-api

# 安装依赖
pnpm install --frozen-lockfile

# 构建
pnpm --filter @ai-platform/constants run build
pnpm --filter @ai-platform/shared run build
cd apps/api-server
npx prisma generate
pnpm run build

# 启动（首次）
cd ~/wuwei-api/apps/api-server
pm2 start dist/main.js --name wuwei-api
pm2 start dist/worker.js --name wuwei-api-worker --no-autorestart false

pm2 save
```

### 4.4 nginx（可选，按需配 SSL）

```nginx
server {
  listen 443 ssl http2;
  server_name staging-api.eatcheck.app;

  # ssl_certificate / ssl_certificate_key ...

  location / {
    proxy_pass http://127.0.0.1:3006;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
  }
}
```

---

## 5. 运维常用命令

在 VM 上执行（需先 `source ~/.nvm/nvm.sh`）：

| 操作 | 命令 |
|---|---|
| 查看进程列表 | `pm2 list` |
| 主服务实时日志 | `pm2 logs wuwei-api` |
| Worker 日志 | `pm2 logs wuwei-api-worker` |
| 重启主服务 | `pm2 restart wuwei-api` |
| 停止 | `pm2 stop wuwei-api` |
| 资源监控 | `pm2 monit` |
| 健康检查 | `curl -fsS http://127.0.0.1:3006/api/v1/health` |

从本机远程执行：

```bash
gcloud compute ssh xiehaiji@openclaw --project=flutter-scaffold-4fd6c --zone=asia-east2-a -- \
  'source ~/.nvm/nvm.sh && pm2 list'
```

---

## 6. 与生产环境的关键差异

| 项 | Staging | Production |
|---|---|---|
| 运行平台 | GCP VM + pm2 | Cloud Run + Docker |
| `NODE_ENV` | `development` | `production` |
| 数据库 | Vercel Prisma Postgres (staging) | Vercel Prisma Postgres (prod) |
| Redis | RedisLabs staging 实例 | RedisLabs prod 实例 |
| Queue 后端 | BullMQ (QUEUE_BACKEND_DEFAULT=bullmq) | Cloud Tasks |
| Cron 后端 | inproc (@Cron) | Cloud Scheduler |
| Swagger | 开启 | 关闭 |
| Internal Auth | 关闭 (ENFORCE_INTERNAL_AUTH=false) | 开启 |
| RevenueCat | sandbox | 生产 |

---

## 7. 故障排查

- **`pm2: command not found`（SSH 非交互式 shell）**
  → 在命令前加 `source ~/.nvm/nvm.sh`，脚本已内置此处理。

- **`Error: Cannot find module '@prisma/client'`**
  → 在 VM 上 `cd ~/wuwei-api/apps/api-server && npx prisma generate`，再 `pm2 restart wuwei-api`。

- **`PrismaClientInitializationError`**
  → 检查 `apps/api-server/.env` 软链是否正确指向 `.env.staging`；确认 `DATABASE_URL` 含 `?sslmode=require`。

- **502 Bad Gateway**
  → `pm2 list` 看 `online` 状态；`pm2 logs wuwei-api --lines 200` 找 stack trace。

- **端口冲突**
  → 检查 `PORT` 环境变量，默认 `3006`；`lsof -i :3006` 查占用进程。

- **Worker 重启频繁**
  → `pm2 logs wuwei-api-worker --lines 100` 查原因；常见：Redis 连接失败、DB 连接池耗尽。
