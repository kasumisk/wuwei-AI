# syntax=docker/dockerfile:1.7
###############################################################################
# EatCheck API Server — Production Dockerfile
#
# Build context: monorepo root (NOT apps/api-server)
#   docker build -f apps/api-server/Dockerfile -t eatcheck-api .
#
# 设计要点：
#   - 多阶段构建：deps → builder → runner，运行镜像不带源码 / pnpm / 编译工具
#   - 非 root 运行（USER node），降低逃逸影响面
#   - dumb-init 作为 PID 1，正确转发 SIGTERM 给 Node（Cloud Run 优雅关机依赖）
#   - Prisma Client 在 builder 阶段生成；schema 与 migrations 拷入运行镜像（migrate deploy 需要）
#   - 不内置 npm / pnpm / 源码：减少镜像 ~150MB，攻击面更小
###############################################################################

ARG NODE_VERSION=20.18.1
ARG PNPM_VERSION=10.28.2

# =============================================================================
# Stage 1: deps —— 解析 + 安装全部依赖（含 dev，用于编译）
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS deps

# 升级 corepack 到 0.31+，否则会报 "Cannot find matching keyid"
# (node 20.18.1 内置 corepack 0.29，对新 pnpm 签名 key 校验失败)
RUN npm install -g corepack@latest \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# 仅拷贝清单文件以最大化 Docker layer 缓存命中
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api-server/package.json ./apps/api-server/
COPY packages/constants/package.json ./packages/constants/
COPY packages/shared/package.json ./packages/shared/

# 全量依赖（含 devDependencies）；--frozen-lockfile 保证可重复构建
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# =============================================================================
# Stage 2: builder —— 编译 TS + 生成 Prisma Client
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS builder

RUN npm install -g corepack@latest \
 && corepack enable \
 && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /repo

# 复用 deps 阶段的 node_modules
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api-server/node_modules ./apps/api-server/node_modules
COPY --from=deps /repo/packages/constants/node_modules ./packages/constants/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/constants ./packages/constants
COPY packages/shared ./packages/shared
COPY apps/api-server ./apps/api-server

# 按依赖顺序构建：constants → shared → api-server
RUN pnpm --filter @ai-platform/constants run build \
 && pnpm --filter @ai-platform/shared run build \
 && pnpm --filter @ai-platform/server exec prisma generate \
 && pnpm --filter @ai-platform/server run build

# 用 pnpm deploy 生成精简的 production node_modules
# 输出到 /prod/api-server，仅包含运行期依赖，无 monorepo workspace 链接
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @ai-platform/server deploy --prod --legacy /prod/api-server

# 在 deploy 输出目录中重新生成 Prisma Client
# 关键: prisma generate 会把 .prisma/client 写到 @prisma/client 同级
# pnpm 模式下 = .pnpm/@prisma+client@.../node_modules/.prisma/client
# pnpm deploy 不会保留这部分,所以必须在 deploy 后再 generate 一次
RUN cp -r /repo/apps/api-server/prisma /prod/api-server/prisma \
 && cd /prod/api-server \
 && ./node_modules/.bin/prisma generate --schema=prisma/schema.prisma

# =============================================================================
# Stage 3: runner —— 最小运行镜像
# =============================================================================
FROM node:${NODE_VERSION}-alpine AS runner

# dumb-init: PID 1 信号转发；tini 也可，但 dumb-init 体积更小
# tzdata: 部分 i18n / 日期格式化依赖
RUN apk add --no-cache dumb-init tzdata \
 && rm -rf /var/cache/apk/*

ENV NODE_ENV=production \
    TZ=UTC \
    # Node 20+ 默认堆大小按容器内存；Cloud Run 1GB 给 Node 750MB 缓冲
    NODE_OPTIONS="--max-old-space-size=768"

WORKDIR /app

# 仅拷贝运行期需要的文件
# - dist：编译产物
# - node_modules：pnpm deploy 精简后的依赖（含 Prisma Client）
# - package.json：运行期可能 require
# - prisma：schema + migrations，用于 prisma migrate deploy
# - static：静态资源（i18n JSON 等）
COPY --from=builder --chown=node:node /prod/api-server/dist ./dist
COPY --from=builder --chown=node:node /prod/api-server/node_modules ./node_modules
COPY --from=builder --chown=node:node /prod/api-server/package.json ./package.json
COPY --from=builder --chown=node:node /repo/apps/api-server/prisma ./prisma
COPY --from=builder --chown=node:node /repo/apps/api-server/static ./static

# 非 root 运行（node 用户由 node:alpine 自带，UID=1000）
USER node

EXPOSE 3000

# Cloud Run 健康检查由平台侧基于 startup probe 完成；
# 镜像内仍保留 HEALTHCHECK 便于本地 docker run / k8s
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# dumb-init 作为 PID 1，确保 SIGTERM 正确传给 node（NestJS shutdown hooks 才会跑）
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
