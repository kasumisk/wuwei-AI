# 订阅功能开关与访问控制系统文档

> 最后更新: 2026-04-20

---

## 一、三种访问控制机制

系统共有三种控制用户访问受保护功能的机制，各自适用场景不同：

### 1. `@RequireSubscription(tier)` — 订阅等级硬门控

| 项目       | 说明                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 位置       | `subscription/app/guards/subscription.guard.ts`                      |
| 装饰器     | `@RequireSubscription(SubscriptionTier.PRO)`                         |
| 原理       | 查询 `user_subscriptions` 表，检查用户是否存在对应等级的激活订阅记录 |
| Admin 配置 | **无效** — 完全绕过 `subscription_plan.entitlements` JSONB           |
| 缺点       | 即使 Admin 在后台将某功能对免费用户开启，此守卫仍会拦截              |
| 错误码     | `403 SUBSCRIPTION_REQUIRED`                                          |

```ts
@Get('some-endpoint')
@RequireSubscription(SubscriptionTier.PRO)  // 必须有 PRO 订阅记录才能访问
async someEndpoint() {}
```

### 2. `@RequireFeature(feature)` — 权益功能开关门控（推荐）

| 项目       | 说明                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| 位置       | `subscription/app/guards/feature.guard.ts`                                                                |
| 装饰器     | `@RequireFeature(GatedFeature.FULL_DAY_PLAN)`                                                             |
| 原理       | 调用 `subscriptionService.getUserSummary()` → 读取 `entitlements` → `entitlementResolver.hasCapability()` |
| Admin 配置 | **有效** — 修改 `subscription_plan.entitlements` JSONB 后 5 分钟内生效                                    |
| 适用       | 能力级开关（布尔型 true/false）和计次类（数值 > 0 视为有权）                                              |
| 错误码     | `403 FEATURE_NOT_ENABLED`                                                                                 |

```ts
@Get('daily-plan')
@RequireFeature(GatedFeature.FULL_DAY_PLAN)  // 从权益配置判断，Admin 可动态控制
async getDailyPlan() {}
```

### 3. `QuotaGateService.checkAccess()` — 配额+能力内联门控

| 项目       | 说明                                                               |
| ---------- | ------------------------------------------------------------------ |
| 位置       | `subscription/app/services/quota-gate.service.ts`                  |
| 调用方式   | Controller 内部 `await this.quotaGateService.checkAccess({...})`   |
| 原理       | 计次类功能走 `QuotaService` 检查/扣减；能力类走 `hasCapability()`  |
| 返回值     | `AccessDecision { allowed, quotaConsumed, degradeMode, paywall? }` |
| 软付费墙   | 结合 `PaywallTriggerService` 记录转化漏斗并返回 `upgradeTeaser`    |
| Admin 配置 | **有效** — 权益配置影响配额上限和能力检查                          |

```ts
const access = await this.quotaGateService.checkAccess({
  userId: user.id,
  feature: GatedFeature.AI_TEXT_ANALYSIS,
  scene: 'food_text_analysis',
  consumeQuota: true,
});
if (!access.allowed) {
  return ResponseWrapper.error(access.paywall?.message, 403);
}
```

---

## 二、GatedFeature 功能开关全览

### 2.1 计次类功能（值为数字，走配额系统）

> 判断依据：`TIER_ENTITLEMENTS[FREE][feature]` 为 `number` 类型  
> 配额重置周期：**每日**（Cron 每小时扫描 `usage_quota.reset_at`）

| GatedFeature        | 功能名称     | FREE 默认 | PRO 默认 | PREMIUM 默认 |       重置周期       |
| ------------------- | ------------ | :-------: | :------: | :----------: | :------------------: |
| `recommendation`    | 智能推荐     |  3 次/天  |   无限   |     无限     |         每日         |
| `ai_image_analysis` | AI 图片分析  |  1 次/天  | 20 次/天 |     无限     |         每日         |
| `ai_text_analysis`  | AI 文本分析  |  3 次/天  |   无限   |     无限     |         每日         |
| `ai_coach`          | AI 教练对话  |  5 次/天  |   无限   |     无限     |         每日         |
| `analysis_history`  | 历史记录条数 |   3 条    |   无限   |     无限     | — (记录上限，非重置) |

> `UNLIMITED = -1`，`QuotaService.check()` 遇到 -1 直接放行。

### 2.2 能力级功能（值为 boolean，走开关检查）

| GatedFeature                | 功能名称                   | FREE 默认 | PRO 默认 | PREMIUM 默认 |
| --------------------------- | -------------------------- | :-------: | :------: | :----------: |
| `detailed_score`            | 详细评分                   |    ✅     |    ✅    |      ✅      |
| `advanced_explain`          | 高级解析说明               |    ✅     |    ✅    |      ✅      |
| `deep_nutrition`            | 深度营养拆解（微量营养素） |    ✅     |    ✅    |      ✅      |
| `personalized_alternatives` | 个性化替代建议             |    ✅     |    ✅    |      ✅      |
| `reports`                   | 周期性报告                 |    ✅     |    ✅    |      ✅      |
| `full_day_plan`             | 全天饮食计划               |    ❌     |    ✅    |      ✅      |
| `full_day_linkage`          | 全天计划联动               |    ❌     |    ❌    |      ✅      |
| `recipe_generation`         | 菜谱生成                   |    ❌     |    ❌    |      ✅      |
| `health_trend`              | 健康趋势分析               |    ❌     |    ❌    |      ✅      |
| `priority_ai`               | 优先 AI 推理               |    ❌     |    ❌    |      ✅      |
| `behavior_analysis`         | 行为画像/主动提醒          |    ❌     |    ✅    |      ✅      |
| `coach_style`               | 教练风格切换               |    ❌     |    ✅    |      ✅      |
| `advanced_challenges`       | 进阶挑战参与               |    ❌     |    ✅    |      ✅      |

### 2.3 混合型功能（值为 boolean | string）

| GatedFeature  | 功能名称 |        FREE         |   PRO   |    PREMIUM    |
| ------------- | -------- | :-----------------: | :-----: | :-----------: |
| `data_export` | 数据导出 | `false`（不可导出） | `'csv'` | `'pdf_excel'` |

> `hasCapability()` 对 `string` 类型返回 `true`（非空字符串视为有权）。

---

## 三、各端点访问控制方式汇总

### 3.1 食物分析模块 (`food-analyze.controller.ts`)

| 端点                             | 控制方式       | GatedFeature        | 说明                               |
| -------------------------------- | -------------- | ------------------- | ---------------------------------- |
| `POST /app/food/analyze-text`    | QuotaGate 内联 | `AI_TEXT_ANALYSIS`  | 计次扣减 + 软付费墙                |
| `POST /app/food/analyze` (图片)  | QuotaGate 内联 | `AI_IMAGE_ANALYSIS` | 计次扣减 + 软付费墙                |
| `GET /app/food/analysis/history` | QuotaGate 内联 | `ANALYSIS_HISTORY`  | 仅检查，不扣减，按条数限制         |
| `GET /app/food/analysis/:id`     | —              | —                   | 仅验证归属，按订阅等级裁剪结果字段 |

> **结果裁剪**：所有分析结果经 `ResultEntitlementService.trimResult()` 处理，根据 `DEEP_NUTRITION` / `PERSONALIZED_ALTERNATIVES` / `ADVANCED_EXPLAIN` 三个开关决定是否返回微量营养素、替代建议和高级说明。

### 3.2 饮食计划模块 (`food-plan.controller.ts`)

| 端点                                   | 控制方式          | GatedFeature    | 说明                   |
| -------------------------------------- | ----------------- | --------------- | ---------------------- |
| `GET /app/food/daily-plan`             | `@RequireFeature` | `FULL_DAY_PLAN` | Admin 可为免费用户开启 |
| `POST /app/food/daily-plan/adjust`     | `@RequireFeature` | `FULL_DAY_PLAN` | 同上                   |
| `POST /app/food/daily-plan/regenerate` | `@RequireFeature` | `FULL_DAY_PLAN` | 同上                   |
| `GET /app/food/meal-suggestion`        | —                 | —               | 无门控                 |
| `GET /app/food/weekly-plan`            | —                 | —               | 无门控                 |

### 3.3 行为建模模块 (`food-behavior.controller.ts`)

| 端点                               | 控制方式          | GatedFeature        | 说明                            |
| ---------------------------------- | ----------------- | ------------------- | ------------------------------- |
| `GET /app/food/behavior-profile`   | `@RequireFeature` | `BEHAVIOR_ANALYSIS` | 已迁移自 `@RequireSubscription` |
| `GET /app/food/proactive-check`    | `@RequireFeature` | `BEHAVIOR_ANALYSIS` | 已迁移自 `@RequireSubscription` |
| `POST /app/food/decision-feedback` | —                 | —                   | 无门控（所有用户均可反馈）      |

### 3.4 AI 教练模块 (`coach.controller.ts`)

| 端点                                        | 控制方式          | GatedFeature  | 说明                                                   |
| ------------------------------------------- | ----------------- | ------------- | ------------------------------------------------------ |
| `POST /app/coach/chat`                      | —                 | —             | SSE 流式，无门控（AI_COACH 配额由 QuotaGate 内联控制） |
| `GET /app/coach/conversations`              | —                 | —             | 无门控                                                 |
| `GET /app/coach/conversations/:id/messages` | —                 | —             | 无门控                                                 |
| `GET /app/coach/daily-greeting`             | —                 | —             | 无门控                                                 |
| `PUT /app/coach/style`                      | `@RequireFeature` | `COACH_STYLE` | 已迁移自 `@RequireSubscription`                        |

### 3.5 游戏化模块 (`gamification.controller.ts`)

| 端点                            | 控制方式          | GatedFeature          | 说明                            |
| ------------------------------- | ----------------- | --------------------- | ------------------------------- |
| `GET /app/challenges`           | —                 | —                     | 无门控（查看列表均可）          |
| `POST /app/challenges/:id/join` | `@RequireFeature` | `ADVANCED_CHALLENGES` | 已迁移自 `@RequireSubscription` |
| `GET /app/streak`               | —                 | —                     | 无门控                          |

---

## 四、Admin 配置生效路径

```
Admin 后台修改 subscription_plan.entitlements (JSONB)
    ↓
数据库 subscription_plan 表更新
    ↓
TieredCacheManager 命中旧缓存（最长 5 分钟）
    ↓ (缓存过期后)
subscriptionService.getUserSummary() 重新读取
    ↓
PlanEntitlementResolver.resolve(tier, dbEntitlements)
  → 将 DB JSONB 覆盖合并到 TIER_ENTITLEMENTS 硬编码默认值
    ↓
FeatureGuard / QuotaGateService / ResultEntitlementService 使用新值
```

**关键说明**：

- `buildUserSummary()` 对免费用户会查询 `subscription_plan WHERE tier='free'` 的 DB 记录，获取其 `entitlements` JSONB 作为覆盖值
- `PlanEntitlementResolver.resolve()` 合并逻辑：DB 值优先，DB 未设置的字段降级为 `TIER_ENTITLEMENTS` 硬编码默认值
- **`@RequireSubscription` 不走此路径**，Admin 配置对其无效

---

## 五、配额系统说明

### 5.1 数据库表

```
usage_quota
  - userId
  - feature (GatedFeature)
  - used (已用次数)
  - limit (上限，来自 entitlements，-1=无限)
  - cycle (daily | weekly | monthly)
  - resetAt (下次重置时间)
```

### 5.2 重置机制

- Cron 任务每小时执行一次，查找 `resetAt <= now` 的记录
- 按 `cycle` 分组批量 `UPDATE`（同一 cycle 类型一次 `updateMany`）
- 重置后设置下一个 `resetAt`：
  - `daily` → 明天 00:00
  - `weekly` → 下周一 00:00
  - `monthly` → 下月 1 日 00:00

### 5.3 check/increment 分离设计

```
check(userId, feature)     → 只读，返回 boolean
increment(userId, feature) → 写入，消耗一次配额
```

业务代码先 check 再 increment，避免预扣导致回滚复杂度。`QuotaGateService.checkAccess({ consumeQuota: false })` 可仅检查不消耗。

---

## 六、付费墙触发机制

### 6.1 硬付费墙（阻断请求）

- 触发条件：配额耗尽（计次类功能 `used >= limit`）
- 处理流程：`QuotaGateService` → `PaywallTriggerService.handleAccessDecision()` → 记录 `subscription_trigger_logs` → 返回 `403 + EnhancedPaywallDisplay`
- 前端收到：`{ paywall: { code, message, recommendedTier } }` 用于弹出升级弹窗

### 6.2 软付费墙（降级返回）

- 触发条件：用户有访问权但分析结果被裁剪（如免费用户的深度营养字段被隐藏）
- 处理流程：`ResultEntitlementService.trimResult()` → `entitlement.fieldsHidden` 记录被隐藏字段 → 异步触发 `PaywallTriggerService.recordResultTrimTrigger()`
- 前端收到：完整结构但部分字段为 `null/[]` + `entitlement.fieldsHidden` 提示升级

---

## 七、遗留问题 / 建议

| 问题                                | 现状                                         | 建议                                                                     |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| `@RequireSubscription` 硬绑定等级   | 所有使用处已迁移到 `@RequireFeature`         | 可删除 `subscription.guard.ts` 和 `require-subscription.decorator.ts`    |
| `coach/chat` 无 AI_COACH 配额检查   | 免费用户可无限聊天                           | 在 SSE 流开始前加 `quotaGateService.checkAccess({ consumeQuota: true })` |
| `analysis_history` 历史记录限制逻辑 | 在 Controller 内手动读取 `entitlements` 判断 | 可提取为 `@RequireFeature(ANALYSIS_HISTORY)` + 服务内做分页              |
| 缓存时长 5 分钟                     | Admin 改完等 5 分钟才生效                    | 可增加 Admin 手动清除指定用户缓存的接口                                  |
