# 智能饮食推荐系统 V6.1 — 专项优化设计

> 版本: V6.1 设计稿  
> 日期: 2026-04-10  
> 定位: 在 V6 已有推荐、画像、解释、订阅基础上，专项强化商业化、食物分析、食物数据沉淀  
> 原则: 不平台化、不推翻现有架构、优先低成本高收益、可灰度、可逐步上线

---

## 1. V6 → V6.1 核心升级总结

### 1.1 一句话

V6 是“能推荐、能解释、能收费的 AI 饮食系统”，V6.1 是“能把分析结果稳定沉淀为结构化资产，并在关键时刻把价值转成收入”的版本。

### 1.2 升级重点

V6.1 只聚焦三件事，不扩平台边界：

1. 订阅体系从“有分层”升级到“能转化、能控量、能联动推荐与分析”。
2. 食物分析从“拍照出结果”升级到“文本/图片双链路分析，统一输出结构”。
3. 食物数据从“分析即返回”升级到“分析后可入库、可去重、可治理、越用越强”。

### 1.3 V6.1 与 V6 的差异

| 维度     | V6                     | V6.1                                             |
| -------- | ---------------------- | ------------------------------------------------ |
| 订阅     | 有套餐和基本门控       | 有能力分级、配额分层、付费触发点、结果裁剪       |
| 文本分析 | 主要依赖手工搜索/记录  | 独立文本分析链路，支持标准化、营养判断、建议输出 |
| 图片分析 | 已有 AI 图片分析       | 强化拆解、多食物组合、置信度、结构化入库         |
| 数据沉淀 | 有食物库和导入管道     | 新增用户分析结果入库链路，形成候选食物资产       |
| 联动能力 | 推荐、画像、解释已存在 | 分析结果反哺推荐、画像、A/B、订阅转化            |

### 1.4 北极星指标

- 文本分析完成率 > 98%
- 图片分析成功返回率 > 95%
- 分析结果入库命中率 > 60%
- 新增食物候选审核通过率 > 30%
- 免费用户到订阅转化率 +15%
- 订阅用户 ARPU +10%
- 深度分析页触发升级点击率 > 8%

---

## 2. 系统模块设计

V6.1 不新建大平台，只增强三类模块。

### 2.1 Subscription Optimization Module

基于现有 `apps/api-server/src/modules/subscription` 增强，不推翻 `SubscriptionService`、`SubscriptionGuard`、`RequireSubscription`。

**职责**

- 定义用户等级: `free` / `pro` / `premium`
- 定义功能级权限: 能不能用、能用几次、能看到多少结果
- 定义能力级权限: 推荐是否使用高级策略、分析是否返回深度解释
- 定义付费触发点: 在犹豫场景弹出升级而不是首页硬拦截
- 将订阅权益联动推荐、分析、解释、历史记录

**输入**

- 用户身份 `userId`
- 当前订阅摘要 `UserSubscriptionSummary`
- 功能标识 `GatedFeature`
- 当前场景上下文: `analysis_result` / `why_not` / `history_unlock` / `advanced_recommendation`

**输出**

- `AccessDecision`: 是否允许、是否扣配额、是否裁剪结果、是否返回升级提示
- `PaywallTrigger`: 升级提示位、文案类型、推荐计划、触发原因

**与现有系统关系**

- 复用现有 `SubscriptionService.getUserTier()`、`TIER_ENTITLEMENTS`
- 复用现有 `SubscriptionGuard` 做接口前置拦截
- 新增更细粒度 `QuotaGateService` 和 `ResultEntitlementService`
- 与 `ExplainV2` 联动裁剪字段，与推荐引擎联动控制策略级别

### 2.2 Food Analysis Engine

在现有 `apps/api-server/src/modules/food/app/analyze.service.ts` 基础上拆成两条明确链路，但保持统一结果结构。

#### Text Analysis Chain

**职责**

- 接收食物名称或自然语言描述
- 标准化映射到食物库
- 对单品或组合做营养估算
- 输出“该不该吃”的统一分析结果

**输入**

- 文本: `鸡胸肉` / `牛肉面` / `一份凯撒沙拉加可乐`
- 用户上下文: 目标、忌口、慢病、今日摄入、餐次

**输出**

- 统一 `FoodAnalysisResultV61`
- 匹配到的标准食物列表
- 置信度、是否建议入库、是否触发人工审核

**与现有系统关系**

- 优先复用 `FoodLibrary`、`FoodService`、`NutritionScoreService`
- 复用推荐系统的健康判断逻辑，不单独造一套评分体系
- 结果可直接进入饮食记录 `FoodRecord`

#### Image Analysis Chain

**职责**

- 接收用户拍照图片
- 识别食物类别
- 拆解组合餐
- 估算份量和营养
- 输出统一分析结果

**输入**

- 图片 URL 或上传文件
- 可选餐次、用户上下文

**输出**

- 统一 `FoodAnalysisResultV61`
- 拆解后的食物组件列表
- 识别置信度、拆解置信度、营养估算置信度

**与现有系统关系**

- 复用现有 `/app/food/analyze` 异步队列模式和 `FoodAnalysisProcessor`
- 保留图片分析走 BullMQ，不阻塞请求
- 识别结果进入同一入库管道，不直接写死到食物主表

### 2.3 Food Ingestion Pipeline

在现有 `food-pipeline` 基础上增加“用户分析结果入库支线”，不影响原有 USDA / OpenFoodFacts 导入管道。

**职责**

- 接收文本/图片分析后的结构化结果
- 判断是否命中已有标准食物
- 未命中时创建候选食物而不是直接污染主库
- 做去重、质量打分、审核流转、合并入库
- 形成可被推荐系统复用的数据资产

**输入**

- `FoodAnalysisResultV61`
- 原始输入快照
- 置信度数据
- 用户确认数据: 是否保存、是否手动修正

**输出**

- 命中标准食物
- 新建 `food_candidate`
- 质量状态: `accepted` / `candidate` / `needs_review` / `rejected`

**与现有系统关系**

- 复用现有 `FoodPipelineOrchestratorService` 的清洗、规则、去重能力
- 复用 `FoodLibrary`、`FoodChangeLog`、`FoodSource`
- 新增用户来源数据进入候选表，不直接进入 `foods`

---

## 3. V6.1 模块总览

```text
V6.1 新增/增强模块:

  SubscriptionModule (增强)
  ├── PlanEntitlementResolver      套餐能力解析
  ├── QuotaGateService             配额检查/扣减
  ├── ResultEntitlementService     结果字段裁剪
  ├── PaywallTriggerService        付费触发策略
  └── SubscriptionAnalyticsHook    转化埋点/A-B 实验联动

  FoodAnalysisModule (增强)
  ├── TextFoodAnalysisService      文本分析链路
  ├── ImageFoodAnalysisService     图片分析链路
  ├── FoodNormalizationService     食物标准化映射
  ├── PortionEstimationService     份量估算
  ├── NutritionEstimationService   营养估算
  ├── FoodDecisionService          是否建议食用
  └── AnalysisResultAssembler      统一输出结构组装

  FoodIngestionModule (新增支线)
  ├── AnalysisIngestionService     分析结果入库编排
  ├── FoodCandidateService         新食物候选管理
  ├── AnalysisDedupService         分析结果去重
  ├── DataQualityService           数据质量评分
  └── ReviewQueueService           人审队列(可选)
```

---

## 4. 核心流程设计

### 4.1 文本分析流程

```text
用户输入文本
  -> POST /app/food/analyze-text
  -> SubscriptionGuard / QuotaGateService 检查权限
  -> TextFoodAnalysisService
      1. 预处理文本
      2. 别名归一化
      3. 匹配 FoodLibrary
      4. 未命中则走 LLM/规则拆解
      5. PortionEstimationService 估份量
      6. NutritionEstimationService 估营养
      7. FoodDecisionService 输出该不该吃
      8. AnalysisResultAssembler 组装统一结构
  -> ResultEntitlementService 按订阅裁剪结果
  -> 返回用户
  -> 异步触发 analysis.completed
      -> AnalysisIngestionService 判断是否入库
      -> UserProfile event 更新短期偏好
      -> Analytics 记录触发点/转化漏斗
```

**说明**

- 文本链路优先命中标准食物，成本最低，适合 Phase 1 先上。
- 文本链路不依赖视觉模型，结果更稳定，适合作为免费版主入口。
- 文本输入支持两类:
  - 标准词: `鸡胸肉`、`苹果`
  - 描述词: `一份牛肉面加卤蛋`、`晚上想吃沙拉配酸奶`

### 4.2 图片分析流程

```text
用户上传图片
  -> POST /app/food/analyze
  -> StorageService 上传图片
  -> SubscriptionGuard / QuotaGateService 检查权限
  -> AnalyzeService.submitAnalysis(requestId)
  -> BullMQ: food-analysis queue
  -> ImageFoodAnalysisService
      1. 图片识别主食物类别
      2. 多食物拆解
      3. 估算份量
      4. 营养估算
      5. FoodDecisionService 输出该不该吃
      6. AnalysisResultAssembler 组装统一结构
  -> Redis 保存 processing/completed/failed
  -> GET /app/food/analyze/:requestId 轮询结果
  -> ResultEntitlementService 按订阅裁剪结果
  -> 异步触发 analysis.completed
      -> AnalysisIngestionService 判断是否入库
      -> UserProfile event 更新短期偏好
      -> Analytics 记录识别质量和转化数据
```

**说明**

- 图片链路必须保持异步，不回退到同步阻塞。
- 图片链路与文本链路共用后半段估算、决策、组装逻辑，但识别入口完全分离。
- 图片链路优先作为订阅增强能力，而不是所有用户无限开放。

### 4.3 是否入库决策流程

```text
analysis.completed
  -> AnalysisIngestionService
      1. 校验结果完整度
      2. 计算 confidence / qualityScore
      3. 与 FoodLibrary 做去重匹配
      4. 命中已有标准食物 -> 建立 analysis_food_link
      5. 未命中但质量高 -> 创建 food_candidate
      6. 未命中且质量低 -> 只保留分析记录，不入食物候选
      7. 命中高频候选 -> 推入 review queue
      8. 审核通过 -> 合并入 foods
```

**入库原则**

- 不把所有分析结果直接写入主食物表。
- 标准食物走“关联”；新食物先走“候选”。
- 只有高频、高置信、高质量候选才进入主库。

---

## 5. 统一分析结果结构

文本和图片链路必须返回同一结构，方便前端、记录、画像、推荐统一消费。

```ts
interface FoodAnalysisResultV61 {
  analysisId: string;
  inputType: 'text' | 'image';
  inputSnapshot: {
    rawText?: string;
    imageUrl?: string;
    mealType?: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  };
  foods: Array<{
    name: string;
    normalizedName?: string;
    foodLibraryId?: string;
    candidateId?: string;
    quantity?: string;
    estimatedWeightGrams?: number;
    category?: string;
    confidence: number;
    calories: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    fiber?: number;
    sodium?: number;
  }>;
  totals: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber?: number;
    sodium?: number;
  };
  score: {
    healthScore: number;
    nutritionScore: number;
    confidenceScore: number;
  };
  decision: {
    recommendation: 'recommend' | 'caution' | 'avoid';
    shouldEat: boolean;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high';
  };
  alternatives: Array<{
    name: string;
    reason: string;
  }>;
  explanation: {
    summary: string;
    primaryReason: string;
    userContextImpact?: string[];
    upgradeTeaser?: string;
  };
  ingestion: {
    matchedExistingFoods: boolean;
    shouldPersistCandidate: boolean;
    reviewRequired: boolean;
  };
  entitlement: {
    tier: 'free' | 'pro' | 'premium';
    fieldsHidden: string[];
  };
}
```

### 5.1 免费版与订阅版返回差异

**免费版**

- 返回基础食物名称
- 返回总热量和简单三大营养素
- 返回基础健康判断
- 返回一句话建议
- 隐藏深度解释、替代建议、历史对比、画像影响因子

**Pro**

- 返回完整营养估算
- 返回个性化解释
- 返回替代建议
- 返回历史记录入口
- 返回“为什么不建议吃”细化原因

**Premium**

- 返回全天联动建议
- 返回趋势对比
- 返回与目标差距
- 返回高级替代路径和补救方案

---

## 6. 数据结构设计

### 6.1 食物主表

继续使用现有 `foods` 表，对齐 `FoodLibrary`，V6.1 只补充少量字段。

**现有主表继续保留**

- `id`
- `code`
- `name`
- `aliases`
- `category`
- `subCategory`
- `calories/protein/fat/carbs/...`
- `qualityScore/satietyScore`
- `status`

**建议新增字段**

| 字段                   | 类型         | 用途                                                   |
| ---------------------- | ------------ | ------------------------------------------------------ |
| `origin_type`          | varchar(20)  | `official` / `ugc_candidate_merged` / `partner_import` |
| `canonical_name`       | varchar(120) | 标准展示名，解决别名过多问题                           |
| `portion_reference`    | jsonb        | 常见份量参考，如一碗/一份/一块                         |
| `analysis_usage_count` | int          | 被分析链路命中的次数                                   |
| `last_analysis_hit_at` | timestamp    | 最近一次命中时间                                       |

### 6.2 新增分析记录表 `food_analysis_record`

用于保存文本/图片分析过程，不与 `food_records` 混淆。

| 字段                   | 类型                  | 说明                                       |
| ---------------------- | --------------------- | ------------------------------------------ |
| `id`                   | uuid                  | 分析记录 ID                                |
| `user_id`              | uuid                  | 用户                                       |
| `input_type`           | varchar(10)           | `text` / `image`                           |
| `raw_text`             | text nullable         | 文本原始输入                               |
| `image_url`            | varchar(500) nullable | 图片地址                                   |
| `meal_type`            | varchar(20) nullable  | 餐次                                       |
| `status`               | varchar(20)           | `completed` / `failed` / `partial`         |
| `recognized_payload`   | jsonb                 | 识别出的食物原始结构                       |
| `normalized_payload`   | jsonb                 | 标准化后的结构                             |
| `nutrition_payload`    | jsonb                 | 统一营养结果                               |
| `decision_payload`     | jsonb                 | 决策结果                                   |
| `confidence_score`     | decimal(5,2)          | 总置信度                                   |
| `quality_score`        | decimal(5,2)          | 数据质量分                                 |
| `matched_food_count`   | int                   | 命中标准食物数量                           |
| `candidate_food_count` | int                   | 新候选数量                                 |
| `persist_status`       | varchar(20)           | `linked` / `candidate_created` / `ignored` |
| `source_request_id`    | varchar(64) nullable  | 图片异步分析 requestId                     |
| `created_at`           | timestamp             | 创建时间                                   |

### 6.3 新增候选食物表 `food_candidate`

用于承接未命中标准库但具备沉淀价值的新食物。

| 字段                  | 类型          | 说明                                           |
| --------------------- | ------------- | ---------------------------------------------- |
| `id`                  | uuid          | 候选食物 ID                                    |
| `canonical_name`      | varchar(120)  | 候选标准名                                     |
| `aliases`             | jsonb         | 识别出的别名/同义词                            |
| `category`            | varchar(30)   | 分类                                           |
| `estimated_nutrition` | jsonb         | 营养估算                                       |
| `source_type`         | varchar(20)   | `text_analysis` / `image_analysis`             |
| `source_count`        | int           | 被分析链路命中的次数                           |
| `avg_confidence`      | decimal(5,2)  | 平均置信度                                     |
| `quality_score`       | decimal(5,2)  | 质量分                                         |
| `review_status`       | varchar(20)   | `pending` / `approved` / `rejected` / `merged` |
| `merged_food_id`      | uuid nullable | 合并到正式食物后的 ID                          |
| `first_seen_at`       | timestamp     | 首次出现                                       |
| `last_seen_at`        | timestamp     | 最近出现                                       |

### 6.4 分析结果与主库关联表 `analysis_food_link`

| 字段                | 类型          | 说明                                            |
| ------------------- | ------------- | ----------------------------------------------- |
| `id`                | uuid          | 主键                                            |
| `analysis_id`       | uuid          | 对应分析记录                                    |
| `food_library_id`   | uuid nullable | 命中标准食物                                    |
| `food_candidate_id` | uuid nullable | 命中候选食物                                    |
| `match_type`        | varchar(20)   | `exact` / `alias` / `semantic` / `vision_guess` |
| `confidence`        | decimal(5,2)  | 本次匹配置信度                                  |

### 6.5 用户行为数据增强

现有订阅和分析要联动，建议新增或增强以下行为埋点表。

#### `analysis_behavior_event`

| 字段              | 类型        | 说明                                                                          |
| ----------------- | ----------- | ----------------------------------------------------------------------------- |
| `id`              | uuid        | 主键                                                                          |
| `user_id`         | uuid        | 用户                                                                          |
| `analysis_id`     | uuid        | 分析记录                                                                      |
| `event_type`      | varchar(30) | `submit` / `view_result` / `save_record` / `upgrade_click` / `unlock_history` |
| `tier_at_time`    | varchar(20) | 行为发生时订阅等级                                                            |
| `trigger_context` | varchar(30) | `result_page` / `quota_exceeded` / `advanced_explain`                         |
| `metadata`        | jsonb       | 扩展数据                                                                      |
| `created_at`      | timestamp   | 时间                                                                          |

#### `subscription_trigger_log`

| 字段               | 类型                 | 说明                                                                        |
| ------------------ | -------------------- | --------------------------------------------------------------------------- |
| `id`               | uuid                 | 主键                                                                        |
| `user_id`          | uuid                 | 用户                                                                        |
| `trigger_scene`    | varchar(30)          | `analysis_limit` / `advanced_result` / `history_view` / `precision_upgrade` |
| `feature`          | varchar(50)          | 对应功能                                                                    |
| `current_tier`     | varchar(20)          | 当前档位                                                                    |
| `recommended_plan` | varchar(20)          | 推荐升级档位                                                                |
| `ab_bucket`        | varchar(20) nullable | 实验桶                                                                      |
| `converted`        | boolean              | 是否转化                                                                    |
| `created_at`       | timestamp            | 时间                                                                        |

---

## 7. 订阅模型设计

### 7.1 用户权限分层

沿用 V6 的三档，但改为“功能级 + 能力级”双层控制。

| 档位    | 功能边界                                       | 能力边界                               |
| ------- | ---------------------------------------------- | -------------------------------------- |
| Free    | 基础推荐、文本基础分析、有限图片分析、基础记录 | 基础策略、基础解释、无历史深度视图     |
| Pro     | 深度分析、个性化推荐、历史记录、完整解释       | 高级排序策略、个性化解释、更多替代建议 |
| Premium | 全部 Pro + 全天联动、趋势、优先分析            | 高精度策略、跨餐建议、优先 AI 队列     |

### 7.2 功能分级

| 功能             | Free      | Pro      | Premium |
| ---------------- | --------- | -------- | ------- |
| 文本分析         | 20 次/天  | 无限     | 无限    |
| 图片分析         | 3 次/天   | 20 次/天 | 无限    |
| 分析结果基础结论 | 是        | 是       | 是      |
| 深度营养拆解     | 否        | 是       | 是      |
| 个性化替代建议   | 否        | 是       | 是      |
| 历史分析记录     | 最近 3 条 | 全量     | 全量    |
| 为什么不建议吃   | 简版      | 完整版   | 完整版  |
| 推荐高级策略     | 否        | 是       | 是      |
| 全天膳食联动     | 否        | 否       | 是      |

### 7.3 订阅控制维度

#### 按功能限制

- 文本分析次数
- 图片分析次数
- 历史记录可查看范围
- 高级解释可见性

#### 按能力限制

- 推荐系统能否调用高级策略
- 分析系统是否返回个性化解释
- 图片分析是否使用优先队列
- 是否可看到全天饮食联动建议

### 7.4 付费触发点设计

付费墙不放在首次核心价值之前，放在“用户已经感到有用，但还差一点完整答案”的节点。

**推荐触发点**

1. 免费用户查看分析结果时，看到“已判断可吃，但升级可查看为什么更适合你”。
2. 免费用户当天第 4 次图片分析时，提示“继续拍照分析需要 Pro”。
3. 用户看到替代建议入口但被裁剪时，提示“升级查看更适合当前目标的替代方案”。
4. 用户想看历史 7 天分析趋势时，提示“升级解锁历史分析与变化趋势”。
5. 用户连续 3 次触发 `caution/avoid`，提示“升级获取更稳定的个性化饮食纠偏”。

**后端触发条件**

```text
if quota exhausted -> hard paywall
if result hidden by entitlement -> soft paywall
if user repeatedly views advanced teaser -> upgrade recommendation
if user has clear goal + high usage + frequent analysis -> premium upsell
```

---

## 8. 订阅控制实现

### 8.1 接口层控制

继续使用现有 `SubscriptionGuard`，但拆为三层。

#### 第一层: 身份和最低等级

- `AppJwtAuthGuard`
- `SubscriptionGuard`
- 适合完全禁止访问的接口

示例:

```ts
@UseGuards(AppJwtAuthGuard, SubscriptionGuard)
@RequireSubscription(SubscriptionTier.PRO)
@Get('history/full')
getFullHistory() {}
```

#### 第二层: 配额控制

新增 `QuotaGateService`

- `checkAndConsume(userId, feature, context)`
- 支持只检查不扣减
- 支持成功后扣减，失败不扣减

适合文本分析、图片分析、导出、报告等按次能力。

#### 第三层: 结果裁剪

新增 `ResultEntitlementService`

- 免费版不报错，返回基础结果 + `upgradeTeaser`
- 订阅版返回完整字段

适合分析结果、解释、推荐候选、历史视图。

### 8.2 服务层控制

新增统一访问决策对象。

```ts
interface AccessDecision {
  allowed: boolean;
  quotaConsumed: boolean;
  degradeMode: 'none' | 'basic_result' | 'hide_advanced_fields';
  paywall?: {
    code: string;
    message: string;
    recommendedTier: 'pro' | 'premium';
  };
}
```

调用方式:

```ts
const access = await subscriptionAccessService.check({
  userId,
  feature: GatedFeature.AI_IMAGE_ANALYSIS,
  scene: 'food_analysis',
  consumeQuota: true,
});
```

### 8.3 如何影响返回结果

**免费用户结果裁剪规则**

- 隐藏 `userContextImpact`
- 隐藏完整 `alternatives`
- 隐藏历史趋势对比
- 隐藏高级解释字段
- 保留基础结论，避免完全无价值

**订阅用户结果增强规则**

- 返回完整营养结构
- 返回与当前目标关联的解释
- 返回历史趋势比较
- 返回更高精度的替代路径

### 8.4 与推荐系统联动

**Free**

- 使用默认策略
- 探索率偏保守
- 不开放全天联动推荐

**Pro**

- 可启用更个性化的 RankPolicy
- 可读取更多短期画像因子
- 推荐解释更完整

**Premium**

- 开启全天联动规划
- 启用更高精度上下文策略
- 分析结果可反向触发下一餐建议

### 8.5 与分析系统联动

- 文本分析: 免费主力入口，配额宽松
- 图片分析: 付费增强入口，配额严格
- 深度解释: 作为软付费墙主要承接点
- 历史分析: 作为续费理由而不是首单入口

---

## 9. 食物分析能力设计

### 9.1 文本分析链路

#### 输入分类

1. 精确食物名: `鸡胸肉`
2. 组合食物名: `牛肉面`
3. 自然语言描述: `晚餐吃了一份沙拉和一杯奶茶`

#### 处理步骤

1. `InputPreprocessor`
   - 去空格、统一简繁/大小写/常见别称
2. `FoodNormalizationService`
   - 先按精确名/别名匹配
   - 再按语义召回匹配
3. `TextParseService`
   - 拆出组合食物和数量词
4. `PortionEstimationService`
   - 估算克重、份数
5. `NutritionEstimationService`
   - 优先用标准库营养
   - 次选用相似食物估算
6. `FoodDecisionService`
   - 结合目标、禁忌、当前摄入给出建议
7. `AnalysisResultAssembler`
   - 统一输出结构

#### 推荐输出

- “是什么”
- “营养如何”
- “建议不建议吃”
- “如果要吃怎么吃更好”
- “可替代什么”

### 9.2 图片分析链路

#### 处理步骤

1. `ImageRecognitionService`
   - 识别主类和候选类
2. `FoodCompositionResolver`
   - 拆解组合餐: 主食、蛋白、蔬菜、饮品
3. `PortionEstimationService`
   - 根据视觉面积、容器类型、常见餐型估重
4. `NutritionEstimationService`
   - 匹配已有标准食物并估算营养
5. `FoodDecisionService`
   - 统一生成建议
6. `AnalysisResultAssembler`
   - 统一输出结构

#### 图片链路特殊要求

- 必须带 `confidenceScore`
- 必须记录原始识别结果和标准化结果
- 必须支持“部分识别成功”而不是全量失败
- 无法确定时返回 `caution`，不做过度自信判断

### 9.3 决策输出规则

V6.1 统一使用三档建议，而不是过多暴露模型细节。

| recommendation | shouldEat | 含义                    |
| -------------- | --------- | ----------------------- |
| `recommend`    | true      | 当前目标下可优先选择    |
| `caution`      | true      | 能吃，但需要控量/换搭配 |
| `avoid`        | false     | 当前场景不建议          |

决策生成因子:

- 用户目标
- 当前餐次
- 今日已摄入情况
- 疾病/禁忌/过敏
- 食物营养结构
- 加工度和置信度

---

## 10. 食物数据入库与结构化沉淀

### 10.1 哪些数据入库

#### 必入库

- 分析记录 `food_analysis_record`
- 原始输入快照
- 统一输出结果
- 置信度与质量分
- 与标准食物或候选食物的关联

#### 条件入库

- 新候选食物 `food_candidate`
- 用户修正后的食物映射
- 高频且高置信的组合餐模板

#### 不直接入主库

- 单次低置信识别结果
- 模糊描述且无法确认的自然语言结果
- 用户随手输入的非标准词

### 10.2 入库策略

#### 标准食物

- 命中 `FoodLibrary` 时，不创建新食物
- 只增加 `analysis_food_link` 和命中计数
- 可更新 `analysis_usage_count`、`last_analysis_hit_at`

#### 新食物

- 不直接写 `foods`
- 创建 `food_candidate`
- 聚合多次命中后再决定是否审核入主库

### 10.3 去重策略

去重分三层：

1. 名称层: 精确名、别名、规范名
2. 语义层: 向量相似度、分类一致性、营养接近度
3. 统计层: 最近 30 天是否已有同类候选高频出现

合并条件建议:

- 名称相似度 > 0.92
- 分类一致
- 热量差异 < 15%
- 宏量营养差异 < 20%

### 10.4 数据质量控制

新增 `DataQualityService`，每条候选结果打质量分 `0-100`。

评分因子:

- 输入清晰度
- 匹配完整度
- 营养字段完整度
- 识别置信度
- 是否被用户确认
- 是否与已有高质量数据冲突

建议阈值:

- `>= 85`: 可自动关联已有标准食物
- `70-84`: 创建候选，等待更多样本
- `50-69`: 仅保留分析记录
- `< 50`: 标记低质量，不参与候选聚合

### 10.5 人工审核

人工审核不是 Phase 1 必做，但要预留。

**推荐做法**

- Phase 1: 无人工审核，只做候选沉淀
- Phase 2: 后台增加候选审核列表
- Phase 3: 只审核高频高价值候选，不做人海审核

审核触发条件:

- 同一候选 7 天内被命中 >= 10 次
- 平均置信度 >= 0.8
- 覆盖用户数 >= 5

---

## 11. 与现有系统联动

### 11.1 接入推荐系统

分析结果不是孤立页面，而是推荐系统的新输入。

**联动方式**

1. 文本/图片分析完成后发出 `food.analysis.completed`
2. 推荐系统订阅该事件
3. 更新短期偏好:
   - 最近常分析的食物类目
   - 最近常被判定 `avoid/caution` 的风险类型
   - 最近实际保存记录的食物偏好
4. 在下一餐推荐中注入:
   - 避免重复踩雷
   - 优先推荐可替代食物
   - 如果刚分析了高热量食物，则下一餐更偏纠偏

### 11.2 影响用户画像

分析行为本身就是隐式偏好信号。

**可写入短期画像的字段**

- `recentAnalyzedCategories`
- `recentRiskFoods`
- `recentPreferredMealPatterns`
- `analysisConfidencePreference`

**可写入长期画像的字段**

- 高频外卖类型
- 高风险食物暴露频率
- 记录习惯强度
- 文本分析 vs 图片分析偏好

### 11.3 参与 A/B 策略

V6.1 不新增平台化实验系统，直接复用现有 A/B 能力。

**建议实验项**

1. 付费触发文案
2. 免费版裁剪深度
3. 图片分析次数阈值
4. 文本分析入口位置
5. 高级解释展示方式

**实验目标**

- 转化率
- 结果保存率
- 次日留存
- 分析后推荐点击率

---

## 12. API 与工程实现建议

### 12.1 新增/增强 API

#### 文本分析

```text
POST /api/app/food/analyze-text
Body: {
  text: string,
  mealType?: string
}
```

#### 图片分析

保留现有:

```text
POST /api/app/food/analyze
GET  /api/app/food/analyze/:requestId
```

#### 保存分析结果为记录

建议增强现有保存记录接口，支持绑定 `analysisId`。

```text
POST /api/app/food/records
Body: {
  analysisId?: string,
  ...
}
```

#### 历史分析

```text
GET /api/app/food/analysis/history
GET /api/app/food/analysis/:analysisId
```

### 12.2 推荐新增服务

| 服务                         | 作用               |
| ---------------------------- | ------------------ |
| `TextFoodAnalysisService`    | 文本分析主服务     |
| `FoodNormalizationService`   | 食物名标准化和映射 |
| `NutritionEstimationService` | 营养估算           |
| `FoodDecisionService`        | 统一做吃/不吃判断  |
| `AnalysisResultAssembler`    | 统一输出组装       |
| `AnalysisIngestionService`   | 分析后入库编排     |
| `QuotaGateService`           | 配额检查与扣减     |
| `ResultEntitlementService`   | 按订阅裁剪输出     |
| `PaywallTriggerService`      | 升级提示策略       |

### 12.3 事件建议

```text
food.analysis.submitted
food.analysis.completed
food.analysis.failed
food.analysis.saved_to_record
food.candidate.created
food.candidate.promoted
subscription.paywall.triggered
```

---

## 13. 分阶段落地方案

### Phase 1: 文本分析 + 基础订阅

**目标**

- 先把最低成本、高稳定性的文本分析做起来
- 先把免费/订阅的能力边界跑通

**范围**

1. 新增 `POST /app/food/analyze-text`
2. 新增统一结果结构 `FoodAnalysisResultV61`
3. 增加 `QuotaGateService` 和 `ResultEntitlementService`
4. 新增 `food_analysis_record`
5. 免费版裁剪深度解释，增加软付费触发
6. 分析结果可保存为 `FoodRecord`

**预估收益**

- 低成本上线分析能力增强
- 快速验证订阅转化链路
- 沉淀第一批结构化分析数据

### Phase 2: 图片分析接入

**目标**

- 在现有异步图片分析基础上做结构化升级
- 把图片识别结果拉进统一入库管道

**范围**

1. 拆分 `ImageFoodAnalysisService`
2. 增加多食物拆解和置信度字段
3. 新增 `analysis_food_link`
4. 新增 `food_candidate`
5. 图片分析接入配额和订阅裁剪
6. 分析结果事件联动画像和推荐

**预估收益**

- 提升图片分析可信度
- 开始沉淀候选食物资产
- 形成图片分析付费价值点

### Phase 3: 数据沉淀优化 + 转化提升

**目标**

- 让分析数据真正变成食物资产和订阅增长引擎

**范围**

1. 新增 `DataQualityService`
2. 候选食物聚合与审核后台
3. 历史分析页和趋势页付费化
4. 转化触发点 A/B 实验
5. 将高频候选合并进 `foods`
6. 分析结果更深度联动推荐策略

**预估收益**

- 食物库越用越准
- 转化率和 ARPU 提升
- 推荐系统获得更丰富的真实输入数据

---

## 14. 风险与优化点

### 14.1 图片识别不准怎么办

**风险**

- 多食物组合误识别
- 份量估算误差大
- 用户对错误结果不信任

**缓解策略**

1. 返回置信度，不假装 100% 准确
2. 支持部分成功，不要求整张图全识别
3. 低置信时默认 `caution`，不输出过强建议
4. 允许用户手动修正并把修正结果作为高质量样本
5. 低置信结果不进入主库

### 14.2 数据污染问题

**风险**

- 用户乱输文本导致候选库膨胀
- 单次错误识别污染主食物表

**缓解策略**

1. 主库和候选库分离
2. 候选需要高频和高置信才可晋升
3. 低质量结果只留分析记录，不做候选
4. 合并前做名称、营养、分类三重校验

### 14.3 用户体验问题

**风险**

- 付费墙太早，伤害首次价值感知
- 免费版过度裁剪，用户看不懂差异
- 图片分析异步轮询等待过长

**缓解策略**

1. 首次分析必须给到有效基础结果
2. 付费墙只拦深度价值，不拦基础结论
3. 文本分析作为快速低延迟入口
4. 图片分析返回处理中状态和预计时长
5. 结果页文案明确“升级后多了什么”

### 14.4 工程复杂度问题

**风险**

- 文本和图片各写一套逻辑，维护成本高

**缓解策略**

1. 入口分离，后半段估算/决策/组装复用
2. 统一结果结构和统一入库编排
3. 先做文本，再做图片
4. 优先加服务，不急着拆更多模块

---

## 15. 最终建议

V6.1 不应该再做“大而全”的扩展，而应该把最接近收入和数据资产的三条链路打透：

1. 用订阅能力把“基础可用”和“深度价值”清晰分层。
2. 用文本/图片双分析链路把用户输入稳定转成统一结构结果。
3. 用候选入库机制把分析结果沉淀成越来越强的食物资产，而不是一次性输出。

按投入产出比，推荐实施顺序是：

1. Phase 1 先上文本分析 + 配额门控 + 结果裁剪。
2. Phase 2 再升级图片分析结构化和候选入库。
3. Phase 3 最后做质量治理、审核和转化实验优化。

这样可以在不推翻 V6 架构的前提下，用最小改动拿到两类核心收益：

- 更高的订阅转化和 ARPU
- 越用越强的食物知识资产
