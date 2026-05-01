# EatCheck API Server — Staging 部署手册

> 适用于 **staging 虚拟机 + pm2** 的部署流程。生产仍走 Cloud Run + Dockerfile（不在此文档范围）。

---

## 1. 架构概览

```
┌────────────────┐       ┌──────────────────────────────────┐       ┌─────────────────┐
│ 开发机 / CI    │──tar──>│ Staging VM                       │       │ Neon (staging)  │
│ build-staging  │  scp  │  /opt/eatcheck/api-server        │──SQL──>│ Upstash (stg)   │
│   .sh          │       │   ├── pm2 cluster: api-server    │       │ R2 (eatcheck-   │
│                │       │   └── pm2 fork:    api-worker    │       │      staging)   │
└────────────────┘       └──────────────────────────────────┘       └─────────────────┘
                                  ▲
                          nginx 反代 / SSL（VM 上自管）
```

- **HTTP 主服务**：pm2 cluster 模式 1 实例，`dist/main.js`，监听 `PORT=3006`
- **BullMQ Worker**：pm2 fork 模式 1 实例，`dist/worker.js`，无 HTTP 监听
- **环境隔离**：`NODE_ENV=staging`，独立 Neon 分支、独立 Upstash、RC sandbox webhook

---

## 2. 一次性 VM 准备

> 假设 VM 是 Ubuntu 22.04 LTS。其他发行版自行替换包管理器。

### 2.1 安装 Node 20 + pnpm + pm2

```bash
# Node 20.x（与 Dockerfile 对齐）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# pnpm（仅 prisma migrate deploy 需要；运行期不强依赖）
sudo npm install -g pnpm@9 pm2@latest

# pm2 开机自启
pm2 startup systemd -u $USER --hp $HOME
# 按提示执行 sudo env PATH=... pm2 startup ... 那一行

# pm2 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### 2.2 目录与凭据

```bash
sudo mkdir -p /opt/eatcheck /etc/eatcheck
sudo chown -R $USER:$USER /opt/eatcheck

# 把 .env.staging（含真实凭据）放到 /etc/eatcheck/
# 注意：tarball 不包含任何 env 文件，凭据必须在 VM 端独立维护
# 必备字段参考：apps/api-server/src/core/config/configuration.ts
#               以及 prisma/schema.prisma 里的 DATABASE_URL / DIRECT_URL
sudo nano /etc/eatcheck/.env.staging
sudo chmod 600 /etc/eatcheck/.env.staging
```

### 2.3 nginx（可选，按需配 SSL）

简化示例（监听 443，反代到 pm2 的 3006）：

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

> NestJS `main.ts` 已设 `app.set('trust proxy', 1)`，单层 nginx 反代即可正确取 IP。

---

## 3. 构建打包（开发机 / CI）

```bash
# 在仓库根
pnpm --filter @ai-platform/server run build:staging
# 或：bash apps/api-server/scripts/build-staging.sh
```

产物：

```
dist-staging/api-server-staging-<git-sha>-<ts>.tar.gz
```

包内布局见 `scripts/build-staging.sh` 头部注释。

---

## 4. 上传与发布

```bash
# 4.1 上传
TARBALL=dist-staging/api-server-staging-XXXXXXXX.tar.gz
scp "$TARBALL" user@staging-vm:/opt/eatcheck/

# 4.2 在 VM 上发布
ssh user@staging-vm <<'EOF'
set -euo pipefail
cd /opt/eatcheck

# 解压到带 git-sha 的目录，便于回滚
TARBALL=$(ls -t api-server-staging-*.tar.gz | head -1)
RELEASE_DIR="releases/$(basename "$TARBALL" .tar.gz)"
mkdir -p "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR" --strip-components=1

# 链接当前版本
ln -sfn "$PWD/$RELEASE_DIR" current

# 链接 .env（凭据从 /etc/eatcheck 单独管理）
ln -sfn /etc/eatcheck/.env.staging current/.env

# 4.3 数据库迁移（首次部署 / schema 变更时）
cd current
npx prisma migrate deploy

# 4.4 启动 / 热重载（零停机）
pm2 startOrReload ecosystem.staging.config.cjs --update-env

# 保存进程列表
pm2 save
EOF
```

**回滚**：

```bash
ssh user@staging-vm 'cd /opt/eatcheck && \
  ln -sfn $PWD/releases/<previous-tag> current && \
  ln -sfn /etc/eatcheck/.env.staging current/.env && \
  cd current && pm2 startOrReload ecosystem.staging.config.cjs --update-env'
```

---

## 5. 运维常用命令

| 操作         | 命令                                                |
| ---------- | ------------------------------------------------- |
| 查看进程       | `pm2 list`                                        |
| 实时日志       | `pm2 logs api-server-staging`                     |
| Worker 日志  | `pm2 logs api-worker-staging`                     |
| 重载（零停机）    | `pm2 reload api-server-staging`                   |
| 重启（断 1~2s） | `pm2 restart api-server-staging`                  |
| 停止         | `pm2 stop api-server-staging`                     |
| 查看资源       | `pm2 monit`                                       |
| 健康检查       | `curl -fsS http://127.0.0.1:3006/api/v1/health`   |
| 队列状态       | `curl -fsS http://127.0.0.1:3006/api/v1/health/queues`（如已实现） |

---

## 6. 与生产环境的关键差异

| 项                       | Staging                          | Production           |
| ----------------------- | -------------------------------- | -------------------- |
| 运行平台                  | VM + pm2                         | Cloud Run + Docker   |
| `NODE_ENV`              | `staging`                        | `production`         |
| Swagger                 | 默认开启（`ENABLE_SWAGGER=true`） | 默认关闭                 |
| Neon Postgres           | 独立 staging 分支                 | 独立 prod 分支          |
| Upstash Redis           | 独立 staging 实例                 | 独立 prod 实例          |
| RevenueCat              | sandbox webhook + sandbox API key | 生产 webhook + 生产 API |
| `SUBSCRIPTION_STORE_ENV` | `sandbox`                        | `production`         |
| R2 bucket               | `eatcheck-staging`               | `eatcheck-prod`      |
| `CACHE_VERSION`         | `staging-v1`                     | `prod-v1`            |
| JWT_SECRET              | 独立                              | 独立                   |
| 日志级别                  | `info`（可临时调 `debug`）         | `info`               |

---

## 7. 故障排查清单

- **启动即崩 / `Error: Cannot find module '@prisma/client'`**
  → `build-staging.sh` 漏拷 `.prisma/client`。重新打包；或在 VM 上 `cd current && npx prisma generate`。
- **`PrismaClientInitializationError`**
  → 检查 `current/.env` 软链是否指向 `/etc/eatcheck/.env.staging`；`DATABASE_URL` 是否含 `?sslmode=require&pgbouncer=true&connection_limit=1`。
- **502 Bad Gateway**
  → `pm2 list` 看 `online` 状态；`pm2 logs api-server-staging --lines 200` 找 stack。
- **OTP 收不到 / 收到但验证失败**
  → 确认 Redis 连接；`redis-cli -u $REDIS_URL keys 'admin:otp:*'`；本服务 OTP TTL 5min。
- **RC webhook 401**
  → `REVENUECAT_WEBHOOK_AUTH` 与 RC dashboard webhook Authorization header 完全一致（含 `Bearer ` 前缀视配置而定）。
- **pm2 reload 后旧进程不退**
  → `kill_timeout` 已设 30s；如仍不退，`pm2 stop && pm2 start` 强制重启；排查是否有未关闭的长连接（如未释放的 BullMQ worker）。
- **磁盘占用上涨**
  → 检查 `releases/` 旧版本数（保留最近 3 个即可）+ pm2 日志（已配 logrotate 100MB×14）。

---

## 8. 安全清单（每次部署必检）

- [ ] `.env.staging` 权限 `600`，仅 deploy 用户可读
- [ ] 真实凭据从未出现在仓库（`git log -p -- '*.env*'` 自查）
- [ ] `NODE_ENV=staging` 已生效（接 `/api/v1/health` 看响应）
- [ ] CORS_ORIGINS 仅放 staging 前端域名（不允许 `*`）
- [ ] DATABASE_URL / REDIS_URL 指向 staging 资源（不要意外用 prod 凭据）
- [ ] RC webhook 指向 staging URL，且使用 sandbox secret
- [ ] nginx 已开启 HTTPS，HTTP→HTTPS 强制跳转

---

## 9. 维护版本号

打包脚本写入 `current/VERSION`，部署后可：

```bash
ssh user@staging-vm 'cat /opt/eatcheck/current/VERSION'
# package = api-server
# tag     = staging-abc123def456-20260501-090000
# git_sha = abc123def456
# built_at= 20260501-090000
# node    = v20.x.x
# pnpm    = 9.x.x
```

也可以暴露 `/api/v1/health/version` 端点（如已实现）让前端 / 监控读取。
