# 无为AI 管理后台系统设计 V8.0

> 基于现有 300+ API 端点，设计可持续迭代的后台管理系统
> 技术栈：React 19 + Ant Design 5 + Zustand + React Query + Recharts

---

## Step 1：能力映射（后端 → 后台）

| 后端能力模块 | 后台功能       | 对应 API 路径前缀                                                        | 现有页面                                                | 状态       |
| ------------ | -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- | ---------- |
| 用户系统     | 用户管理       | `admin/app-users`                                                        | `/user`                                                 | ✅ 已有    |
| 用户画像     | 用户画像看板   | `admin/user-dashboard`, `admin/churn-prediction`                         | `/analytics/user-profile-dashboard`, `/analytics/churn` | ✅ 已有    |
| 食物库       | 食物库管理     | `admin/food-library`                                                     | `/food-library/*`                                       | ✅ 已有    |
| 食物数据管道 | 数据管道管理   | `admin/food-pipeline`                                                    | `/food-pipeline/*`                                      | ✅ 已有    |
| AI补全       | AI补全管理     | `admin/food-pipeline/enrichment`                                         | `/food-library/enrichment`                              | ⚠️ 需增强  |
| 食物分析     | 分析记录管理   | `admin/analysis-records`                                                 | `/analysis-records/*`                                   | ⚠️ 需增强  |
| 推荐系统     | 推荐策略管理   | `admin/strategies`, `admin/recommendation-debug`, `admin/scoring-config` | `/strategy/*`, `/recommendation-debug/*`                | ⚠️ 需增强  |
| A/B实验      | A/B实验管理    | `admin/ab-experiments`                                                   | `/ab-experiments/*`                                     | ⚠️ 需增强  |
| 订阅系统     | 订阅与付费管理 | `admin/subscriptions`                                                    | `/subscription/*`                                       | ⚠️ 需增强  |
| 转化漏斗     | 转化分析       | `admin/analytics/funnel`                                                 | `/analytics/funnel`                                     | ⚠️ 需增强  |
| 策略效果     | 策略效果分析   | `admin/strategy-effectiveness`                                           | `/strategy/effectiveness`                               | ✅ 已有    |
| 内容管理     | 内容审核       | `admin/content/*`                                                        | `/content/*`                                            | ✅ 已有    |
| 游戏化       | 游戏化管理     | `admin/gamification/*`                                                   | `/gamification/*`                                       | ✅ 已有    |
| 数据分析     | 数据统计中心   | `admin/analytics/*`                                                      | `/analytics`                                            | ⚠️ 需增强  |
| AI Coach     | 对话管理       | `admin/content/conversations`                                            | `/content/conversations`                                | ✅ 已有    |
| 通知系统     | —              | (仅 App 端)                                                              | —                                                       | 无后台需求 |
| 食谱管理     | 食谱管理       | `admin/recipes`                                                          | —                                                       | 🔴 缺失    |
| RBAC         | 权限管理       | `admin/roles`, `admin/rbac-permissions`                                  | `/system/permission`                                    | ✅ 已有    |
| 功能开关     | 功能开关       | `admin/feature-flags`                                                    | `/system/feature-flags`                                 | ✅ 已有    |

---

## Step 2：后台模块设计（菜单信息架构）

### 一级菜单结构

```
📊 仪表盘                    order: 0
👥 用户管理                  order: 5
  └─ 用户列表
  └─ 用户详情/:id
🍎 食物管理                  order: 10
  └─ 食物库列表
  └─ 新建食物
  └─ 食物详情/:id
  └─ 食物编辑/:id
  └─ 数据冲突
  └─ AI补全管理              ← 增强
📷 分析记录                  order: 15
  └─ 分析列表
  └─ 分析详情/:id
📝 内容管理                  order: 20
  └─ 饮食记录
  └─ 每日计划
  └─ 对话管理
  └─ 推荐反馈
  └─ AI决策日志
🎯 推荐系统                  order: 25
  └─ 策略列表
  └─ 策略详情/:id
  └─ 推荐调试
  └─ 评分配置
  └─ 策略效果
🧪 A/B实验                   order: 30
  └─ 实验列表
  └─ 实验详情/:id
💰 订阅管理                  order: 35
  └─ 订阅列表
  └─ 订阅计划
  └─ 支付记录
  └─ 使用额度
  └─ 订阅详情/:id
📈 数据分析                  order: 40
  └─ 分析总览
  └─ 转化漏斗
  └─ 用户画像看板
  └─ 流失预测
🍳 食谱管理                  order: 42  ← 新增
  └─ 食谱列表
  └─ 食谱详情/:id
🏗️ 数据管道                  order: 45
  └─ 管道看板
  └─ USDA导入
  └─ 图片识别
  └─ AI标签
  └─ 翻译管理
  └─ 冲突处理
  └─ 质量监控
🎮 游戏化                    order: 50
  └─ 成就管理
  └─ 挑战管理
⚙️ 系统管理                  order: 998
  └─ 管理员
  └─ 权限管理
  └─ 应用版本
  └─ 功能开关
  └─ 数据导出
```

### 每个模块功能说明

| 模块       | 功能                         | 用途（为什么存在）                     |
| ---------- | ---------------------------- | -------------------------------------- |
| 仪表盘     | KPI卡片 + 趋势图 + 快捷入口  | 一屏掌握系统健康状态，快速发现异常     |
| 用户管理   | CRUD + 画像查看 + 封禁       | 管理用户生命周期，查看个体画像辅助客诉 |
| 食物库管理 | 列表/详情/编辑 + 完整度筛选  | 维护食物数据质量，是推荐系统的数据基础 |
| AI补全管理 | 扫描/入队/审核/预览对比      | 用AI批量填充缺失数据，提升食物库完整度 |
| 分析记录   | 查看/审核分析结果 + 热门食物 | 监控AI分析质量，发现高频食物优化重点   |
| 推荐策略   | 创建/配置/调试策略           | 直接影响推荐结果，是运营核心抓手       |
| A/B实验    | 创建/运行/分析实验           | 量化策略效果，数据驱动决策             |
| 订阅管理   | 计划/订阅/支付 CRUD          | 管理付费体系，监控收入                 |
| 数据分析   | 漏斗/画像/流失预测           | 分析用户行为，发现增长机会             |
| 食谱管理   | CRUD + AI生成 + 审核         | 管理食谱内容，丰富推荐池               |

---

## Step 3：核心运营功能设计

### 3.1 影响推荐结果的能力

| 运营动作      | 对应API                                    | 效果                 |
| ------------- | ------------------------------------------ | -------------------- |
| 调整策略权重  | `PUT admin/strategies/:id`                 | 改变推荐评分逻辑     |
| 修改评分配置  | `PUT admin/scoring-config`                 | 调整全局评分参数     |
| 激活/归档策略 | `POST admin/strategies/:id/activate`       | 切换生效策略         |
| 创建A/B实验   | `POST admin/ab-experiments`                | 对比不同策略效果     |
| 推荐调试      | `POST admin/recommendation-debug/simulate` | 验证策略输出         |
| 食物库编辑    | `PUT admin/food-library/:id`               | 修正食物数据影响推荐 |
| 功能开关      | `POST admin/feature-flags/:key/toggle`     | 控制功能灰度         |

### 3.2 分析用户行为的能力

| 分析维度   | 对应API                                           | 输出          |
| ---------- | ------------------------------------------------- | ------------- |
| 用户活跃度 | `GET admin/user-dashboard/active-stats`           | DAU/WAU/MAU   |
| 增长趋势   | `GET admin/user-dashboard/growth-trend`           | 新增用户曲线  |
| 画像分布   | `GET admin/user-dashboard/profile-distribution`   | 人群画像      |
| 流失预测   | `GET admin/churn-prediction/distribution`         | 流失风险分布  |
| 推荐反馈   | `GET admin/content/recommendation-feedback/stats` | 接受率/替换率 |
| 行为画像   | `GET admin/app-users/:id/behavior-profile`        | 个体行为      |

### 3.3 提升转化率的能力

| 转化动作      | 对应API                                             | 效果                 |
| ------------- | --------------------------------------------------- | -------------------- |
| 转化漏斗分析  | `GET admin/analytics/funnel`                        | 发现流失环节         |
| 订阅计划调价  | `PUT admin/subscriptions/plans/:id`                 | 优化定价             |
| 策略→转化归因 | `GET admin/strategy-effectiveness/report`           | 量化策略对付费的影响 |
| 渠道分析      | `GET admin/strategy-effectiveness/channel-analysis` | 识别高转化渠道       |
| A/B验证       | `GET admin/ab-experiments/:id/analysis`             | 量化方案差异         |

---

## Step 4：关键页面设计

### 4.1 仪表盘（增强版）

**页面功能**：一屏聚合系统核心指标 + 趋势 + 异常告警

**关键指标卡片（第一行）**：
| 指标 | 数据源API | 说明 |
|---|---|---|
| DAU | `admin/user-dashboard/active-stats` | 日活跃用户 |
| 今日分析次数 | `admin/analysis-records/statistics` | 食物分析使用量 |
| 推荐接受率 | `admin/recommendation-debug/quality-dashboard` | 推荐效果 |
| 付费转化率 | `admin/analytics/funnel` | 核心商业指标 |
| MRR | `admin/subscriptions/overview` | 月度经常性收入 |
| 食物库完整度 | `admin/food-pipeline/quality/report` | 数据质量 |

**趋势图（第二行）**：

- 用户增长趋势（近30天）— `admin/user-dashboard/growth-trend`
- 分析使用趋势 — 聚合 `admin/analysis-records/statistics`
- 推荐质量趋势 — `admin/content/recommendation-quality/time-trend`

**快捷运营入口（第三行）**：

- AI补全状态 → 跳转 `/food-library/enrichment`
- 待审核分析 → 跳转 `/analysis-records/list?reviewStatus=pending`
- 活跃A/B实验 → 跳转 `/ab-experiments/list?status=running`

### 4.2 食物详情页（增强：字段状态标记）

**增强功能**：

- 每个字段旁显示状态标签：✅ 已填 / ❌ 缺失 / 🤖 AI补全
- 完整度进度条
- 一键触发AI补全按钮

**数据源**：`GET admin/food-library/:id` + `GET admin/food-pipeline/enrichment/completeness/:id`

### 4.3 AI补全预览页（V8.0新增端点）

**页面功能**：对比当前值 vs AI建议值

**关键字段**：
| 字段 | 说明 |
|---|---|
| 食物名称/分类 | 上下文信息 |
| 字段对比表格 | 当前值 / AI建议值 / 同类均值 / 合法范围 |
| 置信度 | AI置信度分数 |
| 操作 | 通过 / 拒绝 / 手动修改 |

**数据源**：`GET admin/food-pipeline/enrichment/staged/:id/preview`

### 4.4 食谱管理（新增模块）

**页面功能**：食谱CRUD + AI生成 + 审核

**数据源**：`admin/recipes/*`（14个端点已存在）

---

## Step 5：API缺口识别

### 已有API完全覆盖的功能（无需新增）

大部分后台功能已有 API 支持。以下为具体缺口：

### 需要在前端新增的 Service 文件

| Service 文件                       | 说明      | 对应后端端点      |
| ---------------------------------- | --------- | ----------------- |
| `subscriptionManagementService.ts` | ✅ 已存在 | —                 |
| `strategyManagementService.ts`     | ✅ 已存在 | —                 |
| `contentManagementService.ts`      | ✅ 已存在 | —                 |
| `recipeManagementService.ts`       | 🔴 需新建 | `admin/recipes/*` |

### 需要新增的前端 API 调用

| 功能             | 缺失的前端API调用                        | 后端已有端点                                                |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- |
| AI补全预览       | `enrichmentApi.previewStaged(id)`        | `GET enrichment/staged/:id/preview` ✅                      |
| AI补全批量预览   | `enrichmentApi.batchPreviewStaged(ids)`  | `POST enrichment/staged/batch-preview` ✅                   |
| 分阶段补全入队   | `enrichmentApi.enqueueStagedBatch(data)` | `POST enrichment/enqueue-staged` ✅                         |
| 补全进度         | `enrichmentApi.getProgress()`            | `GET enrichment/progress` ✅                                |
| 失败重试         | `enrichmentApi.retryFailed(data)`        | `POST enrichment/retry-failed` ✅                           |
| 单食物完整度     | `enrichmentApi.getCompleteness(id)`      | `GET enrichment/completeness/:id` ✅                        |
| 补全统计         | `enrichmentApi.getStatistics()`          | `GET food-pipeline/enrichment/statistics` ✅                |
| 推荐质量评分分布 | `contentApi.getScoreDistribution()`      | `GET content/recommendation-quality/score-distribution` ✅  |
| 推荐质量趋势     | `contentApi.getTimeTrend()`              | `GET content/recommendation-quality/time-trend` ✅          |
| 策略对比         | `contentApi.getStrategyComparison()`     | `GET content/recommendation-quality/strategy-comparison` ✅ |
| 低质量推荐       | `contentApi.getLowQuality()`             | `GET content/recommendation-quality/low-quality` ✅         |

### 真正的后端API缺口（需要新增）

**无。** 所有后台功能均可通过现有 300+ API 端点实现。

---

## Step 6：权限与角色设计

系统已有完整 RBAC 体系（`admin/roles` + `admin/rbac-permissions`），基于此设计三个角色：

| 角色            | 权限范围            | 能做什么                                                                              | 不能做什么                                         |
| --------------- | ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **super_admin** | `*`                 | 所有操作                                                                              | —                                                  |
| **admin**       | 系统管理 + 全部业务 | 用户封禁/删除、策略创建/激活、A/B实验、订阅计划CRUD、AI补全审核、食物库编辑、权限管理 | 删除管理员账号                                     |
| **operator**    | 业务运营            | 查看数据看板、审核分析记录、AI补全审核、查看推荐调试结果、查看用户画像、管理内容      | 策略激活、A/B实验创建/停止、订阅计划修改、系统配置 |
| **analyst**     | 只读分析            | 查看所有数据看板、查看用户列表/详情、查看分析记录、查看推荐质量                       | 任何写操作                                         |

### 权限码设计

```
dashboard:view
user:list, user:detail, user:ban, user:delete
food:list, food:detail, food:create, food:update, food:delete
food:enrichment:view, food:enrichment:approve, food:enrichment:enqueue
analysis:list, analysis:detail, analysis:review
strategy:list, strategy:detail, strategy:create, strategy:update, strategy:activate
experiment:list, experiment:detail, experiment:create, experiment:update, experiment:status
subscription:list, subscription:detail, subscription:plan:manage, subscription:extend
analytics:view, analytics:funnel, analytics:churn
recipe:list, recipe:detail, recipe:create, recipe:update, recipe:delete, recipe:review
content:view
system:*
```

---

## Step 7：分阶段迭代计划

### Phase 1：最小可用（本次实现）

| 任务           | 改动范围                        | 价值             |
| -------------- | ------------------------------- | ---------------- |
| Dashboard 增强 | 新增食物库完整度卡片 + 质量趋势 | 一屏掌握数据健康 |
| 分析记录增强   | 热门食物排行可视化 + 批量审核   | 提升审核效率     |
| 食物详情页增强 | 字段缺失标记 + 完整度评分       | 精确定位数据问题 |
| AI补全预览页   | 新增 staged 预览对比页面        | 审核前可视化对比 |

### Phase 2：运营能力

| 任务             | 改动范围                         | 价值         |
| ---------------- | -------------------------------- | ------------ |
| 推荐质量看板     | 评分分布 + 趋势 + 低质量列表     | 量化推荐效果 |
| 订阅管理增强     | 转化漏斗可视化 + 趋势            | 优化付费转化 |
| AI补全工作流增强 | 分阶段入队 + 进度监控 + 失败重试 | 完整补全闭环 |
| 食谱管理模块     | 新增完整页面                     | 丰富内容池   |

### Phase 3：优化能力

| 任务             | 改动范围                       | 价值         |
| ---------------- | ------------------------------ | ------------ |
| A/B实验看板增强  | 指标对比 + 显著性分析可视化    | 数据驱动决策 |
| 用户画像分析看板 | 画像分布 + 行为聚类            | 理解用户群体 |
| 数据分析中心     | 成本分析 + 错误分析 + 能力使用 | 运维和优化   |

---

## Step 8：数据指标体系

### 核心指标（仪表盘必须展示）

| 指标         | 计算方式                   | 数据源                                   | 更新频率 |
| ------------ | -------------------------- | ---------------------------------------- | -------- |
| DAU          | 当日活跃用户数             | `active-stats`                           | 5min     |
| WAU/MAU      | 周/月活跃                  | `active-stats`                           | 5min     |
| 今日分析次数 | 当日食物分析总量           | `analysis-records/statistics`            | 10min    |
| 推荐接受率   | accepted / total feedbacks | `recommendation-debug/quality-dashboard` | 5min     |
| 付费转化率   | paid / registered          | `analytics/funnel`                       | 5min     |
| MRR          | 月度经常性收入             | `subscriptions/overview`                 | 10min    |
| 食物库完整度 | 核心营养素覆盖率           | `food-pipeline/quality/report`           | 5min     |
| AI分析置信度 | 平均置信度分数             | `analysis-records/statistics`            | 10min    |

### 运营指标（各模块页面展示）

| 指标           | 所在页面              |
| -------------- | --------------------- |
| 补全成功率     | AI补全管理            |
| 待审核数量     | AI补全管理 / 分析记录 |
| 策略覆盖用户数 | 策略管理              |
| 实验显著性     | A/B实验详情           |
| 流失风险分布   | 数据分析              |
| 渠道转化差异   | 数据分析              |

---

## 实施说明

本设计的所有功能均基于现有后端 API，无需新增后端接口。
前端改动主要集中在：

1. 新增/增强 Service 层（补充缺失的 API 调用）
2. 新增/增强页面组件
3. 遵循现有代码模式（ProTable + React Query + routeConfig）
