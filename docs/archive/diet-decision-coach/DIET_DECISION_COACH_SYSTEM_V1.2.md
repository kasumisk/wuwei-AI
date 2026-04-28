# 饮食决策 + AI教练系统 V1.2 设计文档

## 版本信息

| 项目 | 说明                                         |
| ---- | -------------------------------------------- |
| 版本 | V1.2                                         |
| 基线 | V1.1（sim_score匹配 + 推荐引擎替代 + i18n）  |
| 目标 | 决策精度提升 + 宏量问题识别 + 教练上下文深化 |
| 约束 | 不修改推荐/画像/商业化系统、不增加数据库字段 |

---

## Step 1：现有能力分析与缺失点

### 已具备的能力

| 层级   | 能力                                                                | 状态        |
| ------ | ------------------------------------------------------------------- | ----------- |
| 分析层 | 食物识别（标准库 + LLM）                                            | ✅ 成熟     |
| 分析层 | 营养数据（cal/pro/fat/carb/fiber/sodium + V6.3扩展）                | ✅ 有数据   |
| 分析层 | 7维评分引擎（能量/蛋白比/宏量均衡/食物质量/饱腹感/稳定性/血糖影响） | ✅ 成熟     |
| 分析层 | 用户上下文（今日摄入 macro + 目标 macro）                           | ✅ 有数据   |
| 决策层 | 评分→三档决策（recommend/caution/avoid）                            | ✅ 基础     |
| 决策层 | 时间感知（宵夜惩罚、晚餐碳水）                                      | ✅ 部分     |
| 决策层 | 热量超标检测                                                        | ✅ 有       |
| 决策层 | 蛋白质不足检测（仅 fat_loss）                                       | ✅ 部分     |
| 决策层 | 推荐引擎驱动替代方案                                                | ✅ V1.1新增 |
| 教练层 | 多语言系统 prompt                                                   | ✅ V1.1新增 |
| 教练层 | 行为画像风格（strict/friendly/data）                                | ✅ 有       |
| 教练层 | 7天模式分析                                                         | ✅ 有       |

### 关键缺失点

| 层级       | 缺失                                             | 影响                                        | 优先级 |
| ---------- | ------------------------------------------------ | ------------------------------------------- | ------ |
| **分析层** | `NutritionTotals` 不汇总 saturatedFat/addedSugar | 无法检测脂肪质量和糖超标                    | P1     |
| **分析层** | `buildFromLibraryMatch()` 不提取扩展营养字段     | 标准库食物丢失 saturatedFat/addedSugar 数据 | P1     |
| **决策层** | 无脂肪超标检测                                   | fat_loss 用户吃高脂食物无警告               | P1     |
| **决策层** | 无碳水超标检测（仅晚餐有）                       | 全天碳水目标无控制                          | P1     |
| **决策层** | 无添加糖/饱和脂肪警告                            | 健康风险食物无提示                          | P2     |
| **决策层** | 无饮食限制/过敏原检查                            | 过敏用户无安全提示                          | P2     |
| **决策层** | 无健康状况感知（糖尿病/高血压）                  | 高危用户无定向警告                          | P2     |
| **决策层** | goalFat/goalCarbs 有计算但不用于决策             | 宏量目标形同虚设                            | P1     |
| **教练层** | prompt 不含今日 macro 摄入 vs 目标               | 教练不知蛋白/脂肪/碳水进度                  | P1     |
| **教练层** | prompt 不含饮食限制/过敏原/健康状况              | 教练可能推荐违禁食物                        | P2     |
| **教练层** | prompt 不含用户目标聚焦指令                      | 回答不够针对性                              | P1     |
| **教练层** | analysisContext 不传 macro 详情                  | 教练点评缺乏营养维度                        | P1     |
| **教练层** | weakMealType/topExcessCategory 不在 prompt       | 浪费行为画像数据                            | P2     |
| **分析层** | 静态替代的宵夜推荐仍硬编码中文                   | i18n 不完整                                 | P1     |

---

## Step 2：饮食分析系统增强设计

### (1) 单次饮食分析增强

**当前**: `NutritionTotals` 只汇总 calories/protein/fat/carbs/fiber/sodium

**V1.2**: 扩展汇总维度

```typescript
// NutritionTotals 扩展（analysis-result.types.ts）
interface NutritionTotals {
  // 现有
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber?: number;
  sodium?: number;
  // V1.2 新增
  saturatedFat?: number;
  addedSugar?: number;
}
```

**修改点**:

- `calculateTotals()`: 汇总 saturatedFat + addedSugar
- `buildFromLibraryMatch()`: 从 FoodLibrary 提取 saturatedFat/addedSugar（如有）

### (2) 上下文分析增强

**当前**: `buildUserContext()` 已返回 todayProtein/todayFat/todayCarbs + 目标值

**V1.2**: 利用已有数据计算宏量进度比例，供决策使用

```typescript
// computeDecision 中新增检查
macroProgress = {
  proteinPct: todayProtein / goalProtein,
  fatPct: todayFat / goalFat,
  carbsPct: todayCarbs / goalCarbs,
};
```

### (3) 问题识别增强

**当前**: 只检测 — 热量超标、蛋白质不足(fat_loss)、晚餐碳水高(fat_loss)、宵夜高热量

**V1.2 新增检测**:

| 检测项           | 条件                                           | 适用目标         |
| ---------------- | ---------------------------------------------- | ---------------- |
| 脂肪超标         | 本餐脂肪 > 30g 且 今日脂肪进度 > 80%           | fat_loss, health |
| 碳水超标         | 今日碳水进度+本餐 > 110% 目标                  | fat_loss         |
| 蛋白不足(全目标) | 本餐蛋白 < 10g 且 今日蛋白进度 < 50%（午餐后） | 全部             |
| 过敏原命中       | 食物 category/name 含用户 allergens            | 全部             |
| 饮食限制冲突     | 素食者吃肉类 / 清真吃猪肉等                    | 全部             |
| 健康状况警告     | 高血压+高钠 / 糖尿病+高糖                      | 全部             |

---

## Step 3：决策系统增强设计

### (1) 是否建议吃 — 增强

**保持现有**: 7维评分 → scoreToFoodDecision → 三档

**增强**: `computeDecision()` 新增上下文检查项

```
现有检查:
  ✅ 宵夜高热量 → 降级
  ✅ 晚餐碳水(fat_loss)
  ✅ 热量超标
  ✅ 蛋白不足(fat_loss)
  ✅ 蛋白充足(muscle_gain)
  ✅ 单餐占比过高

V1.2 新增:
  🆕 脂肪超标检测
  🆕 碳水目标超限检测
  🆕 全目标蛋白检测（午餐后）
  🆕 过敏原 / 饮食限制 → 强制 avoid
  🆕 健康状况感知（高血压高钠 / 糖尿病高糖）
```

### (2) 原因解释增强

**当前**: `contextReasons` 数组拼接

**V1.2**: 结构化问题识别，每个 reason 带类型标签

```typescript
// 问题分类（内部使用，不改接口）
type IssueType = 'calorie' | 'protein' | 'fat' | 'carbs' | 'time' | 'safety' | 'health';
```

reason 优先级: safety(过敏) > health(疾病) > calorie > protein/fat/carbs > time

### (3) 替代方案增强

**当前**: 推荐引擎 → 静态规则 fallback

**V1.2**: 静态规则中的硬编码中文改为 i18n，宵夜替代也用 `t()`

### (4) 动态决策（同一食物不同结论）

**已有**: 时间感知（宵夜/晚餐/早餐）
**V1.2 增强**: 宏量进度感知 — 同样的鸡胸肉，蛋白已达标时 vs 不足时结论不同

---

## Step 4：AI教练系统增强设计

### (1) 对话式引导 — prompt 增强

**`buildSystemPrompt()` 新增注入**:

```
【今日营养进度】
- 蛋白质: 45g / 目标 120g (37.5%)
- 脂肪: 50g / 目标 65g (76.9%)
- 碳水: 200g / 目标 275g (72.7%)
```

```
【用户饮食限制】
- 过敏原: 花生、虾
- 饮食偏好: 无乳糖
- 健康状况: 无
```

```
【目标聚焦】
用户目标: 减脂
优先关注: 热量不超标 + 蛋白质充足
```

```
【行为洞察】
- 薄弱餐次: 晚餐（容易超标）
- 最常超标品类: 碳水
```

### (2) 建议结构化

**已有**: `buildSystemPrompt()` 包含 4步结构（结论/原因/建议/替代）

**V1.2 增强**: `prepareContext.analysisContext` 扩展传入 macro 详情

```typescript
analysisContext: {
  foods: Array<{ name, calories, protein, fat, carbs }>,  // 新增 macro
  totalCalories, totalProtein, totalFat, totalCarbs,       // 新增 macro totals
  decision, riskLevel, nutritionScore, advice, mealType,   // 现有
}
```

### (3) 个性化语气

**已有**: strict/friendly/data 三风格 via PERSONA_PROMPTS

**V1.2 增强**: 在目标聚焦中注入风格化指令

- fat_loss → "重点控制热量，多提醒蛋白质"
- muscle_gain → "鼓励高蛋白，不过度限制热量"
- health → "均衡建议，关注食物质量"

### (4) 行为引导

**V1.2**: weakMealType + topExcessCategory 注入 prompt，让 LLM 能主动提醒

---

## Step 5：决策链路设计

```
用户输入（想吃什么）
  │
  ▼
┌─────────────────────────────┐
│  Step 1: 食物识别 + 营养解析   │  ← 标准库 / LLM
│  输出: foods[] + totals        │  ← V1.2: totals 含 saturatedFat/addedSugar
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Step 2: 用户上下文构建        │  ← 今日摄入 + 目标 + 画像
│  输出: ctx (macro进度/限制)    │  ← V1.2: 新增 allergens/restrictions/conditions
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Step 3: 7维评分              │  ← NutritionScoreService (只读)
│  输出: score + breakdown      │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Step 4: 决策判断              │
│  - 评分 → 三档基础决策         │
│  - 上下文检查（V1.2增强）       │  ← 脂肪/碳水/安全/健康
│  - 问题识别 + 原因解释         │
│  - 行动建议生成               │
│  输出: FoodDecision            │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Step 5: 替代方案              │
│  - 推荐引擎（个性化）          │  ← SubstitutionService (只读)
│  - 静态规则 fallback           │  ← V1.2: i18n 完善
│  输出: alternatives[]          │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Step 6: AI教练输出            │
│  - 注入 macro 进度 + 限制      │  ← V1.2 增强
│  - 注入行为洞察               │
│  - 目标聚焦指令               │
│  输出: 结构化对话回复           │
└─────────────────────────────┘
```

---

## Step 6：API 能力设计

| 能力     | 现有 API                            | V1.2 变化                               |
| -------- | ----------------------------------- | --------------------------------------- |
| 饮食分析 | `POST /api/app/food/analyze-text`   | 增强: totals 含扩展字段、决策含更多检测 |
| 决策判断 | 内嵌于 analyze-text 流程            | 增强: 新增检测项（无新 API）            |
| AI教练   | `POST /api/app/coach/chat`          | 增强: analysisContext 扩展 macro 字段   |
| 每日问候 | `GET /api/app/coach/daily-greeting` | 无变化                                  |

**无需新增 API**。所有增强通过现有接口的内部逻辑升级实现。

---

## Step 7：数据结构设计

### 允许增强（不加 DB 字段）

| 结构                 | 变化                                                 | 位置                     |
| -------------------- | ---------------------------------------------------- | ------------------------ |
| `NutritionTotals`    | +saturatedFat, +addedSugar                           | analysis-result.types.ts |
| `AnalysisContextDto` | +totalProtein, +totalFat, +totalCarbs, foods[]+macro | coach.dto.ts             |
| `FoodDecision`       | 无结构变化, reason 内容更丰富                        | 无                       |
| Coach system prompt  | 新增 macro 进度段、限制段、目标段、行为段            | coach.service.ts         |

---

## Step 8：分阶段迭代

### Phase 1：分析精度 + 决策增强

**目标**: 让决策覆盖全部宏量维度 + 安全检查

| 编号 | 任务                                                                              | 文件                          |
| ---- | --------------------------------------------------------------------------------- | ----------------------------- |
| P1-1 | `NutritionTotals` 类型扩展: +saturatedFat, +addedSugar                            | analysis-result.types.ts      |
| P1-2 | `calculateTotals()` 汇总 saturatedFat + addedSugar                                | text-food-analysis.service.ts |
| P1-3 | `buildFromLibraryMatch()` 提取扩展营养字段                                        | text-food-analysis.service.ts |
| P1-4 | `buildUserContext()` 扩展返回 allergens/restrictions/conditions + macro 进度      | text-food-analysis.service.ts |
| P1-5 | `computeDecision()` 新增: 脂肪超标、碳水超标、全目标蛋白检测                      | text-food-analysis.service.ts |
| P1-6 | `computeDecision()` 新增: 过敏原/饮食限制/健康状况检查                            | text-food-analysis.service.ts |
| P1-7 | 新增 i18n keys: decision.context.highFat/highCarbs/allergen/restriction/health.\* | i18n-messages.ts              |
| P1-8 | 静态替代宵夜硬编码改 i18n                                                         | text-food-analysis.service.ts |
| P1-9 | TypeScript 类型检查                                                               | —                             |

### Phase 2：上下文分析 + 替代建议增强

**目标**: 让替代方案更智能、决策建议更具体

| 编号 | 任务                                                                        | 文件                          |
| ---- | --------------------------------------------------------------------------- | ----------------------------- |
| P2-1 | `generateDecisionAdvice()` 增强: 脂肪超标/碳水超标时给出具体行动建议        | text-food-analysis.service.ts |
| P2-2 | `generateExplanation()` 增强: 添加脂肪/碳水进度到 userContextImpact         | text-food-analysis.service.ts |
| P2-3 | `AnalysisContextDto` 扩展: +totalProtein/totalFat/totalCarbs, foods[]+macro | coach.dto.ts                  |
| P2-4 | Controller 传 macro 到 analysisContext（前端传入时透传）                    | 无需改 controller             |
| P2-5 | 新增 i18n keys: decision.advice.reduceFat/reduceCarbs 等                    | i18n-messages.ts              |
| P2-6 | TypeScript 类型检查                                                         | —                             |

### Phase 3：AI教练 prompt 深化

**目标**: 教练具备完整营养上下文 + 安全意识

| 编号 | 任务                                                                       | 文件             |
| ---- | -------------------------------------------------------------------------- | ---------------- |
| P3-1 | `buildSystemPrompt()` 新增: 今日 macro 进度段                              | coach.service.ts |
| P3-2 | `buildSystemPrompt()` 新增: 饮食限制/过敏原/健康状况段                     | coach.service.ts |
| P3-3 | `buildSystemPrompt()` 新增: 目标聚焦指令（根据 goalType）                  | coach.service.ts |
| P3-4 | `buildSystemPrompt()` 新增: 行为洞察段（weakMealType + topExcessCategory） | coach.service.ts |
| P3-5 | `prepareContext()` 分析上下文注入增强: macro 详情                          | coach.service.ts |
| P3-6 | 新增 i18n keys: coach.prompt.\* (macro进度/限制/目标聚焦)                  | i18n-messages.ts |
| P3-7 | TypeScript 类型检查                                                        | —                |

---

## 修改文件清单

| 文件                                                                          | Phase      | 变更类型     |
| ----------------------------------------------------------------------------- | ---------- | ------------ |
| `apps/api-server/src/modules/food/app/types/analysis-result.types.ts`         | P1         | 类型扩展     |
| `apps/api-server/src/modules/food/app/services/text-food-analysis.service.ts` | P1, P2     | 核心逻辑增强 |
| `apps/api-server/src/modules/diet/app/recommendation/utils/i18n-messages.ts`  | P1, P2, P3 | i18n keys    |
| `apps/api-server/src/modules/coach/app/dto/coach.dto.ts`                      | P2         | DTO 扩展     |
| `apps/api-server/src/modules/coach/app/coach.service.ts`                      | P3         | prompt 增强  |

## 禁止修改

- `nutrition-score.service.ts` — 只读调用
- `substitution.service.ts` — 只读调用
- `user-profile.service.ts` — 只读调用
- `behavior.service.ts` — 只读调用
- 所有推荐系统模块
- 所有用户画像模块
- 所有订阅/商业化模块
- 数据库 schema
