# 智能饮食系统 V6.3 升级方案

> 基于 V6.2 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-11

---

## 目录

- [[#Step 1：V6.2 能力评估]]
- [[#Step 2：核心升级方向]]
- [[#Step 3：架构升级设计]]
- [[#Step 4：模块级升级设计]]
- [[#Step 5：技术路线图]]
- [[#Step 6：数据迁移]]
- [[#Step 7：文档差异]]

---

## Step 1：V6.2 能力评估

### 1.1 已具备能力

| 能力域   | V6.2 现状                                            | 成熟度 |
| -------- | ---------------------------------------------------- | ------ |
| 用户画像 | 5 层（声明/行为/推断/短期/上下文），CronJob 刷新     | 中高   |
| 推荐引擎 | 10 维评分 + 16 层修正链 + 全局优化器 + 多目标 Pareto | 高     |
| 缓存机制 | L1 内存 + L2 Redis + 食物池分片 + 预计算表           | 高     |
| 行为推断 | 合规率/时段/暴食风险/份量趋势，规则引擎              | 中     |
| 决策系统 | 过敏原前置检查 + 多维评分 + AI 建议生成              | 中     |
| 食物分析 | 文本 + 图片双链路，候选食物管道                      | 中高   |
| 订阅系统 | Free/Pro/Premium + Apple IAP + 微信支付 + 配额       | 高     |
| 协同过滤 | 用户 40% + 物品 60%，余弦相似度 + 时间衰减           | 中     |
| A/B 实验 | 静态分流，Z/t 检验                                   | 中     |
| 健康修正 | 5 层管道（否决/重罚/目标/疾病/正向加成）             | 高     |

### 1.2 核心问题诊断

以下问题基于代码审计发现，按严重程度排序：

#### P0：已计算但未使用的数据（投入产出失衡）

| 死数据                   | 计算位置                          | 问题                                          |
| ------------------------ | --------------------------------- | --------------------------------------------- |
| `taste_pref_vector`      | `profile-cron.service.ts:515-568` | 双周计算，**无任何消费者**                    |
| `userSegment`            | `segmentation.util.ts:57-110`     | 每周计算 7 种分群，**推荐引擎未分支处理**     |
| `churnRisk`              | `profile-cron.service.ts:323-328` | 每周计算，**无留存/通知系统消费**             |
| `nutritionGaps`          | `profile-cron.service.ts:341-358` | 每周计算，**推荐评分未消费**                  |
| `optimalMealCount`       | `profile-cron.service.ts:73-93`   | 每日计算，**计划生成未使用**                  |
| `binge_risk_hours`       | `profile-cron.service.ts:184-208` | 每日计算，**无干预/约束紧缩逻辑**             |
| `mealTimingPatterns`     | `profile-cron.service.ts:157-182` | 每日计算，仅用于 optimalMealCount（亦未用）   |
| `ProfileResolverService` | `profile-resolver.service.ts`     | V6.2 新建的统一聚合器，**推荐引擎绕过不调用** |

**影响：** 约 40% 的画像计算结果是浪费的 CPU 和存储。

#### P1：算法层面不够贴近现实

| 问题                                | 具体表现                                                                                | 影响                            |
| ----------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------- |
| 推荐结果是"单个食物"而非"食谱/菜品" | `MealAssembler` 按角色（碳水/蛋白/蔬菜）拼装独立食物，而非推荐可执行的菜谱              | 用户无法直接执行推荐            |
| 食物库脱离用户实际购买能力          | FoodLibrary 中 USDA/OpenFoodFacts 的食物多为原料，中国超市/外卖实际可获取的菜品覆盖不足 | 推荐了用户买不到的东西          |
| 纤维目标硬编码 27.5g                | `food-scorer.service.ts:~L410`，不区分性别/年龄                                         | USDA 推荐女性 25g、男性 38g     |
| NOVA 加工惩罚是品类级而非单品级     | 所有 NOVA-4 统一 0.55 倍，酸奶和薯片同等对待                                            | 误伤低加工度的 NOVA-4 食物      |
| 没有运动时机感知                    | `post_exercise` 场景在注释中但**从未实现**                                              | 无法提供运动前/后针对性营养建议 |
| Thompson Sampling 是伪实现          | 固定 Beta 范围 [0.3, 1.7] → 缩减，而非真正的贝叶斯后验                                  | 探索效率低，收敛慢              |

#### P2：工程层面

| 问题                      | 具体表现                                                   | 影响                            |
| ------------------------- | ---------------------------------------------------------- | ------------------------------- |
| 协同过滤矩阵全量重建      | `collaborative-filtering.service.ts` 每日 01:00 O(n²) 构建 | 用户量增长后 Cron 爆炸          |
| 周计划串行生成            | `weekly-plan.service.ts` 循环调用 7 次日计划               | 可并行化，减少 ~50% 延迟        |
| 健康修正无缓存            | 5 层管道对每个食物每次请求都执行                           | 可按 (食物, 健康画像 hash) 缓存 |
| Redis 统计非原子操作      | PaywallAnalytics + RecommendationListener 读-改-写         | 并发下数据竞争                  |
| 配额重置逐条 UPDATE       | `quota.service.ts:192-204` while 循环单条更新              | 大用户量时批量效率差            |
| 订阅过期逐条处理          | `subscription.service.ts:431-461` 同上                     | 同上                            |
| 文本分析仅请求 6 种营养素 | AI prompt 只要求返回热量/蛋白/脂肪/碳水/纤维/钠            | 微量营养素缺失，评分不完整      |
| GI/GL 默认 75             | 食物无 GI 数据时统一填 75（中等）                          | 血糖评分不准确                  |

#### P3：架构层面

| 问题                         | 具体表现                                                 | 影响                       |
| ---------------------------- | -------------------------------------------------------- | -------------------------- |
| 推荐策略引擎存在但未深度使用 | StrategyModule 可热切换，但实际只有一套默认策略          | 多策略组合的架构优势未发挥 |
| 无食谱/菜谱层                | 推荐直接操作食物原料，缺少菜谱抽象                       | 用户体验不实用             |
| 特征工程散落                 | 各评分维度的特征提取逻辑分散在 scorer/modifier/engine 中 | 新增特征成本高             |
| 无推荐解释的 A/B 测试        | 解释内容固定，无法验证哪种解释风格转化率更高             | 解释质量无法迭代优化       |
| i18n 食物数据层（L3）未实现  | 食物名称/描述仅中文                                      | 无法国际化                 |

---

## Step 2：核心升级方向

基于以上诊断，确定 **7 个核心升级点**：

### 升级点 1：激活死数据 — 画像驱动推荐闭环

**为什么需要：** 40% 的画像计算结果（7 个字段 + 1 个服务）被浪费。这些数据本该驱动推荐个性化，但推荐引擎绕过了它们。

**解决什么问题：**

- `userSegment` 应驱动不同的推荐策略（新用户温启动 vs 老用户精准推荐）
- `nutritionGaps` 应让推荐填补用户长期营养缺口
- `binge_risk_hours` 应在高风险时段紧缩约束
- `ProfileResolverService` 应成为推荐引擎的唯一画像入口

**具体改动：**

1. 推荐引擎改为调用 `ProfileResolverService.resolve()` 而非手动拼装
2. `userSegment` 映射到 `StrategyModule` 的策略选择
3. `nutritionGaps` 注入 `FoodScorer` 的 nutrientDensity 维度，对缺乏营养素加权
4. `binge_risk_hours` 注入 `ConstraintGenerator`，在高风险时段降低卡路里上限
5. `optimalMealCount` 注入 `DailyPlan` 生成逻辑，动态调整餐次
6. 清除 `taste_pref_vector` 计算逻辑（被 `preferenceProfile` 完全替代）

---

### 升级点 2：引入菜谱层 — 从"食物推荐"到"膳食方案推荐"

**为什么需要：** 当前系统推荐的是独立食物（如"鸡胸肉 200g""西兰花 150g"），用户无法直接执行。现实中用户需要的是"可做的菜"或"可点的外卖"。

**解决什么问题：**

- 推荐结果不可执行（用户不知道怎么做）
- 食物库以原料为主，脱离实际购买/烹饪场景
- `canCook` 字段收集了但未影响推荐

**具体改动：**

1. 新增 `Recipe` 实体（菜谱），包含：食材列表、制作步骤、难度、时长、标签
2. 新增 `RecipeIngredient` 关联实体（菜谱 ↔ FoodLibrary 多对多 + 用量）
3. `MealAssembler` 新增菜谱模式：优先推荐菜谱，降级到食物组合
4. 根据 `canCook` + `cookingSkillLevel` 调整菜谱难度范围
5. 根据 `takeoutFrequency` 区分"自己做"和"外卖/食堂"推荐

**数据来源：**

- Phase 1：AI 生成（基于现有食物库 + 常见搭配，由 Gateway 批量生成）
- Phase 2：外卖平台数据对接（按地区爬取热门菜品）
- Phase 3：用户 UGC 贡献

---

### 升级点 3：营养分析精细化 — 从 6 维到 12 维

**为什么需要：** 文本分析 AI prompt 只请求 6 种营养素（热量/蛋白/脂肪/碳水/纤维/钠），但评分引擎需要 9 种鼓励营养素 + 3 种限制营养素（NRF 9.3）。缺失数据导致评分用品类平均值填充，精度低。

**解决什么问题：**

- NRF 9.3 评分中 7 种营养素靠估算
- `addedSugar` vs `naturalSugar` 字段存在但 AI 不返回
- GI/GL 默认 75 导致血糖评分形同虚设

**具体改动：**

1. 升级 AI 分析 prompt，要求返回 12 维营养素：
   - 原有 6 维：calories, protein, fat, carbs, fiber, sodium
   - 新增 6 维：saturatedFat, addedSugar, vitaminA, vitaminC, calcium, iron
2. 新增 GI/GL 估算逻辑：基于食物类别 + 碳水含量 + 加工程度三因素估算
3. 分析结果入库时写入对应字段（`FoodAnalysisRecord` 已有字段，目前空置）
4. NOVA 惩罚从品类级细化到单品级：使用 `processingScore` 字段（Food Pipeline 已计算）

---

### 升级点 4：推荐引擎策略化 — 分群策略 + 冷启动解决

**为什么需要：** 当前 StrategyModule 有热切换能力但只有一套默认策略。新用户（<20 条交互）的协同过滤信号为零，完全依赖内容推荐，导致冷启动体验差。

**解决什么问题：**

- 新用户推荐质量低
- 所有用户用同一套参数，无差异化
- 策略引擎的投资没有产出

**具体改动：**

1. 定义 4 套预设策略，映射到用户分群：

| 分群                                      | 策略名       | 核心差异                                       |
| ----------------------------------------- | ------------ | ---------------------------------------------- |
| `new_user`                                | `warm_start` | 热门食物优先 + 探索率 40% + 简化解释           |
| `returning_user`                          | `re_engage`  | 历史偏好食物 + 新品探索 10% + "回来看看新推荐" |
| `disciplined_loser` / `muscle_builder`    | `precision`  | 严格营养匹配 + 低探索 + 详细营养解释           |
| `casual_maintainer` / `active_maintainer` | `discovery`  | 多样性优先 + 菜谱推荐 + 轻量解释               |

2. `StrategyModule` 新增自动分配逻辑：用户分群变更时自动切换策略
3. 冷启动方案：
   - 利用 Onboarding 的 `foodPreferences` 和 `cuisinePreferences` 作为初始信号
   - 按地区热门食物填充初始推荐池
   - 前 5 次交互强制高探索率（Thompson Sampling alpha=beta=1）

---

### 升级点 5：性能优化 — 批量化 + 并行化 + 缓存增强

**为什么需要：** 多处逐条处理模式在用户量增长时会成为瓶颈。协同过滤全量重建 O(n²) 不可持续。

**解决什么问题：**

- Cron 任务耗时随用户增长线性/平方增长
- 周计划生成延迟可减半
- 健康修正重复计算可消除

**具体改动：**

| 优化项     | 当前                  | V6.3                                                           | 预期收益          |
| ---------- | --------------------- | -------------------------------------------------------------- | ----------------- |
| 配额重置   | while 循环逐条 UPDATE | `UPDATE ... WHERE expires_at < NOW()` 单条 SQL                 | 100x 提速         |
| 订阅过期   | while 循环逐条处理    | 批量查询 + 批量更新 + 批量事件（`subscription.batch_expired`） | 50x 提速          |
| 周计划生成 | 串行 7 次日计划       | `Promise.all` 并行 7 天（共享预加载数据）                      | ~3x 提速          |
| 健康修正   | 每食物每请求重算      | `Map<foodId_healthHash, modifier>` 请求级缓存                  | 消除 80% 重复计算 |
| CF 矩阵    | 全量日重建            | 增量更新：只重算有新交互的用户行/列                            | O(n²) → O(k\*n)   |
| Redis 统计 | 读-改-写              | `HINCRBY` 原子操作                                             | 消除竞态          |
| 预计算触发 | 固定 03:00 全量       | 事件驱动：画像变更时触发单用户预计算                           | 减少无效计算      |

---

### 升级点 6：纤维目标个性化 + 微量营养素目标

**为什么需要：** 纤维目标硬编码 27.5g 对所有人，不符合实际推荐（USDA：女性 25g，男性 38g，随年龄递减）。宏量营养素目标也是固定比例表。

**解决什么问题：**

- 评分精度：性别/年龄差异大的营养素目标一刀切
- 用户信任：懂营养的用户会发现推荐不合理

**具体改动：**

1. 新增 `NutritionTargetService`，基于性别 + 年龄 + 目标动态计算：
   - 纤维：男 38g / 女 25g，50+ 岁递减 10%
   - 微量营养素 RDA 表：vitA, vitC, vitD, vitE, calcium, iron, potassium（按中国 DRIs 2023）
2. `ConstraintGenerator` 从 `NutritionTargetService` 获取个性化目标，替代硬编码
3. `FoodScorer` 的 NRF 9.3 评分使用个性化 RDA 作为基准

---

### 升级点 7：可解释性增强 — 从"为什么推荐"到"为什么这么搭配"

**为什么需要：** V6.2 的解释系统可以解释单个食物的推荐理由，但无法解释整餐搭配的逻辑（为什么配了这个菜 + 那个汤 + 这个主食）。

**解决什么问题：**

- 用户不理解整餐搭配逻辑
- 菜谱推荐需要更高层次的解释

**具体改动：**

1. `ExplanationGeneratorService` 新增 `explainMealComposition()` 方法：
   - 输入：一餐的完整食物/菜谱列表
   - 输出：营养互补说明（如"鸡胸肉提供蛋白质，西兰花补充维C促进铁吸收"）
2. 推荐结果增加 `mealExplanation` 字段（整餐层面解释）
3. 菜谱推荐增加 `whyThisRecipe` 字段（为什么推荐这道菜）

---

## Step 3：架构升级设计

### V6.3 架构变更图

```
V6.2 架构：
┌─────────────────────────────────────────────────────┐
│                   推荐引擎                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │Constraint│→ │  Filter  │→ │  Scorer  │→ │Assemb│ │
│  │Generator │  │          │  │          │  │ler   │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────┘ │
│        ↑ 手动拼装画像                                  │
│  ┌───────────────────────┐                           │
│  │ shortTermProfile (Redis)                          │
│  │ contextualProfile (计算)                           │
│  │ declared (DB)                                     │
│  └───────────────────────┘                           │
└─────────────────────────────────────────────────────┘

V6.3 架构（新增/变更用 ★ 标记）：
┌─────────────────────────────────────────────────────┐
│                   推荐引擎                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐ │
│  │Constraint│→ │  Filter  │→ │  Scorer  │→ │Assemb│ │
│  │Generator │  │          │  │(+NRF升级)│  │ler   │ │
│  │(+个性化  │  │          │  │(+缺口加权)│  │(+菜谱│ │
│  │ 营养目标)│  │          │  │          │  │ 模式)│ │
│  └──────────┘  └──────────┘  └──────────┘  └──────┘ │
│        ↑                                             │
│  ★ ProfileResolverService.resolve()                  │
│  ┌───────────────────────────────────────┐           │
│  │ EnrichedProfileContext                 │           │
│  │ ├─ declared (含 canCook/budget 等)     │           │
│  │ ├─ observed (行为 + ★暴食风险)         │           │
│  │ ├─ inferred (★分群 → 策略映射)         │           │
│  │ ├─ shortTerm (Redis)                  │           │
│  │ └─ contextual (场景 + ★运动后)         │           │
│  └───────────────────────────────────────┘           │
│        ↑                                             │
│  ★ StrategySelector（分群 → 策略自动映射）            │
│  ┌───────────────────────────────────────┐           │
│  │ warm_start / re_engage / precision /  │           │
│  │ discovery                              │           │
│  └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘

★ 新增模块：
┌──────────────────────┐   ┌──────────────────────┐
│ NutritionTargetService│   │ RecipeModule          │
│ (个性化营养目标计算)   │   │ ├─ Recipe 实体        │
│ (性别/年龄/目标/DRI)  │   │ ├─ RecipeIngredient   │
│                      │   │ ├─ AI 菜谱生成        │
│                      │   │ └─ 菜谱评分/推荐      │
└──────────────────────┘   └──────────────────────┘
```

### 新增模块清单

| 模块                     | 类型                           | 职责                                |
| ------------------------ | ------------------------------ | ----------------------------------- |
| `NutritionTargetService` | Service（注入 DietModule）     | 基于用户属性计算个性化营养目标      |
| `RecipeModule`           | 新 NestJS Module               | 菜谱管理、菜谱-食材关联、AI菜谱生成 |
| `StrategySelector`       | Service（注入 StrategyModule） | 分群 → 策略自动映射                 |

### 修改的已有模块

| 模块                                 | 变更点                                               |
| ------------------------------------ | ---------------------------------------------------- |
| `recommendation-engine.service.ts`   | 调用 ProfileResolverService 替代手动拼装             |
| `food-scorer.service.ts`             | NRF 基准个性化 + nutritionGaps 加权 + 纤维目标个性化 |
| `constraint-generator`               | 接入 NutritionTargetService + bingeRiskHours 约束    |
| `meal-assembler.service.ts`          | 新增菜谱模式                                         |
| `contextual-profile.service.ts`      | 实现 post_exercise 场景                              |
| `food-text-analysis.service.ts`      | prompt 升级到 12 维营养素                            |
| `quota.service.ts`                   | 批量化 SQL                                           |
| `subscription.service.ts`            | 批量化过期处理                                       |
| `collaborative-filtering.service.ts` | 增量更新                                             |
| `weekly-plan.service.ts`             | 并行化生成                                           |
| `explanation-generator.service.ts`   | 新增整餐解释                                         |

---

## Step 4：模块级升级设计

### 4.1 Profile 模块（用户画像）

**目标：从"计算了不用"到"计算了就用"**

#### 4.1.1 ProfileResolverService 成为推荐唯一入口

```typescript
// 当前：recommendation-engine.service.ts:190-213
// 手动拼装，绕过 ProfileResolverService
const shortTermProfile = await this.realtimeProfileService.getProfile(userId);
const contextualProfile = this.contextualProfileService.detect(/* ... */);
// ... 手动组装

// V6.3：统一调用
const profile = await this.profileResolverService.resolve(userId, {
  includeShortTerm: true,
  includeContextual: true,
  scene: detectedScene,
});
```

**改动文件：** `recommendation-engine.service.ts`, `precompute.processor.ts`

#### 4.1.2 分群驱动策略

```typescript
// 新增：strategy-selector.service.ts
@Injectable()
export class StrategySelectorService {
  private readonly SEGMENT_STRATEGY_MAP: Record<UserSegment, string> = {
    new_user: 'warm_start',
    returning_user: 're_engage',
    disciplined_loser: 'precision',
    muscle_builder: 'precision',
    active_maintainer: 'discovery',
    casual_maintainer: 'discovery',
    binge_risk: 'precision', // 严格模式
  };

  async resolveStrategy(userId: string, segment: UserSegment): Promise<Strategy> {
    // 1. 检查是否有手动分配的策略（A/B实验）
    const manual = await this.strategyAssignmentRepo.findOne({ userId });
    if (manual) return manual.strategy;

    // 2. 按分群自动映射
    const strategyName = this.SEGMENT_STRATEGY_MAP[segment];
    return this.strategyRepo.findOne({ name: strategyName });
  }
}
```

#### 4.1.3 激活死数据

| 死数据             | 消费者                       | 接入方式                                      |
| ------------------ | ---------------------------- | --------------------------------------------- |
| `nutritionGaps`    | `FoodScorer.nutrientDensity` | 缺乏的营养素在 NRF 9.3 中权重 ×1.5            |
| `binge_risk_hours` | `ConstraintGenerator`        | 当前时段匹配风险时段时，卡路里上限 ×0.85      |
| `optimalMealCount` | `DailyPlanService`           | 根据最优餐次生成计划（3-6 餐），替代固定 3 餐 |
| `userSegment`      | `StrategySelectorService`    | 自动映射推荐策略                              |

#### 4.1.4 清理无用计算

- 删除 `taste_pref_vector` 的计算逻辑和 Cron 任务（`profile-cron.service.ts:515-568`）
- 保留字段但标记 `@Deprecated`，下个版本移除

#### 4.1.5 新增 post_exercise 场景

```typescript
// contextual-profile.service.ts:新增场景检测
// 基于用户设置的运动时间 + 当前时间判断
private detectPostExercise(profile: DeclaredProfile, hour: number): boolean {
  if (!profile.exerciseSchedule) return false;
  const todayExercise = profile.exerciseSchedule[dayOfWeek];
  if (!todayExercise) return false;
  const exerciseEndHour = todayExercise.startHour + todayExercise.durationHours;
  return hour >= exerciseEndHour && hour <= exerciseEndHour + 2;
}

// post_exercise 场景权重：蛋白质 ×1.3，碳水 ×1.2，卡路里 ×1.1
```

**需要 UserProfile 新增字段：** `exerciseSchedule: JSON`（每周运动计划，可选）

---

### 4.2 Recommendation 模块

**目标：从"单一管道"到"策略驱动 + 菜谱感知"**

#### 4.2.1 策略化推荐

每套策略定义 5 个维度的参数：

```typescript
interface RecommendationStrategy {
  name: string;
  recallPolicy: {
    poolSize: number; // 召回池大小
    popularityWeight: number; // 热门食物权重
    cfWeight: number; // 协同过滤权重
    contentWeight: number; // 内容过滤权重
  };
  rankPolicy: {
    explorationRate: number; // 探索率
    scoringWeightOverrides?: Partial<ScoringWeights>; // 评分权重覆盖
  };
  assemblyPolicy: {
    preferRecipe: boolean; // 是否优先菜谱
    diversityLevel: 'low' | 'medium' | 'high';
  };
  explainPolicy: {
    detailLevel: 'simple' | 'standard' | 'detailed';
    showNutritionRadar: boolean;
  };
}
```

Strategy 数据存储在 `Strategy` 实体中（已存在），只需填充 `config` JSON 字段。

#### 4.2.2 冷启动方案

```
新用户（< 20 交互）的推荐路径：

1. Onboarding 信号提取：
   - foodPreferences → 初始品类偏好
   - cuisinePreferences → 初始菜系偏好
   - allergens → 硬过滤
   - canCook + cookingSkillLevel → 菜谱难度范围

2. 地区热门兜底：
   - 按 regionCode 查询 top 50 高评分食物/菜谱
   - 按 Onboarding 偏好过滤

3. 高探索率：
   - Thompson Sampling 初始 alpha=beta=1（均匀分布）
   - 前 5 次交互不收缩范围

4. 快速反馈循环：
   - 每次反馈后立即重算短期画像
   - 3 次交互后激活品类偏好调整
   - 10 次交互后启用 CF 预热（使用相似新用户的数据）
```

#### 4.2.3 MealAssembler 菜谱模式

```typescript
// meal-assembler.service.ts 新增
async assembleMealWithRecipes(
  candidates: ScoredFood[],
  recipes: ScoredRecipe[],  // 新增
  constraints: MealConstraints,
  strategy: AssemblyPolicy,
): Promise<AssembledMeal> {
  if (strategy.preferRecipe && recipes.length > 0) {
    // 菜谱优先模式：
    // 1. 从菜谱中选 1-2 道主菜（评分最高）
    // 2. 计算菜谱的总营养
    // 3. 用单品食物补充缺口（如需要额外蔬菜/主食）
    return this.assembleFromRecipes(recipes, candidates, constraints);
  }
  // 降级：原有食物组合模式
  return this.assembleFromFoods(candidates, constraints);
}
```

---

### 4.3 Nutrition / Scoring 模块

**目标：从"粗估"到"个性化精准"**

#### 4.3.1 NutritionTargetService

```typescript
@Injectable()
export class NutritionTargetService {
  /**
   * 基于中国 DRIs 2023 + USDA DRI 计算个性化营养目标
   */
  calculate(profile: {
    gender: 'male' | 'female';
    age: number;
    goal: GoalType;
    weightKg: number;
    healthConditions?: HealthCondition[];
  }): NutritionTargets {
    return {
      fiber: this.calcFiber(profile.gender, profile.age),
      vitaminA: this.calcVitaminA(profile.gender, profile.age),
      vitaminC: this.calcVitaminC(profile.gender, profile.age),
      calcium: this.calcCalcium(profile.age),
      iron: this.calcIron(profile.gender, profile.age),
      potassium: 3500, // mg, 中国DRI统一推荐
      // ... 更多微量营养素
    };
  }

  private calcFiber(gender: string, age: number): number {
    // USDA: 男 38g, 女 25g; 50+ 岁递减 10%
    const base = gender === 'male' ? 38 : 25;
    return age >= 50 ? base * 0.9 : base;
  }
}
```

#### 4.3.2 AI 分析 Prompt 升级

```
// 当前 prompt（6 维）：
"请分析以下食物的营养成分：热量、蛋白质、脂肪、碳水化合物、膳食纤维、钠"

// V6.3 prompt（12 维）：
"请分析以下食物的营养成分（每100g）：
必须返回：热量(kcal)、蛋白质(g)、总脂肪(g)、碳水化合物(g)、膳食纤维(g)、钠(mg)
尽量返回：饱和脂肪(g)、添加糖(g)、维生素A(μg RAE)、维生素C(mg)、钙(mg)、铁(mg)
如果不确定，请标注 estimated: true"
```

#### 4.3.3 GI/GL 估算增强

```typescript
// 当前：默认 75
// V6.3：基于食物特征估算
estimateGI(food: FoodLibrary): number {
  if (food.glycemicIndex) return food.glycemicIndex;

  // 三因素估算模型
  const categoryGI = CATEGORY_GI_MAP[food.category] ?? 55;
  const processingAdj = food.novaClass ? (food.novaClass - 1) * 5 : 0;
  const fiberAdj = food.fiber ? Math.min(food.fiber * 2, 15) : 0;

  return Math.max(20, Math.min(100, categoryGI + processingAdj - fiberAdj));
}
```

#### 4.3.4 NRF 9.3 个性化

```typescript
// 当前：固定 sigmoid 中心 150
// V6.3：基于个人 RDA 计算
calculateNRF93(food: FoodLibrary, targets: NutritionTargets): number {
  const encouraged = [
    (food.protein / targets.protein) * 100,
    (food.fiber / targets.fiber) * 100,
    (food.vitaminA / targets.vitaminA) * 100,
    // ... 9 种
  ].reduce((sum, v) => sum + Math.min(v, 100), 0); // cap at 100% DV each

  const limited = [
    (food.saturatedFat / 20) * 100,  // DV 20g
    (food.sodium / 2300) * 100,       // DV 2300mg
    (food.addedSugar / 50) * 100,     // DV 50g
  ].reduce((sum, v) => sum + v, 0);

  return encouraged - limited;
}
```

---

### 4.4 Cache / 性能

**目标：消除已知瓶颈，为用户增长做准备**

#### 4.4.1 批量化数据库操作

```sql
-- 配额重置：从逐条 UPDATE 改为单条 SQL
UPDATE usage_quotas
SET used_count = 0, last_reset_at = NOW()
WHERE expires_at < NOW() AND used_count > 0;

-- 订阅过期：批量处理
UPDATE subscriptions
SET status = 'expired', updated_at = NOW()
WHERE status = 'active' AND end_date < NOW()
RETURNING id, user_id;
-- 然后对返回的用户批量发送事件
```

#### 4.4.2 健康修正请求级缓存

```typescript
// health-modifier-engine.service.ts
async calculateModifier(
  food: FoodLibrary,
  healthProfile: HealthProfile,
  cache?: Map<string, number>,  // 新增：请求级缓存
): Promise<number> {
  const cacheKey = `${food.id}_${hashHealthProfile(healthProfile)}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey)!;

  const modifier = await this.runPipeline(food, healthProfile);
  cache?.set(cacheKey, modifier);
  return modifier;
}
```

#### 4.4.3 协同过滤增量更新

```typescript
// collaborative-filtering.service.ts
@Cron('0 1 * * *')
async incrementalUpdate() {
  // 1. 获取昨天有新交互的用户 ID 列表
  const changedUsers = await this.getChangedUsersSince(yesterday);

  // 2. 只重算这些用户的相似度行
  for (const userId of changedUsers) {
    await this.rebuildUserRow(userId);
  }

  // 3. 只重算涉及食物的物品相似度列
  const changedFoods = await this.getChangedFoodsSince(yesterday);
  for (const foodId of changedFoods) {
    await this.rebuildItemColumn(foodId);
  }
}
```

#### 4.4.4 周计划并行化

```typescript
// weekly-plan.service.ts
async generateWeeklyPlan(userId: string): Promise<WeeklyPlan> {
  // 共享数据预加载（一次）
  const sharedData = await this.preloadSharedData(userId);

  // 7 天并行生成
  const days = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6].map(dayOffset =>
      this.generateDayPlan(userId, dayOffset, sharedData)
    )
  );

  // 跨天去重修正
  return this.crossDayDiversityPass(days);
}
```

#### 4.4.5 Redis 原子操作

```typescript
// 当前：paywall-analytics.listener.ts
// const stats = await this.redis.get(key);
// stats.count++;
// await this.redis.set(key, stats);

// V6.3：原子操作
await this.redis.hincrby(`paywall:stats:${date}`, 'trigger_count', 1);
await this.redis.hincrby(`paywall:stats:${date}`, `feature:${featureKey}`, 1);
```

---

### 4.5 数据流

**目标：从"部分事件驱动"到"完整事件驱动推荐链"**

#### 事件驱动推荐链

```
用户操作
    │
    ├─→ user.meal.recorded
    │       ├─→ 更新行为画像（实时）
    │       ├─→ 更新短期画像（Redis）
    │       ├─→ 检查成就
    │       └─→ ★ 触发单用户推荐预计算
    │
    ├─→ user.feedback.submitted
    │       ├─→ 权重学习
    │       ├─→ A/B 数据记录
    │       └─→ ★ 更新偏好画像 → 触发预计算
    │
    ├─→ user.profile.updated
    │       ├─→ 缓存失效
    │       ├─→ ★ 重算分群 → 可能切换策略
    │       └─→ ★ 触发预计算
    │
    └─→ ★ user.exercise.completed（新事件）
            ├─→ 更新运动记录
            └─→ 触发 post_exercise 场景推荐
```

**关键变更：**

1. 预计算从固定 03:00 全量触发 → 事件驱动单用户触发（保留 03:00 作为兜底）
2. 分群变更触发策略自动切换
3. 新增 `user.exercise.completed` 事件

---

## Step 5：技术路线图

### Phase 1：短期（2-3 周）— 低风险优化

**目标：激活死数据 + 性能优化，不涉及新模块**

| 任务                                     | 工作量 | 风险 |
| ---------------------------------------- | ------ | ---- |
| 推荐引擎改用 ProfileResolverService      | 2d     | 低   |
| nutritionGaps 注入 FoodScorer            | 1d     | 低   |
| bingeRiskHours 注入 ConstraintGenerator  | 1d     | 低   |
| optimalMealCount 注入 DailyPlan          | 1d     | 低   |
| 删除 taste_pref_vector 计算              | 0.5d   | 低   |
| 配额/订阅批量化 SQL                      | 1d     | 低   |
| Redis 原子操作                           | 0.5d   | 低   |
| 健康修正请求级缓存                       | 1d     | 低   |
| 周计划并行化                             | 1d     | 中   |
| 纤维目标个性化（NutritionTargetService） | 2d     | 低   |
| AI prompt 升级到 12 维                   | 1d     | 中   |
| GI/GL 估算增强                           | 1d     | 低   |
| NOVA 惩罚单品化                          | 0.5d   | 低   |

**总计：~14 天**

**验证方式：**

- 推荐结果对比测试：同一用户 V6.2 vs V6.3 Phase 1 的推荐差异
- 性能基准测试：配额/订阅 Cron 耗时对比
- 营养评分精度：10 种常见食物的 NRF 评分对比

---

### Phase 2：中期（3-4 周）— 架构增强

**目标：策略系统 + 菜谱模块 + 冷启动方案**

| 任务                                       | 工作量 | 风险 |
| ------------------------------------------ | ------ | ---- |
| 4 套预设策略定义 + 入库                    | 2d     | 低   |
| StrategySelectorService（分群 → 策略映射） | 2d     | 中   |
| 推荐引擎策略参数注入                       | 3d     | 中   |
| 冷启动方案实现                             | 3d     | 中   |
| Recipe 实体 + RecipeIngredient 实体        | 1d     | 低   |
| RecipeModule（CRUD + 评分）                | 3d     | 中   |
| AI 菜谱批量生成（Pipeline + Prompt）       | 3d     | 中   |
| MealAssembler 菜谱模式                     | 3d     | 高   |
| post_exercise 场景 + exerciseSchedule 字段 | 2d     | 中   |
| 协同过滤增量更新                           | 2d     | 中   |
| 事件驱动预计算                             | 2d     | 中   |
| NRF 9.3 个性化                             | 1d     | 低   |

**总计：~27 天**

**验证方式：**

- 冷启动 A/B：新用户 V6.2 vs V6.3 的 7 日留存率
- 菜谱推荐测试：10 个用户画像 × 3 餐的推荐结果人工评审
- 策略差异化：不同分群用户的推荐多样性指标

---

### Phase 3：长期（4-6 周）— 可解释性 + 数据闭环

**目标：完善体验，建立数据飞轮**

| 任务                               | 工作量 | 风险 |
| ---------------------------------- | ------ | ---- |
| 整餐解释（explainMealComposition） | 3d     | 中   |
| 菜谱解释（whyThisRecipe）          | 2d     | 中   |
| 解释风格 A/B 测试框架              | 2d     | 中   |
| 用户 UGC 菜谱提交 + 审核流         | 5d     | 高   |
| 外卖/食堂菜品数据对接方案          | 3d     | 高   |
| CANDIDATE_PROMOTED 事件监听        | 1d     | 低   |
| GOAL_ACHIEVED 事件监听             | 1d     | 低   |
| 菜谱数据质量监控                   | 2d     | 中   |
| 推荐效果仪表盘（Admin）            | 3d     | 中   |
| export 队列 Processor              | 2d     | 低   |

**总计：~24 天**

**验证方式：**

- 解释满意度：用户反馈中"解释有帮助"比例 >60%
- 菜谱覆盖率：推荐结果中菜谱占比 >40%
- UGC 数据质量：用户提交菜谱的审核通过率 >50%

---

## Step 6：数据迁移

### 6.1 新增数据库实体

```sql
-- Recipe 菜谱表
CREATE TABLE recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  cuisine VARCHAR(50),         -- 菜系
  difficulty SMALLINT DEFAULT 1, -- 1-5
  prep_time_minutes INTEGER,   -- 准备时间
  cook_time_minutes INTEGER,   -- 烹饪时间
  servings SMALLINT DEFAULT 1, -- 份数
  tags TEXT[],                 -- 标签（如：快手菜/减脂/增肌）
  instructions JSONB,          -- 制作步骤
  image_url VARCHAR(500),
  source VARCHAR(50) DEFAULT 'ai_generated', -- ai_generated / user / imported
  calories_per_serving DECIMAL(8,2),
  protein_per_serving DECIMAL(8,2),
  fat_per_serving DECIMAL(8,2),
  carbs_per_serving DECIMAL(8,2),
  fiber_per_serving DECIMAL(8,2),
  quality_score DECIMAL(5,2) DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_recipes_cuisine ON recipes(cuisine);
CREATE INDEX idx_recipes_difficulty ON recipes(difficulty);
CREATE INDEX idx_recipes_tags ON recipes USING GIN(tags);
CREATE INDEX idx_recipes_quality ON recipes(quality_score DESC) WHERE is_active = true;

-- RecipeIngredient 菜谱食材关联表
CREATE TABLE recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id UUID REFERENCES food_library(id) ON DELETE SET NULL,
  ingredient_name VARCHAR(100) NOT NULL, -- 冗余名称，food_id 可能为空
  amount DECIMAL(8,2),
  unit VARCHAR(20),
  is_optional BOOLEAN DEFAULT false,
  sort_order SMALLINT DEFAULT 0
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);
CREATE INDEX idx_recipe_ingredients_food ON recipe_ingredients(food_id);
```

### 6.2 已有表新增字段

```sql
-- user_profiles 新增运动计划字段
ALTER TABLE user_profiles
ADD COLUMN exercise_schedule JSONB DEFAULT NULL;
-- 格式：{ "monday": { "startHour": 7, "durationHours": 1, "type": "cardio" }, ... }

-- food_analysis_records 新增微量营养素字段（已有字段已经够用，
-- 只需确保 AI 返回时写入，无需新增列）
```

### 6.3 策略数据初始化

```sql
-- 插入 4 套预设策略
INSERT INTO strategies (name, description, config, is_default, is_active) VALUES
('warm_start', '新用户温启动策略', '{
  "recallPolicy": { "poolSize": 100, "popularityWeight": 0.5, "cfWeight": 0, "contentWeight": 0.5 },
  "rankPolicy": { "explorationRate": 0.4 },
  "assemblyPolicy": { "preferRecipe": true, "diversityLevel": "high" },
  "explainPolicy": { "detailLevel": "simple", "showNutritionRadar": false }
}', false, true),

('re_engage', '回归用户策略', '{
  "recallPolicy": { "poolSize": 80, "popularityWeight": 0.2, "cfWeight": 0.3, "contentWeight": 0.5 },
  "rankPolicy": { "explorationRate": 0.15 },
  "assemblyPolicy": { "preferRecipe": true, "diversityLevel": "medium" },
  "explainPolicy": { "detailLevel": "standard", "showNutritionRadar": true }
}', false, true),

('precision', '精准营养策略', '{
  "recallPolicy": { "poolSize": 120, "popularityWeight": 0.1, "cfWeight": 0.4, "contentWeight": 0.5 },
  "rankPolicy": { "explorationRate": 0.05 },
  "assemblyPolicy": { "preferRecipe": false, "diversityLevel": "low" },
  "explainPolicy": { "detailLevel": "detailed", "showNutritionRadar": true }
}', false, true),

('discovery', '探索发现策略', '{
  "recallPolicy": { "poolSize": 150, "popularityWeight": 0.3, "cfWeight": 0.3, "contentWeight": 0.4 },
  "rankPolicy": { "explorationRate": 0.25 },
  "assemblyPolicy": { "preferRecipe": true, "diversityLevel": "high" },
  "explainPolicy": { "detailLevel": "standard", "showNutritionRadar": false }
}', true, true);
```

### 6.4 迁移执行顺序

```bash
# 1. 创建新表（无依赖）
pnpm db:migration:generate -- CreateRecipeTables

# 2. 新增字段（无依赖）
pnpm db:migration:generate -- AddExerciseScheduleToProfile

# 3. 初始化策略数据
pnpm db:migration:generate -- SeedV63Strategies

# 4. 执行迁移
pnpm db:migrate
```

---

## Step 7：文档差异

### 7.1 新增章节

| 章节                   | 位置                     | 内容                                |
| ---------------------- | ------------------------ | ----------------------------------- |
| RecipeModule 说明      | 核心模块 §2.2 之后       | 菜谱管理、菜谱-食材关联、AI菜谱生成 |
| NutritionTargetService | 核心模块 §2.2 推荐系统内 | 个性化营养目标计算服务              |
| 策略自动映射           | 核心模块 §2.2 推荐系统内 | 分群 → 策略的自动映射逻辑           |
| 冷启动方案             | 核心模块 §2.2 推荐系统内 | 新用户推荐策略                      |
| 菜谱推荐流程           | 核心流程 §3 之后         | 菜谱召回 → 评分 → 组装流程图        |
| V6.3 升级清单          | 文档末尾                 | 本文档完整内容                      |

### 7.2 修改内容

| 位置                     | 变更                                                 |
| ------------------------ | ---------------------------------------------------- |
| §2.2 推荐系统 - 组件表   | 新增 NutritionTargetService、StrategySelectorService |
| §2.2 推荐系统 - 关键实体 | 新增 Recipe, RecipeIngredient                        |
| §3.3 个性化推荐流程      | 流程图新增"策略选择"步骤 + "菜谱/食物"分支           |
| §4.4 使用 AI 计算的场景  | 新增"AI 菜谱生成"                                    |
| §6.1 实体统计            | 新增菜谱领域 2 个实体，总计 55 → 57                  |
| §8 事件驱动架构          | 新增 user.exercise.completed 事件                    |
| §4.2 写数据库的场景      | 新增"生成菜谱"                                       |

### 7.3 删除内容

| 位置               | 变更                                                   |
| ------------------ | ------------------------------------------------------ |
| ProfileCronService | 删除 taste_pref_vector 双周计算任务                    |
| 推荐引擎内部       | 删除手动画像拼装代码，改为 ProfileResolverService 调用 |

### 7.4 API 新增端点（预期）

| 端点                              | 方法 | 说明             |
| --------------------------------- | ---- | ---------------- |
| `/api/app/food/recipes`           | GET  | 搜索菜谱         |
| `/api/app/food/recipes/:id`       | GET  | 菜谱详情         |
| `/api/app/food/recipe-suggestion` | GET  | 菜谱推荐         |
| `/api/admin/recipes`              | CRUD | 管理后台菜谱管理 |
| `/api/admin/recipes/generate`     | POST | AI 批量生成菜谱  |

---

## 附：V5 → V6.3 演进总结

| 维度 | V5           | V6.0                | V6.1          | V6.2                       | V6.3                                   |
| ---- | ------------ | ------------------- | ------------- | -------------------------- | -------------------------------------- |
| 推荐 | 10 维评分    | + 策略引擎 + 预计算 | 不变          | + 全画像接入               | + 策略自动映射 + 菜谱模式 + 冷启动     |
| 画像 | 3 层 + 填充  | + 短期 + 上下文     | 不变          | + ProfileResolver 5 层统一 | + 激活死数据 + 运动场景 + 分群驱动     |
| 营养 | NRF 9.3 固定 | 不变                | 不变          | + addedSugar 区分          | + 12 维分析 + 个性化 RDA + GI 估算     |
| 商业 | 无           | 订阅 + 支付         | + 配额 + 分层 | + 安全加固                 | 不变（稳定）                           |
| 食物 | 原料库       | 不变                | + 分析管道    | + 搜索增强                 | + 菜谱层 + AI 菜谱生成                 |
| 性能 | 基础         | + 3 级缓存          | 不变          | + 批量 + 游标分页          | + 批量 SQL + 并行 + 增量 CF + 缓存增强 |
| 解释 | 单食物       | + 反向解释          | + 分层展示    | 不变                       | + 整餐解释 + 菜谱解释                  |
