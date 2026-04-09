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
│  food_library │ food_source │ food_conflict │ food_change_log │         │
│  food_translation                                                       │
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
- **6 个快捷操作按钮**：

| 按钮         | 调用接口                      | 说明                 |
| ------------ | ----------------------------- | -------------------- |
| USDA 导入    | `POST /import/usda`           | 跳转 USDA 导入页面   |
| 条形码查询   | `GET /barcode/:code`          | 弹窗输入条形码查询   |
| AI 标注      | `POST /ai/label`              | 跳转 AI 标注页面     |
| AI 翻译      | `POST /ai/translate`          | 跳转翻译管理页面     |
| 计算评分     | `POST /rules/apply`           | 直接执行规则引擎计算 |
| 自动解决冲突 | `POST /conflicts/resolve-all` | 直接执行冲突自动解决 |

### 2.2 USDA 导入

**路径**: `/food-pipeline/usda-import`

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

### 2.4 翻译管理

**路径**: `/food-pipeline/translation`

操作流程：

1. 查看各语言翻译覆盖率统计
2. 选择目标语言（en-US / zh-CN / zh-TW / ja-JP / ko-KR）
3. 勾选 **仅未翻译** 选项
4. 设置批次大小（默认 100）
5. 点击 **开始翻译** → 调用 `POST /ai/translate { targetLocale, untranslatedOnly, limit }`
6. 后端使用 DeepSeek V3 翻译食物名称、别名、描述、份量描述
7. 结果写入 `food_translations` 表（按 `foodId + locale` 去重更新）
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

来源优先级：`usda (100) > manual (90) > openfoodfacts (70) > ai (50) > crawl (30)`

操作流程：

**方式一：一键自动解决**

1. 点击 **自动解决所有** → 调用 `POST /conflicts/resolve-all`
2. 系统按上述规则自动处理

**方式二：人工逐条审核**

1. 查看冲突列表（ProTable 分页展示）
2. 点击单条冲突 → 弹窗展示各来源数据对比
3. 选择解决方案：最高优先级 / 加权平均 / 手动指定 / 忽略
4. 提交 → 调用 `resolveConflict(id, resolution)`

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

## 三、完整 API 接口列表

基础路径：`/admin/food-pipeline`  
认证：JWT Bearer Token + 角色校验（admin / super_admin）

| 方法 | 路径                     | 功能             | 请求体 / 参数                                                          |
| ---- | ------------------------ | ---------------- | ---------------------------------------------------------------------- |
| POST | `/import/usda`           | USDA 批量导入    | `{ query: string, maxItems?: number }`                                 |
| GET  | `/usda/search`           | USDA 搜索预览    | `?query=xxx&pageSize=20`                                               |
| GET  | `/barcode/:code`         | 条形码查询导入   | URL 参数 `code`                                                        |
| GET  | `/openfoodfacts/search`  | OFF 搜索预览     | `?query=xxx&pageSize=20`                                               |
| POST | `/ai/label`              | AI 批量标注      | `{ category?: string, unlabeled?: boolean, limit?: number }`           |
| POST | `/ai/translate`          | AI 批量翻译      | `{ targetLocale: string, limit?: number, untranslatedOnly?: boolean }` |
| POST | `/rules/apply`           | 规则引擎批量计算 | `{ limit?: number, recalcAll?: boolean }`                              |
| POST | `/conflicts/resolve-all` | 自动解决所有冲突 | —                                                                      |
| POST | `/recognize/image`       | 上传图片识别     | FormData `image` 字段                                                  |
| POST | `/recognize/url`         | URL 图片识别     | `{ imageUrl: string }`                                                 |
| GET  | `/quality/report`        | 数据质量报告     | —                                                                      |

---

## 四、数据处理管道流程（内部）

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
              ┌────────────────┐
         ④   │  持久化入库     │
              │  - 写入 food_library
              │  - 写入 food_source（来源记录）
              │  - 写入 food_change_log（变更日志）
              │  - status = 'draft'（新增）
              │  - code = FOOD_G_00001
              └───────┬────────┘
                      │
          ┌───────────┼──────────────┐
          ▼           ▼              ▼
  ┌──────────┐ ┌───────────┐ ┌────────────┐
  │ AI 标注   │ │  AI 翻译   │ │  冲突解决   │
  │ (按需)    │ │  (按需)    │ │  (自动/人工)│
  └──────────┘ └───────────┘ └────────────┘
```

---

## 五、种子数据导入（本地数据）

除了外部数据源管道，还有本地种子数据导入机制：

**数据文件**: `src/scripts/seed-foods.data.ts`  
**执行脚本**: `src/scripts/seed-foods.ts`

```bash
# 运行种子数据导入（幂等操作，按 name 去重）
npx ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts
```

种子数据特点：

- 参考中国食物成分表，覆盖主食、肉类、蔬菜、豆制品、水果、汤类、饮品、零食、快餐等分类
- 自动推导字段：`tags`（基于营养数据）、`isProcessed`、`isFried`、`mainIngredient`、`processingLevel`（NOVA 1-4）、`foodGroup`、`allergens`、`commonPortions`、`glycemicLoad`、`nutrientDensity`
- 中文分类自动映射为英文标准分类码（grain/protein/veggie/fruit/composite 等）

---

## 六、定时调度任务

`FoodSyncSchedulerService` 自动运行以下定时任务：

| 执行时间        | 任务名称      | 说明                                     |
| --------------- | ------------- | ---------------------------------------- |
| 每月 1 号 03:00 | USDA 月度同步 | 拉取 23 类常见食物（每类 50 条）         |
| 每天 04:00      | 冲突自动解决  | 按优先级规则自动处理待解决冲突           |
| 每天 05:00      | 分数批量计算  | 为缺失分数的食物计算评分（最多 1000 条） |
| 每周一 06:00    | 质量报告生成  | 生成并记录周质量监控报告                 |

---

## 七、推荐操作流程（SOP）

### 7.1 首次初始化

```
① 导入种子数据（中国食物成分表）
   → npx ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts

② USDA 批量导入常见食物
   → Admin 后台 → USDA 导入 → 搜索 "chicken" / "rice" / "broccoli" ...

③ 规则引擎批量计算全部分数
   → Admin 后台 → 管道总览 → 点击「计算评分」
   → POST /rules/apply { recalcAll: true }

④ AI 补全缺失标注
   → Admin 后台 → AI 标注 → 勾选「仅标注缺失」→ 开始标注

⑤ AI 翻译为至少英文
   → Admin 后台 → 翻译管理 → 选择 en-US → 勾选「仅未翻译」→ 开始翻译

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

## 八、数据表说明

| 表名               | 用途                         |
| ------------------ | ---------------------------- |
| `food_library`     | 食物主表（营养、标签、分数） |
| `food_source`      | 数据来源记录（多来源追溯）   |
| `food_conflict`    | 来源冲突记录                 |
| `food_change_log`  | 数据变更审计日志             |
| `food_translation` | 多语言翻译                   |

---

## 九、前端服务层（React Query）

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
