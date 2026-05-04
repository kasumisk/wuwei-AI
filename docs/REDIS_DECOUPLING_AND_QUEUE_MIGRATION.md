# Redis 解耦 & 队列迁移设计（生产环境）

> Status: Draft v1
> Owner: Backend
> 影响系统：`eatcheck-api` (Cloud Run) / `eatcheck-worker` (Cloud Run) / Upstash Redis / Cloud SQL Postgres
> 触发事件：2026-05-04 production Upstash `ERR max requests limit exceeded. Limit: 500000, Usage: 500005`，连带 `scoring_config:snapshot SET / sub:expire:lock / rc:webhook-retry:lock / cache:invalidate subscriber` 全部失败，API 慢化、worker 退化。

---

## 0. TL;DR

把 Redis 从 **核心控制面** 降级为 **辅助加速层**：

```
Before                                            After
──────                                            ─────
Upstash Redis（一个）                              Cache Redis（独立、可挂）
  ├─ BullMQ 9 个队列  ─┐                            ├─ 业务缓存（TieredCache L2）
  ├─ 22 个 @Cron 锁   ─┤                            ├─ Throttler 限流
  ├─ TieredCache L2   ─┤                            ├─ 短 TTL 幂等（webhook event id 等）
  ├─ cache:invalidate ─┤   ➜  解耦 + 迁移  ➜      └─ 短期会话状态
  ├─ Throttler        ─┤
  ├─ 幂等 / 锁         ─┤                          Cloud Tasks（独立、按用量计费）
  └─ snapshot / warmup ┘                            ├─ 用户触发型异步任务
                                                    │   （food-analysis / notification /
                                                    │    recipe-generation / export /
                                                    │    embedding / food-enrichment /
                                                    │    subscription-maintenance）
                                                    │
                                                  Cloud Scheduler + Cloud Run Jobs
                                                    ├─ 22 个定时任务（precompute /
                                                    │   profile-cron / weight-learner /
                                                    │   subscription-expire / quota-reset /
                                                    │   revenuecat-reconcile / ...）
                                                    │
                                                  Postgres（核心事实）
                                                    ├─ idempotency_key 表（取代 Redis 锁）
                                                    ├─ task_execution_log 表
                                                    └─ 所有关键状态
```

**目标**：

- Redis 配额耗尽时，API **不挂、不丢任务、不少计费**，只是**变慢**或**少量功能降级**。
- 队列规模与流量解耦，按用量付费，不再依赖 Redis 请求数。
- 定时任务由 GCP 原生组件托管，不再常驻消费 Redis。

**生产硬约束**：

- 不停机；每个 Phase 可独立回滚。
- BullMQ 在途 job 不丢；通过**双轨期**（新流量进 Tasks，旧 BullMQ 仅消化存量）。
- 计费/订阅链路 100% 由 Postgres 幂等表兜底，Redis 仅做加速。

**环境策略（已落地）**：

> local / staging 继续用**单 Redis + BullMQ + @Cron（inproc）**，零 GCP 依赖。
> production **直接切到 Cloud Tasks + Cloud Scheduler（external）**，不双轨，不灰度。

| 项目 | local / staging | production |
|---|---|---|
| `QUEUE_BACKEND_DEFAULT` | `bullmq` | `tasks` |
| `CRON_BACKEND` | `inproc`（@Cron 在 worker 进程内触发） | `external`（Cloud Scheduler → HTTP） |
| `ENFORCE_INTERNAL_AUTH` | `false`（Guard 自动放行） | `true` |
| Redis | 单实例 `REDIS_URL`（BullMQ + Cache 共用） | `CACHE_REDIS_URL`（Upstash，仅 cache/throttler）；Queue Redis 留空（tasks 模式不需要） |
| Cloud Tasks Queues | ❌ 不创建 | ✅ 9 个（已创建） |
| Cloud Scheduler | ❌ | ✅ 21 个 job（已创建；food-sync 5 个已 pause） |
| Cloud Run Jobs | ❌ | ✅ `eatcheck-cron-runner`（重 cron 备用） |
| `eatcheck-worker` | 常驻消费 BullMQ | min=0，空跑（tasks 模式不消费），保留用于回滚 |
| docker-compose / 本地调试 | 不变，`docker-compose up` 一键起 | n/a |

**为什么 local/staging 不上 Cloud Tasks**：

1. 单 Redis 在低流量环境不会触发 Upstash 配额，没有切换动力。
2. `docker-compose up` 一键起、bull-board 可视化、worker 断点调试，体验好。
3. Cloud Tasks / Scheduler 解决的是生产 Redis 配额 / 控制面隔离问题，测试环境不存在。
4. 代码一份共享：`QueueProducer.enqueue()` 根据 `QUEUE_BACKEND_DEFAULT` 自动路由，调用方不感知。

**staging .env 配置（只需这几行）**：

```bash
QUEUE_BACKEND_DEFAULT=bullmq
CRON_BACKEND=inproc
REDIS_URL=rediss://...  # 单实例，BullMQ + Cache 共用
# CACHE_REDIS_URL / QUEUE_REDIS_URL 留空，自动 fallback 到 REDIS_URL
```

---

## 1. 现状盘点（基于代码）

### 1.1 Redis 实际承载（单实例 Upstash）

| 用途 | 命令量级 | 关键字 / 文件 |
|---|---|---|
| **BullMQ 队列**（9 个） | 持续高频 BRPOPLPUSH / 心跳 / lock / delayed | `core/queue/queue.module.ts`, `queue.constants.ts` |
| **TieredCacheManager L2** + L1 失效 pub/sub | 启动 SUBSCRIBE `cache:invalidate`，每次写都 PUBLISH | `core/cache/tiered-cache-manager.ts` |
| **业务 cache get/set/del** | 高频 | 各模块 service |
| **Throttler 限流** | 每个 HTTP 请求至少 1 次 INCR | `nestjs-throttler-storage-redis` (`app.module.ts`) |
| **22 个 Cron 锁** `runWithLock` | 间隔 1m–1h，每次 SETNX + DEL + ping | `redis-cache.service.ts:331` |
| **scoring_config:snapshot** | 启动 + tuning 时 SET | `recommendation/context/scoring-config.service.ts:87` |
| **Cache warmup** | 启动时批量 SET | `core/cache/cache-warmup.service.ts` |
| **Pub/Sub 控制面** | 长连 SUBSCRIBE | `tiered-cache-manager.ts:316` |
| **幂等短 key**（subscription / RC webhook） | 中等 | `revenuecat-sync.service.ts`, `subscription.service.ts` |

### 1.2 BullMQ 队列清单（9 个，全部需迁移）

| Queue | 触发源 | 当前 Producer | 迁移目标 |
|---|---|---|---|
| `food-analysis` | 用户触发（拍照分析） | `modules/food/app/services/analyze.service.ts:208` | **Cloud Tasks**（HTTP target → `eatcheck-api /internal/tasks/food-analysis`） |
| `notification` | 用户/系统触发 FCM 推送 | `modules/notification/app/notification.service.ts:133` | **Cloud Tasks** |
| `recipe-generation` | 用户触发（AI 菜谱生成） | `modules/recipe/app/recipe-generation.service.ts:265` | **Cloud Tasks** |
| `export` | 用户触发（导出 CSV/PDF） | TBD | **Cloud Tasks** |
| `embedding-generation` | 食物入库后台 | `modules/diet/.../embedding-generation.service.ts` | **Cloud Tasks**（fan-out 由触发处分批 enqueue） |
| `food-enrichment` | Admin 触发批量 | `food-pipeline/controllers/food-enrichment.controller.ts:1013` | **Cloud Tasks** + **Cloud Run Jobs**（>10k 条用 Job） |
| `food-usda-import` | Admin 触发 | `food-pipeline/controllers/food-pipeline.controller.ts:74,168,235` | **Cloud Run Jobs**（长任务 / 高内存） |
| `recommendation-precompute` | Cron 触发 + fan-out per user | `modules/diet/app/services/precompute.service.ts:371` | **Cloud Run Jobs**（批量）+ **Cloud Tasks**（fan-out） |
| `subscription-maintenance` | Admin / 系统触发 | `modules/subscription/admin/subscription-management.service.ts` | **Cloud Tasks** |

### 1.3 Cron 清单（22 个）

| 频率 | 任务 | 文件 | 迁移目标 |
|---|---|---|---|
| `0 2 * * *` | usage-archive | `core/llm/usage-archive-cron.service.ts:39` | Scheduler → Run Job |
| `0 2 * * *` | dailyProfileUpdate | `user/.../profile-cron.service.ts:44` | Scheduler → Run Job |
| `0 3 * * 1` | weeklySegmentationUpdate | `profile-cron.service.ts:245` | Scheduler → Run Job |
| `30 4 1,15 * *` | biweeklyPreferenceDecay | `profile-cron.service.ts:418` | Scheduler → Run Job |
| `0 5 * * 1` | analyzeExplanationEffectiveness | `explanation-ab-tracker.service.ts:133` | Scheduler → Run Job |
| `30 6 * * *` | weight-learner-daily | `weight-learner.service.ts:333` | Scheduler → Run Job |
| `0 6 * * 1` | learned-ranking recompute | `learned-ranking.service.ts:106` | Scheduler → Run Job |
| `0 1 * * 1-6` | CF incremental update | `collaborative-filtering.service.ts:168` | Scheduler → Run Job |
| `0 1 * * 0` | CF full rebuild | `collaborative-filtering.service.ts:178` | Scheduler → Run Job |
| `0 7 * * *` | daily-precompute | `diet/.../precompute.service.ts:222` | Scheduler → Run Job |
| `15 4 * * *` | cleanup-precomputed | `precompute.service.ts:410` | Scheduler → Run Job |
| `*/15 * * * *` | revenuecat-reconcile | `revenuecat-sync.service.ts:290` | Scheduler → HTTP endpoint |
| `*/10 * * * *` | revenuecat-webhook-retry | `revenuecat-sync.service.ts:325` | Scheduler → HTTP endpoint |
| `0 * * * *` | subscription-process-expired | `subscription.service.ts:477` | Scheduler → HTTP endpoint |
| `0 * * * *` | quota-reset | `quota.service.ts:229` | Scheduler → HTTP endpoint |
| `0 4 * * 1` | strategy-auto-tuner | `strategy-auto-tuner.service.ts:239` | Scheduler → Run Job |
| `30 5 1 * *` | monthlyUsdaSync | `food-sync-scheduler.service.ts:28` | Scheduler → Run Job |
| `0 4 * * *` | dailyConflictResolution | `food-sync-scheduler.service.ts:79` | Scheduler → Run Job |
| `0 5 * * *` | dailyScoreCalculation | `food-sync-scheduler.service.ts:97` | Scheduler → Run Job |
| `0 6 * * 1` | weeklyQualityReport | `food-sync-scheduler.service.ts:118` | Scheduler → Run Job |
| `30 * * * *` | hourlyPopularityUpdate | `food-sync-scheduler.service.ts:137` | Scheduler → HTTP endpoint |

> 「HTTP endpoint」= 让 Cloud Scheduler 直接 OIDC 认证调用 `eatcheck-api` 的内部接口（轻任务，秒级返回）。
> 「Run Job」= 创建独立 Cloud Run Job（重任务、可能数分钟、需要更高内存/CPU）。

---

## 2. 目标架构

```
                ┌──────────────────────────────────────────────────────────┐
                │  Cloud Scheduler                                          │
                │   ├─ schedule + retry + history                           │
                │   ├─ → HTTP (轻任务直接打 /internal/cron/*)               │
                │   └─ → Run Job execution（重任务）                        │
                └────────────────┬─────────────────────────────────────────┘
                                 │ OIDC (eatcheck-runtime SA)
   user                          │
    │                            ▼
    ▼                ┌─────────────────────────┐
┌────────┐  enqueue  │  Cloud Tasks queues     │   pull (push HTTP target)
│ api    │──────────►│  ├─ food-analysis       │──────────────┐
│ Cloud  │           │  ├─ notification        │              │ OIDC
│ Run    │           │  ├─ recipe-generation   │              ▼
│ (api)  │           │  ├─ export              │      ┌───────────────┐
└────────┘           │  ├─ embedding           │      │ eatcheck-api  │
   │                 │  ├─ food-enrichment     │      │ /internal/    │
   │                 │  └─ subscription-maint  │      │   tasks/*     │
   │                 └─────────────────────────┘      └───────────────┘
   │
   │  cache / throttle / short idempotency
   ▼
┌───────────────────────┐         ┌──────────────────────────┐
│  Cache Redis (small)  │         │  Postgres (Cloud SQL)     │
│  - TieredCache L2     │         │  - idempotency_key        │
│  - Throttler          │◄────────│  - task_execution_log     │
│  - 短 TTL 幂等加速     │  fall   │  - subscription / quota   │
│  - 短期会话状态        │  back  │  - 所有关键状态            │
└───────────────────────┘         └──────────────────────────┘
```

### 2.1 关键不变量

1. **关键状态必须在 Postgres**：subscription event、payment event、analysis status、precompute result、decision record、quota counter（关键场景）。Redis 只做加速。
2. **幂等必须双写**：webhook event id、payment event id 进 Postgres `idempotency_key` 表（unique index），Redis 只做"快速短路"。Redis 不可用时回查 Postgres。
3. **Cloud Tasks 任务必须幂等**：每个 task body 带 `taskId`，handler 进入前先 `INSERT ... ON CONFLICT DO NOTHING` 到 `task_execution_log`，保证 at-least-once 投递下不重复执行。
4. **Cloud Scheduler 不能依赖 Redis 锁**：单实例 Job/Endpoint 调用 + Postgres `task_execution_log(name, scheduled_at)` unique index 保证不重复。

### 2.2 Redis 保留能力（明确白名单）

| 能力 | 是否保留 | 降级策略 |
|---|---|---|
| 业务读缓存（food / recommendation / profile） | ✅ | 回源 DB / 实时计算 |
| Throttler 限流 | ✅ | fail-open（已是默认） |
| 短 TTL 幂等加速（webhook id 5min cache） | ✅ | 回查 Postgres `idempotency_key` |
| Cron `runWithLock` | ❌（迁移后删除） | Postgres unique constraint |
| BullMQ | ❌（迁移后删除） | Cloud Tasks |
| `cache:invalidate` Pub/Sub | ⚠️（保留但降级） | 已改成订阅失败不抛错；最差靠 L1 TTL（≤2min） |
| `scoring_config:snapshot` | ✅ | 回源 feature_flag 表 |
| Cache warmup（启动时批量 SET） | ⚠️（缩规模） | 改成 lazy load，移除启动期写入 |

---

## 3. 数据模型新增（Postgres）

### 3.1 `idempotency_key`

替代 Redis `setNX` 用于支付/订阅/webhook 关键链路。

```sql
CREATE TABLE idempotency_key (
  scope        TEXT        NOT NULL,        -- e.g. 'rc-webhook' / 'food-analysis-task'
  key          TEXT        NOT NULL,        -- 业务幂等键（webhook event id / task id）
  result       JSONB,                       -- 可选：缓存执行结果
  status       TEXT        NOT NULL DEFAULT 'in_progress',  -- in_progress | done | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (scope, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_key (created_at);
-- 定期清理 7 天前 done 记录（迁到 Cloud Run Job）
```

调用模式（取代 `setNX`）：

```ts
// 入口
const inserted = await prisma.idempotencyKey.create({
  data: { scope: 'rc-webhook', key: eventId, status: 'in_progress' },
}).catch(e => {
  if (e.code === 'P2002') return null; // 已存在 → 重复请求
  throw e;
});
if (!inserted) return { duplicate: true };
// ... do work ...
await prisma.idempotencyKey.update({
  where: { scope_key: { scope: 'rc-webhook', key: eventId } },
  data: { status: 'done', completedAt: new Date(), result },
});
```

### 3.2 `task_execution_log`

Cloud Tasks / Run Jobs 执行幂等 + 审计。

```sql
CREATE TABLE task_execution_log (
  task_id       TEXT        PRIMARY KEY,        -- producer 生成的 UUID
  task_type     TEXT        NOT NULL,           -- food-analysis / notification / ...
  scheduled_at  TIMESTAMPTZ NOT NULL,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|done|failed
  attempt       INT         NOT NULL DEFAULT 0,
  error         TEXT,
  payload       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_log_type_status ON task_execution_log (task_type, status);
CREATE INDEX idx_task_log_created ON task_execution_log (created_at);
```

### 3.3 `cron_execution_log`（可选）

替代 Cron Redis 锁。Scheduler 自带"重复执行保护"较弱，用 Postgres 兜底：

```sql
CREATE TABLE cron_execution_log (
  name          TEXT        NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'running',
  PRIMARY KEY (name, scheduled_at)
);
```

实际上 **Scheduler 单 target + Job 单实例 + `attemptDeadline`** 通常已经足够；只对"绝不能重复执行"的任务（如 `quota-reset`、`subscription-process-expired`）启用此表。

---

## 4. GCP 资源清单

> Project: `flutter-scaffold-4fd6c` / Region: `us-east1`
> Runtime SA: `eatcheck-runtime@flutter-scaffold-4fd6c.iam.gserviceaccount.com`

### 4.1 Cloud Tasks Queues（7 个）

```
food-analysis             rate=10/s   maxConcurrent=20  retry: maxAttempts=3, minBackoff=3s, maxBackoff=300s
notification              rate=20/s   maxConcurrent=50  retry: maxAttempts=5, minBackoff=2s
recipe-generation         rate=2/s    maxConcurrent=4   retry: maxAttempts=3, minBackoff=5s
export                    rate=1/s    maxConcurrent=2   retry: maxAttempts=2, minBackoff=5s
embedding-generation      rate=10/s   maxConcurrent=10  retry: maxAttempts=3
food-enrichment           rate=5/s    maxConcurrent=10  retry: maxAttempts=3
subscription-maintenance  rate=5/s    maxConcurrent=5   retry: maxAttempts=3
```

### 4.2 Cloud Run Jobs（重任务）

| Job 名 | 用途 | 资源 | 超时 |
|---|---|---|---|
| `eatcheck-job-precompute` | 每日推荐预计算（批量 fan-out 入 Tasks） | 1cpu/1Gi | 30m |
| `eatcheck-job-cf-rebuild` | 协同过滤矩阵重建（full） | 2cpu/4Gi | 60m |
| `eatcheck-job-cf-incremental` | CF 增量更新 | 1cpu/2Gi | 30m |
| `eatcheck-job-weight-learner` | 排序权重学习 | 1cpu/2Gi | 30m |
| `eatcheck-job-learned-ranking` | 学习式排序权重重算 | 1cpu/2Gi | 30m |
| `eatcheck-job-profile-daily` | 每日画像更新 | 1cpu/2Gi | 30m |
| `eatcheck-job-profile-weekly` | 周分群 | 1cpu/2Gi | 60m |
| `eatcheck-job-explanation-ab` | AB 解释效果分析 | 1cpu/1Gi | 30m |
| `eatcheck-job-strategy-tuner` | 策略自调优 | 1cpu/1Gi | 30m |
| `eatcheck-job-usda-monthly` | USDA 月度同步 | 1cpu/2Gi | 60m |
| `eatcheck-job-food-conflict` | 食物冲突解决 | 1cpu/2Gi | 30m |
| `eatcheck-job-food-score` | 食物打分 | 1cpu/2Gi | 30m |
| `eatcheck-job-quality-report` | 周质量报告 | 1cpu/1Gi | 30m |
| `eatcheck-job-usage-archive` | LLM usage 归档 | 1cpu/1Gi | 30m |
| `eatcheck-job-cleanup-precomputed` | 清理过期预计算 | 1cpu/1Gi | 30m |
| `eatcheck-job-biweekly-decay` | 偏好衰减 | 1cpu/2Gi | 30m |

复用同一镜像（已有 `apps/api-server` Docker），通过 `--command=node --args=dist/cron-runner.js,<task-name>` 区分入口。

### 4.3 Cloud Scheduler（22 条）

每条 Scheduler 一一对应上面的 Cron。target 类型分两种：

- **HTTP target**（轻任务）：直接 OIDC 调 `https://<api-url>/internal/cron/<name>`，header `X-Cron-Token` 二次校验。
- **Cloud Run Jobs target**：`gcloud scheduler jobs create http ... --uri=https://run.googleapis.com/.../jobs/<job>:run --oauth-service-account-email=<runtime SA>`。

### 4.4 IAM

```
eatcheck-runtime SA 需要新增：
  roles/cloudtasks.enqueuer        # 让 api 能 createTask
  roles/run.invoker                # Tasks → api OIDC 调用 / Scheduler → api OIDC 调用
  roles/run.developer              # Scheduler → Run Job execution
```

### 4.5 Cache Redis 实例

短期（Phase 1）选项：

- **A. Memorystore for Redis (Basic, 1GB)**：`us-east1`，VPC connector 接入。优点：无请求数限制、低延迟；缺点：需要 VPC connector。
- **B. Upstash 升级套餐**：保留现有连接方式，零 VPC 改动；按用量再付费。
- **C. 维持现 Upstash**（仅 cache + throttler，去掉 BullMQ 后请求量预计降 80%）

> **推荐 C**（先解耦再决定换不换），原因：
> - BullMQ + Cron Lock 占用了大头请求，迁出后 Upstash 压力骤降；
> - 解耦完观测一周再判断要不要换 Memorystore，避免一次改两件事。

---

## 5. 落地路线（生产安全节奏）

### Phase 0 — 当晚止血（< 2h，纯配置/降级，零业务改动）

**目标**：把今天的 500k 请求消耗源直接砍下来，恢复 production。

| 动作 | 文件 | 风险 |
|---|---|---|
| **0.1** TieredCache 订阅失败已降级（已做） | `tiered-cache-manager.ts` | 0 |
| **0.2** Cache warmup 启动期写入暂时 **关闭**（env flag `CACHE_WARMUP_ENABLED=false`） | `core/cache/cache-warmup.service.ts` | 极低；首次请求改成 lazy load |
| **0.3** `scoring_config:snapshot` 启动期 SET 改 lazy（仅在第一次读且 Redis 可用时写） | `recommendation/context/scoring-config.service.ts` | 极低 |
| **0.4** 高频 Cron 锁（`*/10`、`*/15`、`30 * * * *` 共 4 个）暂时**保留 Redis 锁但缩短 TTL**，避免重启时锁滞留 | 见 §1.3 | 极低 |
| **0.5** 把 `min-instances` 调整为 2（worker）/ 0–1（api），**减少滚动部署放大** | `scripts/deploy-cloudrun.sh` | 0 |
| **0.6** **强制冻结今晚到 Phase 1 上线前** 的非紧急部署（每次 revision 重启都会推高 Redis 请求） | 流程 | 0 |

预期效果：Upstash 日请求降 30–40%，恢复 SLA。

### Phase 1 — Redis 物理拆分（1–3 天）

**目标**：BullMQ 与缓存切到不同 Redis 实例，互不影响。**业务行为零变化**。

| Step | 动作 | 验证 |
|---|---|---|
| **1.1** 新增 env：`QUEUE_REDIS_URL`、`CACHE_REDIS_URL`，旧 `REDIS_URL` 作为 fallback | Secret Manager 同步 |
| **1.2** `core/queue/queue.module.ts` BullMQ 连接读 `QUEUE_REDIS_URL ?? REDIS_URL` | 单元 + 集成测试 |
| **1.3** `core/redis/redis-cache.service.ts` 读 `CACHE_REDIS_URL ?? REDIS_URL` | 同上 |
| **1.4** 准备第二个 Redis 实例（开新 Upstash DB 或 Memorystore） |  |
| **1.5** **先 staging 全量切换**（`QUEUE_REDIS_URL` = 新实例，`CACHE_REDIS_URL` = 老实例），观察 1–3 天 |  |
| **1.6** **生产灰度**：先把 `CACHE_REDIS_URL` 切到新 Cache 实例，观察 6h；再把 `QUEUE_REDIS_URL` 切到新 Queue 实例 | grafana / health check |

**回滚**：删除新 env，回到只有 `REDIS_URL` 的模式即可。

> 此 Phase 完成后，即使 BullMQ Redis 挂了，缓存/限流仍正常；反之亦然。

### Phase 2 — BullMQ → Cloud Tasks（每个队列单独迁，2–3 周）

**统一迁移模板**（每个队列重复一次，**双轨期 ≥ 24h**）：

```
[Step A] 新增 internal HTTP handler
   POST /internal/tasks/<queue-name>
     Header: X-Tasks-Token (固定 secret) + OIDC verify
     Body: { taskId, ...payload }
     幂等：先 INSERT task_execution_log ON CONFLICT DO NOTHING
     业务逻辑直接复用现有 Processor 的 process() 方法

[Step B] 新增 ProducerService 抽象
   QueueProducer.enqueue(queueName, payload, opts) →
     根据 feature flag QUEUE_BACKEND=tasks|bullmq|both
     - tasks: 调 Cloud Tasks API createTask
     - bullmq: 调 BullMQ queue.add()
     - both:  双发（仅供切换前对照验证，可选）

[Step C] 替换调用点
   原: this.foodAnalysisQueue.add('xxx', data, opts)
   新: this.queueProducer.enqueue('food-analysis', data, opts)

[Step D] 灰度切换
   1. 部署 Step A+B+C，QUEUE_BACKEND=bullmq（行为不变）
   2. 切 staging 到 QUEUE_BACKEND=tasks，跑 24h
   3. 生产先按 user 灰度（10% → 50% → 100%）
   4. 100% 后保留 BullMQ Processor 24h，消化剩余 job
   5. backlog=0 后，移除 Processor + InjectQueue + queue 注册

[Step E] 清理
   从 queue.module.ts 的 BullModule.registerQueue 删除该 queue
```

**迁移顺序**（按"风险低 → 风险高"）：

1. **`export`**（用户少、失败可重试） — 最先做，验证整套链路
2. **`food-enrichment`** / **`food-usda-import`** → 转 Cloud Run Jobs（这两个本质是 admin 触发的批处理）
3. **`embedding-generation`**（后台、用户无感）
4. **`recipe-generation`**（用户感知中等）
5. **`notification`**（用户感知高，但失败影响小）
6. **`food-analysis`**（用户感知最高，单独灰度更细 1% → 10% → ...）
7. **`subscription-maintenance`**（涉及计费，最后，且必须先把 §3.1 idempotency_key 表+幂等代码上线）
8. **`recommendation-precompute`** → fan-out 由 Cloud Run Job 完成（见 Phase 3）

每个队列迁完后，**单独发一个生产部署**，观察 24h，再做下一个。

### Phase 3 — @Cron → Cloud Scheduler（1–2 周）

**统一迁移模板**：

```
[Step A] 把 @Cron 方法重构成可手动触发的 service method（去掉装饰器、去掉 runWithLock）
   原:  @Cron(...) async fooDaily() { runWithLock(...) }
   新:  async runFooDaily() { /* 业务 */ }

[Step B] 选择目标
   - 轻任务：新增内部 HTTP endpoint  POST /internal/cron/foo-daily
            Scheduler → OIDC HTTP target 调它
   - 重任务：在 dist/cron-runner.ts 新增子命令
            node dist/cron-runner.js foo-daily
            Cloud Run Job 入口为这个；Scheduler 触发 Job execution

[Step C] feature flag CRON_LEGACY_DISABLED=true 时，原 @Cron 方法直接 return
   先部署 [A]+[C] 但 CRON_LEGACY_DISABLED=false（行为不变）
   创建 Scheduler；先观察 Scheduler + 原 @Cron 双跑 7 天（双跑期间任务必须幂等）
   验证 Scheduler 链路稳定后，开关 CRON_LEGACY_DISABLED=true（旧 cron 关闭）
   再观察 7 天，删除 @Cron 装饰器代码
```

**双跑期幂等**：所有 cron 任务都要实现"今天已经跑过就跳过"的语义。最简单的做法是把每个任务的"上次成功时间"写到 Postgres（`feature_flag` 表或新 `cron_execution_log` 表），双跑时第二次直接 noop。

**新增 cron-runner 入口**（复用现有镜像）：

```ts
// apps/api-server/src/cron-runner.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const TASKS = {
  'precompute-daily': (app) => app.get(PrecomputeService).runDailyPrecompute(),
  'cf-full-rebuild': (app) => app.get(CollaborativeFilteringService).fullRebuild(),
  // ...
};

async function main() {
  const taskName = process.argv[2];
  const fn = TASKS[taskName];
  if (!fn) { console.error('Unknown task', taskName); process.exit(1); }
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  try {
    await fn(app);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
main();
```

Dockerfile 不需要改，Cloud Run Job 用 `--command=node --args=dist/cron-runner.js,<task>`。

### Phase 4 — Redis 收敛（1 周，持续监控）

| 动作 | 影响 |
|---|---|
| 删除 `runWithLock` 调用全部 reference | 代码-200 行 |
| 删除 BullMQ 相关依赖 / queue.module / processor / dead-letter / queue-resilience | 代码-2k 行，依赖减少 |
| 删除 worker.ts + `eatcheck-worker` Cloud Run 服务（替换为按需 Cloud Run Job） | 月省 ~~$15+~~ + 稳定性提升 |
| `redis-cache.service.ts` 把 pub/sub createSubscriber 行为改成"按需创建"且默认禁用（`CACHE_INVALIDATE_PUBSUB_ENABLED=false`），靠 L1 TTL 兜底 | Redis 长连接-1 |
| Throttler / 业务 cache / 短 TTL 幂等保留 |  |

---

## 6. 代码改动清单（Phase 1+2+3 总览）

```
新增：
  apps/api-server/src/core/queue/cloud-tasks.client.ts            # Tasks API 封装
  apps/api-server/src/core/queue/queue-producer.service.ts        # 统一 Producer (tasks|bullmq|both)
  apps/api-server/src/core/queue/internal-task.controller.ts      # /internal/tasks/* HTTP 入口
  apps/api-server/src/core/queue/internal-task.guard.ts           # OIDC + X-Tasks-Token 校验
  apps/api-server/src/core/cron/internal-cron.controller.ts       # /internal/cron/*
  apps/api-server/src/core/cron/internal-cron.guard.ts            # OIDC + X-Cron-Token
  apps/api-server/src/cron-runner.ts                              # Run Job 子命令入口
  apps/api-server/prisma/migrations/<timestamp>_idempotency.sql   # idempotency_key + task_execution_log
  apps/api-server/src/core/idempotency/idempotency.service.ts     # 取代 setNX 用法

修改：
  core/redis/redis-cache.service.ts        # CACHE_REDIS_URL 支持；Phase 4 删除 runWithLock
  core/queue/queue.module.ts               # QUEUE_REDIS_URL 支持；Phase 4 整体删除
  各业务 service                           # InjectQueue → QueueProducer.enqueue
  各 @Cron service                         # 装饰器去除 + 提取 service method
  app.module.ts                            # Throttler 仍用 Redis；移除 worker-only 模块（Phase 4）

废弃：
  worker.ts                                # Phase 4 删除，按需用 Run Job
  core/queue/dead-letter.service.ts        # Cloud Tasks 自带 DLQ（重试穷尽后落 task_execution_log status=failed）
  core/queue/queue-resilience.service.ts   # 不再适用
```

---

## 7. 监控与告警

新增/调整：

- **Cloud Monitoring**：
  - `cloudtasks.googleapis.com/queue/depth` — 每个 queue 队列深度，>1000 告警
  - `cloudtasks.googleapis.com/api/request_count` — 投递失败数
  - `run.googleapis.com/job/completed_execution_count{result=failed}` — Job 失败
  - `cloudscheduler.googleapis.com/job/attempt_count{response_code!=200}` — Scheduler 失败
- **应用层指标**（Postgres 直接 query 暴露 /metrics）：
  - `task_execution_log` 中 status=failed 最近 1h 数量
  - `task_execution_log` 中 attempt > 1 数量（重试率）
  - `idempotency_key` 中 status=in_progress 且 created_at < now()-10min（卡死任务）
- **Redis 指标**：
  - cache hit rate
  - throttler 请求量
  - **删除** BullMQ 队列指标（迁出后）

---

## 8. 风险与回滚

| 风险 | 影响 | 缓解 / 回滚 |
|---|---|---|
| Cloud Tasks 投递延迟 > BullMQ | 用户感知慢 | Tasks 实测 P99 < 1s；保留 `QUEUE_BACKEND=bullmq` 开关 30 天，可一键回退 |
| `task_execution_log` 表膨胀 | DB 慢 | 7 天 TTL 清理 Job + 分区或定期归档 |
| 双轨期重复执行 | 业务异常 | 所有 task handler 必须查 `task_execution_log` 幂等；Cron 迁移期间靠 `cron_execution_log` 或业务字段（如 `subscription.last_processed_at`）兜底 |
| Scheduler 比 @Cron 时间漂移大 | 任务错峰 | 关键任务（quota-reset / subscription-expire）使用 `attemptDeadline` + `retryConfig`，并允许任务自身判断"漏跑追跑" |
| Phase 1 切 QUEUE_REDIS_URL 时 in-flight job 丢失 | 队列任务漏处理 | 切之前先把所有 queue drain 到 0（暂停 enqueue + 等 worker 消费完）；不行的话保留旧 worker 跑老 Redis 直到 backlog=0 |
| Cloud Tasks 配额 | 投递失败 | 默认 1M task/queue 已足够；按需申请提额 |

每个 Phase 都有独立的 env flag 控制，回滚 = 改 flag + 重新 deploy（< 5 min）。

---

## 9. 验收标准

| Phase | 验收 |
|---|---|
| Phase 0 | Upstash 日请求 < 200k；API p99 恢复到事件前水平 |
| Phase 1 | 关掉 cache redis，BullMQ 仍正常；关掉 queue redis，cache 仍正常 |
| Phase 2 | 每个 queue 迁完后 24h 内 task_execution_log 中 status=failed 占比 < 0.1%；BullMQ depth=0 持续 24h；旧 Processor 删除后无报错 |
| Phase 3 | 每个 cron 迁完后双跑期 7 天，Scheduler 成功率 = 100% 且与原 @Cron 业务结果一致；CRON_LEGACY_DISABLED=true 后无业务异常 7 天 |
| Phase 4 | Cache Redis 月请求量 < 旧值的 30%；强制断 Redis 测试，API 仅有缓存命中率下降，无 5xx |

---

## 10. 时间线

```
W1  Day 1     Phase 0 上线（当天）
W1  Day 2-3   Phase 1 staging 验证
W1  Day 4-5   Phase 1 生产灰度上线
W2            Phase 2: export, food-enrichment, food-usda-import 迁移
W3            Phase 2: embedding, recipe-generation, notification 迁移
W4            Phase 2: food-analysis（细灰度）+ subscription-maintenance 迁移
W5            Phase 3: 轻量 cron（HTTP target）批量迁移
W6            Phase 3: 重 cron（Run Job）批量迁移
W7            Phase 3: 双跑观察 + CRON_LEGACY_DISABLED=true
W8            Phase 4: 清理代码 + 关闭 worker 服务 + 文档归档
```

---

## 11. 附录：关键代码片段（Phase 2 模板）

### 11.1 QueueProducer 抽象

```ts
// apps/api-server/src/core/queue/queue-producer.service.ts
@Injectable()
export class QueueProducer {
  constructor(
    private readonly tasks: CloudTasksClient,
    private readonly bull: BullProducerLegacy,        // wraps existing @InjectQueue
    private readonly config: ConfigService,
  ) {}

  async enqueue<T>(queue: QueueName, payload: T, opts?: EnqueueOpts): Promise<void> {
    // 测试环境（dev / staging）默认 bullmq，生产灰度后切 tasks。
    // 即使生产配置错误也会 fallback 到 bullmq，避免一刀切失败。
    const backend = this.config.get<'tasks' | 'bullmq' | 'both'>(
      `QUEUE_BACKEND_${queue.toUpperCase().replace(/-/g, '_')}`,
      this.config.get('QUEUE_BACKEND_DEFAULT', 'bullmq'),
    );
    const taskId = opts?.taskId ?? randomUUID();
    if (backend === 'tasks' || backend === 'both') {
      await this.tasks.createTask(queue, { taskId, payload, opts });
    }
    if (backend === 'bullmq' || backend === 'both') {
      await this.bull.add(queue, { taskId, ...payload }, opts);
    }
  }
}
```

> 测试环境无需配置任何 `QUEUE_BACKEND_*` env，全部走 BullMQ。
> 生产环境逐个 queue 切 `tasks` 灰度上线。

### 11.2 Internal Task Handler

```ts
// apps/api-server/src/core/queue/internal-task.controller.ts
@Controller('internal/tasks')
@UseGuards(InternalTaskGuard)        // OIDC + X-Tasks-Token
export class InternalTaskController {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly foodAnalysis: FoodAnalysisProcessor, // 复用业务逻辑
    // ...
  ) {}

  @Post('food-analysis')
  async foodAnalysis(@Body() body: FoodAnalysisTask) {
    const taken = await this.idempotency.take('task:food-analysis', body.taskId);
    if (!taken) return { duplicate: true };
    try {
      await this.foodAnalysis.process(body);          // 现有 Processor.process() 直接复用
      await this.idempotency.complete('task:food-analysis', body.taskId);
    } catch (e) {
      await this.idempotency.fail('task:food-analysis', body.taskId, e);
      throw e;                                         // 让 Cloud Tasks 自动重试
    }
  }
}
```

### 11.3 Cloud Tasks 创建脚本（一次性 setup）

```bash
# scripts/setup-cloud-tasks.sh
PROJECT_ID=flutter-scaffold-4fd6c
REGION=us-east1
for q in food-analysis notification recipe-generation export embedding-generation food-enrichment subscription-maintenance; do
  gcloud tasks queues create $q \
    --project=$PROJECT_ID --location=$REGION \
    --max-dispatches-per-second=10 \
    --max-concurrent-dispatches=20 \
    --max-attempts=3 \
    --min-backoff=3s --max-backoff=300s
done
```

### 11.4 Scheduler 创建脚本

```bash
# scripts/setup-cloud-scheduler.sh
API_URL=https://eatcheck-api-xxxxxx.us-east1.run.app
SA=eatcheck-runtime@$PROJECT_ID.iam.gserviceaccount.com

# 轻任务：HTTP target
gcloud scheduler jobs create http cron-quota-reset \
  --schedule="0 * * * *" --time-zone=UTC \
  --uri="$API_URL/internal/cron/quota-reset" --http-method=POST \
  --oidc-service-account-email=$SA \
  --attempt-deadline=300s

# 重任务：Run Job target
gcloud scheduler jobs create http cron-precompute-daily \
  --schedule="0 7 * * *" --time-zone=UTC \
  --uri="https://run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/eatcheck-job-precompute:run" \
  --http-method=POST \
  --oauth-service-account-email=$SA \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
```

---

## 12. Open Questions

1. Cache Redis 是否要上 Memorystore（VPC connector 成本 vs Upstash 不确定性）？— **Phase 1 完成后再定**。
2. 是否保留 `dead-letter` 概念？Cloud Tasks 重试穷尽后默认丢弃；建议把"穷尽后"的 task 写入 `task_execution_log` 并加 admin 重放界面。
3. `recommendation-precompute` 的 fan-out 模式（一个 Job 触发 N 个 Tasks）需要在 Phase 2 末期做单独设计文档。

---

## 13. Production 部署序列（一次性 Cutover）

> 项目未上线，**不双轨**：production 直接切到 `QUEUE_BACKEND_DEFAULT=tasks` + `CRON_BACKEND=external`。
> worker 服务在 production 不再消费 BullMQ 队列（保留容器是为了便于回滚）。

### 前置确认

- `apps/api-server/.env.production` 末尾已包含新增段（参考本文档第 8 章）：
  - `CACHE_REDIS_URL`、`QUEUE_REDIS_URL`（QUEUE 在 tasks 模式下可留空）
  - `QUEUE_BACKEND_DEFAULT=tasks`、`CRON_BACKEND=external`、`ENFORCE_INTERNAL_AUTH=true`
  - `GCP_PROJECT_ID`、`CLOUD_TASKS_LOCATION=us-east1`
  - `CLOUD_TASKS_HANDLER_URL`、`CLOUD_TASKS_OIDC_SA_EMAIL`、`CLOUD_TASKS_OIDC_AUDIENCE`
  - `CLOUD_TASKS_INTERNAL_TOKEN`（共享 token，与 Scheduler/Tasks 注入值必须一致）
- IAM：Runtime SA `eatcheck-runtime@<project>.iam.gserviceaccount.com` 需要：
  - `roles/cloudtasks.enqueuer`（API server 入队）
  - `roles/run.invoker`（Scheduler/Tasks 调用 Cloud Run）
  - `roles/run.developer`（cron-runner Job 部署期）
  - `roles/secretmanager.secretAccessor`

### 落地命令（按顺序执行）

```bash
# 0. 编译验证
cd apps/api-server && npx tsc --noEmit -p tsconfig.json

# 1. 镜像构建（一份镜像，三处复用：api / worker / cron-runner）
./scripts/deploy-cloudrun.sh build

# 2. Secret Manager 同步（自动跳过 PUBLIC_KEYS）
./scripts/deploy-cloudrun.sh secrets

# 3. 数据库迁移（IdempotencyKey + TaskExecutionLog 新表）
./scripts/deploy-cloudrun.sh migrate

# 4. Cloud Tasks 9 个队列（幂等）
GCP_PROJECT_ID=flutter-scaffold-4fd6c \
CLOUD_TASKS_LOCATION=us-east1 \
  bash apps/api-server/scripts/setup-cloud-tasks.sh

# 5. 部署 Cloud Run service / job
./scripts/deploy-cloudrun.sh api      # eatcheck-api (HTTP)
./scripts/deploy-cloudrun.sh worker   # eatcheck-worker (常驻；tasks 模式下空跑兜底)
./scripts/deploy-cloudrun.sh cron     # eatcheck-cron-runner (Cloud Run Job, 重 cron 备用)

# 6. 取得 api 实际 URL，回填 production env / Secret Manager
API_URL=$(gcloud run services describe eatcheck-api --region=us-east1 \
  --format='value(status.url)')
echo "$API_URL"  # 例 https://eatcheck-api-xxxx-ue.a.run.app
# 把 CLOUD_TASKS_HANDLER_URL / CLOUD_TASKS_OIDC_AUDIENCE 都设为该值
# 写回 .env.production 后重新执行：
./scripts/deploy-cloudrun.sh secrets
./scripts/deploy-cloudrun.sh api      # 让新 env 生效

# 7. 创建 21 个 Cloud Scheduler Job（HTTP target → InternalCronController）
GCP_PROJECT_ID=flutter-scaffold-4fd6c \
CLOUD_SCHEDULER_LOCATION=us-east1 \
CLOUD_TASKS_HANDLER_URL="$API_URL" \
CLOUD_TASKS_OIDC_SA_EMAIL=eatcheck-runtime@flutter-scaffold-4fd6c.iam.gserviceaccount.com \
CLOUD_TASKS_INTERNAL_TOKEN=<同 production env 中的值> \
  bash apps/api-server/scripts/setup-cloud-scheduler.sh
```

### 验证清单（顺序执行）

1. **健康检查**：`curl $API_URL/api/health/live` → 200。
2. **Internal endpoint 鉴权**：`curl -X POST $API_URL/internal/cron/usage-archive` → 401（无 token / OIDC 时拒绝）。
3. **Scheduler 手动触发**：`gcloud scheduler jobs run usage-archive --location=us-east1` → Cloud Run logs 出现 `[InternalCronController] usage-archive triggered`，DB `task_execution_log` 多一条 `backend='cloud-scheduler', status='succeeded'`。
4. **Tasks enqueue**：在 admin 触发一次 food-analysis（或人为塞测试 payload），观察 `gcloud tasks queues describe food-analysis --location=us-east1` 的 `tasksCount` 暂时 +1，随后 `task_execution_log.backend='cloud-tasks'` 出现成功记录。
5. **重 cron 备用入口**：`gcloud run jobs execute eatcheck-cron-runner --update-env-vars=CRON_NAME=usage-archive --region=us-east1 --wait` 返回 0。

### 回滚预案

- **应急关闭新链路**：
  ```bash
  gcloud run services update eatcheck-api --region=us-east1 \
    --update-env-vars=QUEUE_BACKEND_DEFAULT=bullmq,CRON_BACKEND=inproc
  gcloud run services update eatcheck-worker --region=us-east1 \
    --update-env-vars=CRON_BACKEND=inproc
  ```
  然后**暂停**所有 Scheduler Job：
  ```bash
  for j in $(gcloud scheduler jobs list --location=us-east1 --format='value(name)'); do
    gcloud scheduler jobs pause "$(basename "$j")" --location=us-east1
  done
  ```
- 数据安全：`IdempotencyKey` / `TaskExecutionLog` 不影响业务表，回滚后保留即可。
- BullMQ 队列：tasks 模式下不消费但仍存在，回滚后立即恢复。

### 故障排查速查

| 症状 | 检查项 |
| --- | --- |
| Scheduler 401 | `CLOUD_TASKS_INTERNAL_TOKEN` 是否在 Cloud Run env 与 Scheduler header 完全一致；`ENFORCE_INTERNAL_AUTH` 是否被错误设为 false |
| Tasks 403 | Runtime SA 缺少 `roles/run.invoker`；OIDC `audience` 不等于 service URL |
| Cron 重复执行 | `CRON_BACKEND` 仍为 inproc，且 worker 还在跑；确认 `eatcheck-worker` 也已更新到 external |
| TaskExecutionLog 无写入 | `IdempotencyService` / `TaskExecutionLog` 迁移未跑；检查 Step 3 的 `migrate` 是否成功 |
| Upstash 仍然飙到 limit | 仍有未切换的写入路径；用 `MONITOR` 抓 5 分钟，定位 caller |

