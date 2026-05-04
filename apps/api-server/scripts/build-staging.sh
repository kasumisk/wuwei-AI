#!/usr/bin/env bash
###############################################################################
# EatCheck API Server — Staging 部署脚本
#
# 部署方式：git push → SSH 进 GCP VM → git pull → pnpm build → pm2 restart
#
# 用法：
#   bash apps/api-server/scripts/build-staging.sh          # 正常部署
#   bash apps/api-server/scripts/build-staging.sh --no-push  # 跳过 git push（VM 上已是最新）
#   或：pnpm --filter api-server run build:staging
#
# 前置条件：
#   本机已安装 gcloud CLI 并登录（gcloud auth login）
#   或：设置 SSH_MODE=ssh，并配置好 ~/.ssh/config 里 openclaw 的 Host 条目
###############################################################################

set -Eeuo pipefail

# ─── 配置（按实际修改） ──────────────────────────────────────────────────────
VM_PROJECT="flutter-scaffold-4fd6c"           # GCP 项目 ID
VM_INSTANCE="openclaw"                        # GCP 实例名
VM_USER="xiehaiji"                            # VM 登录用户
VM_ZONE="asia-east2-a"                        # GCP zone
REPO_DIR="/home/xiehaiji/wuwei-api"           # VM 上的仓库根目录
PM2_NAME="wuwei-api"                          # pm2 进程名

# 连接方式：gcloud（默认）或 ssh
SSH_MODE="${SSH_MODE:-gcloud}"

# ─── 路径计算 ────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ─── 颜色输出 ────────────────────────────────────────────────────────────────
RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; BLUE=$'\033[0;34m'; NC=$'\033[0m'
log()  { echo "${BLUE}[deploy-staging]${NC} $*"; }
warn() { echo "${YELLOW}[deploy-staging]${NC} $*" >&2; }
err()  { echo "${RED}[deploy-staging]${NC} $*" >&2; }
ok()   { echo "${GREEN}[deploy-staging]${NC} $*"; }

trap 'err "部署失败 line=$LINENO"; exit 1' ERR

# ─── 参数解析 ────────────────────────────────────────────────────────────────
DO_PUSH=true
for arg in "$@"; do
  case "$arg" in
    --no-push) DO_PUSH=false ;;
    *) err "未知参数: $arg"; exit 1 ;;
  esac
done

# ─── SSH 执行函数 ────────────────────────────────────────────────────────────
ssh_exec() {
  if [ "$SSH_MODE" = "gcloud" ]; then
    local zone_flag=""
    [ -n "$VM_ZONE" ] && zone_flag="--zone=$VM_ZONE"
    gcloud compute ssh "${VM_USER}@${VM_INSTANCE}" --project="${VM_PROJECT}" $zone_flag -- "$@"
  else
    ssh "${VM_USER}@${VM_INSTANCE}" "$@"
  fi
}

# ─── 前置检查 ────────────────────────────────────────────────────────────────
if [ "$SSH_MODE" = "gcloud" ]; then
  command -v gcloud >/dev/null 2>&1 || { err "gcloud CLI 未安装，请先安装或设置 SSH_MODE=ssh"; exit 1; }
fi

cd "$REPO_ROOT"

GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo 'nogit')"

# ─── 1. git push ─────────────────────────────────────────────────────────────
if [ "$DO_PUSH" = true ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  # 检查是否有未提交修改
  if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
    warn "工作区有未提交的修改，请先 git commit 或使用 --no-push 跳过 push"
    exit 1
  fi
  log "[1/3] git push origin $BRANCH"
  git push origin "$BRANCH"
else
  log "[1/3] 跳过 git push（--no-push）"
fi

# ─── 2. SSH 进 VM 执行部署 ────────────────────────────────────────────────────
log "[2/3] SSH → ${VM_INSTANCE}，执行 git pull + build"

ssh_exec bash -lc "
set -euo pipefail

# 补全常见工具路径（gcloud ssh 非交互式环境可能不加载 .bashrc）
export PATH=\"\$HOME/.local/share/pnpm:\$HOME/.nvm/versions/node/\$(ls \$HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin:/usr/local/bin:/usr/bin:\$PATH\"
# 兼容 nvm 方式安装的 node
[ -s \"\$HOME/.nvm/nvm.sh\" ] && source \"\$HOME/.nvm/nvm.sh\"
# 兼容 volta
[ -s \"\$HOME/.volta/env\" ] && source \"\$HOME/.volta/env\"

echo \"--- node: \$(node -v), pnpm: \$(pnpm -v), pm2: \$(pm2 -v) ---\"

echo '--- git pull ---'
cd ${REPO_DIR}
git fetch origin
git reset --hard origin/main

echo '--- pnpm install ---'
pnpm install --frozen-lockfile

echo '--- build workspace packages ---'
pnpm --filter @ai-platform/constants run build
pnpm --filter @ai-platform/shared run build

echo '--- prisma generate + nest build ---'
cd apps/api-server
npx prisma generate
pnpm run build

echo '--- pm2 restart ---'

pm2 restart ${PM2_NAME}

echo '--- done ---'
pm2 show ${PM2_NAME} | grep -E 'status|restart|uptime'
"

# ─── 3. 验证 ─────────────────────────────────────────────────────────────────
log "[3/3] 验证部署结果"
ssh_exec bash -lc "pm2 show ${PM2_NAME} | grep -E 'status|restart|uptime|pid'"

ok "部署完成！git sha: ${GIT_SHA}"
