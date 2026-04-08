# 智能饮食推荐系统 — 生产级架构终稿 (V3)

> **版本**: v3.0 | **日期**: 2026-04-09  
> **定位**: 系统级再设计，非增量补丁。覆盖数据层→特征层→评分层→推荐层→学习层五层架构  
> **前提**: 基于对现有三份设计文档 + 生产代码的逆向分析

---

## 目录

- [一、当前架构批判性分析](#一当前架构批判性分析)
- [二、五层系统架构设计](#二五层系统架构设计)
- [三、多维营养评分系统重设计](#三多维营养评分系统重设计)
- [四、推荐引擎架构升级](#四推荐引擎架构升级)
- [五、全球化能力增强](#五全球化能力增强)
- [六、数据与工程落地方案](#六数据与工程落地方案)
- [七、三阶段演进路线](#七三阶段演进路线)

---

## 一、当前架构批判性分析

### 1.1 致命缺陷（代码级验证）

| # | 问题 | 严重度 | 代码证据 |
|---|------|--------|---------|
| 1 | **角色模板完全失效** | 🔴 致命 | `ROLE_CATEGORIES` 使用中文分类名（`'主食','肉类'`），但 `FoodLibrary.category` 是英文枚举（`'protein','grain'`），`roleCategories.includes(f.category)` 永远返回 `false`，所有角色候选为空，fallback 到全局食物池，导致餐食结构随机 |
| 2 | **评分模型是单调线性函数** | 🟠 严重 | `caloriesScore = 1 - cal/800` — 纯线性递减，无法表达"适量最优"（如增肌用户需要足量热量但不能过量），且 800kcal 硬编码与用户目标无关 |
| 3 | **标签体系中英文混杂** | 🟠 严重 | `MEAL_PREFERENCES` 用中文标签（`'高碳水','清淡'`），但食物库 `tags` 是英文（`'high_protein','low_fat'`），标签匹配大面积失效 |
| 4 | **评分与约束脱节** | 🟡 中等 | `scoreFood()` 的评分维度（6维加权）与 `generateConstraints()` 的约束维度独立运作，约束可能筛掉高分食物，或放入低分食物 |
| 5 | **无全局营养预算优化** | 🟡 中等 | 串行生成4餐，每餐独立贪心选择，无法保证全天宏量营养素达标（如早餐吃完高碳水，午餐应补偿蛋白质，但系统不知道） |
| 6 | **份量调整是线性缩放** | 🟡 中等 | `adjustPortions()` 按热量比例等比缩放所有食物份量（0.6~1.5倍），不考虑单食物的合理份量范围（半碗米饭 vs 3碗米饭都可能出现） |

### 1.2 架构本质问题

当前系统的**本质**是一个**基于规则的贪心筛选器**，而非推荐引擎：

```
输入食物库 → 标签过滤 → 线性评分排序 → 取TopK → 输出
```

**缺少的核心能力**：

| 能力 | 当前 | 需要 |
|------|------|------|
| 食物理解 | 扁平标签 | 向量化语义表示 |
| 用户理解 | 静态档案 | 动态行为画像 + 偏好向量 |
| 组合优化 | 逐个贪心 | 全局约束求解 |
| 非线性评估 | 线性加权 | 分段函数 + 惩罚曲线 |
| 反馈闭环 | 无 | 隐式/显式反馈驱动权重衰减 |
| 文化适配 | 无 | 地区感知的评分偏移 |

---

## 二、五层系统架构设计

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        API Gateway / Client                        │
│         generatePlan() │ getMealSuggestion() │ recordFeedback()     │
└────────────┬────────────────────┬────────────────────┬──────────────┘
             ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L5 · 学习层 (Learning Layer)                                       │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐     │
│  │ FeedbackCollector│ │ PreferenceUpdater │ │ WeightDecayScheduler│  │
│  │ 收集隐式/显式反馈 │ │ 更新用户偏好向量   │ │ 动态衰减评分权重    │  │
│  └────────────────┘ └──────────────────┘ └───────────────────┘     │
└────────────┬───────────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L4 · 推荐层 (Recommendation Layer)                                  │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐     │
│  │ MealPlanner     │ │ DiversityEngine  │ │ ExplorationStrategy│    │
│  │ 全局约束优化     │ │ 长/短期多样性控制 │ │ Thompson Sampling  │    │
│  └────────────────┘ └──────────────────┘ └───────────────────┘     │
└────────────┬───────────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L3 · 评分层 (Scoring Layer)                                         │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐     │
│  │ NutrientScorer  │ │ PenaltyEngine    │ │ ContextModifier   │    │
│  │ 非线性多维评分    │ │ 超标/缺乏惩罚    │ │ 餐次/时段/状态修正 │    │
│  └────────────────┘ └──────────────────┘ └───────────────────┘     │
└────────────┬───────────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L2 · 特征层 (Feature Layer)                                         │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐     │
│  │ FoodFeatureStore│ │ UserFeatureStore │ │ ContextFeatures   │    │
│  │ 食物特征向量     │ │ 用户行为向量      │ │ 时间/地区/季节     │    │
│  └────────────────┘ └──────────────────┘ └───────────────────┘     │
└────────────┬───────────────────────────────────────────────────────┘
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│  L1 · 数据层 (Data Layer)                                            │
│  ┌────────────────┐ ┌──────────────────┐ ┌───────────────────┐     │
│  │ Foods + Trans   │ │ UserProfile +     │ │ FoodSources +     │    │
│  │ + RegionalInfo  │ │ BehaviorProfile   │ │ ChangeLogs        │    │
│  └────────────────┘ └──────────────────┘ └───────────────────┘     │
│  PostgreSQL (主存储)    Redis (缓存/向量)     (V3) 向量数据库         │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 各层职责边界

| 层 | 职责 | 输入 | 输出 | 关键变化 |
|----|------|------|------|---------|
| L1 数据层 | 存储 + 数据加工 | 原始食物/用户数据 | 清洗、标准化后的实体 | 全球化Schema + 多来源融合 |
| L2 特征层 | 特征工程 | 实体数据 | 食物向量 + 用户向量 + 上下文特征 | **新增层** — 将原始数据转化为可计算特征 |
| L3 评分层 | 单食物评估 | 特征 + 目标 | 综合得分 0-100 | 非线性评分 + 动态权重 + 新维度 |
| L4 推荐层 | 组合推荐 | 评分排序 + 约束 | 4餐完整方案 | 全局优化替代逐餐贪心 |
| L5 学习层 | 反馈闭环 | 用户行为信号 | 权重更新 + 偏好衰减 | **新增层** — 驱动系统进化 |

---

## 三、多维营养评分系统重设计

### 3.1 评分维度升级

从当前 6 维升级为 **10 维**，新增 4 个隐含健康维度：

| # | 维度 | 字段名 | 评分函数类型 | 新增? | 说明 |
|---|------|--------|-------------|:-----:|------|
| 1 | 热量合理性 | `energy` | **钟形函数** | 改造 | 不再"越低越好"，而是"接近目标最优" |
| 2 | 蛋白质达标 | `protein` | 分段线性 | 改造 | 按目标类型设不同达标区间 |
| 3 | 宏量平衡 | `macroBalance` | 复合区间 | 保留 | 碳水+脂肪比例 |
| 4 | 食物品质 | `quality` | 对数映射 | 改造 | log 衰减，差距越大影响越小 |
| 5 | 饱腹感 | `satiety` | 对数映射 | 改造 | 同上 |
| 6 | **血糖影响** | `glycemicImpact` | sigmoid 惩罚 | ✅ 新 | 基于 GL（非GI），高GL重罚 |
| 7 | **加工程度** | `processingPenalty` | 阶梯函数 | ✅ 新 | NOVA 1-4 分级，4级直接惩罚 |
| 8 | **微量营养密度** | `micronutrientDensity` | NRF 9.3 | ✅ 新 | 9种鼓励营养素 - 3种限制营养素 |
| 9 | **炎症指数** | `inflammationIndex` | 线性 | ✅ 新 | 基于 Omega-6/3 比率 + 反式脂肪 |
| 10 | 饮食稳定性 | `stability` | 分段 | 保留 | 历史行为 |

### 3.2 核心改造：从线性到非线性

#### 3.2.1 热量评分 — 钟形函数（替代线性递减）

**问题**：当前 `caloriesScore = 1 - cal/800` 意味着0卡永远满分，这对增肌用户完全错误。

**新模型**：以目标热量为中心的高斯钟形函数

$$S_{energy} = 100 \cdot \exp\left(-\frac{(C_{actual} - C_{target})^2}{2\sigma^2}\right)$$

其中 $\sigma$ 根据目标类型动态调整：

| 目标 | $\sigma$ | 含义 |
|------|---------|------|
| fat_loss | $0.12 \cdot C_{target}$ | 严格控制，偏差12%扣分明显 |
| muscle_gain | $0.20 \cdot C_{target}$ | 允许超吃，容忍度高 |
| health | $0.15 \cdot C_{target}$ | 中等 |
| habit | $0.25 \cdot C_{target}$ | 养习惯为主，宽松 |

```typescript
private calcEnergyScore(actual: number, target: number, goalType: string): number {
  if (target <= 0) return 80;
  const sigmaRatio: Record<string, number> = {
    fat_loss: 0.12, muscle_gain: 0.20, health: 0.15, habit: 0.25,
  };
  const sigma = target * (sigmaRatio[goalType] || 0.15);
  const diff = actual - target;
  const score = 100 * Math.exp(-(diff * diff) / (2 * sigma * sigma));

  // 非对称惩罚：超标比不足扣分更重（减脂场景）
  if (goalType === 'fat_loss' && diff > 0) {
    return score * 0.85; // 超标额外扣15%
  }
  // 增肌场景：不足比超标扣分更重
  if (goalType === 'muscle_gain' && diff < 0) {
    return score * 0.90;
  }
  return score;
}
```

**效果对比**（目标500kcal，减脂）：

| 实际摄入 | 旧分数（线性） | 新分数（钟形） |  
|---------|:-----:|:-----:|
| 0 kcal | 100 ❌ | 0 |
| 300 kcal | 62.5 | 43 |
| 450 kcal | 43.8 | 88 |
| 500 kcal | 37.5 | **100** |
| 550 kcal | 31.3 | 75 ← 非对称，超标扣更多 |
| 700 kcal | 12.5 | 12 |

#### 3.2.2 蛋白质评分 — 分段函数（替代简单比例）

$$S_{protein} = \begin{cases} 30 + 70 \cdot \frac{R}{R_{min}} & R < R_{min} \text{ (不足区: 线性增长)} \\ 100 & R_{min} \leq R \leq R_{max} \text{ (达标区: 满分)} \\ 100 - 50 \cdot \frac{R - R_{max}}{0.15} & R > R_{max} \text{ (超标区: 缓慢下降)} \end{cases}$$

其中 $R = \frac{protein \times 4}{calories}$，$[R_{min}, R_{max}]$ 按目标类型设定。

```typescript
private calcProteinScore(protein: number, calories: number, goalType: string): number {
  if (calories <= 0) return 80;
  const ratio = (protein * 4) / calories;
  const ranges: Record<string, [number, number]> = {
    fat_loss:    [0.25, 0.35],
    muscle_gain: [0.25, 0.40],
    health:      [0.15, 0.25],
    habit:       [0.12, 0.30],
  };
  const [min, max] = ranges[goalType] || [0.15, 0.25];

  if (ratio >= min && ratio <= max) return 100;
  if (ratio < min) return Math.max(0, 30 + 70 * (ratio / min));
  // 超标区 — 蛋白质多一些问题不大，缓慢衰减
  return Math.max(0, 100 - 50 * ((ratio - max) / 0.15));
}
```

#### 3.2.3 血糖影响评分 — Sigmoid 惩罚

不使用 GI（血糖指数），因为 GI 不考虑份量。使用 **GL（血糖负荷）= GI × 碳水(g) / 100**，更准确反映实际血糖冲击。

$$S_{glycemic} = 100 \cdot \frac{1}{1 + e^{0.3 \cdot (GL - 15)}}$$

- GL < 10 → 低血糖负荷 → ~95分
- GL 10-20 → 中等 → ~75分
- GL > 20 → 高血糖负荷 → 分数急剧下降

```typescript
private calcGlycemicScore(food: FoodFeatures): number {
  const gi = food.glycemicIndex;
  const carbsPerServing = (food.carbsPer100g * food.standardServingG) / 100;
  if (!gi || gi === 0) return 75; // 无GI数据给中等分
  const gl = (gi * carbsPerServing) / 100;
  return 100 / (1 + Math.exp(0.3 * (gl - 15)));
}
```

#### 3.2.4 加工程度评分 — 阶梯函数

基于 NOVA 分级的阶梯惩罚，NOVA-4 直接重罚：

$$S_{processing} = \begin{cases} 100 & NOVA = 1 \text{ (天然)} \\ 85 & NOVA = 2 \text{ (加工原料)} \\ 55 & NOVA = 3 \text{ (加工食品)} \\ 20 & NOVA = 4 \text{ (超加工)} \end{cases}$$

```typescript
private calcProcessingScore(processingLevel: number): number {
  const scores = [100, 100, 85, 55, 20]; // index = NOVA level
  return scores[processingLevel] ?? 75;
}
```

#### 3.2.5 微量营养密度 — NRF 9.3 算法

**NRF 9.3** (Nutrient Rich Food 9.3) 是学术界公认的营养密度评分算法：

$$NRF_{9.3} = \left(\sum_{i=1}^{9} \frac{Nutrient_i}{DV_i}\right) - \left(\sum_{j=1}^{3} \frac{Nutrient_j}{MRV_j}\right)$$

**9种鼓励营养素**: 蛋白质、膳食纤维、维A、维C、维D、钙、铁、钾、镁

**3种限制营养素**: 饱和脂肪、糖、钠

```typescript
private calcNutrientDensityScore(food: FoodFeatures): number {
  // 每日推荐值 (DV) — 基于 FDA 标准
  const DV: Record<string, number> = {
    protein: 50, fiber: 28, vitaminA: 900, vitaminC: 90,
    vitaminD: 20, calcium: 1300, iron: 18, potassium: 4700, magnesium: 420,
  };
  // 每日最大限制值 (MRV)
  const MRV: Record<string, number> = {
    saturatedFat: 20, sugar: 50, sodium: 2300,
  };

  // 鼓励项（per 100kcal 标准化）
  const calPer100 = food.calories > 0 ? 100 / food.calories : 0;
  let encourage = 0;
  encourage += Math.min(1, (food.protein * calPer100) / DV.protein);
  encourage += Math.min(1, ((food.fiber || 0) * calPer100) / DV.fiber);
  encourage += Math.min(1, ((food.vitaminA || 0) * calPer100) / DV.vitaminA);
  encourage += Math.min(1, ((food.vitaminC || 0) * calPer100) / DV.vitaminC);
  encourage += Math.min(1, ((food.vitaminD || 0) * calPer100) / DV.vitaminD);
  encourage += Math.min(1, ((food.calcium || 0) * calPer100) / DV.calcium);
  encourage += Math.min(1, ((food.iron || 0) * calPer100) / DV.iron);
  encourage += Math.min(1, ((food.potassium || 0) * calPer100) / DV.potassium);
  encourage += Math.min(1, ((food.magnesium || 0) * calPer100) / DV.magnesium);

  // 限制项
  let limit = 0;
  limit += Math.max(0, ((food.saturatedFat || 0) * calPer100) / MRV.saturatedFat - 1);
  limit += Math.max(0, ((food.sugar || 0) * calPer100) / MRV.sugar - 1);
  limit += Math.max(0, ((food.sodium || 0) * calPer100) / MRV.sodium - 1);

  // 归一化到 0-100 (理论最大 encourage=9, limit 通常<1)
  const raw = (encourage / 9) * 100 - limit * 30;
  return Math.max(0, Math.min(100, raw));
}
```

#### 3.2.6 炎症指数 — 基于脂肪酸比率

慢性低度炎症是现代饮食的隐性风险。Omega-6/Omega-3 比率是关键指标：

$$S_{inflammation} = 100 - \begin{cases} 0 & R_{6:3} \leq 4 \text{ (理想)} \\ 5 \cdot (R_{6:3} - 4) & 4 < R_{6:3} \leq 10 \\ 30 + 3 \cdot (R_{6:3} - 10) & R_{6:3} > 10 \end{cases} - P_{trans}$$

其中 $P_{trans} = \min(30, transFat \times 15)$

> **注意**：初期大多数食物缺少 Omega-6/3 数据，此维度采用「有数据才计算」策略，无数据时给中等分。可暂用简化版本——只基于 `saturatedFat`, `transFat`, `fiber` 做快速估算。

```typescript
private calcInflammationScore(food: FoodFeatures): number {
  let score = 80; // 默认中等

  // 反式脂肪重罚
  if (food.transFat && food.transFat > 0) {
    score -= Math.min(30, food.transFat * 15);
  }
  // 高饱和脂肪轻罚
  if (food.saturatedFat && food.saturatedFat > 5) {
    score -= Math.min(15, (food.saturatedFat - 5) * 2);
  }
  // 高纤维奖励（抗炎）
  if (food.fiber && food.fiber > 3) {
    score += Math.min(10, (food.fiber - 3) * 2);
  }
  return Math.max(0, Math.min(100, score));
}
```

### 3.3 动态权重系统

#### 3.3.1 三维权重叠加

最终权重 = **基础权重** × **状态修正** × **餐次修正**

```typescript
interface WeightVector {
  energy: number;
  protein: number;
  macroBalance: number;
  quality: number;
  satiety: number;
  glycemicImpact: number;
  processingPenalty: number;
  micronutrientDensity: number;
  inflammationIndex: number;
  stability: number;
}

// ① 基础权重 — 按目标类型
const BASE_WEIGHTS: Record<string, WeightVector> = {
  fat_loss: {
    energy: 0.22,         // 热量仍重要但不再独大
    protein: 0.18,
    macroBalance: 0.10,
    quality: 0.08,
    satiety: 0.10,
    glycemicImpact: 0.10, // 减脂必须控血糖
    processingPenalty: 0.07,
    micronutrientDensity: 0.05,
    inflammationIndex: 0.05,
    stability: 0.05,
  },
  muscle_gain: {
    energy: 0.15,         // 热量够就行
    protein: 0.25,        // 蛋白质最高优先
    macroBalance: 0.15,
    quality: 0.08,
    satiety: 0.03,
    glycemicImpact: 0.05,
    processingPenalty: 0.07,
    micronutrientDensity: 0.07,
    inflammationIndex: 0.05,
    stability: 0.10,
  },
  health: {
    energy: 0.10,
    protein: 0.08,
    macroBalance: 0.12,
    quality: 0.15,        // 食物品质最高
    satiety: 0.08,
    glycemicImpact: 0.10,
    processingPenalty: 0.10,
    micronutrientDensity: 0.12, // 微量营养密度重要
    inflammationIndex: 0.10,
    stability: 0.05,
  },
  habit: {
    energy: 0.12,
    protein: 0.10,
    macroBalance: 0.08,
    quality: 0.12,
    satiety: 0.15,        // 吃饱才能坚持
    glycemicImpact: 0.08,
    processingPenalty: 0.08,
    micronutrientDensity: 0.07,
    inflammationIndex: 0.05,
    stability: 0.15,      // 习惯养成权重高
  },
};
```

#### 3.3.2 用户状态修正因子

系统检测用户当前状态，动态调整权重：

```typescript
interface StatusModifier {
  condition: (ctx: UserContext) => boolean;
  adjustments: Partial<WeightVector>;
  description: string;
}

const STATUS_MODIFIERS: StatusModifier[] = [
  {
    // 减脂平台期：增加蛋白+饱腹感权重，降低热量权重（避免过度限制）
    condition: (ctx) => ctx.goalType === 'fat_loss' && ctx.weightPlateau > 7,
    adjustments: { protein: +0.05, satiety: +0.05, energy: -0.05, quality: +0.03 },
    description: '减脂平台期：调高蛋白和饱腹感',
  },
  {
    // 蛋白质长期不足：提权
    condition: (ctx) => ctx.avgProteinRatio7d < 0.15,
    adjustments: { protein: +0.08, energy: -0.04 },
    description: '蛋白质长期不足：紧急提权',
  },
  {
    // 高加工饮食倾向：提高品质和加工度权重
    condition: (ctx) => ctx.avgProcessingLevel7d > 2.5,
    adjustments: { quality: +0.05, processingPenalty: +0.05, energy: -0.05 },
    description: '加工食品过多：提高品质权重',
  },
  {
    // 血糖波动风险（糖尿病友好标签用户）
    condition: (ctx) => ctx.diabetesFriendly || ctx.avgGI7d > 65,
    adjustments: { glycemicImpact: +0.10, macroBalance: -0.05 },
    description: '血糖控制需求：提高血糖影响权重',
  },
];
```

#### 3.3.3 餐次修正因子

不同餐次对各营养维度的关注点不同：

```typescript
const MEAL_WEIGHT_MODIFIERS: Record<string, Partial<WeightVector>> = {
  breakfast: {
    energy: +0.03,              // 早餐需要足够能量启动
    glycemicImpact: +0.05,      // 早餐血糖波动影响全天
    satiety: +0.03,             // 撑到午餐
    protein: -0.03,
    inflammationIndex: -0.03,
  },
  lunch: {
    // 午餐最均衡，不做大幅修正
    macroBalance: +0.03,
    satiety: +0.02,
  },
  dinner: {
    glycemicImpact: +0.05,      // 晚餐低GI有助睡眠
    protein: +0.03,             // 晚间蛋白质促修复
    energy: -0.05,              // 晚餐适度少吃
    processingPenalty: +0.02,
  },
  snack: {
    energy: -0.08,              // 加餐热量要少
    satiety: +0.05,             // 但要能顶住
    quality: +0.03,
    micronutrientDensity: +0.03,
    macroBalance: -0.05,
  },
};
```

#### 3.3.4 权重合成算法

```typescript
function computeFinalWeights(
  goalType: string,
  mealType: string,
  userContext: UserContext,
): WeightVector {
  // 1. 基础权重
  const weights = { ...BASE_WEIGHTS[goalType] };

  // 2. 叠加状态修正
  for (const mod of STATUS_MODIFIERS) {
    if (mod.condition(userContext)) {
      for (const [key, delta] of Object.entries(mod.adjustments)) {
        weights[key] = (weights[key] || 0) + delta;
      }
    }
  }

  // 3. 叠加餐次修正
  const mealMod = MEAL_WEIGHT_MODIFIERS[mealType];
  if (mealMod) {
    for (const [key, delta] of Object.entries(mealMod)) {
      weights[key] = (weights[key] || 0) + delta;
    }
  }

  // 4. 归一化（保证权重总和 = 1）
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const key of Object.keys(weights)) {
    weights[key] = Math.max(0, weights[key]) / total;
  }

  return weights;
}
```

### 3.4 惩罚引擎（Penalty Engine）

独立于评分维度的**硬约束惩罚**。维度评分是"打分"，惩罚引擎是"一票否决"：

```typescript
interface PenaltyRule {
  name: string;
  condition: (input: NutritionInput, food?: FoodFeatures) => boolean;
  multiplier: number;  // 总分乘以此系数
  message: string;
}

const PENALTY_RULES: PenaltyRule[] = [
  {
    name: 'calorie_severe_over',
    condition: (input) => input.calories > input.targetCalories * 1.4,
    multiplier: 0.5,
    message: '热量严重超标(>40%)',
  },
  {
    name: 'calorie_over',
    condition: (input) => input.calories > input.targetCalories * 1.2,
    multiplier: 0.75,
    message: '热量超标(>20%)',
  },
  {
    name: 'protein_severe_deficit',
    condition: (input) => input.calories > 0 && (input.protein * 4) / input.calories < 0.08,
    multiplier: 0.6,
    message: '蛋白质严重不足(<8%)',
  },
  {
    name: 'ultra_processed',
    condition: (_, food) => (food?.processingLevel ?? 1) === 4,
    multiplier: 0.8,
    message: '超加工食品',
  },
  {
    name: 'trans_fat_present',
    condition: (_, food) => (food?.transFat ?? 0) > 0.5,
    multiplier: 0.85,
    message: '含反式脂肪',
  },
  {
    name: 'allergen_conflict',
    condition: (input, food) => {
      const userAllergens = input.userAllergens || [];
      const foodAllergens = food?.allergens || [];
      return userAllergens.some(a => foodAllergens.includes(a));
    },
    multiplier: 0, // 直接归零
    message: '过敏原冲突',
  },
];

function applyPenalties(score: number, input: NutritionInput, food?: FoodFeatures): {
  finalScore: number;
  appliedPenalties: string[];
} {
  let finalScore = score;
  const applied: string[] = [];

  for (const rule of PENALTY_RULES) {
    if (rule.condition(input, food)) {
      finalScore *= rule.multiplier;
      applied.push(rule.message);
    }
  }

  return { finalScore: Math.round(finalScore), appliedPenalties: applied };
}
```

### 3.5 完整评分流程示例

**输入**：用户减脂目标，午餐，推荐鸡胸肉沙拉

```
食物: 鸡胸肉沙拉 (1份300g)
  calories: 280kcal, protein: 35g, fat: 8g, carbs: 12g
  fiber: 5g, sugar: 3g, sodium: 450mg
  GI: 35, NOVA: 1, saturatedFat: 2g, transFat: 0g
  vitaminC: 25mg, calcium: 80mg, iron: 2mg
  
目标: fat_loss, 午餐预算 525kcal

Step 1: 计算各维度分数
  energy       = gaussian(280, 525, σ=63)     = 88  (偏低但减脂OK)
  protein      = piecewise(35*4/280=0.50)      = 80  (略超达标区上界0.35)
  macroBalance = range(carbs%=17%, fat%=26%)   = 62  (碳水偏低)
  quality      = log(8/10)                      = 90
  satiety      = log(8/10)                      = 90
  glycemic     = sigmoid(GL = 35*12/100 = 4.2) = 97  (极低GL)
  processing   = step(NOVA=1)                   = 100
  micronutrient = NRF9.3(...)                   = 72
  inflammation = calc(sat=2, trans=0, fiber=5)  = 90
  stability    = calc(streak=12)                = 70

Step 2: 动态权重 (fat_loss + lunch)
  energy=0.23, protein=0.17, macro=0.13, quality=0.08, satiety=0.12,
  glycemic=0.10, processing=0.06, micro=0.04, inflammation=0.04, stability=0.03

Step 3: 加权求和
  Score = 88×.23 + 80×.17 + 62×.13 + 90×.08 + 90×.12 + 97×.10 + 100×.06 + 72×.04 + 90×.04 + 70×.03
        = 20.24 + 13.6 + 8.06 + 7.2 + 10.8 + 9.7 + 6.0 + 2.88 + 3.6 + 2.1
        = 84.2

Step 4: 惩罚检查
  无触发惩罚规则

Step 5: 最终
  Score = 84, Decision = SAFE
  Highlights: ["✅ 极低血糖负荷", "✅ 天然未加工", "⚠️ 碳水偏低建议搭配主食"]
```

---

## 四、推荐引擎架构升级

### 4.1 核心问题重新定义

每日饮食计划本质上是一个**多目标约束优化问题**：

$$\text{maximize} \sum_{m \in \{B,L,D,S\}} \sum_{f \in meal_m} Score(f) \cdot diversity(f) \cdot exploration(f)$$

$$\text{subject to} \begin{cases} \sum calories_f = C_{target} \pm \epsilon \\ \sum protein_f \geq P_{target} \\ fat_{ratio} \in [F_{min}, F_{max}] \\ carbs_{ratio} \in [Cb_{min}, Cb_{max}] \\ |meal_m| = K_m \text{ (每餐食物数)} \\ f_i \neq f_j \text{ (不重复)} \\ structural(meal_m) \text{ (餐食结构约束)} \end{cases}$$

### 4.2 推荐策略：三阶段混合架构

```
┌───────────────────────────────────────────────────┐
│              推荐 Pipeline (单次调用)               │
├───────────────────────────────────────────────────┤
│                                                   │
│  Stage 1: 召回 (Recall)                            │
│  ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │
│  │ Rule Filter  │ │ Tag Match   │ │ Embedding  │  │
│  │ 硬约束过滤    │ │ 标签匹配     │ │ 相似召回    │  │
│  │ 过敏原/禁忌   │ │ 餐次/目标    │ │ (V2阶段)   │  │
│  └──────┬──────┘ └──────┬──────┘ └─────┬──────┘  │
│         └───────────┬───────────────────┘          │
│                     ▼                              │
│  Stage 2: 精排 (Ranking)                           │
│  ┌─────────────────────────────────────────────┐   │
│  │ 10维评分 × 动态权重 × 惩罚引擎                  │   │
│  │ + 用户偏好加权 + 相似度惩罚                     │   │
│  └──────────────────┬──────────────────────────┘   │
│                     ▼                              │
│  Stage 3: 重排 (Re-rank)                           │
│  ┌────────────┐ ┌─────────────┐ ┌──────────────┐  │
│  │ Diversity   │ │ Exploration │ │ Portion Opt  │  │
│  │ 多样性调整   │ │ 探索注入     │ │ 份量优化      │  │
│  └─────┬──────┘ └──────┬──────┘ └──────┬───────┘  │
│        └───────────┬───────────────────┘           │
│                    ▼                               │
│              Final Selection                       │
└───────────────────────────────────────────────────┘
```

### 4.3 Stage 1: 召回层详细设计

#### 4.3.1 规则过滤（硬约束）

```typescript
interface HardConstraints {
  // 用户级别
  allergens: string[];           // 过敏原排除（绝对）
  dietaryRestrictions: string[]; // 饮食限制（素食/清真等）
  excludeFoodNames: string[];    // 跨餐排除 + 用户黑名单

  // 餐次级别
  mealType: string;              // 食物须匹配 mealTypes[]
  maxCaloriesPerFood: number;    // 单食物热量上限

  // 营养级别
  maxTotalCalories: number;      // 本餐热量上限
}

function hardFilter(foods: FoodLibrary[], constraints: HardConstraints): FoodLibrary[] {
  return foods.filter(f => {
    // 过敏原绝对排除
    if (constraints.allergens.some(a => (f.allergens || []).includes(a))) return false;
    // 饮食限制
    if (constraints.dietaryRestrictions.includes('vegetarian') && f.category === 'protein'
        && !['tofu', 'legume', 'egg'].includes(f.subCategory)) return false;
    // 跨餐排除
    if (constraints.excludeFoodNames.includes(f.name)) return false;
    // 餐次匹配
    if (f.mealTypes?.length > 0 && !f.mealTypes.includes(constraints.mealType)) return false;
    // 热量上限
    const servingCal = (f.caloriesPer100g * f.standardServingG) / 100;
    if (servingCal > constraints.maxCaloriesPerFood) return false;
    return true;
  });
}
```

#### 4.3.2 标签匹配（软约束召回）

在规则过滤后，根据目标+餐次生成**偏好标签集**，对食物做软匹配排序：

```typescript
function softTagRecall(
  foods: FoodLibrary[],
  preferredTags: string[],    // 统一使用英文标签
  boostedCategories: string[],
): { food: FoodLibrary; recallScore: number }[] {
  return foods.map(f => {
    let recallScore = 1.0;
    // 标签命中奖励
    const foodTags = f.tags || [];
    const tagHits = preferredTags.filter(t => foodTags.includes(t)).length;
    recallScore += tagHits * 0.15;
    // 分类偏好奖励
    if (boostedCategories.includes(f.category)) recallScore += 0.3;
    // 流行度微弱奖励（避免冷门食物被完全忽视）
    recallScore += Math.min(0.1, (f.popularity || 0) / 10000);
    return { food: f, recallScore };
  }).sort((a, b) => b.recallScore - a.recallScore);
}
```

#### 4.3.3 Embedding 召回（V2阶段）

> V2 阶段实现。通过食物向量 + 用户偏好向量的余弦相似度召回，详见 [六、数据与工程落地方案](#六数据与工程落地方案)

### 4.4 Stage 2: 精排层

精排使用前文设计的10维评分系统。对每个候选食物计算最终得分。

```typescript
function rankFoods(
  candidates: { food: FoodLibrary; recallScore: number }[],
  weights: WeightVector,
  userPreferences: UserPreferences,
  excludeNames: string[],
  selectedFoods: FoodLibrary[], // 本餐已选的食物（用于相似度惩罚）
): ScoredFood[] {
  return candidates.map(({ food, recallScore }) => {
    // 10维评分
    const features = extractFeatures(food);
    const dimScores = computeAllDimensions(features);
    let score = weightedSum(dimScores, weights);

    // 惩罚引擎
    const { finalScore, appliedPenalties } = applyPenalties(score, ..., features);
    score = finalScore;

    // 用户偏好加权
    score = applyUserPreferences(score, food, userPreferences);

    // 相似度惩罚（与本餐已选食物）
    for (const selected of selectedFoods) {
      const sim = computeSimilarity(food, selected);
      score *= (1 - sim * 0.4); // 越相似越惩罚
    }

    // 召回分微调（保持召回阶段的偏好信号）
    score *= (0.9 + 0.1 * recallScore);

    return { food, score, dimScores, appliedPenalties, ...computeServingNutrients(food) };
  }).sort((a, b) => b.score - a.score);
}
```

#### 4.4.1 升级版相似度计算

```typescript
function computeSimilarity(a: FoodLibrary, b: FoodLibrary): number {
  let sim = 0;

  // 同主原料（最高相似）
  if (a.mainIngredient && a.mainIngredient === b.mainIngredient) sim += 0.40;
  // 同二级分类
  else if (a.subCategory && a.subCategory === b.subCategory) sim += 0.30;
  // 同一级分类
  else if (a.category === b.category) sim += 0.15;

  // 同多样性分组
  if (a.foodGroup && a.foodGroup === b.foodGroup) sim += 0.15;

  // 标签重叠度
  const tagsA = new Set(a.tags || []);
  const tagsB = new Set(b.tags || []);
  const intersection = [...tagsA].filter(t => tagsB.has(t)).length;
  const union = new Set([...tagsA, ...tagsB]).size;
  if (union > 0) sim += (intersection / union) * 0.15; // Jaccard

  // 营养素相似度（热量±20% + 蛋白质±30%）
  const calRatio = Math.abs(a.caloriesPer100g - b.caloriesPer100g) / Math.max(a.caloriesPer100g, 1);
  const proRatio = Math.abs((a.proteinPer100g || 0) - (b.proteinPer100g || 0)) / Math.max(a.proteinPer100g || 1, 1);
  if (calRatio < 0.2 && proRatio < 0.3) sim += 0.10;

  return Math.min(1, sim);
}
```

### 4.5 Stage 3: 重排层

#### 4.5.1 多样性引擎

**长期多样性** + **短期多样性** 双重控制：

```typescript
interface DiversityConfig {
  // 短期（本次计划内）
  sameCategoryLimit: number;     // 同一级分类在4餐中最多出现次数（default: 3）
  sameFoodGroupLimit: number;    // 同多样性分组在4餐中最多出现次数（default: 2）
  sameIngredientLimit: number;   // 同主原料在4餐中最多出现次数（default: 1）

  // 长期（跨天）
  recentDaysExclude: number;     // 排除最近N天吃过的食物（default: 2）
  recentDaysPenalty: number;     // 最近N天吃过的食物降权比例（default: 3-5天降30%）
}

/**
 * 多样性函数 — 返回多样性得分 [0, 1]
 * 1 = 完全多样, 0 = 完全重复
 */
function diversityScore(
  candidate: FoodLibrary,
  selectedFoodsAllMeals: FoodLibrary[], // 所有餐次已选食物
  recentFoods: string[],                // 最近N天吃过的食物名
  config: DiversityConfig,
): number {
  let score = 1.0;

  // 短期：同类累计惩罚
  const sameCategory = selectedFoodsAllMeals.filter(f => f.category === candidate.category).length;
  if (sameCategory >= config.sameCategoryLimit) score *= 0.3;
  else if (sameCategory > 0) score *= (1 - sameCategory * 0.1);

  const sameFoodGroup = selectedFoodsAllMeals.filter(f => f.foodGroup === candidate.foodGroup).length;
  if (sameFoodGroup >= config.sameFoodGroupLimit) score *= 0.2;

  const sameIngredient = selectedFoodsAllMeals.filter(f => f.mainIngredient === candidate.mainIngredient).length;
  if (sameIngredient >= config.sameIngredientLimit) score *= 0.1;

  // 长期：最近吃过降权
  if (recentFoods.includes(candidate.name)) score *= 0.3;

  return score;
}
```

#### 4.5.2 探索策略：Thompson Sampling

从 ε-greedy 升级为 **Thompson Sampling**，基于贝叶斯方法平衡探索与利用：

**核心思想**：每个食物维护一个 Beta 分布 $Beta(\alpha, \beta)$，每次推荐时从分布中采样，选采样值最高的。用户接受→α+1，用户拒绝→β+1。

```typescript
interface FoodExplorationState {
  foodId: string;
  alpha: number;  // 成功次数（用户接受）+ 先验
  beta: number;   // 失败次数（用户跳过/替换）+ 先验
}

/**
 * Thompson Sampling 探索
 * 对精排后的 TopK 候选注入探索分数
 */
function thompsonSamplingRerank(
  scored: ScoredFood[],
  explorationStates: Map<string, FoodExplorationState>,
  explorationWeight: number = 0.2, // 探索分占最终分的权重
): ScoredFood[] {
  return scored.map(sf => {
    const state = explorationStates.get(sf.food.id) || { alpha: 1, beta: 1 };

    // 从 Beta(α, β) 分布中采样
    const sample = betaSample(state.alpha, state.beta);

    // 混合评分：exploitation + exploration
    const blendedScore = sf.score * (1 - explorationWeight) + sample * 100 * explorationWeight;

    return { ...sf, score: blendedScore, explorationSample: sample };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Beta 分布采样（Jöhnk 算法，纯 JS 实现）
 */
function betaSample(alpha: number, beta: number): number {
  // 使用 gamma 分布采样实现 beta 采样
  const x = gammaSample(alpha);
  const y = gammaSample(beta);
  return x / (x + y);
}

function gammaSample(shape: number): number {
  // Marsaglia and Tsang's method
  if (shape < 1) return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = randn(); // 标准正态分布
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function randn(): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
```

**V1 阶段简化版**（不依赖历史数据，适合冷启动）：

```typescript
/**
 * V1 简化版：加权随机扰动（ε-greedy 的改良版）
 * 按分数区间分配不同的探索强度：
 *   Top 20%: 3% 扰动（几乎确定性）
 *   Top 20-50%: 10% 扰动（偶尔晋升）
 *   Top 50-80%: 20% 扰动（有机会出场）
 *   Bottom 20%: 5% 扰动（极少出场）
 */
function tieredExploration(scored: ScoredFood[]): ScoredFood[] {
  const total = scored.length;
  return scored.map((sf, i) => {
    const percentile = i / total;
    let epsilon: number;
    if (percentile < 0.2) epsilon = 0.03;
    else if (percentile < 0.5) epsilon = 0.10;
    else if (percentile < 0.8) epsilon = 0.20;
    else epsilon = 0.05;

    const noise = (Math.random() - 0.5) * 2 * epsilon;
    return { ...sf, score: sf.score * (1 + noise) };
  }).sort((a, b) => b.score - a.score);
}
```

#### 4.5.3 智能份量优化

替代当前的线性缩放，引入约束式份量优化：

```typescript
interface PortionConstraint {
  minServings: number;  // 最小份量倍数（default 0.5）
  maxServings: number;  // 最大份量倍数（default 2.0）
  stepSize: number;     // 步进（default 0.25，即四分之一份）
}

/**
 * 对一餐中已选的 K 个食物，调整各自份量使总热量接近预算
 * 同时尽量满足蛋白质目标
 *
 * 简化为：热量约束下的线性比例分配 + 边界裁剪
 */
function optimizePortions(
  foods: ScoredFood[],
  caloriesBudget: number,
  proteinTarget: number,
  constraints: PortionConstraint = { minServings: 0.5, maxServings: 2.0, stepSize: 0.25 },
): ScoredFood[] {
  // 计算当前总热量
  const totalCal = foods.reduce((s, f) => s + f.servingCalories, 0);
  if (totalCal === 0) return foods;

  // 基础比例
  const ratio = caloriesBudget / totalCal;

  return foods.map(f => {
    // 应用比例
    let servings = ratio;

    // 蛋白质优先食物适当增加
    const proteinRatio = f.servingProtein / (f.servingCalories || 1);
    if (proteinRatio > 0.3) { // 高蛋白食物
      servings *= 1.1; // 微增
    }

    // 边界裁剪
    servings = Math.max(constraints.minServings, Math.min(constraints.maxServings, servings));

    // 步进量化（0.5, 0.75, 1.0, 1.25, ...）
    servings = Math.round(servings / constraints.stepSize) * constraints.stepSize;

    return {
      ...f,
      servingCalories: Math.round(f.servingCalories * servings),
      servingProtein: Math.round(f.servingProtein * servings),
      servingFat: Math.round(f.servingFat * servings),
      servingCarbs: Math.round(f.servingCarbs * servings),
      portionMultiplier: servings,
    };
  });
}
```

### 4.6 跨餐协同优化

当前系统的串行生成 + excludeNames 只能避免重复，但无法做营养补偿。升级为**两阶段方法**：

```
阶段A: 串行贪心 + 排除（现有方案，优化后）
  → 快速生成4餐初始方案

阶段B: 全局校准（新增）
  → 检查4餐总和是否满足全天营养目标
  → 如果不满足，对偏差最大的1-2餐做食物替换
```

```typescript
interface DailyPlanValidation {
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  caloriesDeviation: number;   // 与目标偏差百分比
  proteinDeviation: number;
  macroBalanceScore: number;
}

/**
 * 全局校准：检查4餐总和，必要时替换食物
 */
function globalCalibration(
  meals: MealRecommendation[],  // 4餐初始方案
  dailyTarget: DailyNutritionGoals,
  allFoods: FoodLibrary[],
  maxSwaps: number = 2,
): MealRecommendation[] {
  const validation = validateDailyPlan(meals, dailyTarget);

  // 如果偏差在可接受范围内（热量±10%, 蛋白质±15%），直接返回
  if (Math.abs(validation.caloriesDeviation) < 0.10 &&
      Math.abs(validation.proteinDeviation) < 0.15) {
    return meals;
  }

  let swapCount = 0;

  // 蛋白质不足：在非加餐餐次中，替换最低蛋白食物为高蛋白替代
  if (validation.proteinDeviation < -0.15 && swapCount < maxSwaps) {
    const { mealIndex, foodIndex, replacement } = findProteinSwap(
      meals, allFoods, dailyTarget.protein - validation.totalProtein,
    );
    if (replacement) {
      meals[mealIndex].foods[foodIndex] = replacement;
      swapCount++;
    }
  }

  // 热量超标：在最高热量餐次中，替换最高热量食物为低卡替代
  if (validation.caloriesDeviation > 0.10 && swapCount < maxSwaps) {
    const { mealIndex, foodIndex, replacement } = findCalorieSwap(
      meals, allFoods, validation.totalCalories - dailyTarget.calories,
    );
    if (replacement) {
      meals[mealIndex].foods[foodIndex] = replacement;
      swapCount++;
    }
  }

  // 重新计算各餐汇总
  return meals.map(recalculateMealTotals);
}
```

### 4.7 餐食结构模板（修复角色系统）

修复当前 `ROLE_CATEGORIES` 中英文不匹配的致命 bug，统一为英文分类码：

```typescript
/**
 * 餐食角色定义 — 使用英文分类码，与 FoodLibrary.category 字段一致
 */
const MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'side'],
  lunch:     ['carb', 'protein', 'veggie'],
  dinner:    ['protein', 'veggie', 'side'],
  snack:     ['snack1', 'snack2'],
};

/**
 * 角色 → 食物分类映射（英文分类码）
 * ⚠ 关键修复：使用与 FoodLibrary.category 完全一致的英文枚举值
 */
const ROLE_CATEGORIES: Record<string, string[]> = {
  carb:    ['grain'],                          // 主食
  protein: ['protein'],                        // 蛋白质类（肉/蛋/鱼/豆）
  veggie:  ['veggie'],                         // 蔬菜
  side:    ['fruit', 'dairy', 'veggie'],       // 配菜（水果/乳品/蔬菜）
  snack1:  ['fruit', 'dairy', 'fat'],          // 加餐（水果/酸奶/坚果）
  snack2:  ['snack', 'beverage', 'fruit'],     // 加餐（零食/饮品/水果）
};

/**
 * 餐次标签偏好 — 统一使用英文标签
 */
const MEAL_TAG_PREFERENCES: Record<string, { boost: string[]; penalize: string[] }> = {
  breakfast: {
    boost: ['quick_prep', 'high_fiber', 'low_gi', 'whole_food'],
    penalize: ['low_calorie', 'high_protein'],  // 早餐不需要过分追求低卡高蛋白
  },
  lunch: {
    boost: ['high_protein', 'whole_food'],
    penalize: [],
  },
  dinner: {
    boost: ['low_carb', 'high_protein', 'low_gi', 'natural'],
    penalize: ['high_calorie'],
  },
  snack: {
    boost: ['low_calorie', 'natural', 'budget_friendly'],
    penalize: ['high_calorie', 'high_fat'],
  },
};
```

### 4.8 用户建模

#### 4.8.1 用户偏好信号采集

```typescript
/**
 * 用户行为信号类型及其隐式含义
 */
enum FeedbackSignal {
  PLAN_ACCEPTED = 'plan_accepted',       // 查看计划后未操作 → 弱正反馈
  FOOD_COMPLETED = 'food_completed',     // 按推荐进食 → 强正反馈
  FOOD_REPLACED = 'food_replaced',       // 替换了推荐食物 → 负反馈 + 新偏好信号
  FOOD_SKIPPED = 'food_skipped',         // 跳过某食物 → 弱负反馈
  FOOD_FAVORITED = 'food_favorited',     // 收藏食物 → 强正反馈
  MANUAL_RECORD = 'manual_record',       // 手动记录非推荐食物 → 偏好信号
}

interface UserFeedbackRecord {
  userId: string;
  foodId: string;
  signal: FeedbackSignal;
  mealType: string;
  goalType: string;
  timestamp: Date;
  replacedWith?: string;  // 替换场景下的新食物ID
  context?: {
    timeOfDay: number;
    dayOfWeek: number;
    weatherType?: string;
  };
}
```

#### 4.8.2 用户偏好向量（V1 简化版 — 基于统计）

V1 不使用 embedding，而是基于行为统计构建偏好画像：

```typescript
interface UserPreferenceProfile {
  // 分类偏好（归一化得分 0-1）
  categoryPreferences: Record<string, number>;  // { 'protein': 0.8, 'grain': 0.5, ... }

  // 食物组偏好
  foodGroupPreferences: Record<string, number>; // { 'poultry': 0.9, 'fish': 0.6, ... }

  // 标签偏好
  tagPreferences: Record<string, number>;       // { 'high_protein': 0.85, 'low_gi': 0.7, ... }

  // 爱吃/讨厌的食物
  lovedFoods: string[];   // Top 10 高频正反馈食物ID
  avoidedFoods: string[]; // Top 10 高频负反馈食物ID

  // 餐次偏好模式
  mealPatterns: Record<string, {
    preferredCategories: string[];
    avgCalories: number;
    preferredTime: string;
  }>;

  // 更新时间
  lastUpdated: Date;
}

/**
 * 从行为记录中构建偏好画像（定时任务，每日更新）
 */
async function buildUserPreferences(
  userId: string,
  lookbackDays: number = 30,
): Promise<UserPreferenceProfile> {
  const feedbacks = await feedbackRepo.find({
    where: { userId, timestamp: MoreThan(daysAgo(lookbackDays)) },
  });

  // 时间衰减加权：最近的反馈权重更高
  const weighted = feedbacks.map(f => ({
    ...f,
    weight: Math.exp(-0.05 * daysSince(f.timestamp)), // 半衰期约14天
  }));

  // 统计各分类的正/负信号加权和
  const categoryScores = computeCategoryScores(weighted);
  const foodGroupScores = computeFoodGroupScores(weighted);
  const tagScores = computeTagScores(weighted);

  return {
    categoryPreferences: normalize(categoryScores),
    foodGroupPreferences: normalize(foodGroupScores),
    tagPreferences: normalize(tagScores),
    lovedFoods: extractTopFoods(weighted, 'positive', 10),
    avoidedFoods: extractTopFoods(weighted, 'negative', 10),
    mealPatterns: extractMealPatterns(weighted),
    lastUpdated: new Date(),
  };
}
```

#### 4.8.3 偏好应用到评分

```typescript
function applyUserPreferences(
  score: number,
  food: FoodLibrary,
  prefs: UserPreferenceProfile,
): number {
  let adjusted = score;

  // 分类偏好（±15%）
  const catPref = prefs.categoryPreferences[food.category] ?? 0.5;
  adjusted *= (0.85 + 0.30 * catPref);  // [0.85, 1.15]

  // 食物组偏好（±10%）
  if (food.foodGroup) {
    const groupPref = prefs.foodGroupPreferences[food.foodGroup] ?? 0.5;
    adjusted *= (0.90 + 0.20 * groupPref);
  }

  // 爱吃的食物强 boost
  if (prefs.lovedFoods.includes(food.id)) adjusted *= 1.20;

  // 讨厌的食物强 penalize
  if (prefs.avoidedFoods.includes(food.id)) adjusted *= 0.25;

  return adjusted;
}
```

---

## 五、全球化能力增强

### 5.1 Region-Aware Scoring（地区感知评分）

不同饮食文化对"好食物"的定义不同。引入**地区评分偏移**：

```typescript
/**
 * 地区文化配置
 * 影响评分权重、餐食结构、标签偏好
 */
interface RegionalConfig {
  region: string;          // CN / US / JP / KR / IN / EU
  mealStructure: {
    meals: string[];       // 餐次名称
    ratios: number[];      // 热量分配比例
  };
  scoringAdjustments: Partial<WeightVector>;  // 权重偏移
  culturalTags: {
    boost: string[];       // 文化偏好标签
    penalize: string[];    // 文化不适标签
  };
  portionScale: number;    // 份量系数（相对于默认）
}

const REGIONAL_CONFIGS: Record<string, RegionalConfig> = {
  CN: {
    region: 'CN',
    mealStructure: {
      meals: ['breakfast', 'lunch', 'dinner', 'snack'],
      ratios: [0.25, 0.35, 0.30, 0.10],
    },
    scoringAdjustments: {
      macroBalance: +0.05,  // 中餐重视荤素搭配
      satiety: +0.03,
    },
    culturalTags: {
      boost: ['chinese_cuisine', 'stir_fry', 'steamed', 'congee'],
      penalize: [],
    },
    portionScale: 1.0,
  },
  JP: {
    region: 'JP',
    mealStructure: {
      meals: ['breakfast', 'lunch', 'dinner', 'snack'],
      ratios: [0.20, 0.35, 0.35, 0.10],  // 日本晚餐占比更高
    },
    scoringAdjustments: {
      quality: +0.05,             // 日本强调食材品质
      micronutrientDensity: +0.03,
      inflammationIndex: +0.03,   // 日餐富含 Omega-3
    },
    culturalTags: {
      boost: ['japanese_cuisine', 'sashimi', 'miso', 'fermented'],
      penalize: [],
    },
    portionScale: 0.85,  // 日本份量普遍较小
  },
  US: {
    region: 'US',
    mealStructure: {
      meals: ['breakfast', 'lunch', 'dinner', 'snack'],
      ratios: [0.25, 0.30, 0.35, 0.10],
    },
    scoringAdjustments: {
      processingPenalty: +0.05,   // 美式饮食需更强调加工度控制
      energy: +0.03,
    },
    culturalTags: {
      boost: ['american_cuisine', 'salad', 'grilled', 'smoothie'],
      penalize: [],
    },
    portionScale: 1.15,  // 美式份量较大
  },
  IN: {
    region: 'IN',
    mealStructure: {
      meals: ['breakfast', 'lunch', 'dinner', 'snack'],
      ratios: [0.20, 0.35, 0.35, 0.10],
    },
    scoringAdjustments: {
      macroBalance: +0.03,
      quality: +0.03,
    },
    culturalTags: {
      boost: ['indian_cuisine', 'vegetarian', 'spiced', 'lentil', 'curry'],
      penalize: [],
    },
    portionScale: 1.0,
  },
};
```

### 5.2 食物替代系统

当某地区不常见某食物时，需要提供营养等价替代：

```typescript
/**
 * 食物替代候选查找
 * 基于：同分类 + 营养素相似 + 本地可获得
 */
async function findRegionalSubstitutes(
  food: FoodLibrary,
  targetRegion: string,
  limit: number = 5,
): Promise<FoodLibrary[]> {
  // 查找同分类、同地区可得、营养相近的食物
  const candidates = await foodRepo.find({
    where: {
      category: food.category,
      subCategory: food.subCategory,
      status: 'active',
    },
    relations: ['regionalInfo'],
  });

  return candidates
    .filter(c => {
      // 必须在目标地区可获得
      const regionInfo = c.regionalInfo?.find(r => r.region === targetRegion);
      return regionInfo && regionInfo.availability !== 'rare';
    })
    .map(c => ({
      food: c,
      nutritionSimilarity: computeNutritionSimilarity(food, c),
      popularity: c.regionalInfo?.find(r => r.region === targetRegion)?.localPopularity || 0,
    }))
    .filter(c => c.nutritionSimilarity > 0.7) // 营养相似度阈值
    .sort((a, b) => b.nutritionSimilarity * 0.6 + b.popularity * 0.4
                   - (a.nutritionSimilarity * 0.6 + a.popularity * 0.4))
    .slice(0, limit)
    .map(c => c.food);
}

/**
 * 营养素相似度 — 余弦相似度
 */
function computeNutritionSimilarity(a: FoodLibrary, b: FoodLibrary): number {
  const vecA = [a.caloriesPer100g/100, a.proteinPer100g||0, a.fatPer100g||0, a.carbsPer100g||0, a.fiberPer100g||0];
  const vecB = [b.caloriesPer100g/100, b.proteinPer100g||0, b.fatPer100g||0, b.carbsPer100g||0, b.fiberPer100g||0];

  const dotProduct = vecA.reduce((s, v, i) => s + v * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((s, v) => s + v * v, 0));
  const normB = Math.sqrt(vecB.reduce((s, v) => s + v * v, 0));

  return normA > 0 && normB > 0 ? dotProduct / (normA * normB) : 0;
}
```

### 5.3 文化偏好建模

```typescript
/**
 * 在推荐pipeline中应用地区偏好
 */
function applyRegionalPreferences(
  score: number,
  food: FoodLibrary,
  config: RegionalConfig,
): number {
  const foodTags = food.tags || [];

  // 文化匹配奖励
  const culturalHits = config.culturalTags.boost.filter(t => foodTags.includes(t)).length;
  score *= (1 + culturalHits * 0.05); // 每命中一个文化标签 +5%

  // 文化不适惩罚
  const culturalMiss = config.culturalTags.penalize.filter(t => foodTags.includes(t)).length;
  score *= (1 - culturalMiss * 0.10);

  // 地区流行度奖励
  const regionInfo = food.regionalInfo?.find(r => r.region === config.region);
  if (regionInfo?.localPopularity) {
    score *= (1 + Math.min(0.1, regionInfo.localPopularity / 1000));
  }

  return score;
}
```

---

## 六、数据与工程落地方案

### 6.1 数据结构升级

基于全球化食物数据库设计方案的 Schema，需要额外增加以下字段支持新评分维度：

#### 6.1.1 foods 表新增字段

```sql
-- 炎症相关（V2阶段添加）
ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS omega3       DECIMAL(5,2),  -- Omega-3 g/100g
  ADD COLUMN IF NOT EXISTS omega6       DECIMAL(5,2),  -- Omega-6 g/100g
  ADD COLUMN IF NOT EXISTS anti_inflammatory BOOLEAN DEFAULT false; -- 抗炎食物标记

-- 探索系统（V2阶段添加）
ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS global_accept_rate DECIMAL(3,2) DEFAULT 0.5, -- 全局接受率
  ADD COLUMN IF NOT EXISTS recommend_count    INT DEFAULT 0;             -- 被推荐次数
```

#### 6.1.2 用户偏好表（新增）

```sql
CREATE TABLE user_food_preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 统计偏好（定时任务更新）
  category_prefs    JSONB DEFAULT '{}',   -- {"protein": 0.8, "grain": 0.5}
  food_group_prefs  JSONB DEFAULT '{}',
  tag_prefs         JSONB DEFAULT '{}',
  loved_food_ids    JSONB DEFAULT '[]',   -- Top 10 食物ID
  avoided_food_ids  JSONB DEFAULT '[]',
  meal_patterns     JSONB DEFAULT '{}',

  -- V2: embedding 向量
  preference_vector VECTOR(64),           -- pgvector 类型，64维

  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id)
);
```

#### 6.1.3 探索状态表（新增）

```sql
CREATE TABLE food_exploration_states (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  food_id     UUID NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  alpha       DECIMAL(6,1) DEFAULT 1,  -- 成功次数 + 先验
  beta        DECIMAL(6,1) DEFAULT 1,  -- 失败次数 + 先验
  last_recommended_at TIMESTAMP,
  last_feedback_at    TIMESTAMP,

  UNIQUE(user_id, food_id)
);

CREATE INDEX idx_exploration_user ON food_exploration_states(user_id);
```

#### 6.1.4 反馈记录表升级

```sql
-- 扩展现有 recommendation_feedbacks 表
ALTER TABLE recommendation_feedbacks
  ADD COLUMN IF NOT EXISTS signal_type       VARCHAR(30),   -- plan_accepted/food_completed/food_replaced/food_skipped/food_favorited
  ADD COLUMN IF NOT EXISTS replaced_with_id  UUID,          -- 替换场景下的新食物ID
  ADD COLUMN IF NOT EXISTS context           JSONB;         -- 时间/地点/天气等上下文
```

### 6.2 Food Embedding 构建方案

#### 6.2.1 V1: 基于营养特征的手工 Embedding（可立即实现）

```typescript
/**
 * 64维食物特征向量 — 手工构建，无需ML训练
 *
 * 维度分配：
 *   [0-5]   宏量营养素归一化 (calories, protein, fat, carbs, fiber, sugar)
 *   [6-17]  微量营养素归一化 (12种)
 *   [18-22] 健康指标 (GI, GL, NOVA, quality, satiety)
 *   [23-32] 分类 one-hot (10类)
 *   [33-34] 二元标志 (isProcessed, isFried)
 *   [35-44] 标签 multi-hot (Top 10 标签)
 *   [45-54] 口味/烹饪 (预留)
 *   [55-63] 文化/地区 (预留)
 */
function buildFoodEmbedding(food: FoodLibrary): number[] {
  const vec = new Array(64).fill(0);

  // 宏量营养素（per 100g, 归一化到 [0,1]）
  vec[0] = Math.min(1, food.caloriesPer100g / 500);
  vec[1] = Math.min(1, (food.proteinPer100g || 0) / 50);
  vec[2] = Math.min(1, (food.fatPer100g || 0) / 50);
  vec[3] = Math.min(1, (food.carbsPer100g || 0) / 80);
  vec[4] = Math.min(1, (food.fiberPer100g || 0) / 15);
  vec[5] = Math.min(1, (food.sugarPer100g || 0) / 30);

  // 微量营养素（归一化到 [0,1] 基于 DV）
  vec[6]  = Math.min(1, (food.sodium || 0) / 2300);
  vec[7]  = Math.min(1, (food.potassium || 0) / 4700);
  vec[8]  = Math.min(1, (food.calcium || 0) / 1300);
  vec[9]  = Math.min(1, (food.iron || 0) / 18);
  vec[10] = Math.min(1, (food.vitaminA || 0) / 900);
  vec[11] = Math.min(1, (food.vitaminC || 0) / 90);
  vec[12] = Math.min(1, (food.vitaminD || 0) / 20);
  vec[13] = Math.min(1, (food.vitaminE || 0) / 15);
  vec[14] = Math.min(1, (food.vitaminB12 || 0) / 2.4);
  vec[15] = Math.min(1, (food.folate || 0) / 400);
  vec[16] = Math.min(1, (food.zinc || 0) / 11);
  vec[17] = Math.min(1, (food.magnesium || 0) / 420);

  // 健康指标
  vec[18] = Math.min(1, (food.glycemicIndex || 50) / 100);
  vec[19] = Math.min(1, (food.glycemicLoad || 10) / 30);
  vec[20] = (food.processingLevel || 1) / 4;
  vec[21] = (food.qualityScore || 5) / 10;
  vec[22] = (food.satietyScore || 5) / 10;

  // 分类 one-hot
  const categories = ['protein','grain','veggie','fruit','dairy','fat','beverage','snack','condiment','composite'];
  const catIdx = categories.indexOf(food.category);
  if (catIdx >= 0) vec[23 + catIdx] = 1;

  // 二元标志
  vec[33] = food.isProcessed ? 1 : 0;
  vec[34] = food.isFried ? 1 : 0;

  // 标签 multi-hot（选取全局Top10高频标签）
  const topTags = ['high_protein','low_fat','low_carb','high_fiber','low_calorie',
                   'low_gi','natural','quick_prep','vegan','gluten_free'];
  const foodTags = food.tags || [];
  topTags.forEach((tag, i) => {
    vec[35 + i] = foodTags.includes(tag) ? 1 : 0;
  });

  return vec;
}
```

#### 6.2.2 V2: 基于 LLM 的语义 Embedding

V2 阶段使用 LLM（如 text-embedding-3-small）生成语义 embedding：

```typescript
/**
 * V2: 将食物的多维信息编码为自然语言描述，通过 embedding API 获取向量
 */
async function buildSemanticEmbedding(food: FoodLibrary): Promise<number[]> {
  const description = [
    `Food: ${food.name}`,
    `Category: ${food.category} / ${food.subCategory}`,
    `Nutrition per 100g: ${food.caloriesPer100g}kcal, ${food.proteinPer100g}g protein, ${food.fatPer100g}g fat, ${food.carbsPer100g}g carbs`,
    `Properties: ${food.tags?.join(', ')}`,
    `Quality: ${food.qualityScore}/10, Satiety: ${food.satietyScore}/10`,
    `Processing: NOVA-${food.processingLevel}`,
  ].join('. ');

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: description,
    dimensions: 64, // 降维到64
  });

  return response.data[0].embedding;
}
```

### 6.3 推荐系统计算流程 Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     每日计划生成 Pipeline                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Phase 0: 数据准备（1次查询）                                       │   │
│  │                                                                    │   │
│  │  ① 获取用户档案 + 行为画像 + 偏好向量                              │   │
│  │  ② 获取全部活跃食物（foods WHERE status='active'）→ 缓存             │   │
│  │  ③ 获取最近5天吃过的食物名                                         │   │
│  │  ④ 获取探索状态（food_exploration_states）                         │   │
│  │  ⑤ 计算每日营养目标 + 动态权重                                     │   │
│  │  ⑥ 确定地区配置                                                   │   │
│  │                                                                    │   │
│  │  数据库查询: 6次 → Redis缓存后 ≈ 2次（foods + recentFoods）        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Phase 1: 串行生成4餐（每餐 Recall → Rank → Re-rank）              │   │
│  │                                                                    │   │
│  │  for meal in [breakfast, lunch, dinner, snack]:                    │   │
│  │    ① Recall: hardFilter(allergens, restrictions, excludeNames)     │   │
│  │             + softTagRecall(mealTags, roleCategories)              │   │
│  │             → 候选集 ~50-100 个                                    │   │
│  │                                                                    │   │
│  │    ② Rank:  10维评分(动态权重) × 惩罚 × 用户偏好 × 相似度惩罚      │   │
│  │             → 排序后 Top30                                         │   │
│  │                                                                    │   │
│  │    ③ Re-rank: 角色模板选择（逐角色从候选中选最优）                   │   │
│  │              + 多样性函数（短期+长期）                               │   │
│  │              + 探索策略（Thompson Sampling / tieredExploration）    │   │
│  │              + 份量优化（optimizePortions）                         │   │
│  │              → 本餐 2-3 个食物                                     │   │
│  │                                                                    │   │
│  │    ④ 更新状态: excludeNames += 本餐食物名                          │   │
│  │               consumed += 本餐营养汇总                              │   │
│  │               selectedFoodsAllMeals += 本餐食物                     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Phase 2: 全局校准                                                  │   │
│  │                                                                    │   │
│  │  ① 验证4餐总营养 vs 每日目标                                       │   │
│  │  ② 如偏差超阈值，执行最多2次食物替换                                │   │
│  │  ③ 重新计算各餐汇总                                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                               ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Phase 3: 输出 + 持久化                                             │   │
│  │                                                                    │   │
│  │  ① 生成每餐 displayText + tip                                     │   │
│  │  ② 存储 daily_plans                                               │   │
│  │  ③ 异步更新推荐次数（foods.recommend_count++）                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  总计算时间（预估）: < 100ms（纯CPU，无外部调用）                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.4 缓存与存储架构

```
┌─────────────────────────────────────────────────────────┐
│                    存储架构                                │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  PostgreSQL (主存储 — 现有)                                │
│  ├── foods + food_translations + food_sources            │
│  ├── food_regional_info + food_change_logs              │
│  ├── users + user_profiles + user_food_preferences      │
│  ├── food_records + daily_summaries + daily_plans        │
│  ├── recommendation_feedbacks (扩展)                     │
│  ├── food_exploration_states (新增)                      │
│  └── pgvector extension (V2: 向量检索)                   │
│                                                         │
│  Redis (缓存 — 建议新增)                                  │
│  ├── food:active:all     → 全部活跃食物 (TTL: 1h)        │
│  ├── food:features:{id}  → 食物特征向量 (TTL: 6h)        │
│  ├── user:prefs:{userId} → 用户偏好画像 (TTL: 24h)       │
│  ├── user:recent:{userId}→ 最近吃过的食物 (TTL: 1h)      │
│  └── explore:{userId}    → 探索状态缓存 (TTL: 24h)       │
│                                                         │
│  V3阶段（可选）:                                          │
│  ├── pgvector (PostgreSQL扩展) — 向量相似度搜索           │
│  └── 或 Milvus/Qdrant — 独立向量数据库                    │
│                                                         │
│  说明:                                                   │
│  - V1不需要Redis，直接内存缓存（食物库<5000条）            │
│  - V2引入Redis提高多实例性能                              │
│  - V3根据数据量决定是否引入独立向量数据库                   │
└─────────────────────────────────────────────────────────┘
```

### 6.5 V1 工程落地（最小改动清单）

**不引入新基础设施**，仅在现有 NestJS + PostgreSQL 上实现：

| # | 文件 | 改动类型 | 内容 | 优先级 |
|---|------|---------|------|:------:|
| 1 | `recommendation-engine.service.ts` | **修复** | `ROLE_CATEGORIES` 中文→英文 | P0 |
| 2 | `recommendation-engine.service.ts` | **修复** | `MEAL_PREFERENCES` 中文标签→英文标签 | P0 |
| 3 | `recommendation-engine.service.ts` | **重写** | `scoreFood()` → 10维非线性评分 | P0 |
| 4 | `recommendation-engine.service.ts` | **新增** | `computeFinalWeights()` 动态权重系统 | P1 |
| 5 | `recommendation-engine.service.ts` | **新增** | `PenaltyEngine` 硬约束惩罚 | P1 |
| 6 | `recommendation-engine.service.ts` | **升级** | `diversifyWithPenalty()` → `diversityScore()` 长短期多样性 | P1 |
| 7 | `recommendation-engine.service.ts` | **升级** | `addExploration()` → `tieredExploration()` 分层探索 | P1 |
| 8 | `recommendation-engine.service.ts` | **新增** | `optimizePortions()` 约束式份量优化 | P2 |
| 9 | `daily-plan.service.ts` | **新增** | `globalCalibration()` 全局校准 | P2 |
| 10 | `nutrition-score.service.ts` | **重写** | 10维评分替代6维 | P1 |
| 11 | Migration | **新增** | `user_food_preferences` 表 | P2 |
| 12 | Migration | **新增** | `food_exploration_states` 表 | P2 |

---

## 七、三阶段演进路线

### V1: 规则优化版（当前 → 2-3周）

**目标**：修复致命Bug + 评分升级 + 多样性改善

```
V1 范围:
  ✅ 修复 ROLE_CATEGORIES 中英文不匹配
  ✅ 修复 MEAL_PREFERENCES 标签语言
  ✅ 10维非线性评分（钟形/sigmoid/阶梯/NRF9.3）
  ✅ 动态权重（基础×状态×餐次）
  ✅ 惩罚引擎（硬约束）
  ✅ 分层探索（tieredExploration）
  ✅ 长短期多样性函数
  ✅ 约束式份量优化
  ✅ 全局校准
  ✅ 地区配置框架（中国区先行）

  不做:
  ✗ 用户偏好向量
  ✗ Food Embedding
  ✗ Thompson Sampling（需要反馈数据积累）
  ✗ Redis 缓存
  ✗ 向量数据库

  技术栈: NestJS + PostgreSQL（不变）
  预估开发量: 2-3周，1-2人
```

### V2: 半智能版（V1完成后 → 4-6周）

**目标**：引入用户建模 + 食物向量 + 反馈闭环

```
V2 范围:
  ✅ 用户偏好画像（基于行为统计）
  ✅ 偏好应用到评分（分类/标签/食物级别）
  ✅ 反馈信号采集（5种信号）
  ✅ 手工 Food Embedding (64维)
  ✅ 基于向量的相似食物推荐（pgvector）
  ✅ Thompson Sampling 探索（替代 tieredExploration）
  ✅ 食物替代推荐（跨地区）
  ✅ Redis 缓存层
  ✅ 多语言食物数据（food_translations）
  ✅ 全球化数据 Pipeline（USDA + OpenFoodFacts 接入）

  技术栈: NestJS + PostgreSQL + pgvector + Redis
  预估开发量: 4-6周，2人
```

### V3: AI驱动版（V2稳定后 → 8-12周）

**目标**：引入 ML/RL + LLM 能力

```
V3 范围:
  ✅ 语义 Embedding（LLM生成，替代手工向量）
  ✅ Collaborative Filtering（基于用户-食物交互矩阵）
  ✅ 在线学习（权重实时更新，无需全量重训）
  ✅ LLM 对话式推荐（"我想吃清淡的"→ 向量检索 + 重排）
  ✅ 个性化权重学习（从固定权重 → 用户级别学到的权重）
  ✅ 季节性/天气感知推荐
  ✅ A/B 测试框架（新旧推荐策略对比）
  ✅ 独立向量数据库（如数据量超10万）

  技术栈: NestJS + PostgreSQL + pgvector/Qdrant + Redis + Python ML Service (可选)
  预估开发量: 8-12周，2-3人

  关键架构决策:
  - ML 模型在线推理走 Python 微服务（FastAPI），通过 HTTP 与 NestJS 通信
  - 或在 NestJS 中使用 ONNX Runtime 直接推理（避免多语言维护）
  - LLM 调用走现有 OpenRouter 通道
```

### 演进关系图

```
V1 (规则优化)                V2 (半智能)                   V3 (AI驱动)
┌─────────────┐         ┌─────────────────┐          ┌──────────────────┐
│ 10维非线性评分 │───────▶│ + 用户偏好画像    │────────▶│ + 个性化权重学习  │
│ 动态权重      │         │ + 手工Embedding   │          │ + 语义Embedding   │
│ 惩罚引擎      │         │ + Thompson Sampl  │          │ + Collab Filter   │
│ 分层探索      │         │ + 反馈闭环        │          │ + 在线学习        │
│ 多样性函数    │         │ + pgvector        │          │ + LLM推荐对话     │
│ 全局校准      │         │ + Redis           │          │ + A/B测试         │
│ 角色模板修复  │         │ + 全球化Pipeline   │          │ + 季节性感知      │
└─────────────┘         └─────────────────┘          └──────────────────┘
     2-3周                    4-6周                       8-12周

  每阶段独立可用，后一阶段在前一阶段基础上增量构建
  V1 完成即可上线，显著改善推荐质量
```

---

## 附录 A: 当前代码关键修复项

### A.1 ROLE_CATEGORIES 修复

```typescript
// ❌ 当前（失效）
const ROLE_CATEGORIES = {
  carb:    ['主食'],
  protein: ['肉类', '豆制品'],
  veggie:  ['蔬菜'],
  // ...
};

// ✅ 修复后
const ROLE_CATEGORIES: Record<string, string[]> = {
  carb:    ['grain'],
  protein: ['protein'],
  veggie:  ['veggie'],
  side:    ['fruit', 'dairy', 'veggie'],
  snack1:  ['fruit', 'dairy', 'fat'],
  snack2:  ['snack', 'beverage', 'fruit'],
};
```

### A.2 MEAL_PREFERENCES 修复

```typescript
// ❌ 当前（中文标签）
const MEAL_PREFERENCES = {
  breakfast: { includeTags: ['早餐', '高碳水', '易消化'], ... },
  // ...
};

// ✅ 修复后（英文标签，与 food.tags 一致）
const MEAL_PREFERENCES: Record<string, { boost: string[]; penalize: string[] }> = {
  breakfast: {
    boost: ['quick_prep', 'high_fiber', 'low_gi', 'whole_food'],
    penalize: ['high_calorie'],
  },
  lunch: {
    boost: ['high_protein', 'whole_food', 'high_fiber'],
    penalize: [],
  },
  dinner: {
    boost: ['low_carb', 'high_protein', 'low_gi', 'natural'],
    penalize: ['high_calorie'],
  },
  snack: {
    boost: ['low_calorie', 'natural'],
    penalize: ['high_calorie', 'high_fat'],
  },
};
```

---

## 附录 B: 评分公式速查表

| 维度 | 函数类型 | 公式 | 参数 |
|------|---------|------|------|
| 热量 | 高斯钟形 | $100 \cdot e^{-\frac{(x-\mu)^2}{2\sigma^2}}$ | μ=目标, σ=12-25%·目标 |
| 蛋白质 | 分段线性 | 不足区线性↑ / 达标区100 / 超标区缓降 | 区间按目标类型 |
| 宏量平衡 | 复合区间 | (碳水区间分 + 脂肪区间分) / 2 | 碳水40-55%, 脂肪20-30% |
| 品质 | 对数映射 | $100 \cdot \frac{\ln(q+1)}{\ln(11)}$ | q∈[1,10] |
| 饱腹感 | 对数映射 | $100 \cdot \frac{\ln(s+1)}{\ln(11)}$ | s∈[1,10] |
| 血糖影响 | Sigmoid | $\frac{100}{1 + e^{0.3(GL-15)}}$ | GL=GI×carbs/100 |
| 加工度 | 阶梯 | NOVA→{100,85,55,20} | NOVA 1-4 |
| 微量营养 | NRF 9.3 | 9种鼓励 - 3种限制 | per 100kcal 标准化 |
| 炎症指数 | 线性组合 | 80 - transFat惩罚 - satFat惩罚 + fiber奖励 | — |
| 稳定性 | 分段线性 | (连胜分 + 餐次规律分) / 2 | 7天50分, 30天满分 |

---

## 附录 C: 数据库 Migration 执行顺序

```
1750000001 — AddNutritionDimensions (已有设计)
1750000002 — AddUserFoodPreferences (新增)
1750000003 — AddFoodExplorationStates (新增)
1750000004 — ExtendRecommendationFeedbacks (扩展)
1750000005 — AddFoodInflammationFields (V2)
1750000006 — EnablePgvector (V2)
1750000007 — AddPreferenceVector (V2)
```
