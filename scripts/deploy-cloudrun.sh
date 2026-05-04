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
CRON_JOB="${CRON_JOB:-eatcheck-cron-runner}"

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
  # ---- Queue / Cron / Cloud Tasks 解耦后新增（非敏感）----
  QUEUE_BACKEND_DEFAULT CRON_BACKEND ENFORCE_INTERNAL_AUTH
  GCP_PROJECT_ID CLOUD_TASKS_LOCATION
  CLOUD_TASKS_HANDLER_URL CLOUD_TASKS_OIDC_SA_EMAIL CLOUD_TASKS_OIDC_AUDIENCE
  CRON_NAME
  # 注：CLOUD_TASKS_INTERNAL_TOKEN / CACHE_REDIS_URL / QUEUE_REDIS_URL 走 Secret Manager
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

# 构造部署参数：
#   - PUBLIC 键写入临时 yaml 文件（--env-vars-file），规避值含 @ / , 的转义问题
#   - SECRET 键拼成逗号分隔的 --set-secrets 字符串（值均为 secret-name:latest，不含特殊符号）
# 输出:
#   ENVFILE<<<  /tmp 临时 yaml 路径
#   SECRETS<<<  key=secret:latest,... 逗号分隔
build_env_args() {
  require_env_file
  local tmpfile; tmpfile="$(mktemp /tmp/cloudrun-env-XXXXXX.yaml)"
  local secrets=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ ! "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then continue; fi
    local key="${BASH_REMATCH[1]}"
    local value="${BASH_REMATCH[2]}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    if is_reserved_key "$key"; then continue; fi

    if is_public_key "$key"; then
      # 公开键：值为空则跳过（不写入 env vars）
      [[ -z "$value" ]] && continue
      # yaml 格式：KEY: 'value'（单引号转义内部单引号为 ''）
      local escaped_value="${value//\'/\'\'}"
      printf "%s: '%s'\n" "$key" "$escaped_value" >> "$tmpfile"
    else
      # Secret 键：值为空时检查 Secret Manager 是否已有版本，有则仍挂载
      if [[ -z "$value" ]]; then
        if gcloud secrets versions list "eatcheck-${key}" --project="$PROJECT_ID" \
             --filter="state=enabled" --limit=1 --format='value(name)' >/dev/null 2>&1 \
           && [[ -n "$(gcloud secrets versions list "eatcheck-${key}" --project="$PROJECT_ID" \
             --filter="state=enabled" --limit=1 --format='value(name)' 2>/dev/null)" ]]; then
          # Secret Manager 有值，挂载（跳过同步写入）
          true
        else
          continue
        fi
      fi
      [[ -n "$secrets" ]] && secrets+=","
      secrets+="${key}=eatcheck-${key}:latest"
    fi
  done < "$ENV_FILE"

  echo "ENVFILE<<<${tmpfile}"
  echo "SECRETS<<<${secrets}"
}

resolve_image() {
  local tag="${IMAGE_TAG:-latest}"
  echo "${IMAGE_BASE}:${tag}"
}

# 通用 gcloud run deploy 包装，自动清理临时文件
_run_deploy_service() {
  local svc="$1"; shift
  local image; image="$(resolve_image)"
  local parsed; parsed="$(build_env_args)"
  local envfile; envfile="$(echo "$parsed" | grep '^ENVFILE<<<' | sed 's/^ENVFILE<<<//')"
  local secrets;  secrets="$(echo "$parsed"  | grep '^SECRETS<<<'  | sed 's/^SECRETS<<<//')"

  local secret_args=()
  [[ -n "$secrets" ]] && secret_args=(--set-secrets="$secrets")

  gcloud run deploy "$svc" \
    --project="$PROJECT_ID" --region="$REGION" \
    --image="$image" \
    --service-account="$RUNTIME_SA" \
    --env-vars-file="$envfile" \
    "${secret_args[@]}" \
    "$@" \
    --quiet

  rm -f "$envfile"
}

# 通用 gcloud run jobs create/update 包装
_run_job_deploy() {
  local job="$1"; shift
  local image; image="$(resolve_image)"
  local parsed; parsed="$(build_env_args)"
  local envfile; envfile="$(echo "$parsed" | grep '^ENVFILE<<<' | sed 's/^ENVFILE<<<//')"
  local secrets;  secrets="$(echo "$parsed"  | grep '^SECRETS<<<'  | sed 's/^SECRETS<<<//')"

  local secret_args=()
  [[ -n "$secrets" ]] && secret_args=(--set-secrets="$secrets")

  local action="create"
  gcloud run jobs describe "$job" --project="$PROJECT_ID" --region="$REGION" >/dev/null 2>&1 \
    && action="update"

  gcloud run jobs "$action" "$job" \
    --project="$PROJECT_ID" --region="$REGION" \
    --image="$image" \
    --service-account="$RUNTIME_SA" \
    --env-vars-file="$envfile" \
    "${secret_args[@]}" \
    "$@" \
    --quiet

  rm -f "$envfile"
}

cmd_api() {
  log "部署 $API_SERVICE"
  _run_deploy_service "$API_SERVICE" \
    --platform=managed \
    --allow-unauthenticated \
    --port=3000 \
    --cpu=1 --memory=1Gi \
    --min-instances=1 --max-instances=5 \
    --concurrency=80 \
    --timeout=300 \
    --execution-environment=gen2 \
    --cpu-boost \
    --command="dumb-init" \
    --args="--,node,dist/main.js"
  log "✅ $API_SERVICE 部署完成"
  gcloud run services describe "$API_SERVICE" \
    --project="$PROJECT_ID" --region="$REGION" \
    --format="value(status.url)"
}

cmd_worker() {
  log "部署 $WORKER_SERVICE"
  _run_deploy_service "$WORKER_SERVICE" \
    --platform=managed \
    --no-allow-unauthenticated \
    --no-cpu-throttling \
    --cpu=1 --memory=1Gi \
    --min-instances=0 --max-instances=1 \
    --execution-environment=gen2 \
    --command="dumb-init" \
    --args="--,node,dist/worker.js"
  log "✅ $WORKER_SERVICE 部署完成"
}

cmd_migrate() {
  log "创建/更新 Cloud Run Job: $MIGRATE_JOB"
  local job_cmd='cd /app && ./node_modules/.bin/prisma migrate deploy --schema=prisma/schema.prisma && node dist/scripts/init-system.js'
  _run_job_deploy "$MIGRATE_JOB" \
    --cpu=1 --memory=1Gi \
    --max-retries=1 --task-timeout=900 \
    --command="/bin/sh" \
    --args="-c,${job_cmd}"

  log "▶️  执行 Job: $MIGRATE_JOB"
  gcloud run jobs execute "$MIGRATE_JOB" \
    --project="$PROJECT_ID" --region="$REGION" \
    --wait --quiet
  log "✅ 迁移 + 初始化完成"
  log "   查看日志: gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=${MIGRATE_JOB}' --project=$PROJECT_ID --limit=200 --format='value(textPayload)' --freshness=10m"
}

cmd_cron() {
  log "创建/更新 Cloud Run Job: $CRON_JOB"
  _run_job_deploy "$CRON_JOB" \
    --cpu=1 --memory=1Gi \
    --max-retries=1 --task-timeout=3600 \
    --command="dumb-init" \
    --args="--,node,dist/cron-runner.js"
  # CRON_BACKEND=external 额外注入（不在 env 文件里作为固定值，避免 migrate job 也被打上）
  gcloud run jobs update "$CRON_JOB" \
    --project="$PROJECT_ID" --region="$REGION" \
    --update-env-vars="CRON_BACKEND=external" \
    --quiet
  log "✅ $CRON_JOB Job 已就绪"
  log "   触发示例: gcloud run jobs execute $CRON_JOB --region=$REGION --update-env-vars=CRON_NAME=<name> --wait"
}

cmd_all() {
  cmd_build
  IMAGE_TAG="$(cat .last-image-tag 2>/dev/null || echo latest)"
  export IMAGE_TAG
  cmd_secrets
  cmd_migrate
  cmd_api
  cmd_worker
  cmd_cron
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
    cron)    name="$CRON_JOB"; resource_type="cloud_run_job" ;;
    *) die "未知目标: $target (api|worker|migrate|cron)" ;;
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
  cron)     cmd_cron ;;
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
  cron       部署 cron-runner Cloud Run Job (重 cron 备用入口；CRON_NAME 选具体任务)
  api        部署 eatcheck-api HTTP 服务
  worker     部署 eatcheck-worker 常驻服务
  all        以上全部按顺序
  status     查看部署状态
  logs <api|worker|migrate|cron>  查看日志
EOF
    exit 1
    ;;
esac
