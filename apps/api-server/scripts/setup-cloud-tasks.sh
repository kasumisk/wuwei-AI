#!/usr/bin/env bash
# scripts/setup-cloud-tasks.sh
#
# 一次性创建本项目使用的 9 个 Cloud Tasks 队列。
# 幂等：脚本可重复运行；已存在的队列会被跳过（gcloud 返回非零，但脚本继续）。
#
# 必填环境变量：
#   GCP_PROJECT_ID            目标 GCP 项目 ID
#   CLOUD_TASKS_LOCATION      队列所在 region（与 Cloud Run 同 region，本项目 us-east1）
#
# 可选：
#   CLOUD_TASKS_QUEUE_PREFIX  队列名前缀（多环境共用同一项目时使用，例如 "staging-"）
#
# 注意：
#   - Cloud Tasks 不支持已创建队列改名，删除有 7 天保留期；命名要谨慎。
#   - LLM 队列（food-analysis/recipe-generation/embedding-generation）设置较低限速，
#     避免并发触发上游模型 429。

set -euo pipefail

: "${GCP_PROJECT_ID:?need GCP_PROJECT_ID}"
: "${CLOUD_TASKS_LOCATION:?need CLOUD_TASKS_LOCATION (e.g. us-east1)}"
PREFIX="${CLOUD_TASKS_QUEUE_PREFIX:-}"

# 格式：<队列名>:<max-concurrent-dispatches>:<max-dispatches-per-second>
# 不限速队列留空（使用 Cloud Tasks 默认：1000 并发 / 500 qps）
QUEUES=(
  "recommendation-precompute::"
  "food-analysis:10:2"
  "notification::"
  "export::"
  "recipe-generation:10:2"
  "embedding-generation:20:5"
  "food-enrichment::"
  "food-usda-import::"
  "subscription-maintenance::"
)

echo "==> Project: ${GCP_PROJECT_ID}, Region: ${CLOUD_TASKS_LOCATION}, Prefix: '${PREFIX}'"

for entry in "${QUEUES[@]}"; do
  IFS=':' read -r q max_concurrent max_qps <<< "${entry}"
  name="${PREFIX}${q}"
  echo "==> Ensuring queue: ${name}"
  if gcloud tasks queues describe "${name}" \
        --location="${CLOUD_TASKS_LOCATION}" \
        --project="${GCP_PROJECT_ID}" >/dev/null 2>&1; then
    echo "    already exists — updating rate limits"
    rate_args=()
    [[ -n "${max_concurrent}" ]] && rate_args+=(--max-concurrent-dispatches="${max_concurrent}")
    [[ -n "${max_qps}" ]]        && rate_args+=(--max-dispatches-per-second="${max_qps}")
    if [[ ${#rate_args[@]} -gt 0 ]]; then
      gcloud tasks queues update "${name}" \
        --location="${CLOUD_TASKS_LOCATION}" \
        --project="${GCP_PROJECT_ID}" \
        "${rate_args[@]}"
    fi
  else
    rate_args=()
    [[ -n "${max_concurrent}" ]] && rate_args+=(--max-concurrent-dispatches="${max_concurrent}")
    [[ -n "${max_qps}" ]]        && rate_args+=(--max-dispatches-per-second="${max_qps}")
    gcloud tasks queues create "${name}" \
      --location="${CLOUD_TASKS_LOCATION}" \
      --project="${GCP_PROJECT_ID}" \
      --max-attempts=10 \
      --max-retry-duration=3600s \
      --min-backoff=1s \
      --max-backoff=300s \
      "${rate_args[@]}"
    echo "    created"
  fi
done

echo "==> Done. ${#QUEUES[@]} queues processed."
