#!/usr/bin/env bash
# =============================================================================
# EatCheck — Cloud Run 一键部署脚本
#
# 部署拓扑:
#   - eatcheck-api      Cloud Run Service  (HTTP, autoscale)
#   - eatcheck-worker   Cloud Run Service  (常驻, min=1, no cpu throttling)
#   - eatcheck-migrate  Cloud Run Job      (一次性: prisma migrate deploy + db:init)
#
# 三者共享同一镜像，仅 entry/CMD 不同。
#
# 用法:
#   ./scripts/deploy-cloudrun.sh build       # Cloud Build → AR
#   ./scripts/deploy-cloudrun.sh secrets     # 把本地 .env.production 同步到 Secret Manager
#   ./scripts/deploy-cloudrun.sh api         # 部署 HTTP 服务
#   ./scripts/deploy-cloudrun.sh worker      # 部署 Worker 服务
#   ./scripts/deploy-cloudrun.sh migrate     # 创建/更新 + 执行迁移 Job
#   ./scripts/deploy-cloudrun.sh all         # build → secrets → migrate → api → worker
#   ./scripts/deploy-cloudrun.sh status      # 查看三者状态
#   ./scripts/deploy-cloudrun.sh logs api    # 查看日志
# =============================================================================
set -euo pipefail

# ------------------------------- 配置 ----------------------------------------
PROJECT_ID="${PROJECT_ID:-flutter-scaffold-4fd6c}"
REGION="${REGION:-us-east1}"
REPO="${REPO:-eatcheck}"
IMAGE_NAME="api-server"

API_SERVICE="${API_SERVICE:-eatcheck-api}"
WORKER_SERVICE="${WORKER_SERVICE:-eatcheck-worker}"
MIGRATE_JOB="${MIGRATE_JOB:-eatcheck-migrate}"

RUNTIME_SA="eatcheck-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}"

# 本地 env 文件 → Secret Manager 同步源
ENV_FILE="${ENV_FILE:-apps/api-server/.env.production}"

# 标记为「公开值（非敏感）」的键 —— 直接 --set-env-vars，不进 Secret Manager
PUBLIC_KEYS=(
  NODE_ENV PORT LOG_LEVEL API_PREFIX API_VERSION
  JWT_EXPIRES_IN
  CORS_ORIGINS
  AI_GATEWAY_PROVIDER OPENROUTER_BASE_URL
  VISION_MODEL VISION_MODEL_FALLBACK
  STORAGE_ENDPOINT STORAGE_BUCKET STORAGE_PUBLIC_URL
)

# Cloud Run 平台保留键 —— 不能 --set-env-vars
RESERVED_KEYS=(PORT)
# 注: PORT 由 Cloud Run 注入；NODE_ENV 显式 set-env-vars 以确保 ConfigService 读到 production

# ------------------------------- 工具函数 ------------------------------------
COLOR_GREEN='\033[0;32m'; COLOR_YELLOW='\033[1;33m'; COLOR_RED='\033[0;31m'; COLOR_RESET='\033[0m'
log()  { echo -e "${COLOR_GREEN}[$(date '+%H:%M:%S')]${COLOR_RESET} $*"; }
warn() { echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $*" >&2; }
die()  { echo -e "${COLOR_RED}[ERROR]${COLOR_RESET} $*" >&2; exit 1; }

is_public_key() {
  local k="$1"
  for p in "${PUBLIC_KEYS[@]}"; do [[ "$p" == "$k" ]] && return 0; done
  return 1
}

is_reserved_key() {
  local k="$1"
  for p in "${RESERVED_KEYS[@]}"; do [[ "$p" == "$k" ]] && return 0; done
  return 1
}

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "未找到 $ENV_FILE"
}

# ------------------------------- 子命令 --------------------------------------

cmd_build() {
  log "通过 Cloud Build 构建镜像 → $IMAGE_BASE"
  local TAG="$(date +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo 'no-git')"
  gcloud builds submit \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --config=apps/api-server/cloudbuild.yaml \
    --substitutions=_IMAGE="${IMAGE_BASE}:${TAG}",_LATEST="${IMAGE_BASE}:latest" \
    --timeout=1800s \
    .
  echo "$TAG" > .last-image-tag
  log "✅ 构建完成: ${IMAGE_BASE}:${TAG}"
}

cmd_secrets() {
  require_env_file
  log "同步 $ENV_FILE → Secret Manager (project=$PROJECT_ID)"

  local count_secret=0
  local count_skip=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    # 跳过注释、空行
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # 解析 KEY=VALUE
    if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then continue; fi
    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"
    # 去掉首尾引号
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [[ -z "$value" ]] && continue

    # 跳过保留 key
    if is_reserved_key "$key"; then continue; fi
    # 跳过 PUBLIC（这些通过 --set-env-vars 注入）
    if is_public_key "$key"; then count_skip=$((count_skip+1)); continue; fi

    local secret_name="eatcheck-${key}"

    if gcloud secrets describe "$secret_name" --project="$PROJECT_ID" >/dev/null 2>&1; then
      printf '%s' "$value" | gcloud secrets versions add "$secret_name" \
        --data-file=- --project="$PROJECT_ID" >/dev/null
    else
      printf '%s' "$value" | gcloud secrets create "$secret_name" \
        --data-file=- --replication-policy=automatic --project="$PROJECT_ID" >/dev/null
    fi
    # 授权运行时 SA
    gcloud secrets add-iam-policy-binding "$secret_name" \
      --member="serviceAccount:${RUNTIME_SA}" \
      --role="roles/secretmanager.secretAccessor" \
      --project="$PROJECT_ID" >/dev/null 2>&1 || true
    count_secret=$((count_secret+1))
    echo "  • $secret_name"
  done < "$ENV_FILE"

  log "✅ 已同步 $count_secret 个 secret，跳过 $count_skip 个公开键"
}

# 构造 --set-env-vars 与 --set-secrets 参数
build_env_args() {
  require_env_file
  local env_vars=""
  local secrets=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then continue; fi
    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [[ -z "$value" ]] && continue
    if is_reserved_key "$key"; then continue; fi

    if is_public_key "$key"; then
      # 用 ^@^ 作分隔符避免逗号冲突
      [[ -n "$env_vars" ]] && env_vars+="@"
      env_vars+="${key}=${value}"
    else
      [[ -n "$secrets" ]] && secrets+="@"
      secrets+="${key}=eatcheck-${key}:latest"
    fi
  done < "$ENV_FILE"

  echo "ENV_VARS<<<${env_vars}"
  echo "SECRETS<<<${secrets}"
}

resolve_image() {
  local tag="${IMAGE_TAG:-latest}"
  echo "${IMAGE_BASE}:${tag}"
}

cmd_api() {
  local image; image="$(resolve_image)"
  log "部署 $API_SERVICE → $image"
  local parsed; parsed="$(build_env_args)"
  local env_vars; env_vars="$(echo "$parsed" | grep '^ENV_VARS<<<' | sed 's/^ENV_VARS<<<//')"
  local secrets;  secrets="$(echo "$parsed"  | grep '^SECRETS<<<'  | sed 's/^SECRETS<<<//')"

  gcloud run deploy "$API_SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$image" \
    --service-account="$RUNTIME_SA" \
    --platform=managed \
    --allow-unauthenticated \
    --port=3000 \
    --cpu=1 --memory=1Gi \
    --min-instances=0 --max-instances=5 \
    --concurrency=80 \
    --timeout=300 \
    --execution-environment=gen2 \
    --cpu-boost \
    --set-env-vars="^@^${env_vars}" \
    --set-secrets="^@^${secrets}" \
    --command="dumb-init" \
    --args="--,node,dist/main.js" \
    --quiet
  log "✅ $API_SERVICE 部署完成"
  gcloud run services describe "$API_SERVICE" \
    --project="$PROJECT_ID" --region="$REGION" \
    --format="value(status.url)"
}

cmd_worker() {
  local image; image="$(resolve_image)"
  log "部署 $WORKER_SERVICE → $image"
  local parsed; parsed="$(build_env_args)"
  local env_vars; env_vars="$(echo "$parsed" | grep '^ENV_VARS<<<' | sed 's/^ENV_VARS<<<//')"
  local secrets;  secrets="$(echo "$parsed"  | grep '^SECRETS<<<'  | sed 's/^SECRETS<<<//')"

  gcloud run deploy "$WORKER_SERVICE" \
    --project="$PROJECT_ID" \
    --region="$REGION" \
    --image="$image" \
    --service-account="$RUNTIME_SA" \
    --platform=managed \
    --no-allow-unauthenticated \
    --no-cpu-throttling \
    --cpu=1 --memory=1Gi \
    --min-instances=1 --max-instances=1 \
    --execution-environment=gen2 \
    --set-env-vars="^@^${env_vars}" \
    --set-secrets="^@^${secrets}" \
    --command="dumb-init" \
    --args="--,node,dist/worker.js" \
    --quiet
  log "✅ $WORKER_SERVICE 部署完成"
}

cmd_migrate() {
  local image; image="$(resolve_image)"
  log "创建/更新 Cloud Run Job: $MIGRATE_JOB → $image"
  local parsed; parsed="$(build_env_args)"
  local env_vars; env_vars="$(echo "$parsed" | grep '^ENV_VARS<<<' | sed 's/^ENV_VARS<<<//')"
  local secrets;  secrets="$(echo "$parsed"  | grep '^SECRETS<<<'  | sed 's/^SECRETS<<<//')"

  # Job 内执行的命令: 先 migrate deploy(用 DIRECT_URL),再跑 init-system
  # prisma 已在 dependencies, 通过 node_modules/.bin 调用 CLI
  local job_cmd='cd /app && ./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma && node dist/scripts/init-system.js'

  if gcloud run jobs describe "$MIGRATE_JOB" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1; then
    gcloud run jobs update "$MIGRATE_JOB" \
      --project="$PROJECT_ID" --region="$REGION" \
      --image="$image" \
      --service-account="$RUNTIME_SA" \
      --cpu=1 --memory=1Gi \
      --max-retries=1 --task-timeout=900 \
      --set-env-vars="^@^${env_vars}" \
      --set-secrets="^@^${secrets}" \
      --command="/bin/sh" \
      --args="-c,$job_cmd" \
      --quiet
  else
    gcloud run jobs create "$MIGRATE_JOB" \
      --project="$PROJECT_ID" --region="$REGION" \
      --image="$image" \
      --service-account="$RUNTIME_SA" \
      --cpu=1 --memory=1Gi \
      --max-retries=1 --task-timeout=900 \
      --set-env-vars="^@^${env_vars}" \
      --set-secrets="^@^${secrets}" \
      --command="/bin/sh" \
      --args="-c,$job_cmd" \
      --quiet
  fi

  log "▶️  执行 Job: $MIGRATE_JOB (这会跑迁移 + 初始化超管,完成前请勿打断)"
  gcloud run jobs execute "$MIGRATE_JOB" \
    --project="$PROJECT_ID" --region="$REGION" \
    --wait --quiet
  log "✅ 迁移 + 初始化完成。日志中若包含一次性密码,请立即保存"
  log "   查看完整日志: gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=${MIGRATE_JOB}' --project=$PROJECT_ID --limit=200 --format='value(textPayload)' --freshness=10m"
}

cmd_all() {
  cmd_build
  IMAGE_TAG="$(cat .last-image-tag 2>/dev/null || echo latest)"
  export IMAGE_TAG
  cmd_secrets
  cmd_migrate
  cmd_api
  cmd_worker
  log "🎉 全流程完成"
  cmd_status
}

cmd_status() {
  echo "=== Cloud Run Services ==="
  gcloud run services list --project="$PROJECT_ID" --region="$REGION" \
    --format="table(metadata.name,status.url,status.conditions[0].status)" 2>/dev/null || true
  echo
  echo "=== Cloud Run Jobs ==="
  gcloud run jobs list --project="$PROJECT_ID" --region="$REGION" \
    --format="table(metadata.name,status.latestCreatedExecution.name)" 2>/dev/null || true
}

cmd_logs() {
  local target="${1:-api}"
  local resource_type="cloud_run_revision"
  local name=""
  case "$target" in
    api)     name="$API_SERVICE" ;;
    worker)  name="$WORKER_SERVICE" ;;
    migrate) name="$MIGRATE_JOB"; resource_type="cloud_run_job" ;;
    *) die "未知目标: $target (api|worker|migrate)" ;;
  esac
  local label="service_name"
  [[ "$resource_type" == "cloud_run_job" ]] && label="job_name"
  gcloud logging read "resource.type=${resource_type} AND resource.labels.${label}=${name}" \
    --project="$PROJECT_ID" --limit=100 --format="value(timestamp,textPayload,jsonPayload.message)" \
    --freshness=30m
}

# ------------------------------- 入口 ----------------------------------------
case "${1:-}" in
  build)    cmd_build ;;
  secrets)  cmd_secrets ;;
  api)      cmd_api ;;
  worker)   cmd_worker ;;
  migrate)  cmd_migrate ;;
  all)      cmd_all ;;
  status)   cmd_status ;;
  logs)     cmd_logs "${2:-api}" ;;
  *)
    cat <<EOF
Usage: $0 <command>

Commands:
  build      Cloud Build 构建并推送镜像
  secrets    同步 $ENV_FILE 到 Secret Manager
  migrate    部署 + 执行迁移 Job (prisma migrate deploy + init-system)
  api        部署 eatcheck-api HTTP 服务
  worker     部署 eatcheck-worker 常驻服务
  all        以上全部按顺序
  status     查看部署状态
  logs <api|worker|migrate>  查看日志
EOF
    exit 1
    ;;
esac
