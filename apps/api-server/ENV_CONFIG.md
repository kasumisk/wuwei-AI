# EatCheck API Server — 环境变量配置

本文档列出 `apps/api-server` 在生产 / staging / 本地三个环境下需要的全部环境变量。
扫描自代码（`process.env.*` + `configService.get(...)`），与运行时一一对应。

> ⚠️ 历史包袱说明
> - `DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE / DB_SYNCHRONIZE / DB_SSL`
>   仍然在 `core/config/configuration.ts` 中读取，但 **Prisma 不使用它们**，仅 `langchain/services/rag.service.ts` 还在用来初始化 PGVector，已计划在 LLM 模块重构时一并迁移到 `DATABASE_URL`。在那之前，**生产环境仍需配置这组 DB_* 变量**（数值与 `DATABASE_URL` 解析出来的一致即可）。
> - `OKX_* / PROXY_*` 是上一代项目残留，EatCheck 不再使用 OKX，但 `PROXY_*` 仍被 `firebase-admin.service.ts` 与 `app-auth.service.ts` 用作访问 Google/Firebase 的可选代理（北美部署可全部留空）。

---

## 1. 部署矩阵速查

| 类别 | 变量 | Production (Cloud Run) | Staging | 本地开发 |
|---|---|---|---|---|
| 运行时 | `NODE_ENV` | `production` | `staging` | `development` |
| 运行时 | `PORT` | `8080`（Cloud Run 注入）| `8080` | `3000` |
| 数据库 | `DATABASE_URL` | **Neon pooled URL** | Neon pooled URL | 本地 PG 或 Neon dev branch |
| 数据库 | `DIRECT_URL` | **Neon direct URL** | Neon direct URL | 同 `DATABASE_URL` |
| 数据库 | `DB_CONNECTION_LIMIT` | `1`（走 PgBouncer）| `1` | `10` |
| 数据库 | `DB_POOL_TIMEOUT` | `10` | `10` | `10` |
| 数据库 | `DB_SLOW_QUERY_MS` | `500` | `500` | `1000` |
| 缓存 | `REDIS_URL` | Upstash `rediss://...` | Upstash | 本地 `redis://localhost:6379` |
| 缓存 | `CACHE_VERSION` | `v1`（升级缓存结构时 bump） | `v1` | `v1` |
| 鉴权 | `JWT_SECRET` | **强随机 ≥64 字符** | 强随机 | 任意 |
| 鉴权 | `GOOGLE_CLIENT_ID_IOS` | iOS 客户端 OAuth ID | 同 | 可空 |
| 鉴权 | `GOOGLE_CLIENT_ID_ANDROID` | Android 客户端 OAuth ID | 同 | 可空 |
| 鉴权 | `GOOGLE_CLIENT_ID_WEB` | Web 客户端 OAuth ID | 同 | 可空 |
| 鉴权 | `FIREBASE_*`（见 §3）| Firebase Admin SDK 凭据 | 同 | 可空 |
| LLM | `OPENAI_API_KEY` | 必填 | 必填 | 必填或留空走 mock |
| LLM | `OPENROUTER_API_KEY` | 推荐填（fallback）| 同 | 可空 |
| LLM | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | 同 | 同 |
| LLM | `DEEPSEEK_API_KEY` | 食物 enrichment 用 | 同 | 可空 |
| LLM | `TEXT_ANALYSIS_MODEL` | `gpt-4o-mini` | 同 | 同 |
| LLM | `VISION_MODEL` | `gpt-4o-mini` | 同 | 同 |
| LLM | `COACH_MODEL` | `gpt-4o-mini` | 同 | 同 |
| LLM | `RECIPE_GENERATION_MODEL` | `gpt-4o-mini` | 同 | 同 |
| LLM | `RECIPE_MODEL_FAST` / `_STRONG` | 可选覆盖 | 同 | 可空 |
| 食物 | `USDA_API_KEY` | 食物库导入 | 同 | 可空 |
| 食物 | `CONFIDENCE_HIGH_THRESHOLD` | `0.75` | `0.75` | `0.75` |
| 订阅 | `REVENUECAT_SECRET_KEY` | 必填 | 必填 | 可空 |
| 订阅 | `REVENUECAT_WEBHOOK_AUTH` | 必填（webhook 验签）| 同 | 可空 |
| 订阅 | `SUBSCRIPTION_STORE_ENV` | `production` | `sandbox` | `sandbox` |
| 微信 | `WECHAT_APPID` / `_SECRET` | 国内业务必填，北美可空 | 同 | 可空 |
| 微信 | `WECHAT_MINI_APPID` / `_SECRET` | 同 | 同 | 同 |
| 微信 | `WECHAT_REDIRECT_URI` | 微信扫码回调 | 同 | 同 |
| 微信 | `WECHAT_TOKEN` | 微信回调签名 token | 同 | 同 |
| 微信 | `WECHAT_FRONTEND_URL` | 微信扫码后跳转地址 | 同 | 同 |
| 微信支付 | `WECHAT_PAY_*`（见 §4） | 可选 | 同 | 可空 |
| 存储 | `STORAGE_ENDPOINT` | GCS/S3/R2 endpoint | 同 | 可空（用本地或 mock）|
| 存储 | `STORAGE_REGION` | `us-west1` | 同 | `auto` |
| 存储 | `STORAGE_ACCESS_KEY` / `_SECRET_KEY` | 必填 | 同 | 可空 |
| 存储 | `STORAGE_BUCKET` | bucket 名 | 同 | `uploads` |
| 存储 | `STORAGE_PUBLIC_URL` | CDN/公网前缀 | 同 | 可空 |
| App | `APP_STORE_URL` / `GOOGLE_PLAY_URL` | App 下载页 | 同 | 可空 |
| Misc | `API_PREFIX` | `api` | `api` | `api` |
| Misc | `API_VERSION` | `v1` | `v1` | `v1` |
| Misc | `LOG_LEVEL` | `info` | `info` | `debug` |
| Misc | `CORS_ORIGINS` | 见 §5 | 同 | `*` |
| Misc | `ENABLE_SWAGGER` | `false` | `true` | `true`（默认开） |
| Misc | `STRATEGY_VERSION` | `2026.05` | 同 | 同 |
| 代理（可选） | `PROXY_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` | **北美部署留空** | 同 | 国内开发可填 |
| 代理（可选） | `HTTPS_PROXY` / `HTTP_PROXY` | 留空 | 同 | 国内开发可填 |
| 历史遗留 | `DB_HOST` / `_PORT` / `_USERNAME` / `_PASSWORD` / `_DATABASE` | 与 `DATABASE_URL` 一致 | 同 | 同 |
| 历史遗留 | `DB_SYNCHRONIZE` | `false`（生产强制）| `false` | `false` |

---

## 2. Neon Postgres 连接配置（**关键**）

### 2.1 必须使用两个 URL

```bash
# 运行时（Prisma 客户端走 PgBouncer，复用连接）
DATABASE_URL="postgresql://USER:PWD@ep-xxx-pooler.us-west-2.aws.neon.tech/eatcheck?sslmode=require&pgbouncer=true&connect_timeout=10"

# Migration / Introspect（必须直连，PgBouncer 不支持 prepared statement）
DIRECT_URL="postgresql://USER:PWD@ep-xxx.us-west-2.aws.neon.tech/eatcheck?sslmode=require"
```

`schema.prisma` 已经声明了 `directUrl = env("DIRECT_URL")`，`prisma migrate deploy` / `prisma db pull` 都会自动走 `DIRECT_URL`，应用运行时走 `DATABASE_URL`。

### 2.2 连接池容量公式

```
后端 Postgres 实际并发连接 = max-instances × concurrency × DB_CONNECTION_LIMIT
                            （Cloud Run）   （NestJS）       （Prisma 客户端）
```

`PrismaService` 的实现（`core/prisma/prisma.service.ts`）：
- 检测到 hostname 含 `-pooler` 时**强制 `connection_limit=1`**，因为 PgBouncer 已做连接复用，每个 Prisma 客户端持有 1 个稳定连接即可。
- 否则使用 `DB_CONNECTION_LIMIT` 环境变量值（默认 10）。

### 2.3 Neon 计划与 Cloud Run 参数推荐（北美单 region）

| Cloud Run | 值 | 说明 |
|---|---|---|
| `--concurrency` | 40（API）/ 1（Worker） | NestJS 单进程吞吐 |
| `--max-instances` | 10（首月） | 北美 MAU<10k 足够 |
| `--min-instances` | 1（API）/ 1（Worker） | 避免冷启动 |
| `--cpu` | 1 | |
| `--memory` | 1Gi | |
| `--cpu-throttling` | false（Worker 必须） | 否则 BullMQ 长轮询被冻结 |
| `--timeout` | 60s（API）/ 3600s（Worker） | |
| `--execution-environment` | gen2 | |

匹配 Neon **Launch** 计划（≥100 connections）：
```
10 instances × 40 concurrency × 1 (PgBouncer) = 400 客户端 PgBouncer 端连接
PgBouncer transaction mode 复用 → 后端 Postgres 端 ~20 连接，远低于 100 上限。
```

> 如果未来 max-instances > 25，需要升 Neon Scale 计划或自建 PgBouncer。

---

## 3. Firebase（用于移动端登录验证）

```bash
FIREBASE_PROJECT_ID=eatcheck-prod
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@eatcheck-prod.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
# 或者使用 service account JSON 路径（推荐挂载 GCP Secret Manager）
GOOGLE_APPLICATION_CREDENTIALS=/secrets/firebase-sa.json
```

> ⚠️ `FIREBASE_PRIVATE_KEY` 在 Cloud Run 注入时必须保留 `\n`，建议改用 Secret Manager 挂载完整 JSON。

---

## 4. 微信支付（可选）

```bash
WECHAT_PAY_APPID=wx...
WECHAT_PAY_MCHID=16...
WECHAT_PAY_SERIAL_NO=ABCDEF...
WECHAT_PAY_API_V3_KEY=32 字符密钥
WECHAT_PAY_PRIVATE_KEY_PATH=/secrets/wechat-pay-private.pem
```

北美业务可全部留空。

---

## 5. CORS / 安全

```bash
# 多个 origin 用逗号分隔，留空 = 拒绝所有跨域
CORS_ORIGINS=https://eatcheck.app,https://admin.eatcheck.app,https://www.eatcheck.app

# 是否暴露 Swagger（生产强制 false）
ENABLE_SWAGGER=false
```

`main.ts` 已通过 `trust proxy 1` 信任 Cloud Run 前置代理；`helmet()` 已默认开启。

---

## 6. 本地 `.env` 模板

```bash
# 复制以下到 apps/api-server/.env，按需填值

# ===== 运行时 =====
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
API_PREFIX=api
API_VERSION=v1

# ===== 数据库 =====
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/eatcheck?sslmode=disable"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/eatcheck?sslmode=disable"
DB_CONNECTION_LIMIT=10
DB_POOL_TIMEOUT=10
DB_SLOW_QUERY_MS=1000

# 历史遗留（仅 RagService 使用，生产环境与 DATABASE_URL 保持一致）
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=eatcheck

# ===== Redis =====
REDIS_URL=redis://localhost:6379
CACHE_VERSION=v1

# ===== JWT =====
JWT_SECRET=dev-only-change-me-in-production-must-be-at-least-64-chars-long-xxxx

# ===== Google OAuth =====
GOOGLE_CLIENT_ID_IOS=
GOOGLE_CLIENT_ID_ANDROID=
GOOGLE_CLIENT_ID_WEB=

# ===== LLM =====
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
DEEPSEEK_API_KEY=
TEXT_ANALYSIS_MODEL=gpt-4o-mini
VISION_MODEL=gpt-4o-mini
COACH_MODEL=gpt-4o-mini
RECIPE_GENERATION_MODEL=gpt-4o-mini

# ===== 食物 =====
USDA_API_KEY=
CONFIDENCE_HIGH_THRESHOLD=0.75

# ===== 订阅 =====
REVENUECAT_SECRET_KEY=
REVENUECAT_WEBHOOK_AUTH=
SUBSCRIPTION_STORE_ENV=sandbox

# ===== 存储（本地可空，走 mock） =====
STORAGE_ENDPOINT=
STORAGE_REGION=auto
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=uploads
STORAGE_PUBLIC_URL=

# ===== CORS / Swagger =====
CORS_ORIGINS=*
ENABLE_SWAGGER=true

# ===== 代理（仅国内开发需要） =====
# PROXY_HOST=127.0.0.1
# PROXY_PORT=7890
```

---

## 7. 生产环境验证清单

部署前（Cloud Run），用以下命令验证 Secret 是否齐全：

```bash
gcloud run services describe api-server --region us-west1 \
  --format='value(spec.template.spec.containers[0].env[].name)' \
  | sort > /tmp/cloud-run-env.txt

# 与本文件 §1 表格中标注 "必填" 的项做 diff
```

启动后，访问 `/health` 应返回：
```json
{ "status": "ok", "info": { "database": {"status":"up"}, "redis": {"status":"up"}, ... } }
```

---

## 8. Worker 进程（独立 Cloud Run 服务）

`src/worker.ts` 是独立入口（`NestFactory.createApplicationContext`，不监听端口），用于 BullMQ 消费者。
**部署为单独的 Cloud Run 服务**，环境变量与 API 服务**完全相同**（共享 AppModule 依赖图），但容器启动命令不同：

```dockerfile
# 同一镜像，不同 entrypoint
CMD ["dumb-init", "node", "dist/worker.js"]   # Worker 服务
# vs
CMD ["dumb-init", "node", "dist/main.js"]     # API 服务
```

Cloud Run Worker 服务推荐参数：
- `--no-allow-unauthenticated`（Worker 不接外网）
- `--cpu-throttling=false`
- `--min-instances=1 --max-instances=1`（单实例消费，避免重复抢锁）
- `--timeout=3600`

> Worker 不需要 `JWT_SECRET` 之外的 Web 配置（如 `CORS_ORIGINS`、`ENABLE_SWAGGER`），但保留它们不会造成问题。
