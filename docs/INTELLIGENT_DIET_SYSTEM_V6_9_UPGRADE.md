# 智能饮食系统 V6.9 升级方案

> 基于 V6.8 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-12

---

## 目录

1. [Step 1：V6.8 能力评估](#step-1v68-能力评估)
2. [Step 2：核心升级方向](#step-2核心升级方向)
3. [Step 3：架构升级设计](#step-3架构升级设计)
4. [Step 4：模块级升级设计](#step-4模块级升级设计)
5. [Step 5：技术路线图](#step-5技术路线图)
6. [Step 6：数据迁移](#step-6数据迁移)
7. [Step 7：文档差异](#step-7文档差异)

---

## Step 1：V6.8 能力评估

### 1.1 V6.8 已达成能力

| 层次              | 已达成                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **评分管道**      | 12 维评分 + 13 层 Boost，90+ 参数全量外部化，NRF gap 连续函数，添加糖乘法惩罚，Lifestyle 单路径消费                        |
| **召回架构**      | 三路召回（Rule/Semantic/CF）+ RecallMerger 统一融合 + RecallMetadata 溯源                                                  |
| **餐食组合**      | 5 维组合评分（ingredientDiversity + cookingMethodDiversity + flavorHarmony + nutritionComplementarity + textureDiversity） |
| **排序学习**      | LearnedRanking logistic loss + L2 正则 + 验证集 + dimensionScores 精准梯度                                                 |
| **用户画像**      | RealtimeProfile 7 天滑窗 + ContextualProfile 10 场景 + ProfileResolver 5 层聚合 + 冲突解决层 + 新鲜度衰减                  |
| **策略系统**      | 3 层优先级 + 9 子配置段 + Redis 同步 Pub/Sub + Wilson score 统计增强                                                       |
| **管道架构**      | PipelineBuilder 三阶段 + 阶段级 try-catch + 降级标记 + Thompson Sampling                                                   |
| **现实过滤**      | commonality + budget + cookTime + 技能硬过滤 + 食堂模式 + 场景动态调整                                                     |
| **替换服务**      | 6 维营养等价（calories + protein + fat + carbs + GI + micronutrients）                                                     |
| **WeightLearner** | per-dimension 梯度 + 用户级偏移 + 餐次分维 + 7 天半衰期                                                                    |
| **i18n**          | 三语 405+ keys + locale 映射修复 + 线程安全 + 全服务覆盖                                                                   |
| **管道容错**      | 每阶段独立 try-catch + fallback + PipelineDegradation 记录                                                                 |
| **数据模型**      | 48+ Prisma models，foods 70+ 字段，pgvector embedding                                                                      |

### 1.2 V6.8 遗留问题诊断

#### P0：推荐结果脱离现实

- **P0-1**：**推荐食物过于"原材料化"** — 系统基于 `FoodLibrary`（食材级别）推荐，推出"鸡胸肉100g + 西兰花150g + 糙米100g"而非"西兰花炒鸡胸 + 糙米饭"。用户无法直接按原材料执行，导致执行率（Execution Rate）低。虽然有 `ScoredRecipe` 和菜谱模块，但菜谱与推荐管道的集成非常松散——菜谱仅作为 `MealFromPoolRequest.scoredRecipes` 可选参数旁路注入，不是管道一等公民。
- **P0-2**：**场景推断过于粗糙** — `inferAcquisitionChannel()` 仅基于硬编码规则（工作日+午餐→外卖，周末→在家做）。不利用用户历史行为（"这个用户周一到周五中午 80% 叫外卖"），不考虑地理位置、天气等外部信号。同一用户不同天的场景相同。
- **P0-3**：**食物可获得性（Availability）维度缺失** — `availableChannels` 字段存在于 `FoodLibrary` 但大多数食物未标注或默认空数组。系统无法区分"在超市随处可买"vs"只有专业渠道才有"的食物。`commonalityScore` 是静态标注值，不随地区/季节/渠道变化。
- **P0-4**：**现实策略不可配置** — 现实过滤（RealisticFilter）的开关粒度只有 `realism.enabled`，用户无法说"我想要挑战性高的菜"或"今天想简单吃"。RealisticFilter 的严格度完全由策略配置决定，用户端无实时覆盖能力。

#### P1：推荐多样性与智能性不足

- **P1-1**：**无跨餐多样性控制** — 推荐引擎按餐次独立运行（`recommendMealFromPool` 是单餐逻辑），不感知"今天早餐已推荐了面包+牛奶，午餐不应再推面包"的跨餐重复问题。`usedNames` 只在单餐内去重。
- **P1-2**：**无执行率追踪与反馈闭环** — 系统有 `recommendation_feedbacks`（accepted/rejected/replaced），但无"用户是否真正按推荐吃了"的执行追踪。WeightLearner 只能从二值反馈学习，不知道推荐被执行的比例和偏差。
- **P1-3**：**评分维度缺少"大众化"信号** — `commonalityScore` 仅在 RealisticFilter 中做硬过滤（<20 被过滤），但不参与 12 维评分。高大众化的食物和低大众化的食物在评分阶段得分相同，仅靠过滤层强制移除不常见食物。
- **P1-4**：**Segment 发现仍是半静态** — V6.8 将 segment 映射迁移到 Redis，但 segment 定义本身（如 `high_processed_low_compliance`）仍是人工预设，无自动发现能力。
- **P1-5**：**解释系统缺乏结构化 insights** — ExplanationGenerator 输出自然语言文本，但无结构化数据（如"这道菜满足了你 35% 的蛋白质需求"），前端无法做可视化展示。

#### P2：工程与数据问题

- **P2-1**：**菜谱模块与推荐管道分离** — `recipe.types.ts` 有 `ScoredRecipe` 接口，但菜谱评分逻辑不在主管道中。推荐引擎的 `recommendMealFromPool` 在组装阶段才尝试用菜谱替换单食材，优先级低且替换成功率不可控。
- **P2-2**：**食物数据缺少渠道标注** — `FoodLibrary.availableChannels` 字段存在但食物数据中大多未标注。没有"外卖常见菜"、"便利店可买到"、"食堂常见菜"的系统化标注。
- **P2-3**：**推荐结果无"一餐整体方案"概念** — `MealRecommendation.foods` 是 `ScoredFood[]`（独立食物列表），不是一个有主题的"方案"（如"快手中式早餐方案: 鸡蛋灌饼+豆浆+小菜"）。
- **P2-4**：**预计算缓存未区分场景** — 每日 03:00 预计算只按 userId + goalType 缓存，不区分渠道/场景。用户从 HOME_COOK 切换到 DELIVERY 时仍命中旧缓存。
- **P2-5**：**食物可解释性数据不足** — FoodLibrary 有 70+ 字段但缺少"为什么推荐这个食物"需要的上下文字段（如"常见度描述"、"适合场景"、"营养亮点"、"搭配建议"）。

---

## Step 2：核心升级方向

基于 V6.8 遗留问题诊断，确定 **7 个核心升级点**：

### 升级点 1：场景化推荐引擎 — 从渠道过滤到场景驱动

**为什么需要：** V6.8 的场景推断（`inferAcquisitionChannel`）是硬编码规则，不学习用户行为模式。推荐结果不区分"今天想叫外卖"vs"今天想在家做"的用户意图。场景不仅影响食物过滤，还应影响评分权重、召回策略、份量和菜谱选择。

**解决什么问题：** P0-2、P0-4

### 升级点 2：菜谱优先推荐 — 从食材拼凑到方案推荐

**为什么需要：** 当前系统推荐独立食材（"鸡胸肉+西兰花+米饭"），用户需要自己组合成可执行的菜品。菜谱模块存在但未深度集成到推荐管道。用户期望得到的是"番茄炒蛋+米饭+紫菜汤"这样的完整方案。

**解决什么问题：** P0-1、P2-1、P2-3

### 升级点 3：食物可获得性维度 — 从静态标注到动态评估

**为什么需要：** `commonalityScore` 是食物的静态字段，不随渠道/地区变化。一个食物在超市得分 80，在便利店可能只有 30。需要渠道×食物的动态可获得性评分，让推荐结果真正"买得到"。

**解决什么问题：** P0-3、P2-2

### 升级点 4：执行率优化 — 从推荐到执行的闭环

**为什么需要：** 系统只知道推荐被"接受"或"拒绝"，不知道被执行的比例。需要建立 推荐→接受→执行→反馈 的完整闭环，让 WeightLearner 能从执行率学习，而不仅从二值反馈学习。同时引入"大众化信号"进入评分维度。

**解决什么问题：** P1-2、P1-3

### 升级点 5：跨餐多样性与日计划

**为什么需要：** 单餐推荐模式下，早餐推荐了"面包+牛奶"，午餐可能再推"面包+鸡蛋"。缺乏跨餐食材/品类/烹饪方式的多样性约束。需要在推荐引擎层面引入日级上下文。

**解决什么问题：** P1-1、P2-4

### 升级点 6：结构化可解释性 — Explainable Recommendation

**为什么需要：** 当前解释是纯文本字符串，前端无法做可视化展示（如"蛋白质贡献饼图"、"营养达标进度条"）。需要结构化的 insights 数据，同时保留人类可读的文本解释。

**解决什么问题：** P1-5、P2-5

### 升级点 7：智能 Segment 发现 + 动态策略生成

**为什么需要：** V6.8 将 segment 映射迁移到 Redis 但 segment 定义仍是手动预设。需要基于用户行为聚类自动发现新 segment，并为新 segment 自动生成策略假设。

**解决什么问题：** P1-4

---

## Step 3：架构升级设计

### 3.1 推荐管道架构演进

**V6.8 管道（保持不变的部分）：**

```
User Request
  → ProfileResolver（5 层聚合 + 冲突解决层）
  → ConstraintGenerator
  → PipelineBuilder（Recall → Rank → Rerank）
    ├── RuleRecall + SemanticRecall + CFRecall
    ├── RecallMerger（三路融合）
    ├── FoodFilter（硬约束）
    ├── FoodScorer（12 维 + 全量外部化 + lifestyle 去重）
    ├── LearnedRanking（+ dimensionScores 精准梯度）
    ├── ConflictResolver（多轮迭代）
    ├── RealisticFilter（commonality + budget + 技能 + 场景）
    ├── MealCompositionScorer（5 维）
    ├── SubstitutionService（6 维营养等价）
    └── ExplanationGenerator
  → Response
```

**V6.9 增量变化：**

```
User Request
  → ProfileResolver（5 层聚合 + 冲突解决层）
  → [NEW] SceneResolver（用户历史行为→场景推断 + 场景配置覆盖）
  → ConstraintGenerator
  → [NEW] DailyPlanContext（跨餐多样性上下文 + 已推荐食物/品类追踪）
  → PipelineBuilder（Recall → Rank → Rerank）
    ├── RuleRecall + SemanticRecall + CFRecall
    ├── RecallMerger（三路融合）
    ├── FoodFilter（硬约束）
    ├── [UPGRADE] FoodScorer（12→13 维，新增 popularity 维度）
    ├── LearnedRanking
    ├── [UPGRADE] RealisticFilter（+ 渠道可获得性动态评分）
    ├── [NEW] RecipeAssembler（食材→菜谱提升，一等公民集成）
    ├── ConflictResolver（多轮迭代）
    ├── [UPGRADE] MealCompositionScorer（5 维 + 跨餐多样性惩罚）
    ├── SubstitutionService（6 维营养等价）
    ├── [UPGRADE] ExplanationGenerator（+ 结构化 insights）
    └── [NEW] ExecutionRateTracker（执行率追踪 + 反馈闭环）
  → [UPGRADE] Response（MealPlan 方案化输出）

[NEW] SceneResolver（场景解析器，行为驱动）
[NEW] DailyPlanContext（日计划上下文）
[NEW] RecipeAssembler（菜谱组装器）
[NEW] AvailabilityScorer（渠道可获得性评分）
[NEW] ExecutionRateTracker（执行率追踪）
[UPGRADE] RealisticFilter（+ 用户端可配置严格度）
[UPGRADE] FoodScorer（+1 维: popularity）
[UPGRADE] ExplanationGenerator（+ 结构化 insights）
[UPGRADE] MealCompositionScorer（+ 跨餐多样性）
[UPGRADE] SegmentDiscoveryService（自动聚类）
```

### 3.2 核心架构变化

```
recommendation/
├── [NEW]     scene-resolver.service.ts            # 场景解析（行为+规则混合）
├── [NEW]     daily-plan-context.service.ts         # 跨餐日计划上下文
├── [NEW]     recipe-assembler.service.ts           # 菜谱优先组装
├── [NEW]     availability-scorer.service.ts        # 渠道可获得性评分
├── [NEW]     execution-tracker.service.ts          # 执行率追踪
├── [UPGRADE] food-scorer.service.ts               # +popularity 维度
├── [UPGRADE] realistic-filter.service.ts          # +动态可获得性 + 用户覆盖
├── [UPGRADE] meal-composition-scorer.service.ts   # +跨餐多样性
├── [UPGRADE] explanation-generator.service.ts     # +结构化 insights
├── [UPGRADE] recommendation.types.ts              # 新增接口
├── [UPGRADE] pipeline-builder.service.ts          # RecipeAssembler 集成
├── [UPGRADE] recommendation-engine.service.ts     # DailyPlanContext + SceneResolver
strategy/
├── [NEW]     segment-discovery.service.ts         # 自动 segment 聚类
├── [UPGRADE] strategy-auto-tuner.service.ts       # 动态 segment 支持
user/
├── [UPGRADE] contextual-profile.service.ts        # 场景行为特征输出
```

### 3.3 数据流变化

**场景推断流：**

```
V6.8: request.channel || inferAcquisitionChannel(硬编码规则) → AcquisitionChannel
V6.9: request.channel || SceneResolver.resolve(用户行为历史 + 规则) → SceneContext {
        channel: AcquisitionChannel,
        sceneType: 'quick_meal' | 'cooking_at_home' | 'eating_out' | 'office_lunch' | ...,
        realismLevel: 'strict' | 'normal' | 'relaxed',
        confidenceScore: number,
      }
```

**推荐输出流：**

```
V6.8: MealRecommendation { foods: ScoredFood[], ... }
V6.9: MealRecommendation {
        foods: ScoredFood[],
        recipes?: AssembledRecipe[],     // 菜谱方案
        planTheme?: string,              // 方案主题（如"快手中式早餐"）
        insights: StructuredInsight[],   // 结构化可解释性数据
        executionDifficulty: number,     // 执行难度 0-1
        ...
      }
```

**执行率闭环：**

```
V6.8: recommend → accept/reject → WeightLearner（二值梯度）
V6.9: recommend → accept/reject → execute/skip → ExecutionRateTracker → WeightLearner（执行率加权梯度）
```

---

## Step 4：模块级升级设计

### 4.1 场景解析器 — SceneResolver（Phase 1-A）

**新增文件：**

- `recommendation/scene-resolver.service.ts`
- `recommendation/recommendation.types.ts`（新增 SceneContext）

**目标：** 从硬编码场景推断升级为行为驱动 + 规则混合的场景解析，支持用户端覆盖。

**4.1.1 SceneContext 接口**

```typescript
// V6.9: 场景解析结果
export interface SceneContext {
  /** 食物获取渠道 */
  channel: AcquisitionChannel;
  /** 场景类型：细粒度场景标签 */
  sceneType: SceneType;
  /** 现实严格度（用户可覆盖） */
  realismLevel: 'strict' | 'normal' | 'relaxed';
  /** 场景推断置信度 0-1 */
  confidence: number;
  /** 推断来源 */
  source: 'user_explicit' | 'behavior_learned' | 'rule_inferred' | 'default';
  /** 场景特定约束 */
  sceneConstraints: SceneConstraints;
}

export type SceneType =
  | 'quick_breakfast' // 快速早餐（工作日，时间紧张）
  | 'leisurely_brunch' // 悠闲早午餐（周末）
  | 'office_lunch' // 办公室午餐（外卖/食堂）
  | 'home_cooking' // 在家做饭（有时间烹饪）
  | 'eating_out' // 外出就餐
  | 'convenience_meal' // 便利店快餐
  | 'canteen_meal' // 食堂用餐
  | 'post_workout' // 运动后
  | 'late_night_snack' // 深夜加餐
  | 'family_dinner' // 家庭晚餐（多人份）
  | 'meal_prep' // 备餐（批量制作）
  | 'general'; // 通用（无明确场景）

export interface SceneConstraints {
  /** 最大准备时间（分钟），null = 不限 */
  maxPrepTime?: number | null;
  /** 最大烹饪时间（分钟），null = 不限 */
  maxCookTime?: number | null;
  /** 偏好的烹饪方式 */
  preferredCookingMethods?: string[];
  /** 偏好的食物类型标签 */
  preferredTags?: string[];
  /** 排除的食物类型标签 */
  excludedTags?: string[];
  /** 建议份量人数（默认 1） */
  servingCount?: number;
  /** 是否需要便携（如带饭） */
  portable?: boolean;
}
```

**4.1.2 SceneResolver 实现**

```typescript
@Injectable()
export class SceneResolverService {
  constructor(
    private readonly redis: RedisCacheService,
    private readonly logger: Logger
  ) {}

  /**
   * 解析当前推荐请求的场景上下文
   *
   * 优先级:
   * 1. 用户显式指定（请求参数）
   * 2. 行为学习（Redis 中的用户行为模式）
   * 3. 规则推断（现有 inferAcquisitionChannel 逻辑增强）
   * 4. 默认
   */
  async resolve(
    userId: string,
    mealType: string,
    explicitChannel?: string | null,
    explicitRealism?: string | null,
    contextualProfile?: ContextualProfile | null,
    declaredProfile?: any
  ): Promise<SceneContext> {
    // 1. 用户显式指定
    if (explicitChannel || explicitRealism) {
      return this.buildExplicitScene(explicitChannel, explicitRealism, mealType, declaredProfile);
    }

    // 2. 行为学习: 查询用户在 (dayOfWeek, mealType) 组合下的历史渠道偏好
    const learned = await this.learnFromHistory(userId, mealType);
    if (learned && learned.confidence >= 0.6) {
      return learned;
    }

    // 3. 规则推断（增强版 inferAcquisitionChannel）
    const ruleInferred = this.inferByRules(mealType, contextualProfile, declaredProfile);

    // 4. 合并: 行为学习 + 规则推断加权
    if (learned) {
      return this.mergeScenes(learned, ruleInferred);
    }

    return ruleInferred;
  }

  /**
   * 从用户历史行为学习场景偏好
   *
   * Redis key: scene:user:{userId}:patterns
   * Value: { [dayOfWeek_mealType]: { channel: string, count: number }[] }
   */
  private async learnFromHistory(userId: string, mealType: string): Promise<SceneContext | null> {
    const key = `scene:user:${userId}:patterns`;
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const patterns = JSON.parse(raw);
    const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat
    const patternKey = `${dayOfWeek}_${mealType}`;
    const channelHistory = patterns[patternKey];

    if (!channelHistory || channelHistory.length === 0) return null;

    // 选择出现频率最高的渠道
    const sorted = [...channelHistory].sort((a, b) => b.count - a.count);
    const total = sorted.reduce((s, x) => s + x.count, 0);
    const top = sorted[0];
    const confidence = top.count / total;

    return {
      channel: top.channel as AcquisitionChannel,
      sceneType: this.channelToSceneType(top.channel, mealType),
      realismLevel: 'normal',
      confidence,
      source: 'behavior_learned',
      sceneConstraints: this.getDefaultConstraints(this.channelToSceneType(top.channel, mealType)),
    };
  }

  /**
   * 记录用户实际选择的渠道，更新行为模式
   * 在推荐被执行后调用
   */
  async recordChannelUsage(
    userId: string,
    mealType: string,
    channel: AcquisitionChannel
  ): Promise<void> {
    const key = `scene:user:${userId}:patterns`;
    const dayOfWeek = new Date().getDay();
    const patternKey = `${dayOfWeek}_${mealType}`;

    const raw = await this.redis.get(key);
    const patterns = raw ? JSON.parse(raw) : {};

    if (!patterns[patternKey]) patterns[patternKey] = [];

    const existing = patterns[patternKey].find((x: any) => x.channel === channel);
    if (existing) {
      existing.count++;
    } else {
      patterns[patternKey].push({ channel, count: 1 });
    }

    // 保留最近 30 天的数据，TTL 30 天
    await this.redis.set(key, JSON.stringify(patterns), 30 * 86400);
  }

  private channelToSceneType(channel: string, mealType: string): SceneType {
    const map: Record<string, Record<string, SceneType>> = {
      home_cook: {
        breakfast: 'quick_breakfast',
        lunch: 'home_cooking',
        dinner: 'home_cooking',
        snack: 'convenience_meal',
      },
      delivery: {
        breakfast: 'quick_breakfast',
        lunch: 'office_lunch',
        dinner: 'eating_out',
        snack: 'convenience_meal',
      },
      canteen: {
        breakfast: 'canteen_meal',
        lunch: 'canteen_meal',
        dinner: 'canteen_meal',
        snack: 'convenience_meal',
      },
      convenience: {
        breakfast: 'convenience_meal',
        lunch: 'convenience_meal',
        dinner: 'convenience_meal',
        snack: 'convenience_meal',
      },
      restaurant: {
        breakfast: 'eating_out',
        lunch: 'eating_out',
        dinner: 'eating_out',
        snack: 'eating_out',
      },
    };
    return map[channel]?.[mealType] ?? 'general';
  }

  private getDefaultConstraints(sceneType: SceneType): SceneConstraints {
    const defaults: Record<SceneType, SceneConstraints> = {
      quick_breakfast: {
        maxPrepTime: 10,
        maxCookTime: 15,
        preferredTags: ['breakfast', 'easy_digest', 'quick'],
        portable: false,
      },
      leisurely_brunch: {
        maxPrepTime: null,
        maxCookTime: null,
        preferredTags: ['breakfast', 'brunch'],
        servingCount: 2,
      },
      office_lunch: {
        maxPrepTime: 0,
        maxCookTime: 0,
        preferredTags: ['balanced', 'delivery_friendly'],
        portable: true,
      },
      home_cooking: {
        maxPrepTime: 30,
        maxCookTime: 60,
        preferredCookingMethods: ['stir_fry', 'steam', 'boil', 'braise'],
      },
      eating_out: {
        maxPrepTime: 0,
        maxCookTime: 0,
        preferredTags: ['restaurant'],
      },
      convenience_meal: {
        maxPrepTime: 5,
        maxCookTime: 5,
        preferredTags: ['convenience', 'ready_to_eat', 'snack'],
      },
      canteen_meal: {
        maxPrepTime: 0,
        maxCookTime: 0,
        preferredTags: ['canteen', 'common'],
      },
      post_workout: {
        maxPrepTime: 10,
        maxCookTime: 0,
        preferredTags: ['high_protein', 'quick', 'recovery'],
      },
      late_night_snack: {
        maxPrepTime: 5,
        maxCookTime: 10,
        preferredTags: ['low_calorie', 'light', 'easy_digest'],
        excludedTags: ['heavy_flavor', 'fried', 'high_fat'],
      },
      family_dinner: {
        maxPrepTime: null,
        maxCookTime: null,
        servingCount: 3,
        preferredCookingMethods: ['stir_fry', 'steam', 'braise', 'soup'],
      },
      meal_prep: {
        maxPrepTime: null,
        maxCookTime: null,
        preferredTags: ['meal_prep', 'batch_cook', 'freezer_friendly'],
        servingCount: 5,
      },
      general: {},
    };
    return defaults[sceneType] ?? {};
  }
}
```

**验收标准：**

- SceneResolver 支持 4 层优先级（显式 > 行为学习 > 规则推断 > 默认）
- 行为学习基于 Redis 中的 (dayOfWeek × mealType) 历史模式
- 支持 12 种场景类型，每种有默认约束
- 用户端可通过 `explicitRealism` 覆盖严格度
- 编译通过

---

### 4.2 菜谱优先推荐 — RecipeAssembler（Phase 1-B）

**新增/升级文件：**

- `recommendation/recipe-assembler.service.ts`（新增）
- `recommendation/pipeline-builder.service.ts`（升级）
- `recommendation/recommendation.types.ts`（新增 AssembledRecipe）

**目标：** 将菜谱从管道旁路参数提升为一等公民，在排序后尝试将食材组合匹配为菜谱方案。

**4.2.1 AssembledRecipe 接口**

```typescript
// V6.9: 组装后的菜谱方案
export interface AssembledRecipe {
  /** 菜谱 ID（如果匹配到数据库菜谱） */
  recipeId?: string;
  /** 菜谱名称 */
  name: string;
  /** 组成食材（来自 ScoredFood） */
  ingredients: ScoredFood[];
  /** 总热量 */
  totalCalories: number;
  /** 总蛋白质 */
  totalProtein: number;
  /** 预估烹饪时间（分钟） */
  estimatedCookTime: number;
  /** 所需技能等级 */
  skillLevel: string;
  /** 适合的渠道 */
  suitableChannels: AcquisitionChannel[];
  /** 菜谱评分（综合营养+可执行性+匹配度） */
  recipeScore: number;
  /** 是否是智能组装的（vs 数据库匹配的） */
  isAssembled: boolean;
}

// V6.9: MealRecommendation 新增字段
export interface MealRecommendation {
  // ... 现有字段 ...
  /** V6.9: 菜谱方案（如果成功组装） */
  recipes?: AssembledRecipe[];
  /** V6.9: 方案主题标签（如 "快手中式早餐"、"高蛋白午餐"） */
  planTheme?: string;
  /** V6.9: 执行难度 0-1（0=零准备，1=专业厨师级） */
  executionDifficulty?: number;
}
```

**4.2.2 RecipeAssembler 实现**

```typescript
@Injectable()
export class RecipeAssemblerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger
  ) {}

  /**
   * 尝试将排序后的食材候选组装为菜谱方案
   *
   * 策略:
   * 1. 先查询数据库中匹配当前食材组合的菜谱
   * 2. 如果匹配率 >= 60%，直接使用数据库菜谱
   * 3. 如果无匹配，根据角色模板（carb+protein+veggie）智能组装
   * 4. 为组装结果生成方案名称和主题
   */
  async assembleRecipes(
    scoredFoods: ScoredFood[],
    sceneContext: SceneContext,
    mealType: string
  ): Promise<{
    recipes: AssembledRecipe[];
    planTheme: string;
    executionDifficulty: number;
  }> {
    // 1. 尝试数据库菜谱匹配
    const dbRecipes = await this.matchDatabaseRecipes(scoredFoods, sceneContext);

    if (dbRecipes.length > 0) {
      return {
        recipes: dbRecipes,
        planTheme: this.generateTheme(dbRecipes, sceneContext, mealType),
        executionDifficulty: this.calcDifficulty(dbRecipes, sceneContext),
      };
    }

    // 2. 智能组装
    const assembled = this.smartAssemble(scoredFoods, sceneContext, mealType);
    return {
      recipes: assembled,
      planTheme: this.generateTheme(assembled, sceneContext, mealType),
      executionDifficulty: this.calcDifficulty(assembled, sceneContext),
    };
  }

  /**
   * 从数据库匹配菜谱
   *
   * 匹配逻辑:
   * - 查询食材主料（mainIngredient）与当前候选食物的交集
   * - 匹配率 = 交集食材数 / 菜谱食材数
   * - 筛选条件: 匹配率 >= 60% + 渠道兼容 + 烹饪时间满足场景约束
   */
  private async matchDatabaseRecipes(
    foods: ScoredFood[],
    scene: SceneContext
  ): Promise<AssembledRecipe[]> {
    const ingredientNames = foods.map((f) => f.food.mainIngredient).filter(Boolean);
    if (ingredientNames.length === 0) return [];

    // 查询包含这些食材的菜谱
    const recipes = await this.prisma.recipes.findMany({
      where: {
        status: 'active',
        ingredients: {
          some: {
            food_name: { in: ingredientNames as string[] },
          },
        },
        // 渠道兼容
        ...(scene.channel !== AcquisitionChannel.UNKNOWN
          ? {
              available_channels: {
                has: scene.channel,
              },
            }
          : {}),
      },
      include: { ingredients: true },
      take: 10,
    });

    return recipes
      .map((recipe) => {
        const recipeIngredients = recipe.ingredients.map((i) => i.food_name);
        const matched = ingredientNames.filter((n) => recipeIngredients.includes(n!));
        const matchRate = matched.length / recipeIngredients.length;

        if (matchRate < 0.6) return null;

        // 检查烹饪时间约束
        const maxCook = scene.sceneConstraints.maxCookTime;
        if (maxCook !== null && maxCook !== undefined) {
          if ((recipe.cook_time_minutes ?? 0) > maxCook) return null;
        }

        return {
          recipeId: recipe.id,
          name: recipe.name,
          ingredients: foods.filter((f) => recipeIngredients.includes(f.food.mainIngredient ?? '')),
          totalCalories: foods.reduce((s, f) => s + f.servingCalories, 0),
          totalProtein: foods.reduce((s, f) => s + f.servingProtein, 0),
          estimatedCookTime: recipe.cook_time_minutes ?? 0,
          skillLevel: recipe.skill_level ?? 'easy',
          suitableChannels: (recipe.available_channels ?? []) as AcquisitionChannel[],
          recipeScore: matchRate,
          isAssembled: false,
        } as AssembledRecipe;
      })
      .filter(Boolean)
      .sort((a, b) => b!.recipeScore - a!.recipeScore) as AssembledRecipe[];
  }

  /**
   * 智能组装：根据角色模板将食材包装为"菜品方案"
   */
  private smartAssemble(
    foods: ScoredFood[],
    scene: SceneContext,
    mealType: string
  ): AssembledRecipe[] {
    // 按角色分组（carb/protein/veggie/side）
    const grouped: Record<string, ScoredFood[]> = {};
    for (const f of foods) {
      const role = this.inferRole(f.food);
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(f);
    }

    // 组装方案: 每个主食材+搭配 = 一个"菜"
    const recipes: AssembledRecipe[] = [];

    // 主菜: protein + veggie 搭配
    const proteins = grouped['protein'] ?? [];
    const veggies = grouped['veggie'] ?? [];
    if (proteins.length > 0) {
      const mainDish: AssembledRecipe = {
        name: this.generateDishName(proteins[0], veggies[0]),
        ingredients: [proteins[0], ...(veggies[0] ? [veggies[0]] : [])],
        totalCalories: proteins[0].servingCalories + (veggies[0]?.servingCalories ?? 0),
        totalProtein: proteins[0].servingProtein + (veggies[0]?.servingProtein ?? 0),
        estimatedCookTime: Math.max(
          proteins[0].food.cookTimeMinutes ?? 15,
          veggies[0]?.food.cookTimeMinutes ?? 10
        ),
        skillLevel: proteins[0].food.skillRequired ?? 'easy',
        suitableChannels: [scene.channel],
        recipeScore: (proteins[0].score + (veggies[0]?.score ?? 0)) / 2,
        isAssembled: true,
      };
      recipes.push(mainDish);
    }

    // 主食: carb
    const carbs = grouped['carb'] ?? [];
    for (const carb of carbs) {
      recipes.push({
        name: carb.food.name,
        ingredients: [carb],
        totalCalories: carb.servingCalories,
        totalProtein: carb.servingProtein,
        estimatedCookTime: carb.food.cookTimeMinutes ?? 10,
        skillLevel: 'easy',
        suitableChannels: [scene.channel],
        recipeScore: carb.score,
        isAssembled: true,
      });
    }

    // 汤/饮品/配菜
    const sides = grouped['side'] ?? [];
    for (const side of sides) {
      recipes.push({
        name: side.food.name,
        ingredients: [side],
        totalCalories: side.servingCalories,
        totalProtein: side.servingProtein,
        estimatedCookTime: side.food.cookTimeMinutes ?? 5,
        skillLevel: 'easy',
        suitableChannels: [scene.channel],
        recipeScore: side.score,
        isAssembled: true,
      });
    }

    return recipes;
  }

  private inferRole(food: FoodLibrary): string {
    const cat = food.category;
    if (['protein', 'dairy'].includes(cat)) return 'protein';
    if (['grain', 'composite'].includes(cat)) return 'carb';
    if (cat === 'veggie') return 'veggie';
    return 'side';
  }

  private generateDishName(protein: ScoredFood, veggie?: ScoredFood): string {
    if (veggie) {
      const method = protein.food.cookingMethod ?? '炒';
      return `${veggie.food.name}${method}${protein.food.name}`;
    }
    return protein.food.name;
  }

  private generateTheme(recipes: AssembledRecipe[], scene: SceneContext, mealType: string): string {
    const sceneLabel: Record<string, string> = {
      quick_breakfast: '快手早餐',
      home_cooking: '家常菜',
      office_lunch: '工作日午餐',
      convenience_meal: '便捷餐',
      canteen_meal: '食堂推荐',
      eating_out: '外出用餐',
      family_dinner: '家庭晚餐',
      general: '均衡搭配',
    };
    return sceneLabel[scene.sceneType] ?? '均衡搭配';
  }

  private calcDifficulty(recipes: AssembledRecipe[], scene: SceneContext): number {
    if (recipes.length === 0) return 0;
    const avgCookTime = recipes.reduce((s, r) => s + r.estimatedCookTime, 0) / recipes.length;
    const skillMap: Record<string, number> = {
      easy: 0.1,
      beginner: 0.2,
      medium: 0.4,
      intermediate: 0.5,
      hard: 0.7,
      advanced: 0.9,
    };
    const avgSkill =
      recipes.reduce((s, r) => s + (skillMap[r.skillLevel] ?? 0.3), 0) / recipes.length;
    // 加权: 技能 60% + 时间 40%
    return avgSkill * 0.6 + Math.min(1, avgCookTime / 120) * 0.4;
  }
}
```

**验收标准：**

- RecipeAssembler 优先匹配数据库菜谱（匹配率 >= 60%）
- 无匹配时智能组装食材为菜品方案
- 输出包含 planTheme 和 executionDifficulty
- 编译通过

---

### 4.3 食物可获得性维度 — AvailabilityScorer（Phase 1-C）

**新增文件：**

- `recommendation/availability-scorer.service.ts`

**升级文件：**

- `recommendation/realistic-filter.service.ts`

**目标：** 为每个食物在当前场景下计算动态可获得性评分，替代静态 `commonalityScore` 的单一维度。

**4.3.1 AvailabilityScore 接口**

```typescript
// V6.9: 渠道可获得性评分
export interface AvailabilityScore {
  /** 在当前渠道下的可获得性 0-1（0=几乎买不到，1=随处可见） */
  channelAvailability: number;
  /** 综合可获得性（考虑渠道+季节+地区） */
  overallAvailability: number;
  /** 评分来源 */
  source: 'food_data' | 'channel_default' | 'fallback';
}
```

**4.3.2 AvailabilityScorer 实现**

```typescript
@Injectable()
export class AvailabilityScorerService {
  // 渠道×品类 默认可获得性矩阵
  // 行: 渠道, 列: 品类
  private readonly CHANNEL_CATEGORY_MATRIX: Record<string, Record<string, number>> = {
    home_cook: {
      protein: 0.9,
      grain: 0.95,
      veggie: 0.9,
      fruit: 0.85,
      dairy: 0.85,
      composite: 0.6,
      snack: 0.7,
      beverage: 0.8,
      fat: 0.9,
      condiment: 0.95,
    },
    delivery: {
      protein: 0.7,
      grain: 0.8,
      veggie: 0.6,
      fruit: 0.4,
      dairy: 0.5,
      composite: 0.9,
      snack: 0.5,
      beverage: 0.7,
      fat: 0.3,
      condiment: 0.2,
    },
    convenience: {
      protein: 0.3,
      grain: 0.6,
      veggie: 0.2,
      fruit: 0.5,
      dairy: 0.8,
      composite: 0.7,
      snack: 0.95,
      beverage: 0.95,
      fat: 0.1,
      condiment: 0.1,
    },
    canteen: {
      protein: 0.8,
      grain: 0.9,
      veggie: 0.85,
      fruit: 0.5,
      dairy: 0.4,
      composite: 0.85,
      snack: 0.3,
      beverage: 0.6,
      fat: 0.3,
      condiment: 0.3,
    },
    restaurant: {
      protein: 0.8,
      grain: 0.7,
      veggie: 0.7,
      fruit: 0.4,
      dairy: 0.5,
      composite: 0.95,
      snack: 0.4,
      beverage: 0.8,
      fat: 0.3,
      condiment: 0.3,
    },
    unknown: {
      protein: 0.7,
      grain: 0.8,
      veggie: 0.7,
      fruit: 0.6,
      dairy: 0.6,
      composite: 0.7,
      snack: 0.6,
      beverage: 0.7,
      fat: 0.5,
      condiment: 0.5,
    },
  };

  /**
   * 计算食物在指定渠道下的可获得性评分
   */
  score(food: FoodLibrary, channel: AcquisitionChannel): AvailabilityScore {
    // 1. 如果食物有明确的 availableChannels 标注
    if (food.availableChannels && food.availableChannels.length > 0) {
      const isAvailable =
        food.availableChannels.includes(channel) || channel === AcquisitionChannel.UNKNOWN;
      return {
        channelAvailability: isAvailable ? 0.9 : 0.1,
        overallAvailability: isAvailable ? Math.max(0.5, (food.commonalityScore ?? 50) / 100) : 0.1,
        source: 'food_data',
      };
    }

    // 2. 使用渠道×品类默认矩阵
    const channelMatrix =
      this.CHANNEL_CATEGORY_MATRIX[channel] ?? this.CHANNEL_CATEGORY_MATRIX['unknown'];
    const categoryScore = channelMatrix[food.category] ?? 0.5;

    // 3. 结合 commonalityScore 调整
    const commonality = (food.commonalityScore ?? 50) / 100;
    const channelAvailability = categoryScore * 0.6 + commonality * 0.4;

    return {
      channelAvailability,
      overallAvailability: channelAvailability,
      source: 'channel_default',
    };
  }

  /**
   * 批量计算可获得性（性能优化）
   */
  scoreBatch(foods: FoodLibrary[], channel: AcquisitionChannel): Map<string, AvailabilityScore> {
    const results = new Map<string, AvailabilityScore>();
    for (const food of foods) {
      results.set(food.id, this.score(food, channel));
    }
    return results;
  }
}
```

**4.3.3 RealisticFilter 升级**

```typescript
// V6.9: RealisticFilter 集成 AvailabilityScorer
// 在 filterByRealism() 中新增:

// 6. V6.9: 渠道可获得性过滤
if (config.availabilityFilterEnabled !== false) {
  const channel = context.channel ?? AcquisitionChannel.UNKNOWN;
  filtered = filtered.filter((f) => {
    const avail = this.availabilityScorer.score(f, channel);
    return avail.channelAvailability >= (config.minAvailability ?? 0.2);
  });
}
```

**验收标准：**

- AvailabilityScorer 基于渠道×品类矩阵计算动态可获得性
- 食物有 availableChannels 标注时优先使用
- RealisticFilter 集成渠道可获得性过滤
- 编译通过

---

### 4.4 FoodScorer 新增 popularity 维度（Phase 1-D）

**升级文件：**

- `recommendation/recommendation.types.ts`
- `recommendation/food-scorer.service.ts`

**目标：** 将 `commonalityScore`（大众化/常见度）作为第 13 个评分维度引入 FoodScorer，使常见食物在评分阶段获得加分，而非仅在过滤阶段做硬排除。

**4.4.1 类型变更**

```typescript
// V6.9: SCORE_DIMENSIONS 扩展到 13 维
export const SCORE_DIMENSIONS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber',
  'seasonality',
  'executability',
  'popularity', // V6.9: 大众化/常见度维度
] as const;

// V6.9: SCORE_WEIGHTS 更新（13维）
export const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  prot, carbs, fat,  qual, sat,  glyc, nDens, inflam, fiber, season, exec, popul]
  fat_loss: [0.15, 0.14, 0.07, 0.05, 0.05, 0.06, 0.1, 0.08, 0.06, 0.04, 0.03, 0.1, 0.07],
  muscle_gain: [0.14, 0.18, 0.09, 0.05, 0.05, 0.04, 0.08, 0.07, 0.04, 0.03, 0.03, 0.11, 0.09],
  health: [0.06, 0.05, 0.04, 0.04, 0.13, 0.06, 0.09, 0.15, 0.09, 0.07, 0.05, 0.1, 0.07],
  habit: [0.09, 0.07, 0.05, 0.05, 0.11, 0.1, 0.07, 0.07, 0.06, 0.04, 0.04, 0.13, 0.12],
};
```

**4.4.2 food-scorer popularity 维度实现**

```typescript
// V6.9: food-scorer.service.ts 新增 popularity 评分
private scorePopularity(food: FoodLibrary, channel?: AcquisitionChannel): number {
  // 基础大众化分: commonalityScore 0-100 → 归一化到 0-1
  const basePop = (food.commonalityScore ?? 50) / 100;

  // 渠道调整: 如果食物在当前渠道有明确标注且包含该渠道，加分
  let channelBonus = 0;
  if (channel && food.availableChannels?.includes(channel)) {
    channelBonus = 0.1;
  }

  return Math.min(1, basePop + channelBonus);
}
```

**验收标准：**

- SCORE_DIMENSIONS 扩展为 13 维，包含 `popularity`
- SCORE_WEIGHTS 重新归一化（和=1.0）
- popularity 维度从 `commonalityScore` 计算，带渠道加分
- 编译通过

---

### 4.5 跨餐多样性 — DailyPlanContext（Phase 2-A）

**新增文件：**

- `recommendation/daily-plan-context.service.ts`

**升级文件：**

- `recommendation/recommendation-engine.service.ts`
- `recommendation/meal-composition-scorer.service.ts`

**目标：** 引入日级上下文，在推荐多餐时追踪已推荐食物，对跨餐重复施加惩罚。

**4.5.1 DailyPlanContext 接口**

```typescript
// V6.9: 日计划上下文
export interface DailyPlanState {
  /** 当日已推荐的食物 ID 集合 */
  usedFoodIds: Set<string>;
  /** 当日已推荐的食物名集合 */
  usedFoodNames: Set<string>;
  /** 当日已推荐的品类计数 */
  categoryCounts: Record<string, number>;
  /** 当日已推荐的烹饪方式计数 */
  cookingMethodCounts: Record<string, number>;
  /** 当日已推荐的主食材集合 */
  usedMainIngredients: Set<string>;
  /** 当日已累计的营养素 */
  accumulatedNutrition: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
}
```

**4.5.2 DailyPlanContext 服务**

```typescript
@Injectable()
export class DailyPlanContextService {
  /**
   * 创建空的日计划状态
   */
  createEmpty(): DailyPlanState {
    return {
      usedFoodIds: new Set(),
      usedFoodNames: new Set(),
      categoryCounts: {},
      cookingMethodCounts: {},
      usedMainIngredients: new Set(),
      accumulatedNutrition: {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
        fiber: 0,
      },
    };
  }

  /**
   * 在一餐推荐完成后更新日计划状态
   */
  updateAfterMeal(state: DailyPlanState, meal: MealRecommendation): void {
    for (const sf of meal.foods) {
      state.usedFoodIds.add(sf.food.id);
      state.usedFoodNames.add(sf.food.name);
      state.categoryCounts[sf.food.category] = (state.categoryCounts[sf.food.category] ?? 0) + 1;
      if (sf.food.cookingMethod) {
        state.cookingMethodCounts[sf.food.cookingMethod] =
          (state.cookingMethodCounts[sf.food.cookingMethod] ?? 0) + 1;
      }
      if (sf.food.mainIngredient) {
        state.usedMainIngredients.add(sf.food.mainIngredient);
      }
      state.accumulatedNutrition.calories += sf.servingCalories;
      state.accumulatedNutrition.protein += sf.servingProtein;
      state.accumulatedNutrition.fat += sf.servingFat;
      state.accumulatedNutrition.carbs += sf.servingCarbs;
      state.accumulatedNutrition.fiber += sf.servingFiber;
    }
  }

  /**
   * 计算候选食物的跨餐多样性惩罚
   *
   * 惩罚规则:
   * - 名称重复: -0.3
   * - 主食材重复: -0.2
   * - 同品类已出现 >= 3 次: -0.15
   * - 同烹饪方式已出现 >= 2 次: -0.1
   */
  calcDiversityPenalty(food: FoodLibrary, state: DailyPlanState): number {
    let penalty = 0;

    if (state.usedFoodNames.has(food.name)) {
      penalty -= 0.3;
    }
    if (food.mainIngredient && state.usedMainIngredients.has(food.mainIngredient)) {
      penalty -= 0.2;
    }
    if ((state.categoryCounts[food.category] ?? 0) >= 3) {
      penalty -= 0.15;
    }
    if (food.cookingMethod && (state.cookingMethodCounts[food.cookingMethod] ?? 0) >= 2) {
      penalty -= 0.1;
    }

    return Math.max(-0.5, penalty); // 惩罚上限 -0.5
  }
}
```

**4.5.3 MealCompositionScorer 集成跨餐惩罚**

```typescript
// V6.9: MealCompositionScorer 新增跨餐多样性评分
// 在 scoreMealComposition() 中增加:
if (dailyPlanState) {
  for (const sf of foods) {
    const penalty = this.dailyPlanContext.calcDiversityPenalty(sf.food, dailyPlanState);
    if (penalty < 0) {
      sf.score += penalty * 100; // 折算到 0-100 分数空间
    }
  }
}
```

**验收标准：**

- DailyPlanContext 追踪已推荐食物的 ID/名称/品类/烹饪方式/主食材
- 跨餐多样性惩罚规则 4 种（名称/食材/品类/烹饪方式重复）
- MealCompositionScorer 集成跨餐惩罚
- 编译通过

---

### 4.6 结构化可解释性 — StructuredInsight（Phase 2-B）

**升级文件：**

- `recommendation/explanation-generator.service.ts`
- `recommendation/recommendation.types.ts`

**目标：** 在现有自然语言解释基础上，输出结构化的 insights 数据，前端可以做可视化展示。

**4.6.1 StructuredInsight 接口**

```typescript
// V6.9: 结构化推荐洞察
export interface StructuredInsight {
  /** 洞察类型 */
  type: InsightType;
  /** 洞察标题（i18n key） */
  titleKey: string;
  /** 洞察内容（i18n key + vars） */
  contentKey: string;
  /** 模板变量 */
  vars: Record<string, string | number>;
  /** 可视化数据（可选） */
  visualization?: InsightVisualization;
  /** 重要性 0-1 */
  importance: number;
}

export type InsightType =
  | 'nutrient_contribution' // 营养素贡献（如"提供 35% 蛋白质目标"）
  | 'goal_alignment' // 目标匹配度（如"符合减脂低碳策略"）
  | 'health_benefit' // 健康收益（如"富含膳食纤维，有助消化"）
  | 'diversity_note' // 多样性提示（如"今日首次出现海鲜类"）
  | 'scene_match' // 场景匹配（如"适合快手早餐，仅需 10 分钟"）
  | 'execution_tip'; // 执行建议（如"可在前一天晚上备好食材"）

export interface InsightVisualization {
  /** 可视化类型 */
  chartType: 'progress_bar' | 'pie_chart' | 'comparison' | 'badge';
  /** 可视化数据 */
  data: Record<string, number | string>;
}

// V6.9: MealRecommendation 新增
export interface MealRecommendation {
  // ... 现有字段 ...
  /** V6.9: 结构化洞察列表 */
  insights?: StructuredInsight[];
}
```

**4.6.2 ExplanationGenerator 扩展**

```typescript
// V6.9: ExplanationGenerator 新增结构化输出
generateStructuredInsights(
  foods: ScoredFood[],
  target: MealTarget,
  sceneContext?: SceneContext,
  dailyPlan?: DailyPlanState,
  locale?: string,
): StructuredInsight[] {
  const insights: StructuredInsight[] = [];

  // 1. 营养素贡献
  const totalProtein = foods.reduce((s, f) => s + f.servingProtein, 0);
  if (target.protein > 0) {
    const pctProtein = Math.round((totalProtein / target.protein) * 100);
    insights.push({
      type: 'nutrient_contribution',
      titleKey: 'insight.protein_contribution.title',
      contentKey: 'insight.protein_contribution.content',
      vars: { percent: pctProtein, grams: Math.round(totalProtein) },
      visualization: {
        chartType: 'progress_bar',
        data: { current: totalProtein, target: target.protein, percent: pctProtein },
      },
      importance: pctProtein >= 80 ? 0.9 : 0.6,
    });
  }

  // 2. 目标匹配度
  const totalCal = foods.reduce((s, f) => s + f.servingCalories, 0);
  const calDeviation = Math.abs(totalCal - target.calories) / target.calories;
  insights.push({
    type: 'goal_alignment',
    titleKey: 'insight.calorie_match.title',
    contentKey: calDeviation < 0.1
      ? 'insight.calorie_match.excellent'
      : 'insight.calorie_match.moderate',
    vars: { calories: Math.round(totalCal), target: target.calories },
    visualization: {
      chartType: 'comparison',
      data: { actual: totalCal, target: target.calories },
    },
    importance: calDeviation < 0.1 ? 0.8 : 0.5,
  });

  // 3. 场景匹配
  if (sceneContext) {
    insights.push({
      type: 'scene_match',
      titleKey: 'insight.scene_match.title',
      contentKey: `insight.scene_match.${sceneContext.sceneType}`,
      vars: { scene: sceneContext.sceneType },
      importance: 0.7,
    });
  }

  // 4. 多样性提示
  if (dailyPlan) {
    const newCategories = foods
      .map(f => f.food.category)
      .filter(c => !dailyPlan.categoryCounts[c]);
    if (newCategories.length > 0) {
      insights.push({
        type: 'diversity_note',
        titleKey: 'insight.new_category.title',
        contentKey: 'insight.new_category.content',
        vars: { categories: newCategories.join(', ') },
        importance: 0.6,
      });
    }
  }

  return insights.sort((a, b) => b.importance - a.importance);
}
```

**验收标准：**

- StructuredInsight 支持 6 种洞察类型
- 每种洞察可选带可视化数据（progress_bar/pie_chart/comparison/badge）
- ExplanationGenerator 在现有 text 解释基础上新增结构化输出
- 编译通过

---

### 4.7 执行率追踪 — ExecutionTracker（Phase 2-C）

**新增文件：**

- `recommendation/execution-tracker.service.ts`

**升级文件：**

- `recommendation/weight-learner.service.ts`

**Prisma schema 变更：**

```prisma
// V6.9: 推荐执行记录表
model recommendation_executions {
  id                String   @id @default(uuid())
  user_id           String
  recommendation_id String?
  meal_type         String   @db.VarChar(20)
  recommended_foods Json     // 推荐的食物 ID 列表
  executed_foods    Json?    // 实际执行的食物 ID 列表（分析结果回填）
  execution_rate    Float?   // 执行率 0-1（匹配的食物数/推荐的食物数）
  deviation_notes   Json?    // 偏差记录（替换/增加/减少了什么）
  created_at        DateTime @default(now())
  executed_at       DateTime?

  users user_profiles @relation(fields: [user_id], references: [user_id])

  @@index([user_id, created_at])
  @@index([user_id, meal_type])
}
```

**4.7.1 ExecutionTracker 实现**

```typescript
@Injectable()
export class ExecutionTrackerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly logger: Logger
  ) {}

  /**
   * 记录推荐结果（推荐时调用）
   */
  async recordRecommendation(
    userId: string,
    mealType: string,
    recommendedFoods: string[], // food IDs
    recommendationId?: string
  ): Promise<string> {
    const record = await this.prisma.recommendation_executions.create({
      data: {
        user_id: userId,
        meal_type: mealType,
        recommended_foods: recommendedFoods,
        recommendation_id: recommendationId,
      },
    });
    return record.id;
  }

  /**
   * 回填执行结果（食物分析/用户报告后调用）
   *
   * 通过匹配分析结果中的食物与推荐列表，计算执行率
   */
  async recordExecution(
    executionId: string,
    executedFoods: string[] // 实际吃的食物 ID
  ): Promise<{ executionRate: number }> {
    const record = await this.prisma.recommendation_executions.findUnique({
      where: { id: executionId },
    });
    if (!record) throw new Error('Execution record not found');

    const recommended = record.recommended_foods as string[];
    const matched = executedFoods.filter((id) => recommended.includes(id));
    const executionRate = recommended.length > 0 ? matched.length / recommended.length : 0;

    await this.prisma.recommendation_executions.update({
      where: { id: executionId },
      data: {
        executed_foods: executedFoods,
        execution_rate: executionRate,
        executed_at: new Date(),
        deviation_notes: {
          matched: matched.length,
          total_recommended: recommended.length,
          total_executed: executedFoods.length,
          substituted: executedFoods.filter((id) => !recommended.includes(id)),
          skipped: recommended.filter((id) => !executedFoods.includes(id)),
        },
      },
    });

    // 更新 Redis 中的用户执行率均值
    await this.updateUserExecutionRate(record.user_id);

    return { executionRate };
  }

  /**
   * 获取用户近 14 天平均执行率
   */
  async getUserExecutionRate(userId: string): Promise<number> {
    const key = `execution:user:${userId}:avg_rate`;
    const cached = await this.redis.get(key);
    if (cached) return Number(cached);

    const result = await this.prisma.recommendation_executions.aggregate({
      where: {
        user_id: userId,
        execution_rate: { not: null },
        created_at: { gte: new Date(Date.now() - 14 * 86400000) },
      },
      _avg: { execution_rate: true },
    });

    const rate = result._avg.execution_rate ?? 0.5;
    await this.redis.set(key, String(rate), 3600); // 缓存 1 小时
    return rate;
  }

  private async updateUserExecutionRate(userId: string): Promise<void> {
    const key = `execution:user:${userId}:avg_rate`;
    await this.redis.del(key); // 清缓存，下次查询重新计算
  }
}
```

**4.7.2 WeightLearner 集成执行率**

```typescript
// V6.9: WeightLearner 在梯度计算中考虑执行率
private computeTargetedGradient(
  feedback: FeedbackWithScores,
  baseWeights: number[],
  executionRate?: number, // V6.9: 新增
): number[] {
  // ... 现有梯度计算 ...

  // V6.9: 执行率加权
  // 如果推荐被接受但用户实际执行率低，说明推荐可能"看起来好但不实际"
  // 降低梯度权重，避免过度强化不可执行的推荐
  if (executionRate !== undefined && feedback.feedback_type === 'accepted') {
    const execFactor = 0.3 + 0.7 * executionRate; // 执行率 0 → 0.3, 1 → 1.0
    for (let i = 0; i < gradient.length; i++) {
      gradient[i] *= execFactor;
    }
  }

  return gradient;
}
```

**验收标准：**

- 新增 `recommendation_executions` 表
- ExecutionTracker 支持记录推荐 + 回填执行 + 计算执行率
- WeightLearner 梯度计算考虑执行率加权
- 编译通过

---

### 4.8 RealisticFilter 用户端可配置（Phase 2-D）

**升级文件：**

- `recommendation/realistic-filter.service.ts`
- `recommendation/recommendation.types.ts`
- `strategy/strategy.types.ts`

**目标：** 允许用户端实时覆盖现实过滤严格度（"今天想挑战一下" vs "今天想简单吃"），不需要修改策略配置。

**4.8.1 接口扩展**

```typescript
// V6.9: MealFromPoolRequest 新增
export interface MealFromPoolRequest {
  // ... 现有字段 ...
  /** V6.9: 用户端现实策略覆盖 */
  realismOverride?: {
    level: 'strict' | 'normal' | 'relaxed';
  };
  /** V6.9: 场景上下文（SceneResolver 输出） */
  sceneContext?: SceneContext;
  /** V6.9: 日计划状态（跨餐多样性） */
  dailyPlanState?: DailyPlanState;
}
```

**4.8.2 RealisticFilter 支持用户覆盖**

```typescript
// V6.9: adjustForUserPreference
adjustForUserPreference(
  base: RealismConfig | undefined,
  level: 'strict' | 'normal' | 'relaxed',
): RealismConfig {
  const config = { ...(base ?? {}) };

  switch (level) {
    case 'strict':
      config.commonalityThreshold = Math.max(
        config.commonalityThreshold ?? 20, 40,
      );
      config.cookTimeCapEnabled = true;
      config.budgetFilterEnabled = true;
      break;
    case 'relaxed':
      config.commonalityThreshold = Math.min(
        config.commonalityThreshold ?? 20, 10,
      );
      config.cookTimeCapEnabled = false;
      config.budgetFilterEnabled = false;
      break;
    case 'normal':
    default:
      // 不修改
      break;
  }

  return config;
}
```

**验收标准：**

- 用户端可通过 `realismOverride.level` 覆盖严格度
- `strict`: 提高大众化阈值+启用时间/预算过滤
- `relaxed`: 降低大众化阈值+关闭时间/预算过滤
- 编译通过

---

### 4.9 Segment 自动发现（Phase 3-A）

**新增文件：**

- `strategy/segment-discovery.service.ts`

**升级文件：**

- `strategy/strategy-auto-tuner.service.ts`

**目标：** 基于用户行为数据自动聚类发现新 segment，为新 segment 生成策略假设。

**4.9.1 SegmentDiscovery 实现**

```typescript
@Injectable()
export class SegmentDiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    private readonly logger: Logger
  ) {}

  /**
   * 基于用户特征向量进行 K-Means 聚类
   *
   * 特征维度:
   * 1. avgCaloriesPerDay / targetCalories（热量达成率）
   * 2. complianceRate（依从率）
   * 3. processingLevelAvg（加工食品比例）
   * 4. mealTimingVariance（用餐时间规律性）
   * 5. categoryDiversity（品类多样性）
   * 6. executionRate（执行率，V6.9 新增）
   *
   * 输出: 新发现的 segment 标签 + 建议的策略配置
   */
  async discoverSegments(): Promise<DiscoveredSegment[]> {
    // 1. 提取用户特征
    const features = await this.extractUserFeatures();
    if (features.length < 50) {
      this.logger.warn('Not enough users for segment discovery');
      return [];
    }

    // 2. K-Means 聚类（简化版: 使用预定义的距离函数）
    const k = Math.min(10, Math.ceil(features.length / 20));
    const clusters = this.kMeansClustering(features, k);

    // 3. 为每个聚类生成 segment 标签和策略建议
    const discovered: DiscoveredSegment[] = [];
    for (const cluster of clusters) {
      if (cluster.members.length < 10) continue; // 太小的聚类忽略

      const label = this.generateSegmentLabel(cluster.centroid);
      const strategy = this.suggestStrategy(cluster.centroid);

      discovered.push({
        label,
        centroid: cluster.centroid,
        memberCount: cluster.members.length,
        suggestedStrategy: strategy,
        confidence: cluster.cohesion,
      });
    }

    return discovered;
  }

  /**
   * 简化 K-Means（不引入外部 ML 库）
   * 使用 K-Means++ 初始化 + 最多 50 轮迭代
   */
  private kMeansClustering(features: UserFeatureVector[], k: number): Cluster[] {
    // K-Means++ 初始化
    const centroids = this.initCentroids(features, k);
    let clusters: Cluster[] = [];

    for (let iter = 0; iter < 50; iter++) {
      // 分配: 每个用户分配到最近的中心
      const assignments = new Map<number, UserFeatureVector[]>();
      for (let i = 0; i < k; i++) assignments.set(i, []);

      for (const f of features) {
        let minDist = Infinity;
        let minIdx = 0;
        for (let i = 0; i < centroids.length; i++) {
          const dist = this.euclideanDist(f.vector, centroids[i]);
          if (dist < minDist) {
            minDist = dist;
            minIdx = i;
          }
        }
        assignments.get(minIdx)!.push(f);
      }

      // 更新中心
      let converged = true;
      for (let i = 0; i < k; i++) {
        const members = assignments.get(i)!;
        if (members.length === 0) continue;
        const newCentroid = this.calcCentroid(members);
        if (this.euclideanDist(centroids[i], newCentroid) > 0.001) {
          converged = false;
        }
        centroids[i] = newCentroid;
      }

      clusters = Array.from(assignments.entries()).map(([idx, members]) => ({
        centroid: centroids[idx],
        members,
        cohesion: this.calcCohesion(members, centroids[idx]),
      }));

      if (converged) break;
    }

    return clusters;
  }

  private generateSegmentLabel(centroid: number[]): string {
    const [calorieRatio, compliance, processing, timing, diversity, execution] = centroid;
    const parts: string[] = [];

    if (processing > 0.6) parts.push('high_processed');
    else if (processing < 0.3) parts.push('whole_food');

    if (compliance > 0.7) parts.push('high_compliance');
    else if (compliance < 0.3) parts.push('low_compliance');

    if (execution !== undefined && execution < 0.4) parts.push('low_execution');

    if (diversity > 0.7) parts.push('diverse');
    else if (diversity < 0.3) parts.push('repetitive');

    return parts.join('_') || 'general';
  }

  private suggestStrategy(centroid: number[]): string {
    const [calorieRatio, compliance, processing] = centroid;

    if (compliance < 0.3 && processing > 0.5) return 'gentle_guidance';
    if (compliance > 0.7) return 'optimization';
    if (processing > 0.6) return 'quality_upgrade';
    return 'balanced';
  }

  // ... euclideanDist, calcCentroid, calcCohesion, initCentroids 辅助方法 ...
}

interface UserFeatureVector {
  userId: string;
  vector: number[];
}

interface Cluster {
  centroid: number[];
  members: UserFeatureVector[];
  cohesion: number;
}

interface DiscoveredSegment {
  label: string;
  centroid: number[];
  memberCount: number;
  suggestedStrategy: string;
  confidence: number;
}
```

**验收标准：**

- K-Means 聚类使用 6 维用户特征
- 聚类结果自动生成 segment 标签和策略建议
- 最少 50 用户才启动聚类
- 聚类太小（<10 人）的被过滤
- 编译通过

---

### 4.10 预计算缓存场景感知（Phase 3-B）

**升级文件：**

- `recommendation/recommendation-engine.service.ts`
- `recommendation/recommendation.types.ts`

**目标：** 预计算缓存从 `userId + goalType` 扩展为 `userId + goalType + channel`，切换渠道时不命中旧缓存。

**4.10.1 缓存 key 升级**

```typescript
// V6.8: cache key
const cacheKey = `precomputed:${userId}:${goalType}`;

// V6.9: cache key（含渠道）
const cacheKey = `precomputed:${userId}:${goalType}:${channel ?? 'unknown'}`;
```

**4.10.2 预计算批次扩展**

```typescript
// V6.9: 预计算时为常用渠道（home_cook + delivery）各生成一套
// 如果用户有行为学习的场景模式，按高频渠道预计算
async precomputeForUser(userId: string, goalType: string): Promise<void> {
  const scenePatterns = await this.sceneResolver.getTopChannels(userId);
  const channels = scenePatterns.length > 0
    ? scenePatterns.map(p => p.channel)
    : [AcquisitionChannel.HOME_COOK, AcquisitionChannel.DELIVERY];

  for (const channel of channels) {
    const key = `precomputed:${userId}:${goalType}:${channel}`;
    // ... 预计算逻辑 ...
  }
}
```

**验收标准：**

- 预计算缓存 key 包含渠道维度
- 预计算为用户的高频渠道分别生成
- 切换渠道时不命中旧缓存
- 编译通过

---

### 4.11 食物数据渠道标注增强（Phase 3-C）

**升级文件：**

- `apps/api-server/prisma/schema.prisma`
- 数据迁移脚本

**目标：** 系统化补全 `foods.available_channels` 字段，基于品类和加工级别自动推断。

**4.11.1 自动标注迁移**

```typescript
// V6.9: 数据迁移 — 基于品类和加工级别自动推断 availableChannels
async migrateAvailableChannels(): Promise<void> {
  const foods = await this.prisma.foods.findMany({
    where: {
      OR: [
        { available_channels: { isEmpty: true } },
        { available_channels: null },
      ],
    },
  });

  for (const food of foods) {
    const channels = this.inferChannels(food);
    await this.prisma.foods.update({
      where: { id: food.id },
      data: { available_channels: channels },
    });
  }
}

private inferChannels(food: any): string[] {
  const channels: string[] = [];
  const cat = food.category;
  const nova = food.processing_level ?? 0;

  // 生鲜食材: 超市/家庭烹饪
  if (['veggie', 'fruit', 'protein', 'dairy', 'grain'].includes(cat)) {
    channels.push('home_cook');
    if (nova <= 1) channels.push('restaurant');
  }

  // 加工食品: 便利店
  if (nova >= 3) {
    channels.push('convenience');
  }

  // 复合菜品: 外卖/餐厅/食堂
  if (cat === 'composite') {
    channels.push('delivery', 'restaurant', 'canteen');
  }

  // 饮品: 便利店/餐厅
  if (cat === 'beverage') {
    channels.push('convenience', 'restaurant');
  }

  // 零食: 便利店/家庭
  if (cat === 'snack') {
    channels.push('convenience', 'home_cook');
  }

  // 高大众化食物: 全渠道
  if ((food.commonality_score ?? 50) >= 80) {
    if (!channels.includes('canteen')) channels.push('canteen');
    if (!channels.includes('delivery')) channels.push('delivery');
  }

  return [...new Set(channels)];
}
```

**验收标准：**

- 数据迁移为所有未标注食物自动推断渠道
- 推断规则基于品类 + 加工级别 + 大众化评分
- 编译通过

---

## Step 5：技术路线图

### Phase 1：场景化 + 菜谱 + 可获得性（1-2 周）

| 编号 | 任务                                              | 涉及文件                                                                                       | 估时 |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---- |
| 1-A  | SceneResolver 场景解析器                          | `scene-resolver.service.ts`(新), `recommendation.types.ts`, `recommendation-engine.service.ts` | 10h  |
| 1-B  | RecipeAssembler 菜谱优先组装                      | `recipe-assembler.service.ts`(新), `pipeline-builder.service.ts`, `recommendation.types.ts`    | 12h  |
| 1-C  | AvailabilityScorer 渠道可获得性                   | `availability-scorer.service.ts`(新), `realistic-filter.service.ts`                            | 8h   |
| 1-D  | FoodScorer popularity 维度（12→13维）             | `food-scorer.service.ts`, `recommendation.types.ts`                                            | 6h   |
| 1-E  | 管道集成 — SceneResolver+RecipeAssembler 接入管道 | `pipeline-builder.service.ts`, `recommendation-engine.service.ts`                              | 8h   |
| 1-F  | i18n — 场景/菜谱/可解释性消息 key                 | `i18n-messages.ts`                                                                             | 5h   |

**Phase 1 验收标准：**

- SceneResolver 支持 12 种场景类型 + 4 层优先级推断
- RecipeAssembler 能将食材匹配数据库菜谱或智能组装
- AvailabilityScorer 基于渠道×品类矩阵计算可获得性
- FoodScorer 扩展为 13 维（含 popularity）
- 管道完整集成新模块
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### Phase 2：执行率 + 可解释性 + 跨餐多样性（3-5 周）

| 编号 | 任务                                    | 涉及文件                                                                                                      | 估时 |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- |
| 2-A  | DailyPlanContext 跨餐多样性             | `daily-plan-context.service.ts`(新), `meal-composition-scorer.service.ts`, `recommendation-engine.service.ts` | 8h   |
| 2-B  | StructuredInsight 结构化可解释性        | `explanation-generator.service.ts`, `recommendation.types.ts`                                                 | 10h  |
| 2-C  | ExecutionTracker 执行率追踪             | `execution-tracker.service.ts`(新), `weight-learner.service.ts`, `schema.prisma`                              | 10h  |
| 2-D  | RealisticFilter 用户端可配置 + 场景集成 | `realistic-filter.service.ts`, `recommendation.types.ts`, `strategy.types.ts`                                 | 6h   |
| 2-E  | SceneResolver 行为学习回写              | `scene-resolver.service.ts`, `recommendation-engine.service.ts`                                               | 5h   |
| 2-F  | i18n — insight 类 key 三语补全          | `i18n-messages.ts`                                                                                            | 6h   |

**Phase 2 验收标准：**

- DailyPlanContext 追踪跨餐已用食物/品类/烹饪方式
- StructuredInsight 支持 6 种洞察类型 + 可视化数据
- ExecutionTracker 记录推荐→执行闭环，执行率加权梯度
- RealisticFilter 支持 strict/normal/relaxed 三级用户覆盖
- SceneResolver 在推荐执行后回写渠道使用行为
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### Phase 3：Segment 发现 + 缓存优化 + 数据标注（4-6 周）

| 编号 | 任务                             | 涉及文件                                                             | 估时 |
| ---- | -------------------------------- | -------------------------------------------------------------------- | ---- |
| 3-A  | SegmentDiscovery 自动聚类        | `segment-discovery.service.ts`(新), `strategy-auto-tuner.service.ts` | 12h  |
| 3-B  | 预计算缓存场景感知               | `recommendation-engine.service.ts`                                   | 6h   |
| 3-C  | 食物数据渠道标注迁移             | `schema.prisma`, 迁移脚本                                            | 5h   |
| 3-D  | RecipeAssembler 智能组装增强     | `recipe-assembler.service.ts`                                        | 8h   |
| 3-E  | AvailabilityScorer 区域/季节感知 | `availability-scorer.service.ts`                                     | 6h   |
| 3-F  | 端到端集成测试 + 性能验证        | 测试文件                                                             | 8h   |

**Phase 3 验收标准：**

- SegmentDiscovery K-Means 聚类自动发现用户群体
- 预计算缓存 key 包含渠道维度
- 食物数据 available_channels 自动推断并迁移
- RecipeAssembler 智能组装质量提升（名称生成更自然）
- AvailabilityScorer 支持区域（如中国不同地区食物差异）
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### 时间线总览

```
Week 1-2:   Phase 1（场景化 + 菜谱 + 可获得性 + 评分维度）    49h
Week 3-7:   Phase 2（执行率 + 可解释性 + 跨餐多样性）          45h
Week 8-13:  Phase 3（Segment 发现 + 缓存 + 数据增强）          45h
───────────────────────────────────────────────────────────
总计:                                                         139h
```

---

## Step 6：数据迁移

### 6.1 V6.9 Schema 迁移

**6.1.1 新增 recommendation_executions 表**

```sql
-- V6.9: 推荐执行记录表
CREATE TABLE IF NOT EXISTS recommendation_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  recommendation_id VARCHAR(255),
  meal_type VARCHAR(20) NOT NULL,
  recommended_foods JSONB NOT NULL,
  executed_foods JSONB,
  execution_rate FLOAT,
  deviation_notes JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES user_profiles(user_id)
);

CREATE INDEX idx_exec_user_date ON recommendation_executions(user_id, created_at);
CREATE INDEX idx_exec_user_meal ON recommendation_executions(user_id, meal_type);
```

**6.1.2 foods 表 available_channels 自动推断**

```sql
-- V6.9: 为未标注 available_channels 的食物自动推断
-- 由应用层数据迁移脚本执行（见 4.11.1）
-- 这里仅确保列存在
ALTER TABLE foods ADD COLUMN IF NOT EXISTS available_channels TEXT[] DEFAULT '{}';
```

### 6.2 Redis Key 变更

```
# V6.9 新增 Redis keys:
scene:user:{userId}:patterns         (String/JSON) — 用户场景行为模式, TTL 30d
execution:user:{userId}:avg_rate     (String) — 用户平均执行率, TTL 1h
precomputed:{userId}:{goalType}:{channel}  — 场景感知预计算缓存

# V6.9 变更 Redis keys:
precomputed:{userId}:{goalType}      — 旧 key 废弃，迁移到含 channel 版本
```

### 6.3 迁移风险评估

| 风险                                       | 影响                                      | 缓解措施                                        |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------- |
| recommendation_executions 表数据为空       | ExecutionTracker 返回默认执行率 0.5       | getUserExecutionRate 有默认值兜底               |
| available_channels 自动推断不准确          | AvailabilityScorer 退化到 channel_default | 渠道×品类矩阵作为兜底，不完全依赖食物标注       |
| 旧 precomputed 缓存 key 格式不包含 channel | 切换后旧缓存失效                          | 首次部署后 Cron 自动重新预计算                  |
| SceneResolver Redis 行为数据为空           | 退化到规则推断（= V6.8 行为）             | 行为学习渐进累积，不影响首次使用                |
| 13 维权重 vs 旧 12 维权重不兼容            | 旧的 weightOverrides 数组长度不匹配       | computeWeights 做 length 检查，短于 13 维时补零 |

---

## Step 7：文档差异

### 7.1 架构层面变化

| 层次             | V6.8                               | V6.9                                                    | 变化 |
| ---------------- | ---------------------------------- | ------------------------------------------------------- | ---- |
| 场景推断         | inferAcquisitionChannel 硬编码规则 | SceneResolver 4 层优先级（显式>行为>规则>默认）         | 升级 |
| 菜谱集成         | ScoredRecipe 旁路可选参数          | RecipeAssembler 管道一等公民                            | 升级 |
| 食物可获得性     | commonalityScore 静态单维          | AvailabilityScorer 渠道×品类动态评分                    | 新增 |
| 评分维度         | 12 维                              | 13 维（+popularity）                                    | 扩展 |
| 跨餐多样性       | 无（单餐独立）                     | DailyPlanContext 跨餐追踪 + 惩罚                        | 新增 |
| 执行率追踪       | 无                                 | ExecutionTracker 推荐→执行闭环                          | 新增 |
| 可解释性         | 纯文本                             | 结构化 StructuredInsight + 可视化数据                   | 升级 |
| 现实策略可配置性 | 仅策略端配置                       | 用户端 strict/normal/relaxed 覆盖                       | 增强 |
| Segment 发现     | 手动预设                           | K-Means 自动聚类                                        | 新增 |
| 预计算缓存       | userId + goalType                  | userId + goalType + channel                             | 升级 |
| 推荐输出         | ScoredFood[] 食材列表              | ScoredFood[] + AssembledRecipe[] + planTheme + insights | 升级 |

### 7.2 新增模块汇总

| 模块                      | 文件                              | 说明                              |
| ------------------------- | --------------------------------- | --------------------------------- |
| SceneResolverService      | `scene-resolver.service.ts`       | 场景解析器（行为学习 + 规则推断） |
| RecipeAssemblerService    | `recipe-assembler.service.ts`     | 菜谱优先组装                      |
| AvailabilityScorerService | `availability-scorer.service.ts`  | 渠道可获得性评分                  |
| DailyPlanContextService   | `daily-plan-context.service.ts`   | 跨餐多样性上下文                  |
| ExecutionTrackerService   | `execution-tracker.service.ts`    | 执行率追踪                        |
| SegmentDiscoveryService   | `segment-discovery.service.ts`    | 自动 Segment 聚类                 |
| SceneContext              | `recommendation.types.ts`（接口） | 场景解析结果                      |
| AssembledRecipe           | `recommendation.types.ts`（接口） | 组装后的菜谱方案                  |
| StructuredInsight         | `recommendation.types.ts`（接口） | 结构化可解释性洞察                |
| DailyPlanState            | `recommendation.types.ts`（接口） | 日计划状态                        |
| AvailabilityScore         | `recommendation.types.ts`（接口） | 可获得性评分结果                  |

### 7.3 升级模块汇总

| 模块                    | 变化级别 | 说明                                         |
| ----------------------- | -------- | -------------------------------------------- |
| FoodScorer              | 中度扩展 | 12→13 维（+popularity）                      |
| RealisticFilter         | 中度增强 | +渠道可获得性 + 用户端可配置                 |
| MealCompositionScorer   | 中度增强 | +跨餐多样性惩罚                              |
| ExplanationGenerator    | 中度扩展 | +结构化 insights 输出                        |
| WeightLearner           | 轻度增强 | +执行率加权梯度                              |
| PipelineBuilder         | 中度增强 | +RecipeAssembler + SceneContext 集成         |
| RecommendationEngine    | 中度升级 | +SceneResolver + DailyPlanContext + 缓存升级 |
| StrategyAutoTuner       | 轻度增强 | +SegmentDiscovery 集成                       |
| recommendation.types.ts | 重度扩展 | 新增 7 个接口                                |

### 7.4 接口变更

**扩展（向后兼容）：**

```typescript
// MealRecommendation — 新增可选字段
recipes?: AssembledRecipe[];
planTheme?: string;
executionDifficulty?: number;
insights?: StructuredInsight[];

// MealFromPoolRequest — 新增可选字段
realismOverride?: { level: 'strict' | 'normal' | 'relaxed' };
sceneContext?: SceneContext;
dailyPlanState?: DailyPlanState;

// SCORE_DIMENSIONS — 12→13 维（新增 popularity）
// SCORE_WEIGHTS — 13 维权重（重新归一化）
```

**注意事项：**

```typescript
// SCORE_WEIGHTS 数组长度从 12 → 13
// 所有使用 SCORE_WEIGHTS/SCORE_DIMENSIONS 的代码需确认兼容 13 维
// computeWeights() 需对短于 13 维的 baseOverrides 做 padding
```

### 7.5 已解决 vs 遗留问题清单

| 问题 ID | 描述                   | V6.9 状态              | 归属 |
| ------- | ---------------------- | ---------------------- | ---- |
| P0-1    | 推荐食物过于原材料化   | ✅ 已解决（Phase 1-B） | —    |
| P0-2    | 场景推断过于粗糙       | ✅ 已解决（Phase 1-A） | —    |
| P0-3    | 食物可获得性维度缺失   | ✅ 已解决（Phase 1-C） | —    |
| P0-4    | 现实策略不可配置       | ✅ 已解决（Phase 2-D） | —    |
| P1-1    | 无跨餐多样性控制       | ✅ 已解决（Phase 2-A） | —    |
| P1-2    | 无执行率追踪           | ✅ 已解决（Phase 2-C） | —    |
| P1-3    | 评分维度缺少大众化信号 | ✅ 已解决（Phase 1-D） | —    |
| P1-4    | Segment 发现半静态     | ✅ 已解决（Phase 3-A） | —    |
| P1-5    | 解释系统缺乏结构化     | ✅ 已解决（Phase 2-B） | —    |
| P2-1    | 菜谱与推荐管道分离     | ✅ 已解决（Phase 1-B） | —    |
| P2-2    | 食物数据缺少渠道标注   | ✅ 已解决（Phase 3-C） | —    |
| P2-3    | 推荐结果无整体方案概念 | ✅ 已解决（Phase 1-B） | —    |
| P2-4    | 预计算缓存未区分场景   | ✅ 已解决（Phase 3-B） | —    |
| P2-5    | 食物可解释性数据不足   | ✅ 已解决（Phase 2-B） | —    |

**V7.0 方向预告：**

- LightGBM / small transformer 替代规则评分
- 社交饮食场景（聚餐、请客、家庭聚餐）
- 预算感知推荐（结合实际食材价格数据 + 电商/外卖平台 API）
- 时间序列营养目标（周期化营养，如增肌期→减脂期过渡）
- 食物图片识别→推荐闭环（用户拍照确认执行）
- 多语言食物数据库（不仅翻译 key，还有不同地区的本地化食物库）

---

> **设计原则：**
>
> - 所有升级是 V6.8 的增量演进，不重写已有模块
> - 每个 Phase 任务完成后运行 `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 验证编译
> - Prisma schema 变更后运行 `pnpm prisma validate --schema=apps/api-server/prisma/schema.prisma` 验证
> - 所有新模块以 NestJS `@Injectable()` 注册，通过 DI 注入
> - 所有新参数有默认值，确保零配置可启动
> - 菜谱组装和场景解析失败时 graceful 降级到 V6.8 行为
