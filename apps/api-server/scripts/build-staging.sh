#!/usr/bin/env bash
###############################################################################
# EatCheck API Server — Staging 构建打包脚本
#
# 目的：在开发机/CI 上把 api-server 编译并打包成 tarball，
#       上传到 VM 后用 pm2 启动（生产仍走 Cloud Run + Dockerfile）。
#
# 用法：
#   bash apps/api-server/scripts/build-staging.sh
#   或：pnpm --filter api-server run build:staging
#
# 输出：
#   dist-staging/api-server-staging-<git-sha>-<timestamp>.tar.gz
#
# 包内布局：
#   api-server/
#     ├── dist/                 编译后的 JS（含 main.js / worker.js）
#     ├── node_modules/         pnpm deploy --prod 精简后的依赖（含 .prisma/client）
#     ├── prisma/               schema.prisma + migrations（migrate deploy 需要）
#     ├── static/               i18n / 静态资源
#     ├── package.json          运行期 require 用
#     ├── ecosystem.staging.config.cjs   pm2 启动配置
#     └── VERSION               git sha / 打包时间
#
# 注意：.env / .env.staging **不入包**——env 文件由 VM 端独立维护
#       （建议放 /etc/eatcheck/.env.staging，部署时 ln -s 到 current/.env）
###############################################################################

set -Eeuo pipefail

# ─── 路径计算（兼容从仓库根 / apps/api-server 任意目录调用） ─────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/../.." && pwd)"

cd "$REPO_ROOT"

# ─── 颜色输出 ───────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
log()  { echo "${BLUE}[build-staging]${NC} $*"; }
warn() { echo "${YELLOW}[build-staging]${NC} $*" >&2; }
err()  { echo "${RED}[build-staging]${NC} $*" >&2; }
ok()   { echo "${GREEN}[build-staging]${NC} $*"; }

trap 'err "构建失败 line=$LINENO"; exit 1' ERR

# ─── 前置检查 ───────────────────────────────────────────────────────────────
command -v pnpm >/dev/null 2>&1 || { err "pnpm 未安装"; exit 1; }
command -v tar  >/dev/null 2>&1 || { err "tar 未安装"; exit 1; }

GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD 2>/dev/null || echo 'nogit')"
GIT_DIRTY=""
if ! git -C "$REPO_ROOT" diff --quiet 2>/dev/null || ! git -C "$REPO_ROOT" diff --cached --quiet 2>/dev/null; then
  GIT_DIRTY="-dirty"
  warn "工作区有未提交修改，tag 后缀加 -dirty"
fi
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
PACKAGE_TAG="staging-${GIT_SHA}${GIT_DIRTY}-${TIMESTAMP}"

OUTPUT_DIR="$REPO_ROOT/dist-staging"
STAGE_DIR="$OUTPUT_DIR/_stage"
TARBALL="$OUTPUT_DIR/api-server-${PACKAGE_TAG}.tar.gz"

log "仓库根：$REPO_ROOT"
log "打包 tag：$PACKAGE_TAG"
log "输出目录：$OUTPUT_DIR"

# ─── 清理旧产物 ─────────────────────────────────────────────────────────────
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# ─── 1. 安装依赖（含 dev，编译需要） ───────────────────────────────────────
log "[1/6] pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

# ─── 2. 构建 workspace 依赖 ─────────────────────────────────────────────────
log "[2/6] 构建 @ai-platform/constants & @ai-platform/shared"
pnpm --filter @ai-platform/constants run build
pnpm --filter @ai-platform/shared run build

# ─── 3. Prisma generate + 编译 api-server ──────────────────────────────────
log "[3/6] prisma generate + nest build"
pnpm --filter @ai-platform/server exec prisma generate
pnpm --filter @ai-platform/server run build

# ─── 4. pnpm deploy 精简运行时依赖 ─────────────────────────────────────────
# 输出的 node_modules 不再含 monorepo workspace 链接，可以直接 tar 打包发到 VM
# 注意：pnpm deploy 只搬运 package.json files 字段声明的内容；dist/ 不在 files 里
#       所以下方第 5 步会再把 apps/api-server/dist 单独拷进去（覆盖即可）
log "[4/6] pnpm deploy --prod （精简 node_modules）"
DEPLOY_DIR="$OUTPUT_DIR/_deploy"
rm -rf "$DEPLOY_DIR"
pnpm --filter @ai-platform/server deploy --prod --legacy "$DEPLOY_DIR"

# 把 prisma generate 产出的 client 拷进 deploy 输出（pnpm deploy 不会自动带 .prisma/client）
if [ -d "$APP_DIR/node_modules/.prisma" ]; then
  rm -rf "$DEPLOY_DIR/node_modules/.prisma"
  cp -R "$APP_DIR/node_modules/.prisma" "$DEPLOY_DIR/node_modules/.prisma"
fi
if [ -d "$APP_DIR/node_modules/@prisma/client" ]; then
  mkdir -p "$DEPLOY_DIR/node_modules/@prisma"
  rm -rf "$DEPLOY_DIR/node_modules/@prisma/client"
  cp -R "$APP_DIR/node_modules/@prisma/client" "$DEPLOY_DIR/node_modules/@prisma/client"
fi

# ─── 5. 组装打包目录 ───────────────────────────────────────────────────────
log "[5/6] 组装打包目录"
PKG_ROOT="$STAGE_DIR/api-server"
mkdir -p "$PKG_ROOT"

# nest build 产物 — 从源 apps/api-server/dist 拷（pnpm deploy 不带 dist）
if [ ! -d "$APP_DIR/dist" ]; then
  err "$APP_DIR/dist 不存在，nest build 失败？"
  exit 1
fi
cp -R "$APP_DIR/dist"               "$PKG_ROOT/dist"
cp -R "$DEPLOY_DIR/node_modules"    "$PKG_ROOT/node_modules"
cp    "$DEPLOY_DIR/package.json"    "$PKG_ROOT/package.json"
cp -R "$APP_DIR/prisma"             "$PKG_ROOT/prisma"
cp -R "$APP_DIR/static"             "$PKG_ROOT/static" 2>/dev/null || warn "static/ 不存在，跳过"

# pm2 配置（env 文件**不入包**，VM 端独立维护 /etc/eatcheck/.env.staging）
cp "$APP_DIR/ecosystem.staging.config.cjs" "$PKG_ROOT/ecosystem.staging.config.cjs"

# 清理无用文件减小体积
find "$PKG_ROOT" -name "*.map"        -type f -delete 2>/dev/null || true
find "$PKG_ROOT" -name "*.ts"         -type f -delete 2>/dev/null || true
find "$PKG_ROOT" -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true
find "$PKG_ROOT/node_modules" -type d \( -name "__tests__" -o -name "test" -o -name "tests" -o -name ".github" -o -name "examples" \) -exec rm -rf {} + 2>/dev/null || true

# 版本元信息
cat > "$PKG_ROOT/VERSION" <<EOF
package = api-server
tag     = ${PACKAGE_TAG}
git_sha = ${GIT_SHA}${GIT_DIRTY}
built_at= ${TIMESTAMP}
node    = $(node -v)
pnpm    = $(pnpm -v)
EOF

# ─── 6. 打 tarball ─────────────────────────────────────────────────────────
log "[6/6] 打 tarball"
mkdir -p "$OUTPUT_DIR"
tar -czf "$TARBALL" -C "$STAGE_DIR" api-server

# 输出大小
SIZE_HUMAN="$(du -h "$TARBALL" | awk '{print $1}')"

# 清理临时
rm -rf "$STAGE_DIR" "$DEPLOY_DIR"

ok "打包完成：$TARBALL ($SIZE_HUMAN)"
echo
echo "=== 部署到 staging VM ==="
echo "scp $TARBALL  user@staging-vm:/opt/eatcheck/"
echo "ssh user@staging-vm 'cd /opt/eatcheck && \\"
echo "    tar -xzf $(basename "$TARBALL") && \\"
echo "    cd api-server && \\"
echo "    cp /etc/eatcheck/.env.staging .env && \\"
echo "    npx prisma migrate deploy && \\"
echo "    pm2 startOrReload ecosystem.staging.config.cjs --update-env'"
echo
echo "详见 docs/DEPLOY_STAGING.md"
