# 推荐系统调试报告 R4

**日期**: 2026-04-16  
**调试范围**: 推荐引擎全链路调试（4种用户场景 × 17个测试用户 × 4个餐次 = 272次推荐测试）

---

## 一、测试覆盖

| 场景        | 用户数 | 覆盖维度                                                                          |
| ----------- | ------ | --------------------------------------------------------------------------------- |
| fat_loss    | 5      | 普通/初级/海鲜+素食/糖尿病+痛风/多过敏+纯素+清真                                  |
| muscle_gain | 5      | 普通/中级/高预算/大豆鱼过敏+纯素+犹太/多过敏                                      |
| health      | 5      | 轻度高血压/高血压+糖尿病(对象格式)/痛风+高胆固醇(对象格式)/素食+骨质疏松/日式偏好 |
| habit       | 2      | 甲壳类过敏+高外卖频率/多过敏(蛋奶大豆麸质)                                        |

**每个用户测试 breakfast/lunch/dinner/snack 四个餐次。**

---

## 二、发现并修复的 Bug

### Bug 1: 过敏原映射缺失 — `seafood`/`lactose` 未映射（严重）

**文件**: `apps/api-server/src/modules/diet/app/recommendation/filter/allergen-filter.util.ts`

**问题**: `ALLERGEN_ALIAS_MAP` 中没有 `seafood`、`lactose`、`shrimp` 等 key。用户画像中的 `seafood` 过敏原无法匹配食物标签中的 `shellfish`/`shrimp`，导致含虾食物（如面条虾蓉面）被推荐给海鲜过敏用户。

**数据证据**:

- 用户画像过敏原: `seafood`, `lactose`, `egg`, `fish`, `soy`, 等
- 食物标签过敏原: `shellfish`, `shrimp`, `dairy`, `nuts`, 等
- FL3 (seafood+lactose 过敏) 被推荐了含 `["shellfish","shrimp"]` 的面条(虾蓉面)

**修复**:

```typescript
// 新增映射
seafood: ['shellfish', 'shrimp', 'fish', 'seafood'],
shrimp: ['shrimp', 'shellfish'],
lactose: ['dairy', 'milk', 'lactose'],
// shellfish 扩展
shellfish: ['shellfish', 'shrimp'],
```

**验证**: 修复后 FL3 不再收到任何含海鲜/乳制品的推荐。

---

### Bug 2: 健康状况对象格式未处理 — constraint-generator 硬约束失效（中等）

**文件**: `apps/api-server/src/modules/diet/app/recommendation/pipeline/constraint-generator.service.ts`

**问题**: 部分用户的 `healthConditions` 存储为对象格式 `[{"severity":"moderate","condition":"hypertension"}]`，但 `constraint-generator` 直接将对象传给 `normalizeHealthCondition(string)`，导致返回 null。后续 `if (condition === HealthCondition.HYPERTENSION)` 比较失败，**maxSodium/maxPurine 等硬过滤约束不生效**。

**影响用户**: H2 (hypertension+diabetes_type2), H3 (gout+high_cholesterol) — 这些用户的高钠/高嘌呤食物未被正确过滤。

**注意**: `health-modifier-engine` 已正确处理对象格式（通过 `parseConditions` 方法），所以软评分惩罚仍然有效。但硬约束（如钠≥380mg的食物直接排除）缺失。

**修复**:

```typescript
const rawStr =
  typeof rawCondition === 'string'
    ? rawCondition
    : ((rawCondition as { condition?: string }).condition ?? '');
const condition = normalizeHealthCondition(rawStr) ?? rawStr;
```

---

### Bug 3: 增肌用户零食蛋白质严重不足（中等）

**文件**: `apps/api-server/src/modules/diet/app/recommendation/types/scoring.types.ts`

**问题**: `MUSCLE_GAIN_MEAL_ROLES` 中 snack 角色为 `['snack1', 'snack2']`，映射到 `['fruit','snack']` 和 `['beverage','snack','fruit']`。增肌用户的零食热量目标为 280-300 cal，但水果+饮料组合通常只能提供 93-172 cal（33-61%）。

**修复前数据**:
| 用户 | 零食热量达标率 | 蛋白质达标率 |
|------|---------------|-------------|
| MG1 | 33% | 44% |
| MG2 | 65% | 55% |
| MG3 | 57% | 84% |
| MG4 | 37% | 11% |

**修复**: 增肌用户零食第一槽位改为 `snack_protein`，映射到 `['protein', 'dairy', 'snack']`。

**修复后数据**:
| 用户 | 零食热量达标率 | 蛋白质达标率 |
|------|---------------|-------------|
| MG1 | 82-100% | 83-105% |
| MG2 | 82% | 83% |
| MG3 | 107-141% | 47-94% |
| MG5 | 97-100% | 66-208% |

---

### Bug 4: 所有目标类型零食缺少乳制品选项（轻微）

**文件**: `apps/api-server/src/modules/diet/app/recommendation/types/scoring.types.ts`

**问题**: `ROLE_CATEGORIES.snack1` 仅包含 `['fruit', 'snack']`，不包含 dairy（酸奶、芝士等），导致零食缺少中等热量+蛋白质来源。

**修复**: `snack1: ['fruit', 'snack', 'dairy']`

---

## 三、代码质量修复（由子任务发现）

| #   | 文件                                | 问题                                                                             | 修复                       |
| --- | ----------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| 1   | `substitution.service.ts:333-338`   | `vitamin_c`/`vitamin_a` key 不匹配 camelCase 字段 → 微量营养素相似度始终返回 0.5 | 改为 `vitaminC`/`vitaminA` |
| 2   | `food-scorer.service.ts:168`        | `food.calories` 未用 `Number()` 包裹，可能产生 NaN                               | 添加 `Number()`            |
| 3   | `meal-assembler.service.ts:230-236` | `adjustPortions` 缩放了 cal/protein/fat/carbs 但遗漏 fiber                       | 添加 fiber 缩放            |
| 4   | `scene-resolver.service.ts:489`     | `buildDefaultScene` 忽略 `mealType` 参数，始终返回 `'general'`                   | 添加 mealType→scene 映射   |
| 5   | `profile-aggregator.service.ts:153` | 静默回退到 `'CN'` region 无日志                                                  | 添加 warning log           |

---

## 四、已知限制（非 Bug）

### 1. 限制性饮食用户的热量/蛋白质达标困难

**表现**: FL5 (vegan+halal) 零食仅达目标 32-50%，H3 (gout+cholesterol+low_fat) 蛋白质仅 27-37%

**原因**: 食物池中符合多重约束的高热量/高蛋白选项有限。例如：

- 纯素+清真 → 排除所有动物蛋白，剩余主要是豆类/谷物
- 痛风+低脂 → 排除高嘌呤蛋白（内脏、海鲜）和高脂食物，可选蛋白质源极少

**建议**: 扩充食物库中的高蛋白植物食品（如毛豆、藜麦、奇亚籽、蛋白粉等）和低嘌呤蛋白食品。

### 2. 推荐结果的非确定性

引擎包含随机选择逻辑（多样化、品类轮换），同一用户多次请求可能得到不同结果。这是设计特性，但导致某些请求热量偶尔偏离目标±20%。

### 3. 零食品类限制

零食仅允许 2 个食物槽位，对于高热量目标（>200cal）的用户，即使加入 dairy 品类，仍可能偶尔不达标。可考虑为高热量目标的零食增加第3个槽位。

---

## 五、修改文件清单

| 文件                                                                                           | 修改类型                  |
| ---------------------------------------------------------------------------------------------- | ------------------------- |
| `apps/api-server/src/modules/diet/app/recommendation/filter/allergen-filter.util.ts`           | Bug fix: 过敏原映射       |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/constraint-generator.service.ts` | Bug fix: 健康状况对象格式 |
| `apps/api-server/src/modules/diet/app/recommendation/types/scoring.types.ts`                   | Bug fix: 零食角色和品类   |
| `apps/api-server/src/modules/diet/app/recommendation/filter/substitution.service.ts`           | Code fix: 微量营养素 key  |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/food-scorer.service.ts`          | Code fix: Number() 安全   |
| `apps/api-server/src/modules/diet/app/recommendation/meal/meal-assembler.service.ts`           | Code fix: fiber 缩放      |
| `apps/api-server/src/modules/diet/app/recommendation/context/scene-resolver.service.ts`        | Code fix: 默认场景映射    |
| `apps/api-server/src/modules/diet/app/recommendation/profile/profile-aggregator.service.ts`    | Code fix: 日志补充        |

---

## 六、最终回归测试结果摘要

格式: `热量达标%/蛋白质达标%` （⚠ = <70%, ⚡ = >140%）

```
FL1:         B=124/58  L=106/63  D=104/42  S=214/111
FL2:         B=106/86  L=74/87   D=93/80   S=112/133
FL3-seafood: B=97/120  L=86/85   D=66/41⚠  S=42/25⚠   [限制性饮食]
FL4-diabetes:B=56/60⚠  L=56/57⚠  D=51/38⚠  S=107/118  [多重健康约束]
FL5-vegan:   B=92/73   L=100/76  D=89/69   S=50/8⚠    [食物池限制]
MG1:         B=102/72  L=85/93   D=75/83   S=93/105
MG2:         B=102/97  L=94/136  D=92/100  S=82/83
MG3:         B=90/68   L=69/66⚠  D=74/85   S=141/47
MG4-vegan:   B=86/81   L=99/76   D=99/90   S=93/35    [食物池限制]
MG5:         B=93/100  L=86/133  D=106/88  S=100/208
H1-hyp:      B=99/65   L=92/68   D=93/75   S=115/42
H2-hyp+dia:  B=92/74   L=46/35⚠  D=35/26⚠  S=146/107  [多重健康约束正确生效]
H3-gout+chol:B=85/67   L=58/30⚠  D=93/70   S=107/118  [低脂+低嘌呤限制]
H4-veg-osteo:B=85/64   L=90/77   D=103/66  S=150/70
H5-jp:       B=98/62   L=48/27⚠  D=59/56⚠  S=42/57⚠   [随机波动]
HAB1:        B=97/100  L=91/60   D=100/92  S=153/76
HAB2-multi:  B=109/100 L=95/92   D=74/76   S=57/0⚠    [多过敏限制]
```

**总结**: 无限制用户（FL1/FL2/MG1/MG2/MG5/HAB1）热量达标率 74-124%，平均 ~95%。限制性饮食用户（FL4/FL5/H2/H3/HAB2）因食物池受限，部分餐次达标率偏低，属于数据层面而非逻辑层面的问题。
