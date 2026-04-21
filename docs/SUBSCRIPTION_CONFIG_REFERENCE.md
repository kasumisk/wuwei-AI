# 订阅配置项完整参考文档

> 最后更新：2026-04-20  
> 数据来源：`subscription.types.ts` / `quota-gate.service.ts` / admin UI `pages/subscription/plans/index.tsx`

---

## 一、订阅档位总览

| 档位标识  | 中文名         | 定位                               |
| --------- | -------------- | ---------------------------------- |
| `free`    | 免费版         | 基础体验，功能和次数受限           |
| `pro`     | Pro 专业版     | 解锁核心 AI 功能，次数大幅提升     |
| `premium` | Premium 旗舰版 | 全功能无限制，含高级报告与优先响应 |

---

## 二、配额配置项完整说明

### 2.1 计次配额（每日重置，-1 = 无限制）

| 配置键              | 中文名称         | 说明                                        | FREE | PRO | PREMIUM |
| ------------------- | ---------------- | ------------------------------------------- | ---- | --- | ------- |
| `recommendation`    | 每日推荐次数     | 用户每日可获取下一餐推荐的次数，-1 为无限制 | 3    | ∞   | ∞       |
| `ai_image_analysis` | AI 图片分析次数  | 每日可上传图片进行 AI 识别分析的次数        | 1    | 20  | ∞       |
| `ai_text_analysis`  | AI 文本分析次数  | 每日可发起文本输入分析的次数                | 3    | ∞   | ∞       |
| `ai_coach`          | AI 教练对话次数  | 每日可与 AI 教练进行对话的次数              | 5    | ∞   | ∞       |
| `analysis_history`  | 分析历史查看条数 | 可查看的历史分析记录条数，-1 为全量查看     | 3    | ∞   | ∞       |

> **技术说明**：计次配额在 `QuotaGateService.checkAndConsume()` 中扣减，基于 Redis 日级计数器（key 格式：`quota:{userId}:{feature}:{YYYY-MM-DD}`）。数值 `-1` 跳过扣减直接放行。

### 2.2 功能开关（能力级控制，开启则解锁对应功能）

| 配置键                      | 中文名称       | 说明                                               | FREE | PRO | PREMIUM |
| --------------------------- | -------------- | -------------------------------------------------- | ---- | --- | ------- |
| `detailed_score`            | 详细评分拆解   | 是否展示评分详细拆解维度（能量/蛋白质/宏量均衡等） | ✗    | ✓   | ✓       |
| `advanced_explain`          | 高级解释       | 是否开放高级可解释性分析（V2 可视化决策链路）      | ✗    | ✓   | ✓       |
| `deep_nutrition`            | 深度营养拆解   | 是否展示完整微量营养素和宏量成分占比图表           | ✗    | ✓   | ✓       |
| `personalized_alternatives` | 个性化替代建议 | 是否基于用户目标和偏好推荐个性化替代食物           | ✗    | ✓   | ✓       |
| `reports`                   | 周报/月报      | 是否可生成饮食周报和月度营养分析报告               | ✗    | ✓   | ✓       |
| `full_day_plan`             | 全天膳食规划   | V2 每日三餐完整计划（早/中/晚+加餐）               | ✗    | ✓   | ✓       |
| `full_day_linkage`          | 全天膳食联动   | V2 跨餐纠偏：前餐过量后自动调整下一餐建议          | ✗    | ✗   | ✓       |
| `recipe_generation`         | 食谱生成       | 是否可生成个性化食谱（基于食材库和用户偏好）       | ✗    | ✗   | ✓       |
| `health_trend`              | 健康趋势分析   | 是否可查看长期健康趋势图表（30天/90天）            | ✗    | ✗   | ✓       |
| `priority_ai`               | 优先 AI 响应   | 请求优先级高于免费用户，减少 AI 排队等待           | ✗    | ✗   | ✓       |
| `behavior_analysis`         | 行为分析       | V3 用户饮食行为画像、主动提醒、决策反馈分析        | ✗    | ✓   | ✓       |
| `coach_style`               | 教练风格选择   | V5 严格/友善/数据三种 AI 教练人格风格切换          | ✗    | ✓   | ✓       |
| `advanced_challenges`       | 高级挑战       | V4 高级挑战模式，Free 用户仅可查看不可参与         | ✗    | ✓   | ✓       |

### 2.3 数据导出（混合型：关闭 / CSV / PDF+Excel）

| 配置键        | 中文名称     | FREE       | PRO      | PREMIUM          |
| ------------- | ------------ | ---------- | -------- | ---------------- |
| `data_export` | 导出格式权限 | 不允许导出 | CSV 导出 | PDF + Excel 导出 |

> **值说明**：`false` = 不允许导出；`'csv'` = 允许 CSV 格式；`'pdf_excel'` = 允许 PDF + Excel 格式。该字段为混合类型（`boolean | string`），在后台配置界面以三态下拉框呈现。

---

## 三、接口与订阅权限映射

### 3.1 硬门控接口（`@RequireSubscription`，不满足直接 403）

用户订阅档位低于要求时，接口直接返回 `403 Forbidden`，不做降级处理。

| HTTP 方法 | 接口路径                         | 所需最低档位 | 对应功能                         | 控制器文件                    |
| --------- | -------------------------------- | ------------ | -------------------------------- | ----------------------------- |
| `GET`     | `/api/app/food/daily-plan`       | **PRO**      | 全天膳食规划 (`full_day_plan`)   | `food-plan.controller.ts`     |
| `GET`     | `/api/app/food/behavior-profile` | **PRO**      | 行为分析 (`behavior_analysis`)   | `food-behavior.controller.ts` |
| `GET`     | `/api/app/food/proactive-check`  | **PRO**      | 行为分析 (`behavior_analysis`)   | `food-behavior.controller.ts` |
| `PUT`     | `/api/app/coach/style`           | **PRO**      | 教练风格选择 (`coach_style`)     | `coach.controller.ts`         |
| `POST`    | `/api/app/challenges/:id/join`   | **PRO**      | 高级挑战 (`advanced_challenges`) | `gamification.controller.ts`  |

> **注意**：当前无 PREMIUM 专属硬门控接口。PREMIUM 独有功能（`full_day_linkage`、`recipe_generation`、`health_trend`、`priority_ai`）通过软配额检查实现，未来可按需升级为硬门控。

### 3.2 软配额接口（`QuotaGateService.checkAndConsume`，配额耗尽后拒绝或降级）

| HTTP 方法 | 接口路径                         | GatedFeature 枚举值 | 中文名称         | 耗尽行为              |
| --------- | -------------------------------- | ------------------- | ---------------- | --------------------- |
| `POST`    | `/api/app/food/analyze`          | `AI_IMAGE_ANALYSIS` | AI 图片分析次数  | 硬拒绝，返回 429      |
| `POST`    | `/api/app/food/analyze-text`     | `AI_TEXT_ANALYSIS`  | AI 文本分析次数  | 硬拒绝，返回 429      |
| `GET`     | `/api/app/food/analysis/history` | `ANALYSIS_HISTORY`  | 分析历史查看条数 | 软降级，仅返回前 N 条 |

### 3.3 按配置项归类的完整接口权限矩阵

| 配置项（中文）   | 配置键                      | 关联接口                                                                  | FREE 可访问 | PRO 可访问 | PREMIUM 可访问 |
| ---------------- | --------------------------- | ------------------------------------------------------------------------- | ----------- | ---------- | -------------- |
| AI 图片分析次数  | `ai_image_analysis`         | `POST /api/app/food/analyze`                                              | 1次/天      | 20次/天    | 无限           |
| AI 文本分析次数  | `ai_text_analysis`          | `POST /api/app/food/analyze-text`                                         | 3次/天      | 无限       | 无限           |
| AI 教练对话次数  | `ai_coach`                  | `POST /api/app/coach/chat`（含 AI 对话）                                  | 5次/天      | 无限       | 无限           |
| 每日推荐次数     | `recommendation`            | `GET /api/app/food/suggestion`                                            | 3次/天      | 无限       | 无限           |
| 分析历史查看条数 | `analysis_history`          | `GET /api/app/food/analysis/history`                                      | 3条         | 全量       | 全量           |
| 全天膳食规划     | `full_day_plan`             | `GET /api/app/food/daily-plan`                                            | ✗（403）    | ✓          | ✓              |
| 行为分析         | `behavior_analysis`         | `GET /api/app/food/behavior-profile`，`GET /api/app/food/proactive-check` | ✗（403）    | ✓          | ✓              |
| 教练风格选择     | `coach_style`               | `PUT /api/app/coach/style`                                                | ✗（403）    | ✓          | ✓              |
| 高级挑战         | `advanced_challenges`       | `POST /api/app/challenges/:id/join`                                       | ✗（403）    | ✓          | ✓              |
| 数据导出         | `data_export`               | 导出接口（待实现）                                                        | ✗           | CSV        | PDF+Excel      |
| 周报/月报        | `reports`                   | 报告接口（待实现）                                                        | ✗           | ✓          | ✓              |
| 食谱生成         | `recipe_generation`         | 食谱接口（待实现）                                                        | ✗           | ✗          | ✓              |
| 健康趋势分析     | `health_trend`              | 趋势图接口（待实现）                                                      | ✗           | ✗          | ✓              |
| 优先 AI 响应     | `priority_ai`               | 全量 AI 接口（队列优先级）                                                | ✗           | ✗          | ✓              |
| 详细评分拆解     | `detailed_score`            | 评分响应字段控制                                                          | ✗           | ✓          | ✓              |
| 高级解释         | `advanced_explain`          | 决策解释响应字段控制                                                      | ✗           | ✓          | ✓              |
| 深度营养拆解     | `deep_nutrition`            | 营养分析响应字段控制                                                      | ✗           | ✓          | ✓              |
| 个性化替代建议   | `personalized_alternatives` | 决策响应 `alternatives` 字段控制                                          | ✗           | ✓          | ✓              |
| 全天膳食联动     | `full_day_linkage`          | 跨餐纠偏逻辑（联动建议）                                                  | ✗           | ✗          | ✓              |

---

## 四、后台管理界面配置说明

### 4.1 套餐管理表格

| 列名     | 说明                                                    |
| -------- | ------------------------------------------------------- |
| 套餐等级 | free / pro / premium                                    |
| 名称     | 套餐显示名称（可自定义）                                |
| 计费周期 | 月付 / 年付 / 终身                                      |
| 价格     | 单位：分（例：1990 = ¥19.90）                           |
| 配额概览 | 快速预览：图片次数 / 教练次数 / 全天计划 / 行为分析状态 |
| 状态     | 启用 / 禁用                                             |
| 操作     | 编辑基本信息 / 配额配置                                 |

### 4.2 配额配置 Drawer

入口：点击表格操作列「配额配置」按钮，弹出宽 620px 的侧边抽屉。

**第一分区：计次配额（每日重置，-1 = 无限制）**

每项包含「无限制」Toggle + InputNumber 数字输入框（单位：次/天）。Toggle 开启时显示 `∞ 无限制`，数字框禁用。

| 序号 | 标签             | 说明                     |
| ---- | ---------------- | ------------------------ |
| 1    | 每日推荐次数     | 对应 `recommendation`    |
| 2    | AI 图片分析次数  | 对应 `ai_image_analysis` |
| 3    | AI 文本分析次数  | 对应 `ai_text_analysis`  |
| 4    | AI 教练对话次数  | 对应 `ai_coach`          |
| 5    | 分析历史查看条数 | 对应 `analysis_history`  |

**第二分区：功能开关（能力级控制，开启则解锁对应功能）**

以 2 列网格排布的 Switch 开关组。

| 标签           | 配置键                      |
| -------------- | --------------------------- |
| 详细评分拆解   | `detailed_score`            |
| 高级解释       | `advanced_explain`          |
| 深度营养拆解   | `deep_nutrition`            |
| 个性化替代建议 | `personalized_alternatives` |
| 周报/月报      | `reports`                   |
| 全天膳食规划   | `full_day_plan`             |
| 全天膳食联动   | `full_day_linkage`          |
| 食谱生成       | `recipe_generation`         |
| 健康趋势分析   | `health_trend`              |
| 优先 AI 响应   | `priority_ai`               |
| 行为分析       | `behavior_analysis`         |
| 教练风格选择   | `coach_style`               |
| 高级挑战       | `advanced_challenges`       |

**第三分区：数据导出（混合型）**

三态下拉框（Select）：

| 选项值        | 显示文本              |
| ------------- | --------------------- |
| `false`       | 不允许导出            |
| `'csv'`       | 允许 CSV 导出         |
| `'pdf_excel'` | 允许 PDF + Excel 导出 |

**保存行为**：点击「保存配置」仅发送 `{ entitlements: {...} }` 到 `PUT /admin/subscriptions/plans/:id`，不影响套餐基本信息。

### 4.3 编辑基本信息 Modal

| 字段           | 标签       | 类型   | 说明                                              |
| -------------- | ---------- | ------ | ------------------------------------------------- |
| `tier`         | 套餐等级   | Select | free / pro / premium                              |
| `billingCycle` | 计费周期   | Select | monthly（月付）/ yearly（年付）/ lifetime（终身） |
| `priceCents`   | 价格（分） | Number | 1990 = ¥19.90，0 = 免费                           |
| `isActive`     | 是否启用   | Switch | 禁用后用户无法订阅该套餐                          |

---

## 五、`GatedFeature` 枚举完整对照

| 枚举值（TypeScript）                     | 字符串 Key                  | 中文名称       | 类型     | 版本 |
| ---------------------------------------- | --------------------------- | -------------- | -------- | ---- |
| `GatedFeature.RECOMMENDATION`            | `recommendation`            | 推荐           | 计次配额 | V1   |
| `GatedFeature.AI_IMAGE_ANALYSIS`         | `ai_image_analysis`         | 图片分析       | 计次配额 | V1   |
| `GatedFeature.AI_TEXT_ANALYSIS`          | `ai_text_analysis`          | 文本分析       | 计次配额 | V6.1 |
| `GatedFeature.AI_COACH`                  | `ai_coach`                  | AI 教练        | 计次配额 | V1   |
| `GatedFeature.ANALYSIS_HISTORY`          | `analysis_history`          | 分析历史       | 计次配额 | V6.1 |
| `GatedFeature.DETAILED_SCORE`            | `detailed_score`            | 详细评分拆解   | 能力开关 | V1   |
| `GatedFeature.ADVANCED_EXPLAIN`          | `advanced_explain`          | 高级解释       | 能力开关 | V2   |
| `GatedFeature.DEEP_NUTRITION`            | `deep_nutrition`            | 深度营养拆解   | 能力开关 | V6.1 |
| `GatedFeature.PERSONALIZED_ALTERNATIVES` | `personalized_alternatives` | 个性化替代建议 | 能力开关 | V6.1 |
| `GatedFeature.REPORTS`                   | `reports`                   | 周报/月报      | 能力开关 | V1   |
| `GatedFeature.DATA_EXPORT`               | `data_export`               | 数据导出       | 混合型   | V1   |
| `GatedFeature.FULL_DAY_PLAN`             | `full_day_plan`             | 全天膳食规划   | 能力开关 | V2   |
| `GatedFeature.FULL_DAY_LINKAGE`          | `full_day_linkage`          | 全天膳食联动   | 能力开关 | V6.1 |
| `GatedFeature.RECIPE_GENERATION`         | `recipe_generation`         | 食谱生成       | 能力开关 | V1   |
| `GatedFeature.HEALTH_TREND`              | `health_trend`              | 健康趋势分析   | 能力开关 | V1   |
| `GatedFeature.PRIORITY_AI`               | `priority_ai`               | 优先 AI 响应   | 能力开关 | V1   |
| `GatedFeature.BEHAVIOR_ANALYSIS`         | `behavior_analysis`         | 行为分析       | 能力开关 | V3   |
| `GatedFeature.COACH_STYLE`               | `coach_style`               | 教练风格选择   | 能力开关 | V5   |
| `GatedFeature.ADVANCED_CHALLENGES`       | `advanced_challenges`       | 高级挑战       | 能力开关 | V4   |

---

## 六、运行时覆盖机制

配额的最终生效优先级为：

```
DB subscription_plan.entitlements（JSONB）
    > 代码 TIER_ENTITLEMENTS 硬编码兜底
```

1. 系统启动或种子脚本运行后，`TIER_ENTITLEMENTS` 中的值写入 DB。
2. 后台通过「配额配置」Drawer 修改后，仅更新 DB 中对应套餐的 `entitlements` 字段。
3. `SubscriptionEntitlementService.getEntitlements(userId)` 读取 DB 值，若字段缺失则从 `TIER_ENTITLEMENTS` 取兜底值，保证向后兼容。

**同步 DB 到硬编码默认值命令**（部署时运行）：

```bash
npx ts-node apps/api-server/src/scripts/seeds/seed-subscription-plans.shared.ts
```

---

## 七、待实现功能说明

以下配置项已在系统中定义并在后台可配置，但对应的业务接口尚未实现：

| 配置键              | 中文名称     | 状态                 |
| ------------------- | ------------ | -------------------- |
| `reports`           | 周报/月报    | 接口待开发           |
| `data_export`       | 数据导出     | 接口待开发           |
| `recipe_generation` | 食谱生成     | 接口待开发           |
| `health_trend`      | 健康趋势分析 | 接口待开发           |
| `priority_ai`       | 优先 AI 响应 | 队列优先级机制待接入 |
| `full_day_linkage`  | 全天膳食联动 | 跨餐纠偏逻辑待实现   |
