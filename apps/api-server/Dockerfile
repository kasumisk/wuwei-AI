###############################################
# Stage 1: Builder - 在 monorepo 根目录构建
# Docker context 必须设为 monorepo 根目录
###############################################
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# 先拷贝 package 文件以利用 Docker 缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api-server/package.json ./apps/api-server/
COPY packages/constants/package.json ./packages/constants/
COPY packages/shared/package.json ./packages/shared/

RUN pnpm install --frozen-lockfile

# 拷贝源码
COPY packages/constants/ ./packages/constants/
COPY packages/shared/ ./packages/shared/
COPY apps/api-server/ ./apps/api-server/

# 按依赖顺序构建
RUN pnpm --filter @ai-platform/constants run build
RUN pnpm --filter @ai-platform/shared run build
RUN cd apps/api-server && pnpm run build

###############################################
# Stage 2: Production - 最小化运行镜像
###############################################
FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# 拷贝 monorepo 根配置
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./

# 拷贝各包的 package.json
COPY --from=builder /app/apps/api-server/package.json ./apps/api-server/
COPY --from=builder /app/packages/constants/package.json ./packages/constants/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/

# 仅安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 拷贝构建产物
COPY --from=builder /app/apps/api-server/dist ./apps/api-server/dist
COPY --from=builder /app/apps/api-server/static ./apps/api-server/static
COPY --from=builder /app/packages/constants/dist ./packages/constants/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

WORKDIR /app/apps/api-server

EXPOSE 3000

CMD ["node", "dist/main.js"]
