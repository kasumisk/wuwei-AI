# 智能饮食推荐系统 V7.8 升级方案

# V7.8 升级方案 — 画像精简 + 现实化推荐 + 种子数据完善

> 基于 V7.7 架构的版本演进，聚焦：画像减法、推荐贴近现实、食物数据质量、可维护性。

---

## 一、能力评估（Step 1）

### 1.1 V7.7 已具备能力

| 能力域      | 状态    | 说明                                                                    |
| ----------- | ------- | ----------------------------------------------------------------------- |
| 用户画像    | ✅ 成熟 | 5 层画像 + 事件驱动 + 领域模型（NutritionProfile + PreferencesProfile） |
| 推荐管道    | ✅ 成熟 | Recall→Rank→Rerank 三阶段 + 10 ScoringFactor + 14 维评分                |
| 策略引擎    | ✅ 双层 | V6 细粒度 Policy + V7.4 宏观行为策略 + StrategyResolverFacade           |
| 场景系统    | ✅ 完整 | 12 场景 + 6 渠道 + 4 档 Realism + SceneResolver 行为学习                |
| 缓存        | ✅ 三级 | L0 请求级 + L1 内存 LRU + L2 Redis + 预热                               |
| 可解释性    | ✅ 深度 | 14 维解释 + 对比 + 替代 + 叙事体 + 多语言                               |
| Facade 拆分 | ✅ 完成 | ProfileAggregator + StrategyResolverFacade (V7.6)                       |
| 目录结构    | ✅ 完成 | 218 文件重组到语义子目录 (V7.7)                                         |
| 食物数据    | ⚠️ 不足 | ~190 条种子数据，重复条目多，品类覆盖不全                               |
| 策略种子    | ⚠️ 不足 | 仅 4 个预设，场景覆盖不足                                               |

### 1.2 现存问题

#### 🔴 严重（直接影响推荐质量）

| #   | 问题                                          | 影响                                                                                            |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| S1  | **食物种子数据缺陷**                          | 大量重复条目（ingredient/dish 同名覆盖）、品类缺失（dairy/fat）、原材料标为 ingredient 实为菜品 |
| S2  | **activity_level 与 exercise_intensity 冗余** | 值域和语义高度重叠，增加用户填写负担和系统认知复杂度                                            |
| S3  | **推荐食物不贴近现实**                        | commonalityScore 依赖种子数据质量，种子数据不足导致过滤失效                                     |

#### 🟡 高（影响系统质量）

| #   | 问题                                 | 影响                                                                   |
| --- | ------------------------------------ | ---------------------------------------------------------------------- |
| H1  | **food_form 使用混乱**               | 原始种子中宫保鸡丁等菜品标为 ingredient，V7.4 又添加 dish 版本造成重复 |
| H2  | **策略种子数据不完整**               | 仅 4 个预设，无场景策略、无饮食哲学策略                                |
| H3  | **食物微量营养素数据稀疏**           | ~80% 食物缺少维生素/矿物质数据，插补依赖品类均值精度不高               |
| H4  | **profile_resolver 中残留 `as any`** | V7.5 清理后仍有少量残留                                                |

#### 🟢 中（影响可维护性/扩展性）

| #   | 问题                          | 影响                                                                      |
| --- | ----------------------------- | ------------------------------------------------------------------------- |
| M1  | **GoalSpeed 枚举不一致**      | user.types 定义 aggressive/steady/relaxed，schema 注释为 slow/steady/fast |
| M2  | **user_profiles 字段膨胀**    | 40+ 字段，部分（hydration_goal、supplements_used）使用率极低              |
| M3  | **食物 confidence 全部 0.95** | 无法区分高质量数据源和 AI 估算数据                                        |

---

## 二、核心升级方向（Step 2）— 6 个方向

### 方向 1：用户画像冗余减法（解决 S2, M1）

**为什么需要：** `activity_level`（sedentary/light/moderate/active）和 `exercise_intensity`（none/light/moderate/high）值域几乎相同，语义边界模糊。`activity_level` 被 30 处使用（TDEE 核心计算），`exercise_intensity` 仅 10 处使用（生活方式评分修正）。同时存在增加了：

- 用户 onboarding 时的困惑（"活动水平"和"运动强度"有什么区别？）
- 开发者维护时的认知负担
- 画像冲突检测的误报

**解决什么问题：**

- 消除冗余字段，减少用户填写步骤
- 简化 TDEE 计算和生活方式评分的输入来源
- 将 `exercise_intensity` 的精细信息合并到已有的 `exercise_profile` JSON 字段中

### 方向 2：食物种子数据质量修复（解决 S1, H1）

**为什么需要：** 当前种子数据存在严重质量问题：

- ~40 个食物同时存在 ingredient 和 dish 版本，upsert by name 导致后者覆盖前者
- 鸡蛋、茶叶蛋分类为"零食"而非"蛋白质"
- 缺少 dairy 品类（牛奶/酸奶从 beverage 分离）
- 缺少 fat/condiment 品类数据
- 原始种子中菜品被标记为 ingredient（如宫保鸡丁）

**解决什么问题：**

- 确保推荐引擎有高质量的候选池
- 修复 food_form 分类，使 ingredient/dish 区分准确
- 补全品类覆盖，使 ROLE_CATEGORIES 分配合理

### 方向 3：推荐引擎现实化增强（解决 S3）— 不增加新模块

**为什么需要：** 推荐结果不够贴近用户实际生活。用户反馈"推荐的食物我买不到"或"这个菜太复杂了我不会做"。当前系统有 RealisticFilter 和场景系统，但有效性依赖 `commonalityScore` 的准确性，而种子数据中该字段覆盖不全。

**解决什么问题：**

- 提升 `commonalityScore` 的准确性和覆盖率
- 在种子数据层面保证推荐候选的大众化
- 增强 `food_form` 对推荐管道的影响（优先推荐 dish 而非 ingredient）

### 方向 4：策略种子数据完善（解决 H2）

**为什么需要：** 仅 4 个策略预设覆盖不了常见场景。缺少：

- 场景导向策略（外卖场景、食堂场景）
- 饮食哲学策略（素食、轻断食）
- 健康条件策略（糖尿病、痛风）

**解决什么问题：**

- 使策略引擎的 4 预设 + 细粒度策略组合能覆盖主要用户群
- 新用户冷启动时有更合理的默认策略匹配

### 方向 5：GoalSpeed 枚举统一（解决 M1）

**为什么需要：** `user.types.ts` 中 GoalSpeed 定义为 `aggressive/steady/relaxed`，但 Prisma schema 注释和部分代码使用 `slow/steady/fast`。这种不一致导致序列化/反序列化时可能出错。

**解决什么问题：**

- 统一枚举值，消除前后端不一致
- 确保数据库存储值与代码枚举匹配

### 方向 6：可维护性收尾（解决 H4, M3）

**为什么需要：** V7.5 治理后仍有少量 `as any` 残留，食物 confidence 全部硬编码 0.95 无法区分数据质量。

**解决什么问题：**

- 清理剩余 `as any`
- 为种子数据设置合理的 confidence 分级（权威数据源 0.95，AI 估算 0.75，粗估 0.6）

---

## 三、架构升级设计（Step 3）

### 3.1 当前架构（V7.7）— 无变化

```
RecommendationEngineService (薄门面, ~5 DI)
  ├── ProfileAggregatorService (V7.6)
  │     ├── ProfileResolverService (5层画像聚合)
  │     ├── PreferenceProfileService
  │     ├── FeedbackService
  │     └── ... (9 个画像 DI)
  ├── StrategyResolverFacadeService (V7.6)
  ├── PipelineBuilderService
  │     ├── ScoringChainService ← 10 ScoringFactors
  │     ├── FoodScorerService (14 维评分)
  │     ├── RealisticFilterService
  │     └── SceneResolverService
  ├── MealAssemblerService
  └── HealthModifierEngineService
```

### 3.2 V7.8 变更标注

```
变更类型说明: [新增] [修改] [删除] [数据]

RecommendationEngineService (无变化)
  ├── ProfileAggregatorService (无变化)
  │     └── ProfileResolverService
  │           └── [修改] 移除 exercise_intensity 读取，合并到 exercise_profile
  ├── PipelineBuilderService
  │     ├── ScoringChainService
  │     │     └── LifestyleBoostFactor
  │     │           └── [修改] 从 exercise_profile 推断 intensity，不再读 exercise_intensity
  │     └── RealisticFilterService
  │           └── [修改] 对 food_form='ingredient' 且有同名 dish 的降权
  ├── MealAssemblerService
  │     └── [修改] 组装时优先选择 food_form='dish'

数据层变更:
  ├── [数据] Prisma schema: 删除 exercise_intensity 字段
  ├── [数据] 种子数据: 修复 food_form 分类 + 补全品类 + 去重
  ├── [数据] 种子数据: 新增 6 个策略预设
  └── [数据] 迁移脚本: exercise_intensity → exercise_profile.intensity
```

### 3.3 **不新增模块** — 仅修改现有模块

| 模块/文件                      | 变更类型 | 说明                                             |
| ------------------------------ | -------- | ------------------------------------------------ |
| Prisma schema                  | 修改     | 删除 exercise_intensity，统一 GoalSpeed          |
| user_profiles 迁移             | 新增     | 数据迁移脚本                                     |
| seed-foods.data.ts             | 修改     | 修复 food_form + 去重 + 补品类 + confidence 分级 |
| strategy-seed.service.ts       | 修改     | 新增 6 个策略预设                                |
| LifestyleScoringAdapterService | 修改     | 从 exercise_profile 读取 intensity               |
| ProfileResolverService         | 修改     | 移除 exercise_intensity 映射                     |
| pipeline.types.ts              | 修改     | LifestyleProfile 移除 exerciseIntensity          |
| user.types.ts                  | 修改     | GoalSpeed 枚举统一                               |
| RealisticFilterService         | 修改     | food_form 感知过滤                               |
| MealAssemblerService           | 修改     | dish 优先组装                                    |

---

## 四、模块级升级设计（Step 4）

### 4.1 Profile 模块（用户画像）

**变更：画像字段减法**

1. **删除 `exercise_intensity` 字段**
   - 当前：`exercise_intensity VARCHAR(20)` — none/light/moderate/high
   - 变更：删除此字段，其值合并到 `exercise_profile` JSON
   - 迁移：`exercise_profile.intensity = exercise_intensity`，数据迁移后删列
   - 影响：10 处代码需要改为从 `exercise_profile.intensity` 读取

2. **LifestyleProfile 接口调整**
   - 删除 `exerciseIntensity` 字段
   - 新增 `exerciseIntensity` 计算属性（从 exercise_profile 推断）
   - 由 ProfileResolverService.buildContext() 在组装时计算

3. **事件驱动：无变化**
   - 现有 ProfileEventBus 已足够，无需改动

### 4.2 Recommendation 模块

**变更：现实化增强（不增加新模块）**

1. **RealisticFilterService 增强**
   - 新增 `food_form` 感知：当 `food_form='ingredient'` 且候选池中有同名 dish 时，降低 ingredient 版本权重
   - 目的：推荐 "番茄炒蛋"（dish）而非 "鸡蛋"（ingredient）+ "番茄"（ingredient）

2. **MealAssemblerService 增强**
   - 组装时优先选择 `food_form='dish'` 的候选
   - 当 dish 候选不足时回退到 ingredient

3. **ScoringChain — LifestyleBoostFactor**
   - `exerciseIntensity` 改为从 `PipelineContext.enrichedProfile.lifestyle.exerciseIntensity` 读取
   - 该值由 ProfileResolverService 在组装 LifestyleProfile 时从 `exercise_profile.intensity` 推断

### 4.3 Nutrition / Scoring

**变更：无新增评分维度**

- 不引入 addedSugar vs naturalSugar（数据源不支持，种子数据无此字段）
- 保持 14 维评分不变
- 修复 confidence 分级（种子数据层面）

### 4.4 Cache / 性能

**变更：无**

- 三级缓存已完整
- 无新增异步计算需求

### 4.5 数据流

**变更：无**

- 现有事件流（user action → profile → recommendation）已建立
- ProfileEventBus + ShortTermProfile 已覆盖实时更新需求

---

## 五、技术路线图（Step 5）

### Phase 1（短期 — 数据质量修复 + 画像减法）

> 目标：修复数据基础问题，确保推荐候选池质量

| 编号 | 任务                                                                   | 优先级 | 预估影响       |
| ---- | ---------------------------------------------------------------------- | ------ | -------------- |
| P1-A | Prisma schema: 删除 exercise_intensity，合并到 exercise_profile        | 高     | schema 改 2 行 |
| P1-B | 数据迁移脚本: exercise_intensity → exercise_profile.intensity          | 高     | 新增迁移脚本   |
| P1-C | GoalSpeed 枚举统一: aggressive→fast, relaxed→slow                      | 高     | ±10 行         |
| P1-D | ProfileResolverService: 移除 exercise_intensity 映射                   | 高     | ±5 行          |
| P1-E | LifestyleScoringAdapterService: 改读 exercise_profile.intensity        | 高     | ±8 行          |
| P1-F | pipeline.types.ts: LifestyleProfile.exerciseIntensity 改为计算推断     | 中     | ±5 行          |
| P1-G | 种子数据修复: 修正原始种子的 food_form（菜品→dish，原材料→ingredient） | 高     | ~60 行修改     |
| P1-H | 种子数据去重: 移除 ingredient/dish 重复条目，保留 dish 版本            | 高     | ~40 行删除     |
| P1-I | 种子数据补全: 新增 dairy 品类（牛奶/酸奶/奶酪）从 beverage 分离        | 中     | ~30 行新增     |
| P1-J | 种子数据补全: 新增 fat/condiment 品类数据                              | 中     | ~20 行新增     |
| P1-K | 种子数据分类修正: 鸡蛋/茶叶蛋 snack→protein                            | 高     | ~4 行修改      |
| P1-L | 种子数据 confidence 分级: 权威数据 0.95，AI 估算 0.75                  | 低     | ~50 行修改     |
| P1-M | 编译验证 + 全量测试                                                    | 高     | 0              |

### Phase 2（中期 — 推荐现实化 + 策略完善）

> 目标：提升推荐贴近现实程度，完善策略覆盖

| 编号 | 任务                                                                 | 优先级 | 预估影响   |
| ---- | -------------------------------------------------------------------- | ------ | ---------- |
| P2-A | RealisticFilter: food_form 感知过滤（ingredient 有同名 dish 时降权） | 高     | +20 行     |
| P2-B | MealAssembler: dish 优先组装逻辑                                     | 高     | +15 行     |
| P2-C | 策略种子: 新增 `takeout_focused` 策略（外卖场景优化）                | 中     | +40 行     |
| P2-D | 策略种子: 新增 `canteen_optimized` 策略（食堂场景优化）              | 中     | +40 行     |
| P2-E | 策略种子: 新增 `health_condition_diabetes` 策略（糖尿病专用）        | 中     | +40 行     |
| P2-F | 策略种子: 新增 `health_condition_gout` 策略（痛风专用）              | 中     | +40 行     |
| P2-G | 策略种子: 新增 `vegetarian` 策略（素食推荐）                         | 中     | +40 行     |
| P2-H | 策略种子: 新增 `budget_conscious` 策略（低预算优化）                 | 中     | +40 行     |
| P2-I | 种子数据扩充: 补充常见大众菜品（约 30 道高频家常菜）                 | 中     | +300 行    |
| P2-J | commonalityScore 校准: 基于中国饮食调查数据校准现有评分              | 低     | ~80 行修改 |
| P2-K | 编译验证 + 全量测试                                                  | 高     | 0          |

### Phase 3（长期 — 国际化基础 + 商业化准备）

> 目标：为国际化和商业化打基础

| 编号 | 任务                                                         | 优先级 | 预估影响 |
| ---- | ------------------------------------------------------------ | ------ | -------- |
| P3-A | food_translations 种子数据: 核心食物的英文翻译               | 中     | +200 行  |
| P3-B | recipe_translations 种子数据: 核心菜谱的英文翻译             | 中     | +100 行  |
| P3-C | 策略种子: 国际化策略模板（region_code 条件匹配）             | 低     | +40 行   |
| P3-D | food_regional_info: 补充地区化数据（季节性/流行度/价格级别） | 低     | +100 行  |
| P3-E | 文档: 国际化部署指南                                         | 低     | 新增文档 |
| P3-F | AI 自适应学习: FactorLearner 增加学习率衰减和冷启动策略      | 低     | ±20 行   |

---

## 六、数据迁移（Step 6）

### 6.1 Prisma Schema 变更

```prisma
// 删除 exercise_intensity 字段（合并到 exercise_profile JSON）
// 原: exercise_intensity  String?  @db.VarChar(20)  /// V6.8: none|light|moderate|high
// 删除此行

// GoalSpeed 注释统一
// 原: /// 减脂/增肌速度：slow=慢速, steady=稳健, fast=快速
// 改: /// 减脂/增肌速度：fast=快速, steady=稳健, slow=慢速
```

### 6.2 数据迁移 SQL

```sql
-- Step 1: 将 exercise_intensity 合并到 exercise_profile
UPDATE user_profiles
SET exercise_profile = jsonb_set(
  COALESCE(exercise_profile::jsonb, '{}'::jsonb),
  '{intensity}',
  to_jsonb(exercise_intensity)
)
WHERE exercise_intensity IS NOT NULL
  AND exercise_intensity != '';

-- Step 2: 验证迁移
SELECT COUNT(*) AS total,
       COUNT(CASE WHEN exercise_profile::jsonb ? 'intensity' THEN 1 END) AS migrated,
       COUNT(CASE WHEN exercise_intensity IS NOT NULL AND exercise_intensity != '' THEN 1 END) AS had_intensity
FROM user_profiles;

-- Step 3: GoalSpeed 统一（如果数据库中有旧值）
UPDATE user_profiles SET goal_speed = 'fast' WHERE goal_speed = 'aggressive';
UPDATE user_profiles SET goal_speed = 'slow' WHERE goal_speed = 'relaxed';

-- Step 4: 删除 exercise_intensity 列（在 Prisma migration 中执行）
-- ALTER TABLE user_profiles DROP COLUMN exercise_intensity;
```

---

## 七、文档升级（Step 7）— 差异输出

### 新增章节

- `docs/INTELLIGENT_DIET_SYSTEM_V7_7.md` — V7.7 架构现状文档
- `docs/INTELLIGENT_DIET_SYSTEM_V7_8_UPGRADE.md` — 本文件

### 修改内容

- 无需修改旧版文档（各版本独立）

### 删除内容

- 无
