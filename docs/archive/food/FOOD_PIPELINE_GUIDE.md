# 食物数据管道 — Admin 后台使用指南

> 本文档整合了食物管道的完整架构、API 接口与 Admin 后台管理操作流程。

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Admin 后台界面                                │
│  管道总览 │ USDA导入 │ AI标注 │ 翻译管理 │ 冲突审核 │ 数据质量 │ 图片识别  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP (JWT + Roles: admin/super_admin)
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    API Server (NestJS)                                   │
│  Controller: /admin/food-pipeline/*                                     │
│  Orchestrator: FoodPipelineOrchestratorService                          │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ USDA     │  │ OFF      │  │ Cleaner  │  │ Dedup    │  │ Rule     │ │
│  │ Fetcher  │  │ Service  │  │ Service  │  │ Service  │  │ Engine   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ AI Label │  │ AI Trans │  │ Conflict │  │ Quality  │  │ Image    │ │
│  │ Service  │  │ Service  │  │ Resolver │  │ Monitor  │  │ Recogn.  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│  ┌──────────┐                                                           │
│  │ Sync     │ ← Cron 定时调度                                           │
│  │ Scheduler│                                                           │
│  └──────────┘                                                           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  PostgreSQL                                                             │
│  foods │ food_sources │ food_conflicts │ food_change_logs │             │
│  food_translations │ food_health_assessments │ food_taxonomies │         │
│  food_nutrition_details │ food_portion_guides                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、Admin 后台页面说明

Admin 后台路径：`/food-pipeline/*`，需要 `admin` 或 `super_admin` 角色。

### 2.1 管道总览（Dashboard）

**路径**: `/food-pipeline/dashboard`

功能：

- 数据统计卡片（总食物数、已验证、待审核、近 7 天变更）
- 数据完整度进度条（蛋白质、微量元素、GI、过敏原、搭配、标签、图片）
- 分类/来源分布
- 顶部 **建议下一步** 提示：根据当前覆盖率、冲突数和一致性指标自动提示优先动作
- 中部 **推荐流程**：按 `导入 -> 标注 -> 翻译 -> 评分 -> 质检` 5 步展示，每步包含：
  - 什么时候做
  - 什么时候可以跳过
  - 完成标准
  - 常见问题
  - 解决建议
  - 小例子
- 底部 **高级维护与排错**：把候选晋升、分阶段补全、一致性校验、补全统计等低频动作单独收纳

常见使用方式：

1. 先看 **建议下一步**，确认系统推荐你当前优先做哪一步
2. 再看对应流程卡，理解这一步的目标、跳过条件和完成标准
3. 确认属于常规场景后，直接在该步骤卡片里点击按钮
4. 只有在补历史数据、查异常或处理疑难问题时，再使用“高级维护与排错”区块

典型例子：

- 想新增鸡胸肉、米饭等基础食物：先做 **导入原始数据**
- 导入后推荐条件不够用：做 **补全分类和标签**
- 英文端看不到食物名：做 **补全多语言**
- 推荐系统拿不到 qualityScore：做 **计算评分与回填**
- 同一食物不同来源热量差很多：做 **处理冲突与质检**

| 按钮         | 调用接口                      | 说明                 |
| ------------ | ----------------------------- | -------------------- |
| USDA 导入    | `POST /import/usda`           | 跳转 USDA 导入页面   |
| 条形码查询   | `GET /barcode/:code`          | 弹窗输入条形码查询   |
| AI 标注      | `POST /ai/label`              | 跳转 AI 标注页面     |
| AI 翻译      | `POST /ai/translate`          | 跳转翻译管理页面     |
| 计算评分     | `POST /rules/apply`           | 直接执行规则引擎计算 |
| 自动解决冲突 | `POST /conflicts/resolve-all` | 直接执行冲突自动解决 |

此外，总览页还集成以下高级动作：

- `POST /rules/backfill-nutrient-scores`：批量回填历史缺失评分
- `POST /candidates/promote`：将候选食物晋升到正式食物库
- `POST /enrichment/batch-stage`：按阶段即时补全
- `GET /quality/consistency/:id`：校验单个食物是否偏离同类分布
- `GET /enrichment/statistics`：查看 AI 补全运维统计

### 2.2 USDA 导入

**路径**: `/food-pipeline/usda-import`

关键说明：USDA 导入不是 AI 分阶段补全。

- USDA 导入走的是外部数据同步链路：`UsdaFetcherService -> FoodDataCleanerService -> FoodDedupService -> persistSingleFood()`
- 它负责把 USDA 已有事实数据抓取、清洗、去重、补缺失、入库
- 它不会调用 `FoodEnrichmentService.enrichFoodByStage()`，也不会按 `ENRICHMENT_STAGES` 的 1-5 阶段执行
- AI 分阶段补全是另一条链路：`batchEnrichByStage -> FoodEnrichmentService.getFoodsNeedingEnrichment() -> enrichFoodByStage()`
- 两者唯一的交集是最终都可能写入 `foods` 和拆分表（`food_nutrition_details / food_health_assessments / food_taxonomies / food_portion_guides`）

字段覆盖差异：

- USDA 更像“导入已有事实”：宏量营养、部分微量营养、部分健康属性、分类和份量等，以外部源返回为准
- AI 分阶段更像“补推断缺失”：针对库里已经存在但缺字段的食物，按阶段补齐推断值

AI 分阶段补全的 5 个阶段如下：

1. 阶段 1 核心营养素：`protein / fat / carbs / fiber / sugar / sodium / food_form`
2. 阶段 2 微量营养素：`calcium / iron / potassium / cholesterol / vitamin_a / vitamin_c / vitamin_d / vitamin_e / vitamin_b12 / vitamin_b6 / folate / zinc / magnesium / saturated_fat / trans_fat / purine / phosphorus / added_sugar / natural_sugar / omega3 / omega6 / soluble_fiber / insoluble_fiber / water_content_percent`
3. 阶段 3 健康属性：`glycemic_index / glycemic_load / fodmap_level / oxalate_level / processing_level / allergens / tags`
4. 阶段 4 使用属性：`meal_types / common_portions / flavor_profile / cuisine / cooking_methods / sub_category / food_group / main_ingredient / standard_serving_desc / quality_score / satiety_score / nutrient_density / commonality_score / popularity / aliases`
5. 阶段 5 扩展属性：`ingredient_list / texture_tags / dish_type / prep_time_minutes / cook_time_minutes / skill_required / estimated_cost_level / shelf_life_days / serving_temperature / dish_priority / acquisition_difficulty / compatibility / available_channels / required_equipment`

运维建议：

- 如果目的是补中国主库已有食物的 USDA 客观营养数据，优先用 USDA 导入，模式建议 `fill_missing_only`
- 如果目的是补 USDA / 中国成分表里都没有、需要模型推断的字段，才用 AI 分阶段补全
- USDA 预估/导入是同步请求，批次偏大时耗时会明显上升；后台前端已为 USDA 请求单独放宽超时，但日常仍建议优先从小批量开始（如关键词 10-20、预设每组 5-10、分类单页 10-20）

操作流程：

1. 输入关键词（如 "chicken breast"）
2. 点击 **搜索预览** → 调用 `GET /usda/search?query=xxx&pageSize=20`
3. 预览结果表格展示（名称、热量、蛋白质、来源ID 等）
4. 设置最大导入数量（默认 100）
5. 点击 **批量导入** → 调用 `POST /import/usda { query, maxItems }`
6. 后端自动执行：采集 → 清洗 → 去重 → 规则计算 → 入库
7. 返回结果：新增/更新/跳过/错误 数量

### 2.3 AI 标注

**路径**: `/food-pipeline/ai-label`

操作流程：

1. 选择目标分类（可选，如 protein / grain / veggie 等）
2. 勾选 **仅标注缺失** 选项（`unlabeled: true`）
3. 设置批次大小（默认 100）
4. 点击 **开始标注** → 调用 `POST /ai/label { category, unlabeled, limit }`
5. 后端使用 DeepSeek V3 为每条食物补充：
   - `category`、`subCategory`、`foodGroup`
   - `mainIngredient`、`processingLevel`
   - `mealTypes`、`allergens`、`compatibility`
   - `tags`（合并已有标签）
6. 标注完成后自动触发 **规则引擎** 重新计算 `qualityScore`、`satietyScore`、`nutrientDensity`
7. 返回结果：标注成功/失败 数量

AI 标注与 AI 数据补全不是同一个服务，职责也不同：

- `AI 标注` 页面走 `FoodAiLabelService.labelBatch(...)`
- 主要面向“结构化标签化”：补 `category / subCategory / foodGroup / mainIngredient / processingLevel / mealTypes / allergens / compatibility / tags`
- 它是轻量批量标注流程，强调给食物打分类、标签、过敏原、餐次、搭配关系，并在结束后重跑规则评分
- 它不走 `FoodEnrichmentService.enrichFoodByStage()`，也不走 5 阶段补全、审核暂存、补全历史等机制

`AI 数据补全` 页面则走 `FoodEnrichmentService`：

- 支持按 `ENRICHMENT_STAGES` 的 5 个阶段补字段
- 面向“字段级缺失补全”，不仅补标签，也补营养、健康属性、使用属性、扩展属性
- 支持直接入库 / staging 审核 / 队列 / 补全历史 / 回退 / 完整度统计

如果中国食物成分表的数据已经主要通过 `AI 数据补全` 跑过，而且效果成熟，那么从能力一致性角度看，后续确实更适合逐步把“结构字段补全”收敛到 `FoodEnrichmentService` 体系，而不是长期并行维护两套 AI 逻辑。

但当前代码下，二者仍然有明显边界：

- `AI 标注` 更快、更轻，适合导入后快速打标签
- `AI 数据补全` 更完整、更重，适合正式补库、审核、留痕和可回退运维

当前建议：

1. 如果目标只是导入后快速补 `category/tags/allergens/mealTypes`，继续使用 `AI 标注`
2. 如果目标是“长期只保留一套成熟 AI 管道”，建议后续把第 2 步逐步迁移成 `FoodEnrichmentService` 的结构字段阶段能力，并保留现有审核/历史/回退链路
3. 在迁移完成前，不建议直接删除 `AI 标注`，否则总览页第 2 步会失去一个轻量快速入口

### 2.4 翻译管理

**路径**: `/food-pipeline/translation`

操作流程：

1. 查看各语言翻译覆盖率统计
2. 选择目标语言（en-US / zh-CN / zh-TW / ja-JP / ko-KR）
3. 勾选 **仅未翻译** 选项
4. 设置批次大小（默认 100）
5. 点击 **开始翻译** → 调用 `POST /ai/translate { targetLocales, untranslatedOnly, limit }`
6. 后端使用 DeepSeek V3 翻译食物名称、别名、描述、份量描述
7. 结果写入 `food_translations` 表（按 `foodId + locale` upsert）
8. 返回结果：翻译成功/失败 数量

### 2.5 冲突审核

**路径**: `/food-pipeline/conflicts`

冲突产生原因：不同数据源（USDA、OpenFoodFacts、AI）对同一食物的营养字段存在差异。

自动解决规则：
| 差异范围 | 解决策略 |
|-----------|---------------|
| < 5% | 取高优先级来源值 |
| 5% - 15% | 取加权平均 |
| > 15% | 标记人工审核 |
| 分类不一致 | 取高优先级来源 |
| 过敏原差异 | 取并集（安全优先）|

来源优先级：`usda (100) > cn_food_composition (95) > openfoodfacts (80) > manual (70) > ai (40) > crawl (30)`

操作流程：

**方式一：一键自动解决**

1. 点击 **自动解决所有** → 调用 `POST /conflicts/resolve-all`
2. 系统按上述规则自动处理

**方式二：人工逐条审核**

1. 查看冲突列表（ProTable 分页展示）
2. 点击单条冲突 → 弹窗展示各来源数据对比
3. 选择解决方案：最高优先级 / 加权平均 / 手动指定 / 忽略
4. 提交 → 调用食物库管理冲突接口 `POST /admin/food-library/conflicts/:conflictId/resolve`

### 2.6 数据质量监控

**路径**: `/food-pipeline/quality-monitor`

展示内容：

- **完整度得分**仪表盘（百分比）
- **质量得分**仪表盘
- **7 项字段完整度**进度条：
  - 蛋白质覆盖率
  - 微量元素覆盖率（维生素/矿物质）
  - 血糖指数（GI）覆盖率
  - 过敏原标注率
  - 搭配信息覆盖率
  - 标签覆盖率
  - 图片覆盖率
- **质量指标**：已验证数、平均置信度、低置信度数、宏量不一致数
- **冲突统计**：总数 / 待处理 / 已解决 / 需人工审核
- **翻译统计**：各语言覆盖率

数据来源：`GET /quality/report`

### 2.7 图片识别

**路径**: `/food-pipeline/image-recognition`

操作流程：

**方式一：上传图片**

1. 点击上传或拖拽图片文件
2. 调用 `POST /recognize/image` (FormData)
3. 后端使用 DeepSeek-VL / GPT-4o-mini 视觉模型识别
4. 展示识别结果：食物名称、英文名、置信度、分类、估算热量

**方式二：URL 识别**

1. 输入图片 URL
2. 调用 `POST /recognize/url { imageUrl }`
3. 同上返回识别结果

---

## 三、页面到接口/数据表对照

| Admin 页面 | 前端路径 | 主要接口 | 主要读写表 |
| ---------- | -------- | -------- | ---------- |
| 管道总览 | `/food-pipeline/dashboard` | `GET /quality/report` `POST /import/usda` `POST /ai/label` `POST /ai/translate` `POST /rules/apply` `POST /conflicts/resolve-all` | `foods` `food_sources` `food_change_logs` `food_conflicts` `food_translations` `food_health_assessments` `food_taxonomies` `food_nutrition_details` |
| USDA 导入 | `/food-pipeline/usda-import` | `GET /usda/search` `POST /import/usda` | `foods` `food_sources` `food_change_logs` `food_conflicts` `food_health_assessments` `food_taxonomies` |
| AI 标注 | `/food-pipeline/ai-label` | `POST /ai/label` | `foods` `food_taxonomies` `food_health_assessments` `food_change_logs` |
| 翻译管理 | `/food-pipeline/translation` | `POST /ai/translate` `GET /quality/report` | `food_translations` `foods` |
| 冲突审核 | `/food-pipeline/conflicts` | `POST /conflicts/resolve-all` `POST /admin/food-library/conflicts/:conflictId/resolve` | `food_conflicts` `foods` `food_sources` `food_change_logs` |
| 数据质量监控 | `/food-pipeline/quality-monitor` | `GET /quality/report` | `foods` `food_conflicts` `food_translations` `food_health_assessments` `food_taxonomies` `food_nutrition_details` |
| 图片识别 | `/food-pipeline/image-recognition` | `POST /recognize/image` `POST /recognize/url` | 无持久化主路径；识别结果默认即时返回 |

说明：
- `foods` 只承载基础信息、宏量营养和元数据；标签、评分、GI、微量营养、份量等通过 split tables 读写。
- 冲突人工审核不走 `/admin/food-pipeline`，而是走食物库管理控制器下的冲突解决接口。

---

## 四、完整 API 接口列表

基础路径：`/admin/food-pipeline`  
认证：JWT Bearer Token + 角色校验（admin / super_admin）

| 方法 | 路径                              | 功能                         | 请求体 / 参数                                                                 |
| ---- | --------------------------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| POST | `/import/usda`                    | USDA 批量导入                | `{ query: string, maxItems?: number }`                                        |
| GET  | `/usda/search`                    | USDA 搜索预览                | `?query=xxx&pageSize=20`                                                      |
| GET  | `/barcode/:code`                  | 条形码查询导入               | URL 参数 `code`                                                               |
| GET  | `/openfoodfacts/search`           | OFF 搜索预览                 | `?query=xxx&pageSize=20`                                                      |
| POST | `/ai/label`                       | AI 批量标注                  | `{ category?: string, unlabeled?: boolean, limit?: number }`                  |
| POST | `/ai/translate`                   | AI 批量翻译                  | `{ targetLocales?: string[], limit?: number, untranslatedOnly?: boolean }`    |
| POST | `/rules/apply`                    | 规则引擎批量计算             | `{ limit?: number, recalcAll?: boolean }`                                     |
| POST | `/rules/backfill-nutrient-scores` | 回填 `qualityScore` 等评分   | `{ batchSize?: number }`                                                      |
| POST | `/conflicts/resolve-all`          | 自动解决所有冲突             | —                                                                             |
| POST | `/recognize/image`                | 上传图片识别                 | FormData `image` 字段                                                         |
| POST | `/recognize/url`                  | URL 图片识别                 | `{ imageUrl: string }`                                                        |
| GET  | `/quality/report`                 | 数据质量报告                 | —                                                                             |
| POST | `/candidates/promote`             | 候选食物晋升为正式食物       | `{ minConfidence?: number, limit?: number }`                                  |
| POST | `/enrichment/batch-stage`         | 分阶段即时补全               | `{ stages?: number[], limit?: number, category?: string }`                    |
| GET  | `/quality/consistency/:id`        | 单食物同类一致性校验         | URL 参数 `id`                                                                 |
| GET  | `/enrichment/statistics`          | AI 补全统计                  | —                                                                             |

---

## 五、数据处理管道流程（内部）

一条食物数据从外部源到最终入库的完整流程：

```
                ┌─────────────┐
                │  外部数据源   │
                │ USDA / OFF  │
                │ / 条形码     │
                └──────┬──────┘
                       │ 原始数据
                       ▼
              ┌────────────────┐
         ①   │  数据清洗       │  FoodDataCleanerService
              │  - 空值过滤     │  calories=0 → 丢弃
              │  - 文本标准化   │  去除特殊字符
              │  - 异常值裁剪   │  合理范围 [0, 900] kcal
              │  - 单位转换     │  kJ → kcal
              │  - 宏量交叉验证 │  P×4+C×4+F×9 vs cal
              └───────┬────────┘
                      │ CleanedFoodData
                      ▼
              ┌────────────────┐
         ②   │  去重检测       │  FoodDedupService
              │  1. 条形码匹配  │  → 合并更新
              │  2. 来源ID匹配  │  → 合并更新 + 冲突检测
              │  3. 名称精确匹配 │  → 跳过
              │  4. 名称模糊匹配 │  name×0.6 + nutrition×0.4
              │     阈值 0.85   │  → 跳过
              │  5. 无匹配      │  → 新增
              └───────┬────────┘
                      │
            ┌─────────┼──────────┐
            ▼         ▼          ▼
        [新增]    [合并更新]   [跳过]
            │         │
            ▼         ▼
              ┌────────────────┐
         ③   │  规则引擎       │  FoodRuleEngineService
              │  - 自动标签     │  16+ 种标签自动推导
              │  - qualityScore │  品质评分 (1-10)
              │  - satietyScore │  饱腹感评分 (1-10)
              │  - nutrientDens │  NRF 营养密度
              └───────┬────────┘
                      │
                      ▼
              ┌──────────────────────────────┐
         ④   │  持久化入库                   │
              │  - 写入 foods 主表           │
              │  - 写入 food_sources         │
              │  - 写入 food_change_logs     │
              │  - 同步 upsert 拆分表：      │
              │    food_health_assessments   │
              │    food_taxonomies           │
              │    food_nutrition_details    │
              │    food_portion_guides       │
              │  - 默认 status = 'draft'     │
              │  - code = FOOD_G_00001       │
              └───────┬──────────────────────┘
                      │
          ┌───────────┼──────────────┐
          ▼           ▼              ▼
  ┌──────────┐ ┌───────────┐ ┌────────────┐
  │ AI 标注   │ │  AI 翻译   │ │  冲突解决   │
  │ (按需)    │ │  (按需)    │ │  (自动/人工)│
  └──────────┘ └───────────┘ └────────────┘
```

---

## 六、种子数据导入（本地数据）

除了外部数据源管道，还有本地种子数据导入机制：

**数据文件**: `apps/api-server/src/scripts/seeds/seed-foods.data.ts`  
**执行脚本**: `apps/api-server/src/scripts/seeds/seed-foods.ts`

```bash
# 在仓库根目录运行种子数据导入（幂等操作，按 name 去重）
pnpm --dir apps/api-server exec ts-node -r tsconfig-paths/register src/scripts/seeds/seed-foods.ts
```

种子数据特点：

- 参考中国食物成分表，覆盖主食、肉类、蔬菜、豆制品、水果、汤类、饮品、零食、快餐等分类
- 自动推导字段：`tags`（基于营养数据）、`isProcessed`、`isFried`、`mainIngredient`、`processingLevel`（NOVA 1-4）、`foodGroup`、`allergens`、`commonPortions`、`glycemicLoad`、`nutrientDensity`
- 中文分类自动映射为英文标准分类码（grain/protein/veggie/fruit/composite 等）

---

## 七、定时调度任务

`FoodSyncSchedulerService` 自动运行以下定时任务：

| 执行时间        | 任务名称      | 说明                                     |
| --------------- | ------------- | ---------------------------------------- |
| 每月 1 号 05:30 | USDA 月度同步 | 拉取 22 类常见食物（每类 50 条）         |
| 每天 04:00      | 冲突自动解决  | 按优先级规则自动处理待解决冲突           |
| 每天 05:00      | 分数批量计算  | 为缺失分数的食物计算评分（最多 1000 条） |
| 每周一 06:00    | 质量报告生成  | 生成质量报告并输出摘要日志               |

---

## 八、推荐操作流程（SOP）

### 7.1 首次初始化

```
① 导入种子数据（中国食物成分表）
   → pnpm --dir apps/api-server exec ts-node -r tsconfig-paths/register src/scripts/seeds/seed-foods.ts

② USDA 批量导入常见食物
   → Admin 后台 → USDA 导入 → 搜索 "chicken" / "rice" / "broccoli" ...

③ 规则引擎批量计算全部分数
   → Admin 后台 → 管道总览 → 点击「计算评分」
   → POST /rules/apply { recalcAll: true }

④ 快速补结构标签
   → Admin 后台 → AI 标注 → 勾选「仅标注缺失」→ 开始标注

④-补充：如果这批数据需要进入正式 AI 补全链路（分阶段、可审核、可回退）
   → Admin 后台 → AI 数据补全 / 分阶段补全 → 选择结构字段相关阶段再执行

⑤ AI 翻译为至少英文
   → Admin 后台 → 翻译管理 → 选择 `targetLocales = ['en-US']` → 勾选「仅未翻译」→ 开始翻译

⑥ 查看质量报告
   → Admin 后台 → 数据质量 → 确认完整度达标
```

### 7.2 日常维护

```
① 定时任务自动运行（USDA 月度同步 + 每日冲突解决 + 每日分数计算）
② 定期查看质量报告，关注：
   - 低置信度食物数量
   - 宏量营养素不一致数量
   - 各字段完整度百分比
③ 人工审核需要 review 的冲突
   → Admin 后台 → 冲突审核 → 逐条审核 > 15% 差异的冲突
④ 按需追加新分类食物导入
```

### 7.3 新增食物（单条）

```
方式一：条形码扫描
   → Admin 后台 → 管道总览 → 条形码查询 → 输入条形码 → 自动入库

方式二：图片识别 + 手动录入
   → Admin 后台 → 图片识别 → 上传图片 → 获取识别结果
   → 根据结果在食物库管理中手动录入

方式三：USDA 搜索导入
   → Admin 后台 → USDA 导入 → 搜索食物名称 → 批量导入
```

---

## 九、数据表说明

| 表名                        | 用途                                   |
| --------------------------- | -------------------------------------- |
| `foods`                     | 食物主表（基础信息、宏量营养、元数据） |
| `food_sources`              | 数据来源记录（多来源追溯）             |
| `food_conflicts`            | 来源冲突记录                           |
| `food_change_logs`          | 数据变更审计日志                       |
| `food_translations`         | 多语言翻译                             |
| `food_health_assessments`   | GI/GL、加工程度、质量评分              |
| `food_taxonomies`           | 标签、过敏原、兼容性、餐次             |
| `food_nutrition_details`    | 微量营养与精细化营养字段               |
| `food_portion_guides`       | 份量、烹饪、设备、温度等信息           |

---

## 十、前端服务层（React Query）

`apps/admin/src/services/foodPipelineService.ts` 提供以下 React Query Hooks：

| Hook                       | 类型     | 说明             |
| -------------------------- | -------- | ---------------- |
| `useQualityReport()`       | Query    | 获取质量报告     |
| `useImportUsda()`          | Mutation | USDA 批量导入    |
| `useBatchAiLabel()`        | Mutation | AI 批量标注      |
| `useBatchAiTranslate()`    | Mutation | AI 批量翻译      |
| `useBatchApplyRules()`     | Mutation | 规则引擎计算     |
| `useResolveAllConflicts()` | Mutation | 自动解决所有冲突 |
| `useLookupBarcode()`       | Mutation | 条形码查询       |
| `useRecognizeImage()`      | Mutation | 图片上传识别     |
| `useRecognizeImageByUrl()` | Mutation | URL 图片识别     |
