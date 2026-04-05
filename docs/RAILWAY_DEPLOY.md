# Railway 部署与维护文档

> API Server (NestJS) 部署在 Railway，前端应用 (Web/Admin) 部署在 Vercel。

## 目录

- [架构概览](#架构概览)
- [前置条件](#前置条件)
- [快速部署](#快速部署)
- [手动部署步骤](#手动部署步骤)
- [环境变量配置](#环境变量配置)
- [数据库管理](#数据库管理)
- [日常维护](#日常维护)
- [监控与健康检查](#监控与健康检查)
- [故障排查](#故障排查)
- [回滚与恢复](#回滚与恢复)

---

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      用户浏览器                              │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────┐            ┌──────────────────┐
│   Vercel (Web)   │            │  Vercel (Admin)  │
│   Next.js 前端    │            │  Vite 后台管理    │
└──────────────────┘            └──────────────────┘
           │                               │
           └───────────────┬───────────────┘
                           │ HTTPS API 请求
                           ▼
              ┌──────────────────────┐
              │   Railway (API)      │
              │   NestJS 后端服务     │
              │   Port: 3000         │
              └──────────┬───────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Railway (Postgres)  │
              │  PostgreSQL 17       │
              │  内网: 5432          │
              │  公网: 33335         │
              └──────────────────────┘
```

### 当前部署信息

| 服务 | 平台 | 地址 |
|------|------|------|
| API Server | Railway | `https://api-server-production-dfcb.up.railway.app` |
| PostgreSQL | Railway | 内网 `postgres.railway.internal:5432` / 公网 `metro.proxy.rlwy.net:33335` |
| Web 前端 | Vercel | 通过 Vercel 配置 |
| Admin 后台 | Vercel | 通过 Vercel 配置 |

---

## 前置条件

### 工具安装

```bash
# 安装 Railway CLI (macOS)
brew install railway

# 或通过 npm 安装
npm install -g @railway/cli

# 验证安装
railway --version

# 登录 Railway
railway login
```

### 项目要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker（本地测试时需要）

---

## 快速部署

### 一键部署（推荐）

```bash
# 完整部署：创建项目 + 数据库 + 部署 + 初始化
./scripts/deploy-railway.sh init

# 仅部署代码更新
./scripts/deploy-railway.sh deploy

# 查看部署状态
./scripts/deploy-railway.sh status

# 查看帮助
./scripts/deploy-railway.sh help
```

### 快速命令参考

```bash
./scripts/deploy-railway.sh init       # 首次完整初始化部署
./scripts/deploy-railway.sh deploy     # 部署代码更新
./scripts/deploy-railway.sh logs       # 查看运行日志
./scripts/deploy-railway.sh db:init    # 初始化数据库（种子数据）
./scripts/deploy-railway.sh db:seed    # 运行种子数据脚本
./scripts/deploy-railway.sh db:connect # 连接数据库 Shell
./scripts/deploy-railway.sh health     # 健康检查
./scripts/deploy-railway.sh status     # 查看服务状态
./scripts/deploy-railway.sh env        # 查看环境变量
./scripts/deploy-railway.sh env:set    # 批量设置环境变量
./scripts/deploy-railway.sh rollback   # 回滚到上一次部署
./scripts/deploy-railway.sh destroy    # 销毁项目（危险）
```

---

## 手动部署步骤

如果不使用一键脚本，可按以下步骤手动操作：

### 1. 初始化项目

```bash
cd /path/to/new-platform

# 初始化 Railway 项目
railway init
# 选择 workspace，输入项目名（如 ai-platform）

# 添加 PostgreSQL
railway add --database postgres

# 创建 API 服务
railway add --service api-server
```

### 2. 配置环境变量

```bash
railway variables \
  --set "NODE_ENV=production" \
  --set "PORT=3000" \
  --set "DB_HOST=postgres.railway.internal" \
  --set "DB_PORT=5432" \
  --set "DB_USERNAME=postgres" \
  --set "DB_PASSWORD=<从 Postgres 服务获取>" \
  --set "DB_DATABASE=railway" \
  --set "DB_SYNCHRONIZE=true" \
  --set "LOG_LEVEL=info" \
  --set "API_PREFIX=api" \
  --set "API_VERSION=v1"
```

> **注意**: `DB_PASSWORD` 需要从 Railway 项目的 Postgres 服务变量中获取。

### 3. 部署

```bash
railway up --detach
```

### 4. 生成域名

```bash
railway domain
```

### 5. 初始化数据库

```bash
# 使用公网地址连接运行初始化
DB_HOST=metro.proxy.rlwy.net \
DB_PORT=33335 \
DB_USERNAME=postgres \
DB_PASSWORD=<密码> \
DB_DATABASE=railway \
DB_SYNCHRONIZE=true \
NODE_ENV=production \
npx ts-node -r tsconfig-paths/register src/scripts/init-system.ts
```

---

## 环境变量配置

### 必需变量

| 变量 | 说明 | 生产环境值 |
|------|------|-----------|
| `NODE_ENV` | 运行环境 | `production` |
| `PORT` | 服务端口 | `3000` |
| `DB_HOST` | 数据库地址 | `postgres.railway.internal` |
| `DB_PORT` | 数据库端口 | `5432` |
| `DB_USERNAME` | 数据库用户 | `postgres` |
| `DB_PASSWORD` | 数据库密码 | 从 Railway Postgres 服务获取 |
| `DB_DATABASE` | 数据库名 | `railway` |
| `DB_SYNCHRONIZE` | 自动同步表结构 | `true`（首次），建议后续改为 `false` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `API_PREFIX` | API 路径前缀 | `api` |
| `API_VERSION` | API 版本 | `v1` |

### 可选变量（业务功能）

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `OKX_API_BASE_URL` | OKX API 地址 | `https://web3.okx.com` |
| `OKX_PROJECT` | OKX 项目 ID | - |
| `OKX_API_KEY` | OKX API 密钥 | - |
| `OKX_SECRET_KEY` | OKX 密钥 | - |
| `OKX_PASSPHRASE` | OKX API 密码 | - |
| `OKX_WEB3_RPC_URL` | Web3 RPC 地址 | `https://eth.llamarpc.com` |
| `OPENAI_API_KEY` | OpenAI 密钥（RAG 功能） | - |

### 管理环境变量

```bash
# 查看当前变量
railway variables

# 设置单个变量
railway variables --set "KEY=VALUE"

# 批量设置
railway variables --set "KEY1=VAL1" --set "KEY2=VAL2"
```

---

## 数据库管理

### 连接数据库

```bash
# 通过 Railway CLI 连接 (需切换到 Postgres 服务)
railway connect

# 通过 psql 直连（公网）
PGPASSWORD=<密码> psql -h metro.proxy.rlwy.net -p 33335 -U postgres -d railway
```

### 初始化系统数据

```bash
# 在 api-server 目录下
cd apps/api-server

# 完整初始化（角色 + 权限 + 管理员）
DB_HOST=metro.proxy.rlwy.net DB_PORT=33335 DB_USERNAME=postgres \
DB_PASSWORD=<密码> DB_DATABASE=railway DB_SYNCHRONIZE=true NODE_ENV=production \
npx ts-node -r tsconfig-paths/register src/scripts/init-system.ts
```

### 初始化后的默认数据

| 数据 | 内容 |
|------|------|
| **角色** | SUPER_ADMIN（超级管理员）、ADMIN（管理员） |
| **权限** | 24+ 个菜单和操作权限 |
| **管理员** | 用户名: `admin`，密码: `admin123` |
| **数据表** | 11 张表（users, roles, permissions 等） |

> ⚠️ **重要**: 部署到生产环境后，请立即修改默认管理员密码！

### 数据库备份

```bash
# 导出数据
PGPASSWORD=<密码> pg_dump -h metro.proxy.rlwy.net -p 33335 -U postgres railway > backup_$(date +%Y%m%d_%H%M%S).sql

# 恢复数据
PGPASSWORD=<密码> psql -h metro.proxy.rlwy.net -p 33335 -U postgres -d railway < backup.sql
```

---

## 日常维护

### 部署更新

```bash
# 方式一：一键脚本
./scripts/deploy-railway.sh deploy

# 方式二：手动
cd /path/to/new-platform
railway up --detach
```

### 查看日志

```bash
# 实时日志
railway logs

# 构建日志
railway logs --build

# 通过脚本
./scripts/deploy-railway.sh logs
```

### 重启服务

```bash
# 重启（不重新构建）
railway restart

# 重新部署（重新构建）
railway redeploy

# 通过脚本
./scripts/deploy-railway.sh restart
```

---

## 监控与健康检查

### 健康检查端点

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `GET /api/health` | 完整状态 | 数据库连接、运行时间 | 无需 |
| `GET /api/health/live` | 存活探针 | 返回 `{alive: true}` | 无需 |
| `GET /api/health/ready` | 就绪探针 | 返回 `{ready: boolean}` | 无需 |

### 手动检查

```bash
# 存活检查
curl -s https://api-server-production-dfcb.up.railway.app/api/health/live

# 完整健康状态
curl -s https://api-server-production-dfcb.up.railway.app/api/health | python3 -m json.tool

# 就绪检查
curl -s https://api-server-production-dfcb.up.railway.app/api/health/ready
```

### 预期返回

```json
{
  "code": 200,
  "data": {
    "status": "ok",
    "timestamp": 1771129289922,
    "uptime": 882.43,
    "environment": "production",
    "database": "healthy",
    "capabilities": 0
  },
  "message": "操作成功",
  "success": true
}
```

### Swagger 文档

线上文档地址: `https://api-server-production-dfcb.up.railway.app/api/docs`

---

## 故障排查

### 常见问题

#### 1. 数据库连接失败

**症状**: `Error: getaddrinfo ENOTFOUND postgres.railway.internal`

**原因**: 在本地执行脚本时使用了 Railway 内网地址

**解决**: 本地运行时使用公网地址 `metro.proxy.rlwy.net:33335`

#### 2. pgvector 扩展不可用

**症状**: `error: extension "vector" is not available`

**原因**: Railway PostgreSQL 未安装 pgvector 扩展

**影响**: RAG 功能不可用，但不影响主应用运行（已做容错处理）

**解决**: 如需 RAG 功能，需使用支持 pgvector 的数据库服务（如 Supabase、Neon）

#### 3. Web3 RPC 连接失败

**症状**: `Web3 初始化失败: invalid json response body`

**影响**: Web3 相关功能不可用，不影响其他功能

**解决**: 替换为可靠的 RPC 地址，设置环境变量 `OKX_WEB3_RPC_URL`

#### 4. 构建失败

```bash
# 查看构建日志
railway logs --build

# 本地测试构建
docker build -f apps/api-server/Dockerfile -t api-server-test .
```

#### 5. 部署后服务不响应

```bash
# 检查服务状态
railway service status

# 检查环境变量
railway variables

# 查看运行日志
railway logs
```

### 日志分析

```bash
# 过滤错误日志
railway logs 2>&1 | grep -i "error"

# 查看最近的日志
railway logs 2>&1 | tail -50
```

---

## 回滚与恢复

### 回滚部署

```bash
# 通过脚本回滚到上一次部署
./scripts/deploy-railway.sh rollback

# 手动回滚：移除最新部署
railway down
```

### 完全重建

```bash
# 重新部署
railway up --detach

# 或强制重新部署
railway redeploy
```

---

## 项目文件结构

```
new-platform/
├── railway.toml                    # Railway 部署配置
├── .dockerignore                   # Docker 构建忽略文件
├── scripts/
│   ├── deploy.sh                   # Vercel 部署脚本（前端）
│   └── deploy-railway.sh           # Railway 部署脚本（后端）
├── apps/
│   └── api-server/
│       ├── Dockerfile              # 多阶段构建（monorepo 支持）
│       ├── src/scripts/
│       │   ├── init-system.ts      # 系统初始化（角色+权限+管理员）
│       │   ├── seed-admin.ts       # 管理员种子数据
│       │   ├── seed-data.ts        # 业务种子数据
│       │   └── seed-permissions.ts # 权限种子数据
│       └── ...
└── ...
```

---

## 费用与资源

### Railway 免费额度（Starter 计划）

| 资源 | 额度 |
|------|------|
| 执行时间 | $5/月 |
| 内存 | 8 GB |
| CPU | 8 vCPU |
| 磁盘 | 1 GB |
| 网络 | 100 GB |

### 监控资源使用

在 Railway Dashboard 中查看:
- **CPU 使用率**: 正常应低于 50%
- **内存使用**: NestJS 通常 150-300 MB
- **磁盘使用**: PostgreSQL 数据量
- **网络流量**: API 请求量

---

## 安全注意事项

1. **修改默认密码**: 部署后立即修改 `admin/admin123`
2. **DB_SYNCHRONIZE**: 生产稳定后设为 `false`，使用 migration 管理
3. **敏感变量**: 通过 Railway 环境变量管理，不要提交到代码仓库
4. **CORS 配置**: 确保只允许前端域名访问 API
5. **日志级别**: 生产环境使用 `info` 或 `warn`，避免 `debug`
