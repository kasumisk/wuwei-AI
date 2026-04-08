# 用户画像系统设计 — User Profiling System

> **版本**: v1.0 | **日期**: 2025-07-17  
> **定位**: 生产级用户信息收集、推理、动态更新系统设计  
> **依赖**: 基于 INTELLIGENT_DIET_SYSTEM_V3.md 五层架构的用户数据层  
> **现有实体**: UserProfile, UserBehaviorProfile, RecommendationFeedback

---

## 目录

- [一、用户数据完整 Schema](#一用户数据完整-schema)
- [二、分步引导流（Staged Onboarding）](#二分步引导流staged-onboarding)
- [三、字段 → 推荐映射表](#三字段--推荐映射表)
- [四、智能推断与补全机制](#四智能推断与补全机制)
- [五、动态更新与长期学习](#五动态更新与长期学习)
- [六、工程实现方案](#六工程实现方案)
- [附录 A：MVP vs Full 字段对比](#附录-amvp-vs-full-字段对比)
- [附录 B：Top 10 最高影响力字段](#附录-btop-10-最高影响力字段)
- [附录 C：常见反模式清单](#附录-c常见反模式清单)

---

## 一、用户数据完整 Schema

### 1.1 设计原则

| 原则 | 说明 |
|------|------|
| **三层分离** | 声明数据（用户填写）、行为数据（系统观测）、推断数据（算法推理）严格分层 |
| **渐进收集** | 不在入口一次性要求所有信息，按使用深度逐步收集 |
| **置信度标注** | 每个推断字段附带 confidence 分数，低于阈值不影响推荐 |
| **向后兼容** | 新增字段默认 nullable，老用户不受影响 |
| **隐私最小化** | 只收集推荐算法直接需要的信息，敏感字段加密存储 |

### 1.2 完整用户画像 JSON Schema

```jsonc
{
  // ============ Layer 1: 声明数据（用户主动填写）============
  "declared": {
    // --- 基础身体指标 ---
    "gender": "male | female | other",         // 影响 BMR 计算
    "birthYear": 1995,                          // 影响 BMR、营养需求
    "heightCm": 175.0,                          // 必填 - BMR 核心
    "weightKg": 72.5,                           // 必填 - BMR 核心
    "targetWeightKg": 68.0,                     // 可选 - 目标导向
    "bodyFatPercent": 18.5,                     // 可选 - 精确 BMR (Katch-McArdle)

    // --- 目标设定 ---
    "goal": "fat_loss | muscle_gain | health | habit",
    "goalSpeed": "aggressive | steady | relaxed",
    "dailyCalorieGoal": null,                   // null = 系统自算，用户可覆盖

    // --- 活动与运动 ---
    "activityLevel": "sedentary | light | moderate | active",
    "exerciseProfile": {                        // V2 新增
      "type": "none | cardio | strength | mixed",
      "frequencyPerWeek": 3,                    // 0-7
      "avgDurationMinutes": 45                  // 单次运动时长
    },

    // --- 饮食习惯 ---
    "mealsPerDay": 3,                           // 1-6
    "takeoutFrequency": "never | sometimes | often",
    "canCook": true,
    "cookingSkillLevel": "none | basic | intermediate | advanced",  // V2 新增

    // --- 饮食偏好 ---
    "foodPreferences": ["sweet", "fried", "carbs", "meat", "spicy"],
    "tasteIntensity": {                         // V2 新增 - 口味强度
      "spicy": 3,     // 0-5 级
      "sweet": 4,
      "salty": 2,
      "sour": 1
    },
    "cuisinePreferences": ["chinese", "japanese", "western"],  // V2 新增

    // --- 饮食限制 ---
    "dietaryRestrictions": ["no_beef", "vegetarian", "lactose_free", "halal"],
    "allergens": [],                            // V2 新增 - 过敏原（独立字段！）
    // 可选值: milk, eggs, fish, shellfish, tree_nuts, peanuts,
    //         wheat, soybeans, sesame, sulfites

    // --- 健康状况 ---
    "healthConditions": [],                     // V2 新增
    // 可选值: diabetes_type2, hypertension, high_cholesterol,
    //         gout, kidney_disease, fatty_liver, pcos, ibs

    // --- 行为与心理 ---
    "weakTimeSlots": ["afternoon", "evening", "midnight"],
    "bingeTriggers": ["stress", "boredom", "social", "emotion"],
    "discipline": "high | medium | low",

    // --- 生活场景（V2 新增）---
    "budgetLevel": "low | medium | high",       // 预算约束
    "familySize": 1,                            // 1=独居，>1=需考虑家庭餐
    "mealPrepWilling": false,                   // 是否愿意备餐
    "regionCode": "CN"                          // 地区代码 → 食材可得性
  },

  // ============ Layer 2: 行为数据（系统自动观测）============
  "observed": {
    "foodPreferences": {
      "loves": ["鸡胸肉", "西兰花"],           // 连续接受 ≥3 次
      "avoids": ["苦瓜"],                       // 连续跳过 ≥2 次
      "frequentFoods": ["米饭", "鸡蛋"]         // Top 10 高频食物
    },
    "bingeRiskHours": [15, 22, 23],             // 高风险时段（24h 制）
    "failureTriggers": ["stress"],              // 从 AI 决策日志分析
    "avgComplianceRate": 0.72,                  // 推荐执行率
    "mealTimingPatterns": {                     // V2 新增 - 用餐时间模式
      "breakfast": "07:30",
      "lunch": "12:00",
      "dinner": "18:30",
      "snack": "15:00"
    },
    "portionTendency": "under | normal | over", // V2 新增 - 份量倾向
    "replacementPatterns": {                     // V2 新增 - 替换模式
      "protein→protein": 0.6,                   // 同类替换概率
      "grain→grain": 0.4
    },
    "totalRecords": 156,
    "healthyRecords": 112,
    "streakDays": 7,
    "longestStreak": 23,
    "coachStyle": "friendly | strict | data_driven"
  },

  // ============ Layer 3: 推断数据（算法推理）============
  "inferred": {
    "estimatedBMR": 1680,                       // Harris-Benedict / Katch-McArdle
    "estimatedTDEE": 2100,                      // BMR × 活动系数
    "recommendedCalories": 1680,                // TDEE - 目标缺口
    "macroTargets": {                           // 宏量营养素目标
      "proteinG": 130,
      "carbG": 200,
      "fatG": 55
    },
    "userSegment": "disciplined_loser | casual_maintainer | binge_risk | muscle_builder",
    "churnRisk": 0.15,                          // 流失风险 0-1
    "optimalMealCount": 4,                      // 推断最佳餐次
    "tastePrefVector": [0.8, 0.2, 0.6, ...],   // 64-dim 口味偏好向量（V3）
    "nutritionGaps": ["fiber", "vitamin_d"],    // 长期营养缺口
    "goalProgress": {                           // 目标进展
      "startWeight": 75.0,
      "currentWeight": 72.5,
      "progressPercent": 35.7,
      "estimatedWeeksLeft": 8,
      "trend": "on_track | behind | ahead"
    },
    "confidenceScores": {                       // 各推断的置信度
      "estimatedBMR": 0.95,                     // 有身高体重 → 高置信
      "userSegment": 0.60,                      // 数据不足 → 中置信
      "tastePrefVector": 0.30                   // 新用户 → 低置信
    }
  },

  // ============ 元数据 ============
  "meta": {
    "profileVersion": 2,                        // Schema 版本
    "onboardingStep": 4,                        // 当前引导到第几步
    "onboardingCompleted": true,
    "dataCompleteness": 0.78,                   // 声明数据完整度
    "lastActiveAt": "2025-07-17T08:30:00Z",
    "firstSeenAt": "2025-06-01T10:00:00Z",
    "profileUpdatedAt": "2025-07-15T20:00:00Z"
  }
}
```

### 1.3 与现有实体映射

| JSON 层 | 现有实体 | 改造策略 |
|---------|---------|---------|
| `declared` | `UserProfile` | **扩展** — 新增 `allergens`, `healthConditions`, `exerciseProfile`, `cookingSkillLevel`, `budgetLevel`, `familySize`, `tasteIntensity`, `cuisinePreferences`, `mealPrepWilling`, `regionCode` |
| `observed` | `UserBehaviorProfile` | **扩展** — 新增 `mealTimingPatterns`, `portionTendency`, `replacementPatterns` |
| `inferred` | ❌ 不存在 | **新建** `UserInferredProfile` 实体 |
| `meta` | 分散在 `UserProfile.onboardingCompleted` | **内聚** — 统一到 `UserProfile` 新增字段 |

### 1.4 新增实体: UserInferredProfile

```typescript
@Entity('user_inferred_profiles')
export class UserInferredProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'estimated_bmr', type: 'int', nullable: true })
  estimatedBMR: number;

  @Column({ name: 'estimated_tdee', type: 'int', nullable: true })
  estimatedTDEE: number;

  @Column({ name: 'recommended_calories', type: 'int', nullable: true })
  recommendedCalories: number;

  @Column({ name: 'macro_targets', type: 'jsonb', default: '{}' })
  macroTargets: { proteinG?: number; carbG?: number; fatG?: number };

  @Column({ name: 'user_segment', type: 'varchar', length: 30, nullable: true })
  userSegment: string;

  @Column({ name: 'churn_risk', type: 'decimal', precision: 3, scale: 2, default: 0 })
  churnRisk: number;

  @Column({ name: 'optimal_meal_count', type: 'int', nullable: true })
  optimalMealCount: number;

  @Column({ name: 'taste_pref_vector', type: 'jsonb', default: '[]' })
  tastePrefVector: number[];

  @Column({ name: 'nutrition_gaps', type: 'jsonb', default: '[]' })
  nutritionGaps: string[];

  @Column({ name: 'goal_progress', type: 'jsonb', default: '{}' })
  goalProgress: {
    startWeight?: number;
    currentWeight?: number;
    progressPercent?: number;
    estimatedWeeksLeft?: number;
    trend?: string;
  };

  @Column({ name: 'confidence_scores', type: 'jsonb', default: '{}' })
  confidenceScores: Record<string, number>;

  @Column({ name: 'last_computed_at', type: 'timestamp', nullable: true })
  lastComputedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

---

## 二、分步引导流（Staged Onboarding）

### 2.1 当前问题

| 问题 | 影响 |
|------|------|
| 单页长表单 | 用户看到 15+ 字段后放弃率高 |
| 无进度感知 | 用户不知道还要填多少 |
| "暂时跳过"过于粗暴 | 跳过后 `heightCm=null`、`weightKg=null` 导致 BMR 无法计算，推荐质量骤降 |
| `bingeTriggers` 定义但未收集 | Entity 有字段，UI 没有对应输入控件 |
| 缺少渐进式深度收集 | 新用户和老用户填写同样的表单 |

### 2.2 四步引导设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Onboarding Flow (4 Steps)                       │
├─────────┬────────────┬─────────────┬───────────────┬──────────────┤
│  Step 1 │   Step 2   │   Step 3    │    Step 4     │   持续收集    │
│  ~3s    │   ~15s     │   ~20s      │   ~15s        │   使用中      │
│         │            │             │               │              │
│ 核心身份 │  目标 + 身体│  饮食习惯    │  行为 + 心理   │  深度偏好     │
│ 2 字段  │  4-5 字段   │  4-5 字段   │  3-4 字段     │  系统触发     │
│         │            │             │               │              │
│ ✅ 必填  │ ✅ 必填     │ ⚡ 可跳过   │ ⚡ 可跳过     │ 🔄 自动      │
└─────────┴────────────┴─────────────┴───────────────┴──────────────┘
```

### Step 1: 快速启动（~3秒，2 字段，不可跳过）

**设计意图**: 最低推荐成本，拿到 BMR 核心参数

| 字段 | UI 形式 | 必填 | 理由 |
|------|---------|------|------|
| `gender` | 两选一按钮（男/女）| ✅ | BMR 公式分性别，影响 ±10% |
| `birthYear` | 年份滚轮 | ✅ | BMR 中年龄变量，影响 ±5% |

**UI 实现要点**:
- 单屏展示，大按钮，无滚动
- 标题："让我们用 3 秒认识你"
- 底部按钮："下一步 →"
- **不允许跳过**

```tsx
// Step1: 快速启动
<View className="onboarding-step step-1">
  <Text className="step-title">让我们用 3 秒认识你</Text>
  <Text className="step-subtitle">这两项信息帮助我们精准计算你的营养需求</Text>
  
  <GenderSelector value={gender} onChange={setGender} />
  <YearPicker value={birthYear} onChange={setBirthYear} />
  
  <Button disabled={!gender || !birthYear} onClick={nextStep}>
    下一步 →
  </Button>
</View>
```

### Step 2: 目标与身体（~15秒，4-5 字段，不可跳过）

**设计意图**: 拿到完整 BMR + 目标方向 → 系统已可输出基础推荐

| 字段 | UI 形式 | 必填 | 理由 |
|------|---------|------|------|
| `heightCm` | 数字滑动条 (100-220) | ✅ | BMR 核心 |
| `weightKg` | 数字滑动条 (30-200) | ✅ | BMR 核心 |
| `goal` | 4 选 1 卡片 | ✅ | 决定营养计算策略 |
| `targetWeightKg` | 数字滑动条 | 条件必填 | 仅 `goal=fat_loss/muscle_gain` 时显示 |
| `activityLevel` | 4 选 1 图标 | ✅ | TDEE = BMR × 系数 |

**UI 实现要点**:
- 身高体重用直观的滑动条而非数字输入，减少认知负担
- 目标用图标+短文案卡片："🔥减脂 / 💪增肌 / ❤️健康 / 🎯习惯"
- 活动等级用示意图："🪑久坐 / 🚶轻度 / 🏃中度 / 🏋️高强度"
- **完成 Step 2 后立即计算 BMR + TDEE + recommendedCalories，在确认页展示**
- **不允许跳过**（这些是核心）

```
┌────────────────────────────────────┐
│  Step 2/4 完成！你的专属计算：      │
│                                    │
│  基础代谢率 (BMR) = 1,680 kcal     │
│  每日消耗 (TDEE) = 2,100 kcal      │
│  推荐摄入 = 1,680 kcal/天          │
│                                    │
│  "基于你的减脂目标，我们建议          │
│   每日减少约 420 kcal 摄入"         │
│                                    │
│  [ 接受推荐 ]  [ 自定义热量 ]       │
└────────────────────────────────────┘
```

### Step 3: 饮食习惯（~20秒，4-5 字段，可跳过）

**设计意图**: 细化推荐策略，但缺失影响有限（有合理默认值）

| 字段 | UI 形式 | 默认值 | 理由 |
|------|---------|--------|------|
| `mealsPerDay` | 3 选 1（2/3/4）| 3 | 决定每日推荐几餐 |
| `dietaryRestrictions` | 多选标签 | `[]` | 硬过滤，不可推荐的食物 |
| `allergens` | 多选标签 (醒目❗) | `[]` | **安全性要求**，必须独立于偏好 |
| `foodPreferences` | 多选标签 | `[]` | 软偏好，影响排序 |
| `takeoutFrequency` | 3 选 1 | `sometimes` | 影响推荐食物的制作复杂度 |

**UI 实现要点**:
- **过敏原必须有独立区域 + 醒目标识**，不可与偏好混淆
- 偏好和忌口用标签云（Tag Cloud）多选形式
- 底部有"跳过此步"按钮，文案："已有不错的默认值，稍后可修改"
- 跳过后所有字段使用默认值

```tsx
// 过敏原独立区域 — 安全性优先
<View className="allergen-section warning">
  <Text className="section-title">⚠️ 你有食物过敏吗？</Text>
  <Text className="section-hint">请务必勾选，系统将严格排除这些食物</Text>
  <TagCloud 
    options={ALLERGEN_OPTIONS} 
    value={allergens} 
    onChange={setAllergens}
    style="warning"  // 红色/橙色标签
  />
</View>

// 饮食偏好
<View className="preference-section">
  <Text className="section-title">你偏爱的口味</Text>
  <TagCloud 
    options={PREFERENCE_OPTIONS}
    value={foodPreferences}
    onChange={setFoodPreferences}
    style="default"  // 蓝色/绿色标签
  />
</View>
```

### Step 4: 行为与心理（~15秒，3-4 字段，可跳过）

**设计意图**: 个性化推荐策略（约束松紧度、教练风格）

| 字段 | UI 形式 | 默认值 | 理由 |
|------|---------|--------|------|
| `discipline` | 3 选 1 | `medium` | 约束松紧度 |
| `weakTimeSlots` | 多选标签 | `[]` | 高风险时段干预 |
| `bingeTriggers` | 多选标签 | `[]` | 暴食预防策略 |
| `canCook` | 开关 | `true` | 是否推荐需烹饪的食物 |

**UI 实现要点**:
- 不要用"自律程度"这种让人不适的措辞，改为：
  - 高 → "饮食计划我都能严格执行 💪"
  - 中 → "大部分时候能坚持 👍"
  - 低 → "我需要更灵活的方案 🤷"
- `bingeTriggers` 终于要收集了！措辞："什么情况下你容易多吃？"
- 完成后进入系统，标记 `onboardingCompleted = true`

### 2.3 完成率优化策略

| 策略 | 实现 |
|------|------|
| **进度条** | 顶部 4 段进度条，当前步高亮 |
| **即时价值** | Step 2 完成后立即展示 BMR 计算结果（"看，这就是你的数据"） |
| **跳过不等于放弃** | Step 3/4 可跳过，7 天后系统弹窗："补充这些信息可以让推荐更准" |
| **社会证明** | "87% 的用户完成了全部 4 步" |
| **最小指纹** | Step 1 只有 2 个字段，消除"好多要填"的恐惧 |
| **数据预览** | 每步完成展示"基于你的信息，系统已优化 XX" |

### 2.4 跳过机制设计

```
跳过 Step 3 → 使用安全默认值：
  - mealsPerDay = 3
  - dietaryRestrictions = []
  - allergens = []
  - foodPreferences = []
  - takeoutFrequency = 'sometimes'

跳过 Step 4 → 使用安全默认值：
  - discipline = 'medium'
  - weakTimeSlots = []
  - bingeTriggers = []
  - canCook = true

⚠️ 跳过 Step 3/4 后，dataCompleteness < 0.6
→ 7 天后触发 "补全弹窗"
→ 推荐质量提示："完善信息可提升推荐准确度 ~30%"
```

### 2.5 持续收集（第 5 维度：使用中触发）

| 触发条件 | 收集字段 | 方式 |
|---------|---------|------|
| 使用 7 天 + Step 3 未填 | `allergens`, `dietaryRestrictions` | 弹窗卡片 |
| 连续替换同类食物 ≥ 3 次 | 确认偏好 | 底部 Toast |
| 使用 14 天 | `cookingSkillLevel`, `budgetLevel` | 设置页引导 |
| 使用 30 天 | `exerciseProfile` | 独立卡片 |
| 目标达成 / 停滞 | 调整 `goal`, `goalSpeed` | 智能建议弹窗 |
| 累计记录 ≥ 50 次 | `tasteIntensity` | 基于行为自动推断，用户确认 |

---

## 三、字段 → 推荐映射表

### 3.1 硬约束字段（Filtering 阶段）

这些字段直接决定食物是否进入候选池，**不可违反**。

| 字段 | 推荐影响 | 实现机制 | 缺失时处理 |
|------|---------|---------|-----------|
| `allergens` | **从候选池完全排除**含过敏原食物 | WHERE 条件 + FoodLibrary 新增 `allergens` jsonb 字段 | 不过滤（假设无过敏） |
| `dietaryRestrictions` | 排除违反限制的食物（如 vegetarian 排除肉类） | WHERE 条件，映射到 category 过滤 | 不过滤 |
| `healthConditions` | 限制特定营养素（如 diabetes → 低 GI 优先，gout → 限制嘌呤） | 动态注入额外约束到 `generateConstraints()` | 不注入额外约束 |

### 3.2 软约束字段（Scoring 阶段）

这些字段影响**评分权重和排序**，但不会完全排除食物。

| 字段 | 评分维度影响 | 权重调整公式 | 缺失时默认 |
|------|------------|-------------|-----------|
| `goal` | 宏量营养素目标分配 | fat_loss: P35/C40/F25; muscle_gain: P40/C40/F20; health: P25/C50/F25 | health 默认 |
| `goalSpeed` | 热量缺口/盈余大小 | aggressive: TDEE×0.75; steady: TDEE×0.85; relaxed: TDEE×0.92 | steady |
| `discipline` | 约束宽松度 | high: ±5% 容忍; medium: ±15%; low: ±25% | medium (±15%) |
| `activityLevel` | TDEE 活动系数 | sedentary: 1.2; light: 1.375; moderate: 1.55; active: 1.725 | light (1.375) |
| `foodPreferences` | 偏好食物得分加成 | 匹配一个标签 +0.1, 两个 +0.15 | 无加成 |
| `takeoutFrequency` | 推荐食物制作复杂度 | often: 优先 `prepTime < 10min`; never: 不限 | sometimes (不特殊处理) |
| `canCook` | 是否推荐需烹饪食物 | false: 只推荐即食/外卖/简单加热类 | true |
| `cookingSkillLevel` | 食谱复杂度上限 | none ≈ canCook=false; basic: ≤3步; intermediate: 不限 | basic |
| `budgetLevel` | 价格筛选 | low: 排除高价食材; high: 不限 | medium (不特殊处理) |
| `mealsPerDay` | 每餐热量分配 | 3餐: 30/40/30; 4餐: 25/35/25/15; 2餐: 45/55 | 3 (30/40/30) |
| `bodyFatPercent` | BMR 算法选择 | 有值: Katch-McArdle (更精确); 无值: Harris-Benedict | Harris-Benedict |
| `familySize` | 份量建议和食材选择 | >1: 推荐"适合分享"的菜品，份量按人数缩放 | 1 (独食模式) |

### 3.3 行为观测字段（Re-ranking 阶段）

| 字段 | 推荐影响 | 实现 |
|------|---------|------|
| `observed.foodPreferences.loves` | 爱吃的食物 score ×1.2 | Re-rank 加成 |
| `observed.foodPreferences.avoids` | 讨厌的食物 score ×0.3 | Re-rank 惩罚 |
| `observed.frequentFoods` | 多样性惩罚：连续推荐频繁食物时降分 | 去重 + 衰减 |
| `observed.avgComplianceRate` | < 0.5 → 放宽约束，优先可接受度 | 动态调整约束松紧 |
| `observed.mealTimingPatterns` | 推荐推送时机优化 | 在用户习惯用餐前 30min 推送 |
| `observed.replacementPatterns` | 学习用户替换倾向（鸡胸→牛肉=蛋白质类内替换） | 替换推荐候选排序 |
| `observed.bingeRiskHours` | 高风险时段推送"安全零食"推荐 | 定时任务触发 |
| `observed.streakDays` | 连续打卡 → 激励消息；断档 → 温和鼓励 | 教练风格适配 |

### 3.4 推断字段（全局校准阶段）

| 字段 | 推荐影响 | 更新频率 |
|------|---------|---------|
| `inferred.recommendedCalories` | **全天热量预算**，4 餐按比例分配 | 每次体重更新 |
| `inferred.macroTargets` | 每餐的蛋白/碳水/脂肪目标约束 | 每次目标变更 |
| `inferred.userSegment` | 选择对应的推荐策略模板 | 每周一次 |
| `inferred.nutritionGaps` | 长期缺失的营养素 → 优先推荐高含量食物 | 每 7 天 |
| `inferred.goalProgress.trend` | behind → 更严格约束; ahead → 适度放松 | 每 3 天 |
| `inferred.churnRisk` | > 0.7 → 降低难度，增加探索性推荐 | 每周 |
| `inferred.tastePrefVector` | 食物相似度计算（协同过滤） | 每 14 天 |

---

## 四、智能推断与补全机制

### 4.1 冷启动策略（用户数据不足时）

```
┌───────────────────────────────────────────────────┐
│               Cold Start Decision Tree             │
├───────────────────────────────────────────────────┤
│                                                    │
│  有性别 + 年龄 + 身高 + 体重？                       │
│  ├── Yes → 计算精确 BMR/TDEE                       │
│  └── No  → 使用人群均值                             │
│            (男: 1700 kcal/女: 1400 kcal)           │
│                                                    │
│  有 goal？                                         │
│  ├── Yes → 基于目标的宏量营养素分配                    │
│  └── No  → 默认 "health"，均衡分配                   │
│                                                    │
│  有饮食偏好/限制？                                    │
│  ├── Yes → 基于声明过滤 + 评分                       │
│  └── No  → 使用地区热门食物作为初始推荐                 │
│            (regionCode → 默认偏好模板)               │
│                                                    │
│  有行为数据 (记录 ≥ 10 条)？                         │
│  ├── Yes → 行为推断开始生效                           │
│  └── No  → 纯 Exploration 模式 (ε=0.4)             │
│            更高探索率，快速收集偏好信号               │
│                                                    │
└───────────────────────────────────────────────────┘
```

### 4.2 字段级推断引擎

| 缺失字段 | 推断方法 | 置信度 | 生效阈值 |
|---------|---------|--------|---------|
| `bodyFatPercent` | BMI 经验公式: BF% ≈ 1.2×BMI + 0.23×Age - 16.2(男) / -5.4(女) | 0.5 | 始终（当有 BMI 时） |
| `activityLevel` | 协同过滤：相同年龄段+性别+目标的用户众数 | 0.4 | 新用户 ≥ 该群体 30 人 |
| `mealsPerDay` | 用餐记录时间聚类 → 自动识别餐次模式 | 0.7 | 记录 ≥ 14 天 |
| `weakTimeSlots` | 从 AI 决策日志中，`decision=AVOID/LIMIT` 的时段统计 | 0.8 | 记录 ≥ 21 天 + ≥ 3 次同时段 |
| `foodPreferences` | 接受率 Top 5 食物的 tag 聚合 | 0.6 | 反馈 ≥ 20 条 |
| `tasteIntensity` | 接受食物的口味标签频率分布 → 归一化为 0-5 | 0.5 | 反馈 ≥ 30 条 |
| `cookingSkillLevel` | `canCook` + 接受食物的制作难度分布 | 0.5 | 反馈 ≥ 15 条 |
| `discipline` | `avgComplianceRate` 映射: >0.8→high, 0.5-0.8→medium, <0.5→low | 0.7 | 记录 ≥ 14 天 |
| `exerciseProfile` | 第三方 API 集成 (Apple Health / 微信运动) | 0.9 | 用户授权 |
| `budgetLevel` | 接受食物的均价分布 | 0.4 | 记录 ≥ 30 天 |

### 4.3 推断置信度管理

```typescript
interface InferenceResult<T> {
  value: T;
  confidence: number;      // 0-1
  source: 'declared' | 'observed' | 'inferred' | 'default';
  updatedAt: Date;
  evidenceCount: number;   // 支撑该推断的数据点数量
}

// 合并策略：declared > observed (高置信) > inferred (高置信) > default
function resolveField<T>(
  declared?: T,
  observed?: InferenceResult<T>,
  inferred?: InferenceResult<T>,
  defaultValue?: T
): InferenceResult<T> {
  if (declared !== undefined && declared !== null) {
    return { value: declared, confidence: 1.0, source: 'declared', ... };
  }
  if (observed && observed.confidence >= 0.6) {
    return observed;
  }
  if (inferred && inferred.confidence >= 0.5) {
    return inferred;
  }
  if (observed) return observed;  // 低置信观测仍优于默认
  if (inferred) return inferred;
  return { value: defaultValue, confidence: 0.1, source: 'default', ... };
}
```

### 4.4 协同过滤冷启动

当新用户数据极少时，利用**相似用户群体**补全：

```typescript
// 用户分段维度 → 找到相似群体
type UserSegmentKey = `${GoalType}_${ActivityLevel}_${AgeRange}_${Gender}`;
// 例: "fat_loss_light_25-35_male"

async function getGroupDefaults(segmentKey: UserSegmentKey): Promise<Partial<UserProfile>> {
  // 该群体的众数偏好
  const groupStats = await this.profileRepo
    .createQueryBuilder('p')
    .select([
      'mode(p.meals_per_day) as typical_meals',
      'mode(p.takeout_frequency) as typical_takeout',
      'array_agg(DISTINCT unnest(p.food_preferences)) as common_preferences',
    ])
    .where('p.segment_key = :key', { key: segmentKey })
    .andWhere('p.total_records >= 30')  // 只用活跃用户的数据
    .getRawOne();

  return {
    mealsPerDay: groupStats.typical_meals ?? 3,
    takeoutFrequency: groupStats.typical_takeout ?? 'sometimes',
    foodPreferences: groupStats.common_preferences ?? [],
  };
}
```

### 4.5 推断触发时机

```
┌──────────────────────────────────────────────────────┐
│                 推断引擎触发时机                       │
├──────────────────────────────────────────────────────┤
│                                                      │
│  实时触发（同步）：                                    │
│  ├── 用户更新 Profile → 重算 BMR/TDEE/macroTargets    │
│  ├── 用户更新体重 → 重算 goalProgress                  │
│  └── 用户修改 goal → 重置 macroTargets + 约束策略      │
│                                                      │
│  延迟触发（异步 Cron）：                               │
│  ├── 每日 02:00 → 更新 avgComplianceRate, streakDays  │
│  ├── 每周一 03:00 → 更新 userSegment, churnRisk       │
│  ├── 每 7 天 → 更新 nutritionGaps                     │
│  └── 每 14 天 → 更新 tastePrefVector                  │
│                                                      │
│  事件触发：                                           │
│  ├── 累计反馈 = 20 → 首次推断 foodPreferences          │
│  ├── 累计反馈 = 50 → 首次推断 tasteIntensity           │
│  └── 连续 3 天未登录 → 更新 churnRisk                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 五、动态更新与长期学习

### 5.1 Profile 状态机

```
                    ┌─────────┐
        注册/登录    │  COLD   │ dataCompleteness < 0.3
         ────────>  │ (冷启动) │ 使用群体默认 + 高探索率
                    └────┬────┘
                         │ 完成 Step 1-2
                         ▼
                    ┌─────────┐
                    │  WARM   │ dataCompleteness 0.3-0.6
                    │ (预热)   │ BMR 可算，推断辅助
                    └────┬────┘
                         │ 完成 Step 3-4 或使用 14 天
                         ▼
                    ┌─────────┐
                    │  HOT    │ dataCompleteness 0.6-0.85
                    │ (活跃)   │ 推荐质量稳定
                    └────┬────┘
                         │ 使用 30 天 + records ≥ 50
                         ▼
                    ┌─────────┐
                    │ MATURE  │ dataCompleteness > 0.85
                    │ (成熟)   │ 行为推断高置信
                    └─────────┘
                         │
                         │ 14 天未活跃
                         ▼
                    ┌─────────┐
                    │  STALE  │ 数据可能过时
                    │ (陈旧)   │ 重新确认关键字段
                    └─────────┘
```

### 5.2 字段更新策略

| 更新类型 | 字段示例 | 触发条件 | 策略 |
|---------|---------|---------|------|
| **用户主动** | `weightKg`, `goal`, `allergens` | 用户编辑档案 | 立即生效，重算所有依赖值 |
| **指数衰减** | `foodPreferences` (observed) | 每次反馈 | 近期数据权重更高: `w = e^(-λ·days_ago)`, λ=0.05 |
| **窗口滑动** | `avgComplianceRate` | 每日 Cron | 仅计算最近 30 天窗口 |
| **里程碑触发** | `userSegment` | 累计变化达阈值 | 体重变化 ≥ 2kg 或 complianceRate 变化 ≥ 0.15 |
| **目标迁移** | `goal` | 达成目标 | 建议用户切换：fat_loss → health/muscle_gain |
| **季节调整** | 推荐策略 | 日期变化 | 冬季增加热食权重，夏季增加凉菜 |

### 5.3 目标自动迁移

```typescript
// 目标达成检测
async function checkGoalTransition(userId: string): Promise<GoalTransitionSuggestion | null> {
  const profile = await this.getProfile(userId);
  const inferred = await this.getInferred(userId);
  
  // fat_loss 达成
  if (profile.goal === GoalType.FAT_LOSS 
      && profile.weightKg <= profile.targetWeightKg) {
    return {
      currentGoal: GoalType.FAT_LOSS,
      suggestedGoal: GoalType.HEALTH,
      reason: '恭喜！你已达到目标体重，建议切换到"保持健康"模式',
      suggestedCalories: inferred.estimatedTDEE,  // 不再有热量缺口
    };
  }
  
  // 长期停滞（4 周无变化）
  if (inferred.goalProgress.trend === 'behind' 
      && inferred.goalProgress.estimatedWeeksLeft > 20) {
    return {
      currentGoal: profile.goal,
      suggestedGoal: profile.goal,  // 不换目标
      suggestedSpeed: GoalSpeed.RELAXED,
      reason: '进度有些慢，建议调整到"佛系"节奏，长期坚持更重要',
    };
  }
  
  return null;
}
```

### 5.4 反馈闭环架构

```
用户行为 ─────────────────────────────────────────────────────┐
  │                                                           │
  ├── 接受推荐(accepted) ──> loves[] 候选, score +reinforcement │
  ├── 替换食物(replaced) ──> replacementPatterns 更新           │
  ├── 跳过推荐(skipped)  ──> avoids[] 候选, score -penalty     │
  ├── 记录食物(manual)   ──> frequentFoods 更新                │
  └── 体重更新           ──> goalProgress 重算                 │
                                                              │
  ┌────────────────────────────────────────────────────────────┘
  │
  ▼  推断引擎 (ProfileInferenceService)
  │
  ├── 短期信号 (每日) ──> avgComplianceRate, streakDays
  ├── 中期信号 (每周) ──> userSegment, churnRisk, nutritionGaps
  └── 长期信号 (每月) ──> tastePrefVector, goalProgress.trend
  │
  ▼  推荐引擎调整
  │
  ├── 约束松紧 ←── discipline (declared) + complianceRate (observed)
  ├── 探索率   ←── 用户阶段 (COLD=0.4, WARM=0.3, HOT=0.15, MATURE=0.08)
  ├── 评分权重 ←── goal + goalSpeed + healthConditions
  └── 候选池   ←── allergens + dietaryRestrictions + avoids (observed)
```

### 5.5 数据版本控制

```typescript
// 关键字段变更时创建快照
@Entity('profile_snapshots')
export class ProfileSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'jsonb' })
  snapshot: Partial<UserProfile>;  // 变更时的完整值

  @Column({ name: 'trigger_type', type: 'varchar', length: 30 })
  triggerType: 'goal_change' | 'weight_update' | 'restriction_change' | 'weekly_auto';

  @Column({ name: 'changed_fields', type: 'jsonb' })
  changedFields: string[];  // ['goal', 'goalSpeed']

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

// 触发时机
async function onProfileUpdate(userId: string, oldProfile: UserProfile, newProfile: UserProfile) {
  const criticalFields = ['goal', 'goalSpeed', 'weightKg', 'allergens', 
                          'dietaryRestrictions', 'healthConditions'];
  const changed = criticalFields.filter(f => 
    JSON.stringify(oldProfile[f]) !== JSON.stringify(newProfile[f])
  );
  
  if (changed.length > 0) {
    await this.snapshotRepo.save({
      userId,
      snapshot: oldProfile,
      triggerType: this.classifyChange(changed),
      changedFields: changed,
    });
  }
}
```

---

## 六、工程实现方案

### 6.1 数据库迁移

#### Migration 1: UserProfile 扩展

```typescript
// migration: AddProfileExtensionFields
export class AddProfileExtensionFields implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 新增字段 —— 全部 nullable，老用户不受影响
    await queryRunner.query(`
      ALTER TABLE user_profiles
        ADD COLUMN IF NOT EXISTS allergens jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS health_conditions jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS exercise_profile jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS cooking_skill_level varchar(20) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS taste_intensity jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS cuisine_preferences jsonb DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS budget_level varchar(10) DEFAULT NULL,
        ADD COLUMN IF NOT EXISTS family_size int DEFAULT 1,
        ADD COLUMN IF NOT EXISTS meal_prep_willing boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS region_code varchar(5) DEFAULT 'CN',
        ADD COLUMN IF NOT EXISTS onboarding_step int DEFAULT 0,
        ADD COLUMN IF NOT EXISTS data_completeness decimal(3,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS profile_version int DEFAULT 1
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_profiles
        DROP COLUMN IF EXISTS allergens,
        DROP COLUMN IF EXISTS health_conditions,
        DROP COLUMN IF EXISTS exercise_profile,
        DROP COLUMN IF EXISTS cooking_skill_level,
        DROP COLUMN IF EXISTS taste_intensity,
        DROP COLUMN IF EXISTS cuisine_preferences,
        DROP COLUMN IF EXISTS budget_level,
        DROP COLUMN IF EXISTS family_size,
        DROP COLUMN IF EXISTS meal_prep_willing,
        DROP COLUMN IF EXISTS region_code,
        DROP COLUMN IF EXISTS onboarding_step,
        DROP COLUMN IF EXISTS data_completeness,
        DROP COLUMN IF EXISTS profile_version
    `);
  }
}
```

#### Migration 2: UserInferredProfile 新建

```typescript
export class CreateUserInferredProfile implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_inferred_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid UNIQUE NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        estimated_bmr int,
        estimated_tdee int,
        recommended_calories int,
        macro_targets jsonb DEFAULT '{}',
        user_segment varchar(30),
        churn_risk decimal(3,2) DEFAULT 0,
        optimal_meal_count int,
        taste_pref_vector jsonb DEFAULT '[]',
        nutrition_gaps jsonb DEFAULT '[]',
        goal_progress jsonb DEFAULT '{}',
        confidence_scores jsonb DEFAULT '{}',
        last_computed_at timestamp,
        updated_at timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_inferred_user ON user_inferred_profiles(user_id)
    `);
  }
}
```

#### Migration 3: UserBehaviorProfile 扩展

```typescript
export class ExtendBehaviorProfile implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE user_behavior_profiles
        ADD COLUMN IF NOT EXISTS meal_timing_patterns jsonb DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS portion_tendency varchar(10) DEFAULT 'normal',
        ADD COLUMN IF NOT EXISTS replacement_patterns jsonb DEFAULT '{}'
    `);
  }
}
```

#### Migration 4: ProfileSnapshot 新建

```typescript
export class CreateProfileSnapshots implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS profile_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        snapshot jsonb NOT NULL,
        trigger_type varchar(30) NOT NULL,
        changed_fields jsonb NOT NULL,
        created_at timestamp DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_snapshot_user_time ON profile_snapshots(user_id, created_at DESC)
    `);
  }
}
```

### 6.2 API 端点设计

```typescript
@Controller('user-profile')
export class UserProfileController {
  
  // ============ 引导流 API ============
  
  /** 分步保存 —— 每步独立提交，不要求一次性提交所有 */
  @Post('onboarding/step/:step')
  async saveOnboardingStep(
    @Param('step') step: number,   // 1-4
    @Body() dto: OnboardingStepDto,
    @CurrentUser() user: AppUser
  ): Promise<{
    profile: UserProfile;
    computed: { bmr?: number; tdee?: number; recommendedCalories?: number };
    nextStep: number | null;       // null = 完成
    completeness: number;          // 0-1
  }>;

  /** 跳过某步 */
  @Post('onboarding/skip/:step')
  async skipOnboardingStep(
    @Param('step') step: number,
    @CurrentUser() user: AppUser
  ): Promise<{ nextStep: number | null; completeness: number }>;

  // ============ 档案管理 API ============
  
  /** 获取完整画像（声明 + 行为 + 推断 + 元数据） */
  @Get('full-profile')
  async getFullProfile(@CurrentUser() user: AppUser): Promise<FullUserProfile>;

  /** 更新声明数据（部分更新） */
  @Patch('declared')
  async updateDeclaredProfile(
    @Body() dto: UpdateDeclaredProfileDto,
    @CurrentUser() user: AppUser
  ): Promise<UserProfile>;

  /** 获取补全建议（哪些字段该补充了） */
  @Get('completion-suggestions')
  async getCompletionSuggestions(
    @CurrentUser() user: AppUser
  ): Promise<{
    suggestions: Array<{
      field: string;
      priority: 'high' | 'medium' | 'low';
      reason: string;
      estimatedImpact: string; // "推荐准确度提升 ~15%"
    }>;
    currentCompleteness: number;
  }>;

  // ============ 推断 API ============
  
  /** 手动触发推断更新 */
  @Post('infer/refresh')
  async refreshInference(@CurrentUser() user: AppUser): Promise<UserInferredProfile>;

  /** 获取目标迁移建议 */
  @Get('goal-transition')
  async getGoalTransitionSuggestion(
    @CurrentUser() user: AppUser
  ): Promise<GoalTransitionSuggestion | null>;
}
```

### 6.3 DTO 分步验证

```typescript
// Step 1 DTO
export class OnboardingStep1Dto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['male', 'female', 'other'])
  gender: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1940)
  @Max(2020)
  birthYear: number;
}

// Step 2 DTO
export class OnboardingStep2Dto {
  @IsNotEmpty()
  @IsNumber()
  @Min(50) @Max(250)
  heightCm: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(20) @Max(300)
  weightKg: number;

  @IsNotEmpty()
  @IsIn(Object.values(GoalType))
  goal: GoalType;

  @IsOptional()
  @IsNumber()
  @Min(30) @Max(200)
  targetWeightKg?: number;

  @IsNotEmpty()
  @IsIn(Object.values(ActivityLevel))
  activityLevel: ActivityLevel;

  @IsOptional()
  @IsNumber()
  @Min(800) @Max(5000)
  dailyCalorieGoal?: number;  // null 时系统自算
}

// Step 3 DTO
export class OnboardingStep3Dto {
  @IsOptional()
  @IsInt() @Min(1) @Max(6)
  mealsPerDay?: number;

  @IsOptional()
  @IsArray()
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  allergens?: string[];

  @IsOptional()
  @IsArray()
  foodPreferences?: string[];

  @IsOptional()
  @IsIn(['never', 'sometimes', 'often'])
  takeoutFrequency?: string;
}

// Step 4 DTO
export class OnboardingStep4Dto {
  @IsOptional()
  @IsIn(Object.values(Discipline))
  discipline?: Discipline;

  @IsOptional()
  @IsArray()
  weakTimeSlots?: string[];

  @IsOptional()
  @IsArray()
  bingeTriggers?: string[];

  @IsOptional()
  @IsBoolean()
  canCook?: boolean;
}
```

### 6.4 完整度计算

```typescript
/** 字段权重表 —— 权重越高，填写后对推荐质量影响越大 */
const FIELD_WEIGHTS: Record<string, number> = {
  // Step 1 — 基础
  gender: 8,
  birthYear: 8,
  // Step 2 — 核心
  heightCm: 10,
  weightKg: 10,
  goal: 9,
  activityLevel: 7,
  targetWeightKg: 5,
  // Step 3 — 饮食
  mealsPerDay: 4,
  dietaryRestrictions: 6,
  allergens: 7,
  foodPreferences: 3,
  takeoutFrequency: 2,
  // Step 4 — 行为
  discipline: 5,
  weakTimeSlots: 3,
  bingeTriggers: 4,
  canCook: 3,
  // V2 扩展
  exerciseProfile: 4,
  cookingSkillLevel: 2,
  healthConditions: 6,
  budgetLevel: 2,
  tasteIntensity: 2,
};

function calculateCompleteness(profile: UserProfile): number {
  const totalWeight = Object.values(FIELD_WEIGHTS).reduce((a, b) => a + b, 0);
  let filledWeight = 0;

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const value = profile[field];
    if (value !== null && value !== undefined) {
      if (Array.isArray(value) && value.length === 0) continue; // 空数组不算
      if (typeof value === 'object' && Object.keys(value).length === 0) continue;
      filledWeight += weight;
    }
  }

  return Math.round((filledWeight / totalWeight) * 100) / 100; // 0.00 - 1.00
}
```

### 6.5 缓存策略

```typescript
// 用户画像读取频率极高（每次推荐都需要），必须缓存
@Injectable()
export class ProfileCacheService {
  private cache = new Map<string, { data: FullUserProfile; expireAt: number }>();
  
  private readonly TTL = {
    declared: 5 * 60 * 1000,    // 声明数据 5 分钟（用户修改不频繁）
    observed: 60 * 1000,         // 行为数据 1 分钟（每次反馈都在更新）
    inferred: 30 * 60 * 1000,   // 推断数据 30 分钟（Cron 定时更新）
  };

  async getFullProfile(userId: string): Promise<FullUserProfile> {
    const cached = this.cache.get(userId);
    if (cached && cached.expireAt > Date.now()) return cached.data;

    const [declared, observed, inferred] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
      this.inferredRepo.findOne({ where: { userId } }),
    ]);

    const full = this.mergeProfile(declared, observed, inferred);
    this.cache.set(userId, { data: full, expireAt: Date.now() + this.TTL.declared });
    return full;
  }

  /** Profile 更新时清除缓存 */
  invalidate(userId: string) {
    this.cache.delete(userId);
  }
}
```

### 6.6 服务架构

```
┌────────────────────────────────────────────────────────┐
│                  UserProfileModule                      │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Controllers:                                          │
│  └── UserProfileController (API 端点)                   │
│                                                        │
│  Services:                                             │
│  ├── ProfileManageService (声明数据 CRUD + 引导流)       │
│  ├── ProfileInferenceService (推断引擎)                  │
│  │   ├── BMR/TDEE Calculator                           │
│  │   ├── User Segmentation                             │
│  │   ├── Taste Preference Vectorizer                   │
│  │   ├── Churn Risk Estimator                          │
│  │   └── Nutrition Gap Analyzer                        │
│  ├── ProfileCacheService (缓存层)                       │
│  └── ProfileSnapshotService (版本快照)                   │
│                                                        │
│  Cron Jobs:                                            │
│  ├── DailyProfileUpdateJob (02:00 每日)                 │
│  ├── WeeklySegmentationJob (Mon 03:00)                 │
│  └── BiweeklyVectorUpdateJob (每 14 天)                 │
│                                                        │
│  Entities:                                             │
│  ├── UserProfile (扩展)                                 │
│  ├── UserBehaviorProfile (扩展)                         │
│  ├── UserInferredProfile (新建)                         │
│  └── ProfileSnapshot (新建)                             │
│                                                        │
│  Dependencies:                                         │
│  ├── RecommendationEngineModule (消费方)                 │
│  ├── BehaviorModule (行为数据源)                         │
│  └── FoodLibraryModule (食物数据源)                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 附录 A：MVP vs Full 字段对比

### MVP（V1，2-3 周）

即在现有 `UserProfile` 基础上的最小改动，覆盖 80% 推荐质量。

| 字段 | 当前状态 | MVP 动作 | 理由 |
|------|---------|---------|------|
| `gender` | ✅ 已有 | 保持 | BMR 核心 |
| `birthYear` | ✅ 已有 | 保持 | BMR 核心 |
| `heightCm` | ✅ 已有 | 保持 | BMR 核心 |
| `weightKg` | ✅ 已有 | 保持 | BMR 核心 |
| `goal` | ✅ 已有 | 保持 | 策略决定 |
| `goalSpeed` | ✅ 已有 | 保持 | 热量计算 |
| `activityLevel` | ✅ 已有 | 保持 | TDEE |
| `targetWeightKg` | ✅ 已有 | 保持 | 目标追踪 |
| `mealsPerDay` | ✅ 已有 | 保持 | 餐次分配 |
| `dietaryRestrictions` | ✅ 已有 | 保持 | 硬过滤 |
| `foodPreferences` | ✅ 已有 | 保持 | 软评分 |
| `discipline` | ✅ 已有 | 保持 | 约束松紧 |
| `canCook` | ✅ 已有 | 保持 | 推荐过滤 |
| `takeoutFrequency` | ✅ 已有 | 保持 | 复杂度调整 |
| `weakTimeSlots` | ✅ 已有 | 保持 | 干预时段 |
| `bingeTriggers` | ✅ Entity 有，UI 无 | **修复 UI** | 暴食预防 |
| `allergens` | ❌ 不存在 | **新增** | ⚠️ 安全必需 |
| `onboardingStep` | ❌ 不存在 | **新增** | 分步引导 |
| `dataCompleteness` | ❌ 不存在 | **新增** | 补全触发 |
| 四步引导流 | ❌ 单页表单 | **重构 UI** | 提升完成率 |

**MVP 工作量**: UserProfile 加 3 个字段 + 修复 bingeTriggers UI + 重构引导为 4 步

### Full（V2，4-6 周）

在 MVP 基础上增加的高级字段：

| 字段 | 优先级 | 理由 |
|------|--------|------|
| `healthConditions` | P1 | 糖尿病/高血压用户的安全推荐 |
| `exerciseProfile` | P1 | 运动用户的热量/蛋白质需要显著不同 |
| `cookingSkillLevel` | P2 | 精细化烹饪建议 |
| `budgetLevel` | P2 | 预算约束推荐 |
| `tasteIntensity` | P2 | 口味强度偏好 |
| `cuisinePreferences` | P3 | 菜系偏好 |
| `familySize` | P3 | 家庭餐管理 |
| `mealPrepWilling` | P3 | 备餐推荐 |
| `regionCode` | P3 | 区域化食材推荐 |
| `UserInferredProfile` | P1 | 推断引擎实体 |
| `ProfileSnapshot` | P2 | 数据版本控制 |
| 行为推断引擎 | P1 | 自动学习偏好 |
| 协同过滤冷启动 | P2 | 新用户质量提升 |
| 持续收集弹窗 | P2 | 渐进式数据收集 |

---

## 附录 B：Top 10 最高影响力字段

按对推荐质量的**实际影响力**排序（不是用户感知重要性）：

| 排名 | 字段 | 影响力 | 原因 |
|------|------|--------|------|
| 1 | `heightCm` + `weightKg` | ⭐⭐⭐⭐⭐ | BMR 基础，影响所有热量计算 |
| 2 | `goal` | ⭐⭐⭐⭐⭐ | 决定宏量营养素分配比例、约束策略模板 |
| 3 | `allergens` | ⭐⭐⭐⭐⭐ | 安全性！推荐含过敏原食物后果严重 |
| 4 | `activityLevel` | ⭐⭐⭐⭐ | TDEE 乘数 1.2~1.725，影响每日热量 ±500kcal |
| 5 | `dietaryRestrictions` | ⭐⭐⭐⭐ | 硬过滤，错推忌口食物导致信任崩塌 |
| 6 | `discipline` | ⭐⭐⭐⭐ | 约束松紧度直接影响用户能否执行推荐 |
| 7 | `gender` + `birthYear` | ⭐⭐⭐ | BMR 公式中的性别和年龄项 |
| 8 | `mealsPerDay` | ⭐⭐⭐ | 每餐热量 = 总热量 / 餐次，错误餐次导致单餐过多或过少 |
| 9 | `observd.avgComplianceRate` | ⭐⭐⭐ | 反映用户实际执行力，低执行率需自动降低难度 |
| 10 | `healthConditions` | ⭐⭐⭐ | 糖尿病用户推荐高 GI 食物是危险的 |

**关键洞察**: Top 5 字段（身体数据 + 目标 + 过敏 + 活动 + 忌口）已能支撑 **~80% 的推荐质量**。Step 1+2 恰好覆盖了其中 4 个（身体 + 目标 + 活动），Step 3 覆盖了过敏和忌口。因此 Step 1-3 完成后就能提供可接受的推荐。

---

## 附录 C：常见反模式清单

### ❌ 反模式 1: 一次性收集所有信息

```
错误做法：
  注册后展示 20+ 字段的长表单
  
后果：
  - 完成率 < 30%
  - 大量用户填假数据快速跳过
  - "暂时跳过" → 永远不回来填

正确做法：
  4 步分段引导 + 使用中持续收集 + 行为推断自动补全
```

### ❌ 反模式 2: 过敏原和偏好混在一起

```
错误做法：
  dietaryRestrictions = ["no_beef", "vegetarian", "peanut_allergy"]
  把"不吃牛肉"和"花生过敏"放在同一个字段
  
后果：
  - 推荐引擎把过敏和偏好同等处理
  - 偏好可以被"探索"覆盖（ε-greedy 可能推荐牛肉给不吃牛肉的人）
  - 但过敏被"探索"覆盖是危险的

正确做法：
  allergens (硬约束，永不推荐) 和 dietaryRestrictions (软约束，可探索) 分开
```

### ❌ 反模式 3: 推断数据覆盖声明数据

```
错误做法：
  用户声明 discipline = "high"
  系统观测到 avgComplianceRate = 0.45 → 自动改为 discipline = "low"
  
后果：
  - 用户发现"我明明选了很强，为什么推荐变宽松了？"
  - 用户失去对系统的控制感

正确做法：
  声明数据 > 推断数据
  InferredProfile 单独存储，推荐引擎同时参考两者
  对低置信推断不采取行动
  冲突时显式询问用户："我们观察到你的执行率约为 45%，要调整方案吗？"
```

### ❌ 反模式 4: BMR 硬编码或使用用户原始输入

```
错误做法：
  dailyCalorieGoal = 用户输入的 1200
  无论身体数据如何变化都使用这个值
  
后果：
  - 体重下降 10kg 后仍按旧热量推荐 → 基础代谢降低 → 实际缺口过大
  - 添加运动后仍按旧热量 → 热量不足

正确做法：
  dailyCalorieGoal = null 时系统自算
  用户可覆盖，但体重变化 ≥2kg 时弹窗提示重新计算
  InferredProfile.recommendedCalories 始终保持最新
```

### ❌ 反模式 5: 行为画像无时间衰减

```
错误做法：
  loves = ["鸡胸肉"]  // 6 个月前频繁吃的
  最近 30 天其实已经很少选鸡胸肉了
  
后果：
  - 系统持续推荐用户已经吃腻的食物
  - 用户感觉"推荐毫无变化"

正确做法：
  指数衰减: weight = e^(-0.05 × days_since)
  30 天前的反馈权重 ≈ 0.22（影响力衰减到 22%）
  60 天前的反馈权重 ≈ 0.05（几乎无影响）
```

### ❌ 反模式 6: 冷启动时使用全局均值

```
错误做法：
  新用户 → 推荐全局最热门的食物
  
后果：
  - 一个增肌用户看到的推荐和减脂用户一样
  - 男性 25 岁看到的推荐和女性 50 岁一样

正确做法：
  使用 segment-based 协同过滤
  新用户 → 找到同目标 + 同性别 + 同年龄段的群体 → 使用群体热门食物
```

### ❌ 反模式 7: 字段验证不一致

```
错误做法：
  前端: heightCm 允许 0-999
  后端: heightCm 校验 @Min(50) @Max(250)
  Entity: heightCm 类型 decimal(5,1)
  
后果：
  - 前端允许提交无效数据
  - 后端拒绝 → 用户看到"请求失败"
  
正确做法：
  验证规则定义在 DTO 中，前后端共享常量：
  PROFILE_CONSTRAINTS = { heightCm: { min: 50, max: 250 }, ... }
  前端从 @wuwei/constants 包导入同一份约束
```

### ❌ 反模式 8: Entity 有字段但 UI 不收集

```
当前 Bug：
  UserProfile.bingeTriggers: string[]  // Entity 定义了
  Onboarding UI: 没有 bingeTriggers 的输入控件
  BehaviorProfile 的推断也没有自动填充 bingeTriggers

后果：
  - bingeTriggers 永远是空数组
  - 基于 bingeTriggers 的暴食预防逻辑从不生效

正确做法：
  Step 4 包含 bingeTriggers 收集
  同时 BehaviorService 的 analyzeUserBehavior() 也应该
  从 AI 决策日志推断 failureTriggers → 写入 bingeTriggers
```

### ❌ 反模式 9: 目标达成后无迁移

```
错误做法：
  用户减到目标体重 → 系统仍然按减脂推荐（持续热量缺口）
  
后果：
  - 用户持续减重到不健康水平
  - 用户主动提高摄入 → 系统警告"超标" → 互相矛盾

正确做法：
  目标达成 → 自动建议切换到 health 模式
  recommendedCalories = TDEE（不再有缺口）
  用户确认后切换，不自动切换
```

### ❌ 反模式 10: 缺少数据完整度跟踪

```
错误做法：
  onboardingCompleted = true/false
  只知道"完成了没有"，不知道"完成了多少"
  
后果：
  - 用户跳过了 Step 3-4，onboardingCompleted = true
  - 系统认为数据完整，不再催促补全
  - 推荐质量不佳但系统不知道原因

正确做法：
  dataCompleteness: 0.00 - 1.00
  < 0.6 → 7 天后弹窗补全
  < 0.3 → 每次打开 App 都提示
  onboardingStep: 0-4 追踪进度
```

---

## 实施优先级路线图

```
┌─────────────────────────────────────────────────────────────────┐
│                      实施路线图                                  │
├───────────────┬───────────────────┬─────────────────────────────┤
│    Phase 1    │     Phase 2       │        Phase 3              │
│   MVP (2-3周) │   Full (4-6周)    │     Advanced (8-12周)       │
├───────────────┼───────────────────┼─────────────────────────────┤
│               │                   │                             │
│ ✅ 新增 3 字段 │ 🔧 healthConditions│ 🧠 tastePrefVector         │
│   allergens   │ 🔧 exerciseProfile │ 🧠 协同过滤冷启动            │
│   onboardStep │ 🔧 cookingSkillLvl │ 🧠 churnRisk 估算          │
│   completeness│ 🔧 budgetLevel     │ 🧠 nutritionGap 分析       │
│               │ 🔧 tasteIntensity  │ 🧠 goalProgress 追踪       │
│ ✅ 修复 UI    │                   │                             │
│   bingeTriggers│ 🔧 InferredProfile│ 🔄 持续收集弹窗             │
│               │ 🔧 ProfileSnapshot │ 🔄 季节调整                │
│ ✅ 4步引导重构 │ 🔧 BMR/TDEE 自算  │ 🔄 第三方数据集成            │
│               │ 🔧 行为推断引擎    │   (Apple Health/微信运动)   │
│ ✅ completeness│ 🔧 补全建议 API   │                             │
│   计算逻辑     │                   │ 📊 A/B 测试框架             │
│               │ 🔧 缓存层          │   (引导流 + 推荐策略)        │
│               │                   │                             │
│ 产出:         │ 产出:             │ 产出:                       │
│ 完成率 > 70%  │ 推荐准确度 +25%   │ 个性化准确度 +40%           │
│ 推荐可用      │ 用户留存 +15%     │ 用户满意度 +30%             │
│               │                   │                             │
└───────────────┴───────────────────┴─────────────────────────────┘
```

---

> **关键行动项（立即可执行）**:
> 1. 修复 `bingeTriggers` UI 缺失（0.5 天）
> 2. 新增 `allergens` 字段 + Migration（0.5 天）
> 3. 重构引导页为 4 步（2-3 天）
> 4. 新增 `onboardingStep` + `dataCompleteness` 字段（0.5 天）
> 5. 实现 `calculateCompleteness()` 逻辑（0.5 天）
