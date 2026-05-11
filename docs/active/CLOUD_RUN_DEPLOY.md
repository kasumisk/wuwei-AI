# Cloud Run 部署方案 — EatCheck API + Worker

> 适用范围: `apps/api-server` (NestJS 11 + Prisma 6 + BullMQ)
> 目标: 在 Google Cloud Run 上同时运行 HTTP API 服务与常驻 Worker，并复用同一镜像。

---

## 1. 拓扑

```
                                    ┌──────────────────────────────┐
                                    │   Artifact Registry          │
                                    │   us-east1-docker.pkg.dev    │
                                    │   /flutter-scaffold-4fd6c    │
                                    │   /eatcheck/api-server:<tag> │
                                    └──────────────┬───────────────┘
                                                   │ 同一镜像
                          ┌────────────────────────┼────────────────────────┐
                          ▼                        ▼                        ▼
                ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
                │ eatcheck-api    │      │ eatcheck-worker │      │ eatcheck-migrate│
                │ Cloud Run Svc   │      │ Cloud Run Svc   │      │ Cloud Run Job   │
                │                 │      │                 │      │                 │
                │ CMD: main.js    │      │ CMD: worker.js  │      │ CMD: migrate +  │
                │ public HTTP     │      │ no-cpu-throttl  │      │      init-system│
                │ autoscale 0..5  │      │ min=1, max=1    │      │ on-demand       │
                │ /api/health/*   │      │ BullMQ consumer │      │ 一次性          │
                └────────┬────────┘      └────────┬────────┘      └────────┬────────┘
                         │                        │                        │
                         └────────────┬───────────┴────────────┬───────────┘
                                      ▼                        ▼
                            Neon Postgres (us-east-1)    Upstash Redis
```

| 资源 | 类型 | 触发 | 实例策略 | 用途 |
|---|---|---|---|---|
| `eatcheck-api` | Cloud Run Service | HTTP 请求 | min=0, max=5, concurrency=80, cpu=1, mem=1Gi | 对外 API |
| `eatcheck-worker` | Cloud Run Service | 后台 | min=1, max=1, **no-cpu-throttling**, cpu=1, mem=1Gi | BullMQ 消费者，不能 scale-to-zero |
| `eatcheck-migrate` | Cloud Run Job | 手动/CI | 单次执行 | `prisma migrate deploy` + `init-system.ts` |

---

## 2. 前置 (一次性，已完成)

```bash
PROJECT_ID=flutter-scaffold-4fd6c
REGION=us-east1

gcloud config set project $PROJECT_ID
gcloud config set run/region $REGION

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com iam.googleapis.com

gcloud artifacts repositories create eatcheck \
  --repository-format=docker --location=$REGION

gcloud iam service-accounts create eatcheck-runtime \
  --display-name="EatCheck Cloud Run Runtime SA"
```

运行时服务账号: `eatcheck-runtime@flutter-scaffold-4fd6c.iam.gserviceaccount.com`
该账号被授予访问 `eatcheck-*` 系列 Secret 的 `roles/secretmanager.secretAccessor` (脚本会按 secret 粒度授权)。

---

## 3. 配置策略

### 3.1 公开值 (env vars)
直接通过 `--set-env-vars` 注入。位于 `scripts/deploy-cloudrun.sh` 的 `PUBLIC_KEYS`：
```
NODE_ENV PORT LOG_LEVEL API_PREFIX API_VERSION
JWT_EXPIRES_IN CORS_ORIGINS
AI_GATEWAY_PROVIDER OPENROUTER_BASE_URL
VISION_MODEL VISION_MODEL_FALLBACK
STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_PUBLIC_URL
```

### 3.2 敏感值 (Secret Manager)
其余键全部进 Secret Manager，命名规则: `eatcheck-<KEY>` (例如 `eatcheck-DATABASE_URL`)。
通过 `--set-secrets` 在容器启动时挂载为环境变量。

### 3.3 Cloud Run 平台保留键
- `PORT`：由平台自动注入（默认 8080，本服务监听 `PORT||3000`，已兼容）
- 不要手动 `--set-env-vars PORT=...`

---

## 4. 部署步骤

```bash
# 一键完成全流程
./scripts/deploy-cloudrun.sh all

# 或者按阶段执行
./scripts/deploy-cloudrun.sh build       # Cloud Build 构建镜像
./scripts/deploy-cloudrun.sh secrets     # 同步 .env.production → Secret Manager
./scripts/deploy-cloudrun.sh migrate     # 创建/执行迁移 Job (含超管初始化)
./scripts/deploy-cloudrun.sh api         # 部署 HTTP 服务
./scripts/deploy-cloudrun.sh worker      # 部署 Worker 服务
./scripts/deploy-cloudrun.sh status
./scripts/deploy-cloudrun.sh logs api
```

### 4.1 镜像构建 (`build`)

使用 Cloud Build 远程构建 (`e2-highcpu-8`，约 5-8 分钟)。镜像 tag: `<YYYYMMDD-HHMMSS>-<git_sha>`，同时打 `latest`。

构建命令使用 monorepo 根作为 context：
```
gcloud builds submit -f apps/api-server/Dockerfile \
  --tag us-east1-docker.pkg.dev/$PROJECT_ID/eatcheck/api-server:<tag> .
```

### 4.2 密钥同步 (`secrets`)

逐行解析 `apps/api-server/.env.production`：
- 注释/空行/`PUBLIC_KEYS` 跳过
- 其余 → 创建/追加 secret 版本，并把 SA 加入 `secretAccessor`

**轮换密钥时，只需重新跑 `secrets` 子命令 + 滚动 Cloud Run 服务即可（Cloud Run 会读取最新 `:latest` 版本）。**

### 4.3 迁移与初始化 (`migrate`)

Job 内执行：
```
node node_modules/prisma/build/index.js migrate deploy --schema=prisma/schema.prisma
node dist/scripts/init-system.js
```

`init-system.ts` 已被改造，幂等地完成：
1. **订阅计划 seed** —— 调用 `seedSubscriptionPlans()`，写入默认订阅档位（FREE / PRO / 等），可重复执行不重复写入
2. `SUPER_ADMIN` / `ADMIN` 角色
3. 25 个权限（菜单 + 操作）+ 父子关系
4. ADMIN 角色分配全部权限
5. **创建超级管理员** `xiehaiji@gmail.com` (用户名 `xiehaiji`)
   - 若不存在 → 用 24 位随机密码新建，**仅本次日志显示**
   - 若存在 → 仅同步 email/username/role/status，**不覆盖密码**
   - 可通过环境变量 `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` 覆盖
6. 关联 `userRoles` 至 `SUPER_ADMIN` role

> ✅ 订阅配置种子已内置在 `init-system.ts` 的第 0 步，迁移 Job 一次性跑完即包含。

⚠️ 首次执行后立即从 Cloud Run Job 日志中复制初始密码，并登录后修改。

### 4.4 API 服务 (`api`)

```
--port=3000
--cpu=1 --memory=1Gi
--min-instances=0 --max-instances=5
--concurrency=80 --timeout=300
--execution-environment=gen2
--cpu-boost
--allow-unauthenticated
--command=dumb-init --args=--,node,dist/main.js
```

启动探针默认走 TCP 3000；应用内 `/api/health/live` 由 `Dockerfile` HEALTHCHECK 与 LB 探活复用。

### 4.5 Worker 服务 (`worker`)

```
--no-allow-unauthenticated      # 不暴露公网
--no-cpu-throttling             # idle 时仍保留 CPU,BullMQ 长连接不被冻
--min-instances=1 --max-instances=1   # 单实例消费,防止重复处理
--command=dumb-init --args=--,node,dist/worker.js
```

> Worker 使用 `NestFactory.createApplicationContext`，不监听端口；SIGTERM 经 `dumb-init` 转发给 node，`enableShutdownHooks` 让 BullMQ Worker 优雅关闭。

---

## 5. 验证

```bash
# HTTP 服务 URL
API_URL=$(gcloud run services describe eatcheck-api --region=us-east1 --format='value(status.url)')
curl -fsS "$API_URL/api/health/live"  # → {"alive":true}
curl -fsS "$API_URL/api/health/ready" # → {"ready":true}
curl -fsS "$API_URL/api/health"       # → {"status":"ok",...}

# Worker 状态 (查看日志中是否有 "EatCheck Worker started")
./scripts/deploy-cloudrun.sh logs worker | head -40

# 超管登录 (使用迁移日志中输出的初始密码)
curl -X POST "$API_URL/api/admin/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"xiehaiji","password":"<刚刚输出的随机密码>"}'
```

---

## 6. 故障排查

| 现象 | 排查 |
|---|---|
| `migrate` Job 失败 `P3009` | 上一次迁移卡在中间 → 进入 Neon 控制台手动 `_prisma_migrations` 修复，或临时改 Job CMD 跑 `migrate resolve` |
| Worker 启动后 30s 即被杀 | 忘记加 `--no-cpu-throttling` 或 `--min-instances=1`，Cloud Run 把它当 idle |
| API 502 `Container failed to start` | 90% 是缺 `JWT_SECRET` 等必填 secret；查 `logs api` 看 NestJS bootstrap 报错 |
| 504 first request 慢 | 冷启动；提到 `min-instances=1` 或开启 `--cpu-boost`（已默认开） |
| Prisma `Engine not found` | 镜像 base 须是 `node:*-alpine`，且 Dockerfile 已生成 client（见 builder stage L61） |
| Neon `Too many connections` | `DATABASE_URL` 必须用 `-pooler` host + `connection_limit=1`（已配置） |

---

## 7. 后续优化路线

1. **Cloud Build 触发器**：把 `deploy-cloudrun.sh all` 接入 GitHub `main` 分支推送
2. **VPC + Cloud NAT**：固定出站 IP，便于第三方 IP 白名单
3. **Cloud Armor**：在 API 前加 WAF，限速/地理封禁
4. **Cloud Tasks 替代部分 BullMQ**：定时类任务可下沉到 Cloud Tasks/Scheduler，进一步降低 Worker 资源占用
5. **CDN + Cloud Run 域名映射**：自定义域 `api.eatcheck.app` 映射到 `eatcheck-api`，开启 HTTPS

---

## 8. 关键文件索引

| 路径 | 说明 |
|---|---|
| `apps/api-server/Dockerfile` | 多阶段镜像（已修复 pnpm filter 与 HEALTHCHECK） |
| `apps/api-server/src/main.ts` | HTTP 服务入口 |
| `apps/api-server/src/worker.ts` | Worker 入口（共享 AppModule，不监听端口） |
| `apps/api-server/src/scripts/init-system.ts` | 系统初始化（角色/权限/超管） |
| `scripts/deploy-cloudrun.sh` | 一键部署脚本 |
| `apps/api-server/.env.production` | Secret 同步源（不入仓） |
