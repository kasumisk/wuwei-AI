# 智能饮食系统 V6.4 升级方案

> 基于 V6.3 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-11

---

## 目录

- [[#Step 1：V6.3 能力评估]]
- [[#Step 2：核心升级方向]]
- [[#Step 3：架构升级设计]]
- [[#Step 4：模块级升级设计]]
- [[#Step 5：技术路线图]]
- [[#Step 6：数据迁移]]
- [[#Step 7：文档差异]]

---

## Step 1：V6.3 能力评估

### 1.1 已具备能力（V6.3 达成状态）

| 能力域   | V6.3 现状                                                            | 成熟度 |
| -------- | -------------------------------------------------------------------- | ------ |
| 用户画像 | 5 层统一聚合（ProfileResolverService），死数据已激活，运动场景已实现 | 高     |
| 推荐引擎 | 10 维评分 + 12 层 Boost + 策略驱动 + 菜谱模式 + 冷启动               | 高     |
| 菜谱系统 | Recipe 实体 + AI 批量生成 + 评分推荐 + UGC 提交（待审核）            | 中     |
| 缓存机制 | L1 内存 + L2 Redis + 食物池分片 + 预计算 + TieredCacheManager        | 高     |
| 营养评分 | 12 维 AI 分析 + 个性化 NRF 9.3 + GI 三因素估算 + NOVA 单品化         | 高     |
| 策略系统 | 4 套预设策略 + 分群自动映射 + A/B 实验配置合并 + 8 维策略参数        | 中高   |
| 协同过滤 | 增量更新（Mon-Sat） + 全量重建（Sunday），双模式融合                 | 中高   |
| 行为推断 | 合规率/时段/暴食风险/份量趋势/分群驱动策略切换                       | 中高   |
| 解释系统 | 单食物 + 整餐 + 反向 + 雷达图 + i18n（zh/en/ja）+ A/B 风格测试       | 高     |
| 决策系统 | 过敏原前置 + 多维评分 + AI 建议 + 5 层健康修正                       | 中高   |
| 食物分析 | 文本 + 图片双链路 + 12 维营养素 + 候选食物管道                       | 高     |
| 订阅系统 | Free/Pro/Premium + Apple IAP + 微信支付 + 配额（批量重置）           | 高     |
| 性能     | 周计划并行 + CF 增量 + Redis 原子操作 + 事件驱动预计算               | 中高   |
| A/B 实验 | 实验引擎 + 卡方检验 + 策略实验 + 解释风格实验                        | 中     |
| 区域化   | food_regional_info 表 + 可用性加权 + region_code 过滤                | 中     |

### 1.2 核心问题诊断

以下问题基于对 V6.3 代码的深度审计发现，按严重程度排序：

#### P0：安全与生产就绪性（阻塞上线）

| 问题               | 具体表现                                                                                        | 影响                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| JWT 密钥硬编码回退 | `app-jwt.strategy.ts:22` — `process.env.JWT_SECRET \|\| 'your-secret-key-change-in-production'` | **CRITICAL**：环境变量缺失时任何人可伪造 token |
| SMS 万能验证码     | `sms.service.ts:7` — `UNIVERSAL_CODE = '888888'`，`verifyCode()` 始终接受此码                   | **CRITICAL**：绕过全部短信验证                 |
| 验证白名单关闭     | `main.ts:22` — `whitelist: false, forbidNonWhitelisted: false`                                  | **HIGH**：允许 Mass Assignment 攻击            |
| 验证错误泄露       | `main.ts:29-30` — `target: true, value: true`                                                   | **HIGH**：错误响应暴露 DTO 结构和原始输入      |
| CORS 全开          | `main.ts:40` — `app.enableCors()` 无域名限制                                                    | **HIGH**：任意域名可发起认证请求               |
| 无优雅关机         | `main.ts` 缺少 `enableShutdownHooks()`                                                          | **HIGH**：重启时 BullMQ 任务可能丢失           |
| 无请求体大小限制   | `main.ts` 未配置 body parser limit                                                              | **MEDIUM**：大 payload DoS 攻击向量            |

#### P1：工程健壮性

| 问题                | 具体表现                                                                            | 影响                             |
| ------------------- | ----------------------------------------------------------------------------------- | -------------------------------- |
| 异常过滤器重复注册  | `AllExceptionsFilter` 同时在 `CoreModule:23` 和 `AppModule:100` 注册为 `APP_FILTER` | 每个异常被处理两次，日志重复     |
| 限流器名冲突        | `StrictThrottle` 使用 `AI_HEAVY` 相同 tier 名称 (`throttle.constants.ts:87`)        | 不同限流装饰器共享计数器         |
| 健康检查不完整      | `health.controller.ts` 只检查 DB，不检查 Redis、BullMQ 队列                         | Redis 故障时系统静默降级         |
| 无监控指标          | 无 Prometheus/APM，唯一可观测性是日志                                               | 无法监控延迟、缓存命中率、错误率 |
| 日志无轮转          | Winston 文件 transport 无 size limit 和 rotation                                    | 生产环境磁盘无限增长             |
| Redis 单连接        | `RedisCacheService` 全局共享一个 `createClient()`                                   | 高并发时成为瓶颈                 |
| Prisma 连接池未调优 | `PrismaService` 无 constructor 参数，使用默认连接数                                 | 生产环境下连接不足或浪费         |
| Cron 3AM 重叠       | `daily-precompute`(3AM) + `weekly-segment`(Mon 3AM) 可同时运行                      | 数据库压力叠加                   |
| SMS 内存存储        | 验证码存在进程内存（`Map`），重启丢失，多实例不共享                                 | 不支持水平扩展                   |

#### P2：推荐与体验层

| 问题                        | 具体表现                                                                | 影响                                       |
| --------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| 健康修正无缓存              | `health-modifier-engine.service.ts` 5 层管道每食物每请求重算            | 重复计算，单次推荐可能触发 200+ 次健康修正 |
| 配额状态查询逐条重置        | `quota.service.ts:166` — `getAllQuotaStatus()` 在查询时逐条重置过期配额 | 查询变成写操作，性能浪费                   |
| 菜谱 quality_score 非自动化 | 仅 Admin API 触发计算，创建/更新时不自动评分                            | AI 生成的菜谱无质量分数直到人工触发        |
| exerciseSchedule DTO 缺失   | 字段存在于 DB 和 Schema，但 `UpdateDeclaredProfileDto` 未暴露           | 用户无法通过 API 设置运动计划              |
| 图片分析 prompt 标注错误    | prompt 称"必须返回（6维）"但实际只列了 4 项必须                         | 轻微：可能导致 AI 不确定哪些是必须字段     |
| 区域食物数据稀疏            | `food_regional_info` 覆盖率未知，无数据的食物统一 0.7x rare 惩罚        | 误惩罚仅缺少区域数据（非真正稀有）的食物   |
| 菜谱无 i18n                 | `food_translations` 表存在但 `recipe_translations` 不存在               | 菜谱无法国际化                             |

#### P3：架构可扩展性

| 问题                         | 具体表现                                       | 影响                              |
| ---------------------------- | ---------------------------------------------- | --------------------------------- |
| 无场景化推荐入口             | 推荐引擎统一入口，无"外卖/做饭/便利店"场景参数 | 用户无法根据获取渠道获取推荐      |
| 策略 A/B 使用浅              | `EXPERIMENT` scope 已定义但无实验分配流程      | 策略优化无数据驱动闭环            |
| 食物获取渠道缺失             | 无"外卖可点"/"超市可买"/"便利店可得"标签       | 推荐结果可执行性不确定            |
| 无推荐效果归因               | 推荐点击/采纳后无法追踪到具体策略+分群的贡献   | 无法评估哪个策略/分群组合效果最好 |
| 无联邦学习/边缘计算          | 所有计算集中在服务端                           | 冷启动和实时性受限于网络延迟      |
| 菜谱 AI 生成模型单一         | 仅 `baidu/ernie-4.5-8k`，中文导向              | 非中餐菜谱质量可能较低            |
| 无食物时令/季节感知          | `seasonal` 标签存在但无自动化时令判断          | 推荐冬天的西瓜、夏天的羊肉        |
| Thompson Sampling 无收敛监控 | Beta 参数更新无可视化，无法判断探索是否已充分  | 无法知道何时降低探索率            |

---

## Step 2：核心升级方向

基于以上诊断，确定 **8 个核心升级点**：

### 升级点 1：生产安全加固 — 从"可用"到"可上线"

**为什么需要：** P0 中 7 项安全/生产就绪性问题直接阻塞上线。系统功能完善但安全防线全开，等于没有防线。

**解决什么问题：**

- JWT 密钥硬编码 → 启动时强制校验环境变量
- SMS 万能码 → 环境感知，生产环境禁用
- 验证白名单 → 启用 whitelist + forbidNonWhitelisted
- CORS → 白名单域名配置
- Body size → 限制 10MB
- 优雅关机 → enableShutdownHooks + BullMQ graceful drain
- 异常过滤器 → 去重注册

---

### 升级点 2：场景化推荐 — 从"推荐什么吃"到"在哪吃什么"

**为什么需要：** 用户的饮食场景决定了可获取性。在家做饭、点外卖、便利店买、食堂吃，每个场景的食物/菜谱候选集完全不同。当前推荐引擎不区分获取渠道。

**解决什么问题：**

- 推荐了用户在当前场景下无法获取的食物/菜谱
- 菜谱推荐了复杂菜但用户想点外卖
- 便利店场景下推荐原料毫无意义
- `canCook` / `takeoutFrequency` 数据已有但仅影响菜谱难度，未影响获取渠道

**具体改动：**

1. 新增 `AcquisitionChannel` 枚举：`home_cook`（自己做）、`takeout`（外卖）、`canteen`（食堂）、`convenience`（便利店）、`restaurant`（餐厅）
2. 推荐请求新增可选参数 `channel?: AcquisitionChannel`，无传入时自动推断（基于 canCook + 时段 + takeoutFrequency）
3. 食物/菜谱新增 `available_channels` 标签字段
4. 召回阶段按 channel 过滤候选池
5. 排序阶段：当前 channel 的可获取性作为新的评分维度

---

### 升级点 3：食物时令与季节感知 — 让推荐符合自然节律

**为什么需要：** 当前 `food_regional_info.availability` 仅有 `common/seasonal/rare` 静态标签，无季节性判断。系统可能在冬天推荐西瓜、夏天推荐羊肉。

**解决什么问题：**

- 推荐反季食物，用户觉得不合理
- 季节性食物无价格/新鲜度调整
- 时令蔬果的营养优势未体现

**具体改动：**

1. `food_regional_info` 新增 `peak_months: int[]` 字段（如 `[6,7,8]` 表示夏季当季）
2. 新增 `SeasonalityService`：根据当前月份 + 食物 `peak_months` 计算时令分数
3. 时令分数注入 `FoodScorer` 作为第 11 维评分 `seasonality`
4. 当季食物 +10% 分数，反季食物 -15% 分数
5. 季节变化时自动失效相关食物池缓存

---

### 升级点 4：推荐效果归因与闭环 — 从"推了就完"到"推了能学"

**为什么需要：** V6.3 有 A/B 实验引擎 + 策略系统 + 反馈收集，但三者未形成闭环。无法回答"哪个策略对哪类用户效果最好"。

**解决什么问题：**

- 策略优化靠人工判断，非数据驱动
- 推荐采纳后无法归因到策略+分群组合
- A/B 实验覆盖面窄，仅解释风格
- Thompson Sampling 的 Beta 参数更新无可视化

**具体改动：**

1. 推荐结果新增 `recommendation_trace`：记录 `{strategyName, segmentName, channelUsed, experimentId, recallSource}`
2. 反馈提交时将 trace 信息一并记录到 `recommendation_feedback` 表
3. 新增 `StrategyEffectivenessService`：按 (strategy × segment × channel) 维度聚合采纳率/替换率/跳过率
4. Admin 仪表盘新增"策略效果矩阵"页面
5. 基于效果矩阵，支持手动调整分群→策略映射（或自动优化）
6. Thompson Sampling 收敛可视化：Admin 可查看每个食物的 alpha/beta 参数分布

---

### 升级点 5：健康修正缓存 + 推荐管道性能优化

**为什么需要：** 健康修正是推荐管道中最重的计算之一（5 层管道 × 每个候选食物），但完全无缓存。一次推荐请求可能触发 200+ 次健康修正计算，其中大量是重复的。

**解决什么问题：**

- 单次推荐延迟中健康修正占比过大
- 同一用户（健康画像不变时）对同一食物的修正结果稳定，可缓存
- 配额查询触发写操作（`getAllQuotaStatus` 逐条重置）

**具体改动：**

1. 健康修正请求级缓存：`Map<foodId_healthHash, modifier>` 在单次推荐请求生命周期内共享
2. 健康修正 L2 缓存：用户健康画像 hash + 食物 ID 作为 key，TTL 随画像变更失效
3. `getAllQuotaStatus` 去除内联重置逻辑，改为读取 + 标记需重置的 quota IDs，由 Cron 统一重置
4. 菜谱 `quality_score` 自动化：创建/更新时自动触发评分计算（BullMQ 异步）

---

### 升级点 6：可观测性体系 — 从"只有日志"到"全链路可观测"

**为什么需要：** 当前系统唯一的可观测性手段是 Winston 日志，无 metrics、无 trace、无 dashboard。生产环境无法回答"推荐平均延迟多少""缓存命中率多少""哪个 Cron 最慢"。

**解决什么问题：**

- 无法量化推荐性能
- 无法发现慢查询/瓶颈
- 缓存策略调优无数据支撑
- 故障定位靠看日志 grep

**具体改动：**

1. 集成 Prometheus 指标（`@willsoto/nestjs-prometheus` 或自建）：
   - HTTP 请求延迟直方图（按 endpoint）
   - 推荐管道各阶段耗时（recall / rank / rerank / assemble）
   - 缓存命中率（L1 / L2）
   - BullMQ 队列深度 + 处理耗时
   - Cron 执行耗时 + 成功/失败计数
2. 健康检查增强：新增 Redis 连通性 + BullMQ 队列健康
3. 日志轮转：Winston `DailyRotateFile` transport，7 天保留
4. 暴露 `/metrics` 端点供 Grafana 采集

---

### 升级点 7：基础设施加固 — 连接池 + Redis 集群 + 请求上下文

**为什么需要：** Prisma 连接池使用默认值，Redis 全局单连接，SMS 验证码存内存。这些在低并发下不是问题，但上线后用户量增长时会逐一暴露。

**解决什么问题：**

- Prisma 连接数不可控
- Redis 单连接高并发排队
- SMS 验证码多实例不共享
- 请求上下文在异步操作中可能丢失

**具体改动：**

1. Prisma 连接池配置化：通过环境变量控制 `connection_limit` 和 `pool_timeout`
2. Redis 连接池：引入 `generic-pool` 或 `ioredis` 的内置连接池（多连接模式）
3. SMS 验证码迁移到 Redis：`SET sms:{phone} {code} EX 300`，支持多实例 + 自动过期
4. Cron 执行分散：将 3AM 集中的 Cron 分散到 2:00-5:00 不同时间段

---

### 升级点 8：菜谱生态增强 — 从"有菜谱"到"菜谱好用"

**为什么需要：** V6.3 引入了菜谱模块但仍处于早期：质量评分非自动化、AI 生成模型单一、无 i18n、区域食物数据稀疏导致误惩罚。

**解决什么问题：**

- AI 生成的菜谱无自动质量把关
- 仅 ERNIE 生成，非中餐菜谱质量可能差
- 无区域食物数据的食物被错误标记为 rare
- 菜谱无翻译支持

**具体改动：**

1. 菜谱创建/更新时自动触发 `quality_score` 计算（via BullMQ）
2. 低质量菜谱自动标记 `review_status: needs_review`（quality_score < 40）
3. AI 生成支持模型路由：中餐用 ERNIE，西餐/日料用 DeepSeek 或 GPT
4. `recipe_translations` 表新增，与 `food_translations` 结构一致
5. 区域食物默认可用性从 `rare`(0.7x) 改为 `unknown`(1.0x) — 无数据不惩罚
6. `exerciseSchedule` 暴露到 `UpdateDeclaredProfileDto`

---

## Step 3：架构升级设计

### V6.4 架构变更图

```
V6.3 架构：
┌──────────────────────────────────────────────────────────────┐
│                        推荐引擎                               │
│  ProfileResolver → StrategySelector → Recall → Rank → Assemble │
│       ↑                    ↑           ↑       ↑        ↑     │
│  5层画像统一           4套策略      食物+菜谱  12层Boost  菜谱模式│
│                                                              │
│  NutritionTargetService  │  ExplanationGenerator（含整餐）     │
│  个性化RDA+NRF9.3       │  i18n（zh/en/ja）                   │
└──────────────────────────────────────────────────────────────┘

V6.4 架构（新增/变更用 ★ 标记）：
┌──────────────────────────────────────────────────────────────┐
│                        推荐引擎                               │
│  ProfileResolver → StrategySelector → Recall → Rank → Assemble │
│       ↑                    ↑           ↑       ↑        ↑     │
│  5层画像统一           4套策略    ★ 按Channel ★ 11维评分  菜谱模式│
│                        ↑          过滤    (+时令)             │
│                   ★ 效果归因                                  │
│                   ★ 自动优化                                  │
│                                                              │
│  NutritionTargetService  │  ExplanationGenerator（含整餐）     │
│  个性化RDA+NRF9.3       │  i18n（zh/en/ja）                   │
│                          │                                    │
│  ★ 健康修正缓存          │  ★ RecommendationTrace 记录        │
│  ★ SeasonalityService    │  ★ StrategyEffectivenessService    │
└──────────────────────────────────────────────────────────────┘

★ 新增横切层：
┌──────────────────────────────────────────────────────────────┐
│                    生产安全 & 可观测性                          │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ SecurityHarden │  │ Prometheus  │  │ HealthCheck+     │  │
│  │ (JWT/CORS/     │  │ Metrics     │  │ (DB+Redis+Queue) │  │
│  │  Validation/   │  │ (延迟/命中率│  │                  │  │
│  │  BodyLimit)    │  │  /队列深度) │  │                  │  │
│  └────────────────┘  └─────────────┘  └──────────────────┘  │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────┐  │
│  │ GracefulShutdn │  │ LogRotation │  │ Redis Pool       │  │
│  │ (BullMQ drain) │  │ (7-day keep)│  │ + Prisma Pool    │  │
│  └────────────────┘  └─────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 新增模块/服务清单

| 模块/服务                      | 类型                                | 职责                                      |
| ------------------------------ | ----------------------------------- | ----------------------------------------- |
| `SeasonalityService`           | Service（注入 DietModule）          | 基于月份+地区+食物peak_months计算时令分数 |
| `StrategyEffectivenessService` | Service（注入 DietModule）          | 按 strategy×segment×channel 聚合推荐效果  |
| `HealthModifierCache`          | 缓存层（注入 HealthModifierEngine） | 请求级 + L2 健康修正结果缓存              |
| `PrometheusModule`             | 新 NestJS Module                    | Prometheus 指标收集 + /metrics 端点       |
| `recipe_translations`          | Prisma Model                        | 菜谱多语言翻译                            |

### 修改的已有模块

| 模块                                                 | 变更点                                           |
| ---------------------------------------------------- | ------------------------------------------------ |
| `recommendation-engine.service.ts`                   | 新增 channel 参数 + recommendation_trace 记录    |
| `food-scorer.service.ts`                             | 新增第 11 维 seasonality 评分                    |
| `food-pool-cache.service.ts`                         | 按 channel 过滤候选池 + 季节变化缓存失效         |
| `health-modifier-engine.service.ts`                  | 注入缓存层                                       |
| `food.dto.ts`                                        | 推荐请求新增 channel 参数                        |
| `quota.service.ts`                                   | getAllQuotaStatus 去除内联重置                   |
| `recipe.service.ts` / `recipe-generation.service.ts` | 自动 quality_score + 模型路由                    |
| `preference-profile.service.ts`                      | 区域无数据默认 1.0x（非 0.7x）                   |
| `main.ts`                                            | 安全加固全部改动                                 |
| `app.module.ts`                                      | 去重 AllExceptionsFilter + 新增 PrometheusModule |
| `core.module.ts`                                     | 去除 AllExceptionsFilter 注册                    |
| `health.controller.ts`                               | 新增 Redis + BullMQ 检查                         |
| `throttle.constants.ts`                              | 修复 StrictThrottle tier 名冲突                  |
| `user-profile.dto.ts`                                | 暴露 exerciseSchedule                            |
| `sms.service.ts`                                     | 验证码迁移到 Redis + 环境感知万能码              |
| `recommendation-event.listener.ts`                   | 新增 trace 信息记录                              |
| `feedback.service.ts`                                | 反馈关联 trace 信息                              |

---

## Step 4：模块级升级设计

### 4.1 Profile 模块（用户画像）

**目标：修复 DTO 缺口 + 增强获取渠道推断**

#### 4.1.1 exerciseSchedule DTO 暴露

```typescript
// dto/user-profile.dto.ts — UpdateDeclaredProfileDto 新增
@IsOptional()
@IsObject()
@ApiProperty({
  description: '每周运动计划',
  example: { mon: { startHour: 7, durationHours: 1, type: 'cardio' } },
  required: false,
})
exerciseSchedule?: Record<string, { startHour: number; durationHours: number; type?: string }>;
```

**改动文件：** `user/app/dto/user-profile.dto.ts`

#### 4.1.2 AcquisitionChannel 推断

```typescript
// contextual-profile.service.ts 新增
inferAcquisitionChannel(
  profile: DeclaredProfile,
  hour: number,
  dayOfWeek: number,
): AcquisitionChannel {
  // 1. 检查用户是否主动指定
  // （由推荐请求参数传入，此处仅处理未指定的情况）

  // 2. 时段 + 用户属性推断
  if (!profile.canCook || profile.cookingSkillLevel <= 1) {
    return 'takeout'; // 不会做饭 → 外卖/食堂
  }

  if (hour >= 6 && hour <= 9) {
    return 'home_cook'; // 早餐大概率在家
  }

  if (dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 11 && hour <= 13) {
    // 工作日午餐
    return profile.takeoutFrequency >= 3 ? 'takeout' : 'canteen';
  }

  if (profile.takeoutFrequency >= 5) {
    return 'takeout'; // 高频外卖用户
  }

  return 'home_cook'; // 默认在家做
}
```

#### 4.1.3 EnrichedProfileContext 扩展

```typescript
// recommendation.types.ts
interface EnrichedProfileContext {
  // ... 已有 5 层
  inferred: {
    // ... 已有字段
    suggestedChannel: AcquisitionChannel; // ★ V6.4 新增
  };
}
```

---

### 4.2 Recommendation 模块

**目标：场景化推荐 + 效果归因 + 健康修正缓存**

#### 4.2.1 场景化推荐 — Channel 参数

```typescript
// food.dto.ts — GenerateDailyPlanDto 新增
@IsOptional()
@IsEnum(AcquisitionChannel)
@ApiProperty({
  description: '获取渠道（不传则自动推断）',
  enum: AcquisitionChannel,
  required: false,
})
channel?: AcquisitionChannel;

// AcquisitionChannel 枚举
enum AcquisitionChannel {
  HOME_COOK = 'home_cook',     // 自己做饭
  TAKEOUT = 'takeout',         // 外卖
  CANTEEN = 'canteen',         // 食堂
  CONVENIENCE = 'convenience', // 便利店
  RESTAURANT = 'restaurant',   // 餐厅
}
```

#### 4.2.2 Channel 影响召回

```typescript
// recommendation-engine.service.ts — recall 阶段
async recallCandidates(
  profile: EnrichedProfileContext,
  channel: AcquisitionChannel,
  strategy: ResolvedStrategy,
): Promise<ScoredFood[]> {
  // 1. 食物池按 channel 过滤
  const pool = await this.foodPoolCache.getPool(
    profile.declared.regionCode,
    channel, // ★ V6.4: 按渠道过滤
  );

  // 2. Channel 影响召回策略
  switch (channel) {
    case 'home_cook':
      // 优先菜谱，食材可获取性高
      break;
    case 'takeout':
      // 优先外卖平台已有菜品，按地区热门
      break;
    case 'convenience':
      // 仅预包装食品 + 即食食品
      // 食物库标签 available_channels 包含 convenience
      break;
    case 'canteen':
      // 食堂常见菜品，份量固定
      break;
    case 'restaurant':
      // 菜谱为主，不限难度
      break;
  }
}
```

#### 4.2.3 食物/菜谱 Channel 标签

```typescript
// foods 表新增字段
available_channels String[] @default(["home_cook"])
// 如：["home_cook", "takeout"] 表示可在家做也可外卖点到

// recipes 表新增字段
available_channels String[] @default(["home_cook"])
// 如：["home_cook", "restaurant"]

// food_pool_cache.service.ts — 按 channel 过滤
async getPool(regionCode: string, channel: AcquisitionChannel): Promise<FoodPool> {
  const cacheKey = `food_pool:${regionCode}:${channel}`;
  return this.tieredCache.getOrSet(cacheKey, async () => {
    // 查询 available_channels 包含指定 channel 的食物
    return this.prisma.foods.findMany({
      where: {
        available_channels: { has: channel },
        // ... 其他已有过滤条件
      },
    });
  }, { l1Ttl: 300, l2Ttl: 1800 });
}
```

#### 4.2.4 推荐效果归因 — RecommendationTrace

```typescript
// recommendation.types.ts 新增
interface RecommendationTrace {
  strategyName: string;       // 使用的策略
  segmentName: string;        // 用户分群
  channel: AcquisitionChannel; // 获取渠道
  experimentId?: string;       // A/B 实验 ID
  recallSource: {              // 召回来源分布
    content: number;           // 内容召回占比
    cf: number;                // CF 召回占比
    popularity: number;        // 热门召回占比
    recipe: number;            // 菜谱召回占比
  };
  scoringVersion: string;      // 评分版本号
  coldStartFactor: number;     // 冷启动因子
  seasonalityApplied: boolean; // 是否应用了时令调整
}

// recommendation-engine.service.ts — 生成 trace
private buildTrace(/* ... */): RecommendationTrace {
  return {
    strategyName: resolvedStrategy.name,
    segmentName: profile.inferred.userSegment,
    channel: effectiveChannel,
    experimentId: resolvedStrategy.experimentId,
    recallSource: this.calcRecallDistribution(candidates),
    scoringVersion: 'v6.4',
    coldStartFactor,
    seasonalityApplied: true,
  };
}
```

#### 4.2.5 Trace 持久化

```typescript
// 推荐结果返回时附带 trace（加密/压缩后放在 meta 中）
// 用户反馈时将 trace 关联到反馈记录

// feedback.service.ts
async submitFeedback(dto: FeedbackDto): Promise<void> {
  // ... 已有逻辑
  // ★ V6.4: 解析并存储 trace
  if (dto.recommendationTrace) {
    await this.prisma.recommendation_traces.create({
      data: {
        recommendation_id: dto.recommendationId,
        user_id: userId,
        strategy_name: trace.strategyName,
        segment_name: trace.segmentName,
        channel: trace.channel,
        experiment_id: trace.experimentId,
        recall_source: trace.recallSource,
        feedback_type: dto.feedbackType, // accepted/replaced/skipped
        created_at: new Date(),
      },
    });
  }
}
```

#### 4.2.6 StrategyEffectivenessService

```typescript
// 新增：strategy-effectiveness.service.ts
@Injectable()
export class StrategyEffectivenessService {
  /**
   * 按 (strategy × segment × channel) 维度聚合推荐效果
   * 支持时间范围过滤
   */
  async getEffectivenessMatrix(params: {
    startDate: Date;
    endDate: Date;
  }): Promise<EffectivenessMatrix> {
    const rows = await this.prisma.$queryRaw`
      SELECT
        strategy_name,
        segment_name,
        channel,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE feedback_type = 'accepted') as accepted,
        COUNT(*) FILTER (WHERE feedback_type = 'replaced') as replaced,
        COUNT(*) FILTER (WHERE feedback_type = 'skipped') as skipped,
        ROUND(
          COUNT(*) FILTER (WHERE feedback_type = 'accepted')::numeric / NULLIF(COUNT(*), 0),
          4
        ) as acceptance_rate
      FROM recommendation_traces
      WHERE created_at BETWEEN ${params.startDate} AND ${params.endDate}
      GROUP BY strategy_name, segment_name, channel
      ORDER BY acceptance_rate DESC
    `;

    return this.formatMatrix(rows);
  }

  /**
   * 获取单个策略在各分群上的表现
   */
  async getStrategyPerformance(strategyName: string): Promise<StrategyPerformance> {
    // 按 segment 分组的采纳率 + 趋势
  }

  /**
   * 建议优化：基于效果矩阵推荐分群→策略调整
   */
  async suggestOptimizations(): Promise<OptimizationSuggestion[]> {
    const matrix = await this.getEffectivenessMatrix({
      /* 近 30 天 */
    });
    const suggestions: OptimizationSuggestion[] = [];

    for (const cell of matrix.cells) {
      // 如果某个 segment 在当前策略下采纳率 < 30%
      // 查找该 segment 在其他策略下的表现
      // 如果有更好的策略，建议切换
      if (cell.acceptanceRate < 0.3) {
        const better = matrix.findBestStrategy(cell.segmentName);
        if (better && better.acceptanceRate > cell.acceptanceRate * 1.5) {
          suggestions.push({
            segment: cell.segmentName,
            currentStrategy: cell.strategyName,
            suggestedStrategy: better.strategyName,
            expectedImprovement: better.acceptanceRate - cell.acceptanceRate,
          });
        }
      }
    }
    return suggestions;
  }
}
```

---

### 4.3 Nutrition / Scoring 模块

**目标：增加时令评分维度 + 健康修正缓存**

#### 4.3.1 SeasonalityService

```typescript
// 新增：seasonality.service.ts
@Injectable()
export class SeasonalityService {
  /**
   * 计算食物的时令分数
   * @returns 0.85 (反季) ~ 1.0 (无季节性) ~ 1.10 (当季)
   */
  calculateSeasonalScore(food: FoodLibrary, regionCode: string, currentMonth: number): number {
    const regionalInfo = food.regionalInfo?.find((r) => r.region === regionCode);
    if (!regionalInfo?.peakMonths?.length) {
      return 1.0; // 无季节性数据，不调整
    }

    const peakMonths = regionalInfo.peakMonths;
    if (peakMonths.includes(currentMonth)) {
      return 1.1; // 当季 +10%
    }

    // 计算距离最近当季月份的距离
    const minDistance = Math.min(
      ...peakMonths.map((m) =>
        Math.min(Math.abs(currentMonth - m), 12 - Math.abs(currentMonth - m))
      )
    );

    if (minDistance <= 1) return 1.0; // 临近季节，不调整
    if (minDistance <= 2) return 0.95; // 稍微降低
    return 0.85; // 反季 -15%
  }

  /**
   * 获取当前月份的当季食物 ID 列表（用于召回加速）
   */
  async getInSeasonFoodIds(regionCode: string): Promise<string[]> {
    const currentMonth = new Date().getMonth() + 1;
    return this.tieredCache.getOrSet(
      `seasonal:${regionCode}:${currentMonth}`,
      async () => {
        return this.prisma.food_regional_info
          .findMany({
            where: { region: regionCode, peak_months: { has: currentMonth } },
            select: { food_id: true },
          })
          .then((rows) => rows.map((r) => r.food_id));
      },
      { l1Ttl: 86400, l2Ttl: 86400 } // 1 天缓存
    );
  }
}
```

#### 4.3.2 FoodScorer 新增第 11 维

```typescript
// food-scorer.service.ts
// 现有 10 维 → 11 维
// 新增 index 10: seasonality

// 评分维度定义
const SCORING_DIMENSIONS = [
  'calories', 'protein', 'carbs', 'fat', 'quality',
  'satiety', 'glycemic', 'nutrientDensity', 'inflammation',
  'fiber', 'seasonality', // ★ V6.4
];

// Goal-specific weights 更新（从 10 维扩展到 11 维）
const GOAL_WEIGHTS: Record<GoalType, number[]> = {
  fat_loss:     [0.18, 0.17, 0.08, 0.06, 0.06, 0.07, 0.12, 0.10, 0.07, 0.05, 0.04],
  muscle_gain:  [0.17, 0.22, 0.12, 0.06, 0.06, 0.05, 0.10, 0.09, 0.05, 0.04, 0.04],
  health:       [0.07, 0.06, 0.05, 0.05, 0.16, 0.07, 0.11, 0.18, 0.11, 0.08, 0.06],
  habit:        [0.12, 0.10, 0.06, 0.06, 0.15, 0.13, 0.09, 0.09, 0.08, 0.05, 0.07],
};

// 评分计算
calcSeasonalityScore(food: FoodLibrary, regionCode: string): number {
  const seasonalScore = this.seasonalityService.calculateSeasonalScore(
    food, regionCode, new Date().getMonth() + 1,
  );
  // 映射到 0-100 分
  return (seasonalScore - 0.85) / (1.10 - 0.85) * 100;
}
```

#### 4.3.3 健康修正请求级 + L2 缓存

```typescript
// health-modifier-engine.service.ts 改造
@Injectable()
export class HealthModifierEngineService {
  // ★ V6.4: L2 缓存（用户健康画像 hash + 食物 ID）
  private readonly HEALTH_CACHE_TTL = 3600; // 1 小时

  async calculateModifier(
    food: FoodLibrary,
    healthProfile: HealthProfile,
    requestCache?: Map<string, number> // ★ 请求级缓存
  ): Promise<number> {
    const healthHash = this.hashHealthProfile(healthProfile);
    const cacheKey = `hm:${food.id}:${healthHash}`;

    // 1. 请求级缓存
    if (requestCache?.has(cacheKey)) {
      return requestCache.get(cacheKey)!;
    }

    // 2. L2 缓存（Redis）
    const cached = await this.tieredCache.get<number>(cacheKey);
    if (cached !== null) {
      requestCache?.set(cacheKey, cached);
      return cached;
    }

    // 3. 计算
    const modifier = await this.runPipeline(food, healthProfile);

    // 4. 写入两级缓存
    requestCache?.set(cacheKey, modifier);
    await this.tieredCache.set(cacheKey, modifier, {
      l1Ttl: 600, // 内存 10 分钟
      l2Ttl: this.HEALTH_CACHE_TTL,
    });

    return modifier;
  }

  // 画像变更时失效
  async invalidateForUser(userId: string): Promise<void> {
    // 通过 pattern 删除该用户相关的健康修正缓存
    // 触发点：user.profile.updated 事件
  }

  private hashHealthProfile(profile: HealthProfile): string {
    // 将影响健康修正的字段（疾病、过敏、目标）做确定性 hash
    const key = [
      profile.healthConditions?.sort().join(','),
      profile.allergens?.sort().join(','),
      profile.goalType,
      profile.dietaryRestrictions?.sort().join(','),
    ].join('|');
    return createHash('md5').update(key).digest('hex').slice(0, 12);
  }
}
```

#### 4.3.4 区域可用性默认值修正

```typescript
// preference-profile.service.ts:178-190 修改
// 当前：无区域数据的食物默认 0.7x（rare）
// V6.4：无区域数据的食物默认 1.0x（unknown / neutral）
getRegionalBoost(food: FoodLibrary, regionCode: string): number {
  const regionalInfo = food.regionalInfo?.find(r => r.region === regionCode);
  if (!regionalInfo) {
    return 1.0; // ★ V6.4: 无数据不惩罚（原为 0.7）
  }

  switch (regionalInfo.availability) {
    case 'common':
      return regionalInfo.localPopularity >= 70 ? 1.2 : 1.05;
    case 'seasonal':
      return 0.9;
    case 'rare':
      return 0.7;
    default:
      return 1.0;
  }
}
```

---

### 4.4 Cache / 性能

**目标：健壮化基础设施，准备上线**

#### 4.4.1 Prisma 连接池配置

```typescript
// core/prisma/prisma.service.ts 改造
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor(private configService: ConfigService) {
    super({
      datasources: {
        db: {
          url: configService.get<string>('DATABASE_URL'),
        },
      },
      // ★ V6.4: 连接池通过 DATABASE_URL 参数控制
      // DATABASE_URL=postgresql://...?connection_limit=10&pool_timeout=10
    });
  }
}

// .env.example 新增说明
// DATABASE_URL=postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10
```

#### 4.4.2 Redis 连接池

```typescript
// core/redis/redis-cache.service.ts 改造
@Injectable()
export class RedisCacheService implements OnModuleInit {
  private pool: Pool<RedisClientType>;

  async onModuleInit(): Promise<void> {
    this.pool = createPool(
      {
        create: async () => {
          const client = createClient({ url: this.redisUrl });
          await client.connect();
          return client;
        },
        destroy: async (client) => {
          await client.disconnect();
        },
      },
      {
        min: 2,
        max: parseInt(process.env.REDIS_POOL_SIZE || '10', 10),
        acquireTimeoutMillis: 5000,
      }
    );
  }

  // 所有 Redis 操作通过 pool 获取连接
  async get<T>(key: string): Promise<T | null> {
    const client = await this.pool.acquire();
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } finally {
      await this.pool.release(client);
    }
  }
}
```

#### 4.4.3 getAllQuotaStatus 修复

```typescript
// quota.service.ts:166 改造
// 当前：查询时逐条重置过期配额
// V6.4：仅读取，不写入。重置由 Cron 统一处理
async getAllQuotaStatus(userId: string): Promise<QuotaStatus[]> {
  const quotas = await this.prisma.usage_quotas.findMany({
    where: { user_id: userId },
  });

  return quotas.map(q => ({
    feature: q.feature_key,
    used: q.used_count,
    limit: q.max_count,
    isExpired: q.expires_at < new Date(), // ★ 标记过期但不重置
    expiresAt: q.expires_at,
  }));
}
```

#### 4.4.4 Cron 时间分散

```
当前 Cron 集中度：
01:00 — CF 增量/全量
02:00 — daily profile
03:00 — daily precompute + weekly segment (Mon)
04:00 — cleanup + bimonthly decay + daily food sync
05:00 — daily quality check
06:00 — weekly normalization (Mon)

V6.4 调整后：
00:30 — CF 增量/全量（提前 30 分钟，避开 02:00 画像更新）
02:00 — daily profile（不变）
02:30 — ★ weekly segment (Mon)（从 03:00 移出）
03:00 — daily precompute（不变，但不再与 weekly segment 重叠）
03:30 — cleanup（从 04:00 提前）
04:00 — daily food sync（不变）
04:30 — bimonthly decay（从 04:30 固定）
05:00 — daily quality check（不变）
06:00 — weekly normalization (Mon)（不变）
```

---

### 4.5 数据流

**目标：推荐归因闭环 + 季节感知缓存失效**

#### 4.5.1 推荐归因事件链

```
推荐请求
    │
    ├─→ 推荐引擎生成结果 + RecommendationTrace
    │       └─→ trace 随结果返回客户端（meta 字段）
    │
    ├─→ 用户反馈（accepted/replaced/skipped）
    │       ├─→ 反馈 + trace 持久化到 recommendation_traces
    │       ├─→ 权重学习（已有）
    │       ├─→ 偏好更新（已有）
    │       └─→ ★ 触发 trace 聚合（按策略×分群×渠道）
    │
    └─→ ★ Admin 查看效果矩阵
            ├─→ StrategyEffectivenessService.getEffectivenessMatrix()
            ├─→ 策略优化建议
            └─→ 手动/自动调整分群→策略映射
```

#### 4.5.2 季节变化缓存失效

```
每月 1 日 00:00（新增 Cron）
    │
    ├─→ 失效所有 food_pool 缓存（按 region + channel）
    ├─→ 失效 seasonal 食物 ID 缓存
    ├─→ 重建当月当季食物列表
    └─→ 日志记录季节切换
```

#### 4.5.3 画像变更 → 健康修正缓存失效

```
user.profile.updated 事件
    │
    ├─→ 已有：缓存失效 + 重算分群 + 预计算
    └─→ ★ V6.4: 健康修正缓存失效
            └─→ HealthModifierEngineService.invalidateForUser(userId)
```

---

## Step 5：技术路线图

### Phase 1：短期（1-2 周）— 生产安全 + 基础修复

**目标：消除所有上线阻塞项，修复已知 bug**

| 任务                                                      | 工作量 | 风险 | 优先级 |
| --------------------------------------------------------- | ------ | ---- | ------ |
| JWT 密钥启动校验（无 env 则 throw）                       | 0.5d   | 低   | P0     |
| SMS 万能码环境感知（production 禁用）                     | 0.5d   | 低   | P0     |
| ValidationPipe whitelist=true + forbidNonWhitelisted=true | 0.5d   | 中   | P0     |
| 验证错误 target=false, value=false                        | 0.5d   | 低   | P0     |
| CORS 配置白名单域名（env 控制）                           | 0.5d   | 低   | P0     |
| enableShutdownHooks + BullMQ graceful drain               | 1d     | 中   | P0     |
| 请求体大小限制 10MB                                       | 0.5d   | 低   | P0     |
| AllExceptionsFilter 去重注册                              | 0.5d   | 低   | P1     |
| StrictThrottle tier 名修复                                | 0.5d   | 低   | P1     |
| exerciseSchedule DTO 暴露                                 | 0.5d   | 低   | P1     |
| 图片分析 prompt 标注修复                                  | 0.5d   | 低   | P2     |
| getAllQuotaStatus 去除内联重置                            | 0.5d   | 低   | P2     |
| SMS 验证码迁移到 Redis                                    | 1d     | 中   | P1     |
| 区域可用性默认值 rare→unknown                             | 0.5d   | 低   | P2     |

**总计：~8 天**

**验证方式：**

- 安全审计 checklist：所有 P0 项逐一验证
- 启动测试：缺少 JWT_SECRET 时应用拒绝启动
- 集成测试：whitelist 启用后验证已有 DTO 不受影响
- Redis 验证码：多实例共享验证

---

### Phase 2：中期（2-3 周）— 性能 + 可观测性

**目标：建立可观测性基线 + 消除性能瓶颈**

| 任务                               | 工作量 | 风险 | 优先级 |
| ---------------------------------- | ------ | ---- | ------ |
| Prometheus 指标集成                | 3d     | 中   | P1     |
| HTTP 延迟 / 推荐管道各阶段耗时指标 | 2d     | 中   | P1     |
| 缓存命中率指标（L1/L2）            | 1d     | 低   | P1     |
| BullMQ 队列深度 + 处理耗时指标     | 1d     | 低   | P1     |
| /metrics 端点暴露                  | 0.5d   | 低   | P1     |
| 健康检查增强（Redis + BullMQ）     | 1d     | 低   | P1     |
| 日志轮转（DailyRotateFile 7天）    | 0.5d   | 低   | P2     |
| 健康修正请求级缓存                 | 1d     | 低   | P1     |
| 健康修正 L2 缓存                   | 2d     | 中   | P1     |
| Prisma 连接池配置化                | 0.5d   | 低   | P2     |
| Redis 连接池                       | 2d     | 中   | P2     |
| Cron 时间分散                      | 0.5d   | 低   | P2     |
| 菜谱 quality_score 自动化          | 1d     | 低   | P2     |

**总计：~16 天**

**验证方式：**

- Prometheus 指标可通过 `/metrics` 获取
- 推荐管道延迟 P95 < 500ms（含健康修正缓存后）
- 缓存命中率基线建立（预期 L1 > 60%，L2 > 85%）
- 健康修正缓存：同一用户同一食物二次请求耗时 < 1ms

---

### Phase 3：长期（3-5 周）— 场景化 + 归因闭环 + 时令

**目标：推荐贴近现实 + 数据驱动策略优化**

| 任务                                           | 工作量 | 风险 | 优先级 |
| ---------------------------------------------- | ------ | ---- | ------ |
| AcquisitionChannel 枚举 + 推断逻辑             | 2d     | 中   | P1     |
| 食物/菜谱 available_channels 字段 + 数据标注   | 3d     | 中   | P1     |
| 推荐引擎 channel 参数注入                      | 2d     | 中   | P1     |
| food_pool_cache 按 channel 分片                | 2d     | 中   | P1     |
| DTO 新增 channel 参数                          | 0.5d   | 低   | P1     |
| SeasonalityService 实现                        | 2d     | 低   | P2     |
| food_regional_info peak_months 字段 + 数据填充 | 2d     | 中   | P2     |
| FoodScorer 新增第 11 维 seasonality            | 1d     | 中   | P2     |
| 月初季节缓存失效 Cron                          | 0.5d   | 低   | P2     |
| RecommendationTrace 数据模型 + 记录逻辑        | 2d     | 中   | P1     |
| 反馈关联 trace                                 | 1d     | 低   | P1     |
| StrategyEffectivenessService                   | 3d     | 中   | P2     |
| Admin 策略效果矩阵页面                         | 3d     | 中   | P2     |
| 策略优化建议接口                               | 2d     | 中   | P2     |
| recipe_translations 表 + API                   | 2d     | 低   | P3     |
| AI 菜谱生成模型路由（中餐/西餐）               | 1d     | 中   | P3     |
| Thompson Sampling 收敛可视化                   | 2d     | 中   | P3     |

**总计：~30 天**

**验证方式：**

- 场景化推荐：同一用户 channel=home_cook vs channel=takeout 推荐结果差异 > 50%
- 时令评分：冬季西瓜评分 < 夏季西瓜评分 15%+
- 归因闭环：Admin 可查看策略效果矩阵，至少覆盖 4 策略 × 7 分群
- 策略建议：自动检测采纳率 < 30% 的策略×分群组合

---

## Step 6：数据迁移

### 6.1 新增 Prisma Model

```prisma
// schema.prisma 新增

// ★ 推荐归因追踪
model recommendation_traces {
  id                String   @id @default(uuid())
  recommendation_id String?
  user_id           String
  strategy_name     String   @db.VarChar(50)
  segment_name      String   @db.VarChar(50)
  channel           String   @db.VarChar(20)
  experiment_id     String?  @db.VarChar(50)
  recall_source     Json     // { content, cf, popularity, recipe }
  scoring_version   String   @db.VarChar(10)
  cold_start_factor Float    @default(0)
  feedback_type     String?  @db.VarChar(20) // accepted/replaced/skipped
  created_at        DateTime @default(now())

  @@index([user_id])
  @@index([strategy_name, segment_name])
  @@index([channel])
  @@index([created_at])
  @@index([strategy_name, segment_name, channel]) // 效果矩阵查询
}

// ★ 菜谱翻译
model recipe_translations {
  id          String @id @default(uuid())
  recipe_id   String
  locale      String @db.VarChar(10)  // zh-CN, en-US, ja-JP
  name        String @db.VarChar(200)
  description String? @db.Text
  instructions Json?  // 翻译后的步骤

  recipe recipes @relation(fields: [recipe_id], references: [id], onDelete: Cascade)

  @@unique([recipe_id, locale])
  @@index([locale])
}
```

### 6.2 已有表新增字段

```sql
-- foods 表新增获取渠道
ALTER TABLE foods
ADD COLUMN available_channels TEXT[] DEFAULT ARRAY['home_cook'];

CREATE INDEX idx_foods_channels ON foods USING GIN(available_channels);

-- recipes 表新增获取渠道
ALTER TABLE recipes
ADD COLUMN available_channels TEXT[] DEFAULT ARRAY['home_cook'];

CREATE INDEX idx_recipes_channels ON recipes USING GIN(available_channels);

-- food_regional_info 表新增时令月份
ALTER TABLE food_regional_info
ADD COLUMN peak_months INTEGER[] DEFAULT NULL;

CREATE INDEX idx_regional_peak_months ON food_regional_info USING GIN(peak_months);
```

### 6.3 数据初始化

```sql
-- 1. 食物获取渠道初始标注（基于品类推断）
-- 生鲜蔬果 → home_cook
-- 快餐/预制食品 → takeout, convenience
-- 主食类 → home_cook, canteen
UPDATE foods SET available_channels = ARRAY['home_cook']
WHERE category IN ('vegetables', 'fruits', 'grains', 'legumes', 'meat', 'seafood');

UPDATE foods SET available_channels = ARRAY['home_cook', 'takeout', 'convenience']
WHERE category IN ('snacks', 'beverages', 'dairy');

UPDATE foods SET available_channels = ARRAY['home_cook', 'canteen', 'takeout']
WHERE category IN ('prepared_foods', 'mixed_dishes');

-- 2. 菜谱获取渠道初始标注
UPDATE recipes SET available_channels = ARRAY['home_cook']
WHERE difficulty <= 3;

UPDATE recipes SET available_channels = ARRAY['home_cook', 'restaurant']
WHERE difficulty >= 4;

-- 3. 时令数据初始填充（中国区主要食材）
-- 示例：西瓜夏季（6-8月），白菜冬季（11-2月）
INSERT INTO food_regional_info (food_id, region, availability, peak_months)
SELECT id, 'CN', 'seasonal', ARRAY[6,7,8]
FROM foods WHERE name LIKE '%西瓜%'
ON CONFLICT (food_id, region) DO UPDATE SET peak_months = EXCLUDED.peak_months;

INSERT INTO food_regional_info (food_id, region, availability, peak_months)
SELECT id, 'CN', 'seasonal', ARRAY[11,12,1,2]
FROM foods WHERE name LIKE '%白菜%'
ON CONFLICT (food_id, region) DO UPDATE SET peak_months = EXCLUDED.peak_months;

-- 更多时令数据需要通过批量脚本填充（见 Phase 3 数据标注任务）
```

### 6.4 迁移执行顺序

```bash
# Phase 1（安全加固，无数据库变更）
# 纯代码修改，无需迁移

# Phase 2（可观测性，无数据库变更）
# 纯代码修改，无需迁移

# Phase 3
# 1. 创建 recommendation_traces 表
pnpm prisma migrate dev --name add_recommendation_traces

# 2. 创建 recipe_translations 表
pnpm prisma migrate dev --name add_recipe_translations

# 3. 新增字段（available_channels, peak_months）
pnpm prisma migrate dev --name add_channel_and_seasonality_fields

# 4. 数据初始化（运行种子脚本）
pnpm prisma db seed -- --scope=v6.4-channels
pnpm prisma db seed -- --scope=v6.4-seasonality
```

---

## Step 7：文档差异

### 7.1 新增章节

| 章节                | 位置                        | 内容                                               |
| ------------------- | --------------------------- | -------------------------------------------------- |
| 生产安全配置        | 系统架构总览 §技术架构 之后 | JWT/CORS/Validation/BodyLimit/Shutdown 配置项清单  |
| 场景化推荐          | 核心流程 §个性化推荐 之后   | AcquisitionChannel 定义 + 渠道推断逻辑 + 召回过滤  |
| 时令评分            | 核心模块 §推荐系统 - 评分   | SeasonalityService 时令分数计算 + 第 11 维评分     |
| 推荐归因            | 核心模块 §推荐系统 之后     | RecommendationTrace + StrategyEffectivenessService |
| 可观测性            | 技术架构 §部署 之后         | Prometheus 指标清单 + /metrics 端点 + Grafana 建议 |
| 健康修正缓存        | 核心模块 §缓存机制          | 请求级 + L2 两级健康修正缓存策略                   |
| recipe_translations | 核心模块 §菜谱系统          | 菜谱多语言支持结构                                 |

### 7.2 修改内容

| 位置                           | 变更                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| §评分维度表                    | 从 10 维扩展到 11 维（+seasonality），权重表更新              |
| §Goal-specific 权重            | 4 组权重从 10 元素扩展到 11 元素                              |
| §food_regional_info 表结构     | 新增 peak_months 字段说明                                     |
| §foods 表结构                  | 新增 available_channels 字段说明                              |
| §recipes 表结构                | 新增 available_channels 字段说明                              |
| §实体统计                      | 新增 recommendation_traces, recipe_translations，总计 58 → 60 |
| §Cron 调度表                   | 时间分散后的新 schedule                                       |
| §推荐请求参数                  | 新增 channel 可选参数                                         |
| §健康检查                      | 新增 Redis + BullMQ 检查                                      |
| §区域食物加权                  | 默认可用性从 rare(0.7x) 改为 unknown(1.0x)                    |
| §preference-profile 区域 boost | 无数据返回 1.0 而非 0.7                                       |

### 7.3 删除内容

| 位置                                 | 变更                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `core.module.ts`                     | 删除 AllExceptionsFilter 注册（仅保留 app.module.ts 中的） |
| `quota.service.ts:getAllQuotaStatus` | 删除内联重置逻辑                                           |

### 7.4 API 变更

#### 新增端点

| 端点                                                | 方法 | 说明                      |
| --------------------------------------------------- | ---- | ------------------------- |
| `/metrics`                                          | GET  | Prometheus 指标（无认证） |
| `/api/admin/strategy-effectiveness`                 | GET  | 策略效果矩阵              |
| `/api/admin/strategy-effectiveness/suggest`         | GET  | 策略优化建议              |
| `/api/admin/recipes/:id/translations`               | CRUD | 菜谱翻译管理              |
| `/api/admin/recommendation-debug/trace/:id`         | GET  | 查看推荐归因详情          |
| `/api/admin/recommendation-debug/thompson-sampling` | GET  | TS 收敛可视化数据         |

#### 修改端点

| 端点                            | 变更                                       |
| ------------------------------- | ------------------------------------------ |
| `POST /api/app/diet/daily-plan` | 新增可选参数 `channel: AcquisitionChannel` |
| `PUT /api/app/users/profile`    | 新增可选字段 `exerciseSchedule`            |
| `GET /health/ready`             | 新增 Redis + BullMQ 健康检查               |

---

## 附：V5 → V6.4 演进总结

| 维度   | V5           | V6.0                | V6.1          | V6.2              | V6.3                       | V6.4                              |
| ------ | ------------ | ------------------- | ------------- | ----------------- | -------------------------- | --------------------------------- |
| 推荐   | 10 维评分    | + 策略引擎 + 预计算 | 不变          | + 全画像接入      | + 策略映射 + 菜谱 + 冷启动 | + 场景化渠道 + 时令 + 效果归因    |
| 画像   | 3 层 + 填充  | + 短期 + 上下文     | 不变          | + ProfileResolver | + 死数据激活 + 运动        | + 渠道推断 + DTO 修复             |
| 营养   | NRF 9.3 固定 | 不变                | 不变          | + addedSugar      | + 12 维 + 个性化 RDA + GI  | + 时令评分（11 维）               |
| 商业   | 无           | 订阅 + 支付         | + 配额 + 分层 | + 安全加固        | 不变                       | 不变（稳定）                      |
| 食物   | 原料库       | 不变                | + 分析管道    | + 搜索增强        | + 菜谱层 + AI 生成         | + 渠道标签 + 时令标签             |
| 性能   | 基础         | + 3 级缓存          | 不变          | + 批量 + 游标     | + 并行 + 增量 CF + 原子    | + 健康修正缓存 + 连接池           |
| 解释   | 单食物       | + 反向              | + 分层        | 不变              | + 整餐 + 菜谱              | 不变（稳定）                      |
| 安全   | 基础         | + Guard 体系        | + 订阅 Guard  | + 安全加固        | 不变                       | + 生产加固（JWT/CORS/Validation） |
| 可观测 | 无           | + 日志              | 不变          | 不变              | 不变                       | + Prometheus + 健康检查增强       |
| 归因   | 无           | 无                  | 无            | 无                | 无                         | + RecommendationTrace + 效果矩阵  |
