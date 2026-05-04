#!/usr/bin/env bash
# scripts/setup-cloud-scheduler.sh
#
# 一次性创建本项目使用的 21 个 Cloud Scheduler Job（HTTP target → InternalCronController）。
# 幂等：已存在的 job 会被 update 覆盖，缺失的会被 create。
#
# 必填环境变量：
#   GCP_PROJECT_ID                    目标 GCP 项目 ID
#   CLOUD_SCHEDULER_LOCATION          Scheduler region（与 Cloud Run 同 region，us-east1）
#   CLOUD_TASKS_HANDLER_URL           Cloud Run service base URL（不含路径）
#                                     例如 https://eatcheck-api-xxxx-ue.a.run.app
#   CLOUD_TASKS_OIDC_SA_EMAIL         Scheduler 调用 Cloud Run 时使用的 SA
#                                     例如 eatcheck-runtime@flutter-scaffold-4fd6c.iam.gserviceaccount.com
#   CLOUD_TASKS_INTERNAL_TOKEN        共享 token（写入 X-Internal-Token header；与 Cloud Run env 一致）
#
# 可选：
#   CLOUD_SCHEDULER_PREFIX            job 名前缀（多环境共用同一项目时使用，例如 "staging-"）
#   CLOUD_SCHEDULER_AUDIENCE          OIDC audience（默认与 CLOUD_TASKS_HANDLER_URL 相同）
#
# 时区：
#   所有 cron 表达式按 UTC 解释（与 @nestjs/schedule 在 Cloud Run 上的行为一致）。
#
# 维护：
#   修改/新增 cron 时，同步：
#     1) src/<module>/<service>.ts 中 @Cron 表达式 + cronRegistry.register('<name>')
#     2) 本脚本 JOBS 数组
#     3) docs/REDIS_DECOUPLING_AND_QUEUE_MIGRATION.md cron 列表

set -euo pipefail

: "${GCP_PROJECT_ID:?need GCP_PROJECT_ID}"
: "${CLOUD_SCHEDULER_LOCATION:?need CLOUD_SCHEDULER_LOCATION (e.g. us-east1)}"
: "${CLOUD_TASKS_HANDLER_URL:?need CLOUD_TASKS_HANDLER_URL (Cloud Run base URL)}"
: "${CLOUD_TASKS_OIDC_SA_EMAIL:?need CLOUD_TASKS_OIDC_SA_EMAIL}"
: "${CLOUD_TASKS_INTERNAL_TOKEN:?need CLOUD_TASKS_INTERNAL_TOKEN}"

PREFIX="${CLOUD_SCHEDULER_PREFIX:-}"
AUDIENCE="${CLOUD_SCHEDULER_AUDIENCE:-${CLOUD_TASKS_HANDLER_URL}}"
BASE_URL="${CLOUD_TASKS_HANDLER_URL%/}"

# JOBS 格式：cron-name|cron-expr|description
# 注意：cron-name 与 cronRegistry.register 中字符串严格一致（kebab-case）。
JOBS=(
  # food-pipeline (5)
  "food-sync-monthly-usda|0 3 1 * *|每月 1 号 USDA 全量同步"
  "food-sync-daily-conflict-resolution|30 3 * * *|每日 03:30 食物冲突解决"
  "food-sync-daily-score-calculation|0 4 * * *|每日 04:00 食物评分计算"
  "food-sync-weekly-quality-report|0 5 * * 1|每周一 05:00 食物质量报告"
  "food-sync-hourly-popularity-update|0 * * * *|每小时食物流行度更新"

  # user/profile (3)
  "user-profile-daily-update|0 3 * * *|每日 03:00 用户画像更新"
  "user-profile-weekly-segmentation|0 4 * * 0|每周日 04:00 用户分群"
  "user-profile-biweekly-preference-decay|0 4 */14 * *|每两周偏好衰减"

  # diet/recommendation precompute (2)
  "recommendation-daily-precompute|0 7 * * *|每日 07:00 推荐预计算入队 fan-out"
  "recommendation-cleanup-precomputed|15 4 * * *|每日 04:15 清理过期预计算结果"

  # subscription (4)
  "subscription-quota-reset|0 * * * *|每小时配额重置"
  "subscription-process-expired|0 * * * *|每小时订阅过期处理"
  "subscription-revenuecat-reconcile|*/15 * * * *|每 15 分钟 RevenueCat 对账"
  "subscription-revenuecat-webhook-retry|*/10 * * * *|每 10 分钟 RevenueCat webhook 重试"

  # recommendation/optimization (5)
  "weight-learner-daily|30 6 * * *|每日 06:30 权重学习"
  "learned-ranking-weekly-recompute|0 6 * * 1|每周一 06:00 学习排序重算"
  "strategy-auto-tune-weekly|0 4 * * 1|每周一 04:00 策略自动调优"
  "explanation-ab-weekly-analyze|0 5 * * 1|每周一 05:00 解释 AB 分析"
  "cf-incremental-daily|0 1 * * 1-6|周一-周六 01:00 协同过滤增量更新"
  "cf-full-rebuild-weekly|0 1 * * 0|每周日 01:00 协同过滤全量重建"

  # core/llm (1)
  "usage-archive|0 2 * * *|每日 UTC 02:00 LLM 用量归档"
)

echo "==> Project: ${GCP_PROJECT_ID}, Region: ${CLOUD_SCHEDULER_LOCATION}, Prefix: '${PREFIX}'"
echo "==> Target: ${BASE_URL}/api/internal/cron/<cronName>"
echo "==> SA: ${CLOUD_TASKS_OIDC_SA_EMAIL}"
echo

for entry in "${JOBS[@]}"; do
  IFS='|' read -r cron_name schedule description <<< "${entry}"
  job_name="${PREFIX}${cron_name}"
  uri="${BASE_URL}/api/internal/cron/${cron_name}"

  if gcloud scheduler jobs describe "${job_name}" \
        --location="${CLOUD_SCHEDULER_LOCATION}" \
        --project="${GCP_PROJECT_ID}" >/dev/null 2>&1; then
    action="update"
  else
    action="create"
  fi

  echo "==> ${action} job: ${job_name} [${schedule}] -> ${uri}"

  header_flag="--headers"
  if [ "${action}" = "update" ]; then
    header_flag="--update-headers"
  fi

  gcloud scheduler jobs ${action} http "${job_name}" \
    --location="${CLOUD_SCHEDULER_LOCATION}" \
    --project="${GCP_PROJECT_ID}" \
    --schedule="${schedule}" \
    --time-zone="UTC" \
    --uri="${uri}" \
    --http-method=POST \
    "${header_flag}=X-Internal-Token=${CLOUD_TASKS_INTERNAL_TOKEN},Content-Type=application/json" \
    --message-body='{}' \
    --oidc-service-account-email="${CLOUD_TASKS_OIDC_SA_EMAIL}" \
    --oidc-token-audience="${AUDIENCE}" \
    --description="${description}" \
    --attempt-deadline=540s \
    --max-retry-attempts=3 \
    --min-backoff=10s \
    --max-backoff=600s
done

echo
echo "==> Done. ${#JOBS[@]} scheduler jobs processed."
echo "==> 注意：Cloud Run service 的 ENFORCE_INTERNAL_AUTH=true 时，确保："
echo "   - SA ${CLOUD_TASKS_OIDC_SA_EMAIL} 拥有 roles/run.invoker"
echo "   - Cloud Run env CLOUD_TASKS_INTERNAL_TOKEN 与本脚本注入值一致"
echo "   - Cloud Run env CLOUD_TASKS_OIDC_AUDIENCE = ${AUDIENCE}"
