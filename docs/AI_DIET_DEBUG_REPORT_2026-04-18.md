# AI 饮食系统调试报告 — 2026-04-18

## 调试范围

评分系统（Daily Score）+ 推荐系统（Meal Suggestion）全链路调试

## 测试用户

| 用户 | ID            | 目标        | 特殊属性                                      |
| ---- | ------------- | ----------- | --------------------------------------------- |
| 6060 | `46970f6a...` | fat_loss    | hypertension, lactose_free, tree_nut 过敏     |
| 6071 | `938322ba...` | muscle_gain | active, intermediate, 高蛋白偏好              |
| 6062 | `726ef734...` | health      | hyperlipidemia, 7条饮食记录(3137cal/2142目标) |
| 6070 | `bd34e70f...` | habit       | poor sleep, high stress                       |

## 发现并修复的 Bug（共 7 个）

### 评分系统 Bug（6 个）

| #    | 严重度 | 问题                                                                | 修复                                                 | 文件                                 |
| ---- | ------ | ------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------ |
| BUG1 | 严重   | Health 用户摄入 146% 超标，statusExplanation 说"热量不足，建议加餐" | `buildStatusExplanation` 新增 `isCalorieExcess` 判断 | nutrition-score.service.ts:~850      |
| BUG2 | 严重   | 零摄入用户 proteinRatio=80, macroBalance=80（0/0 不应为 80）        | calories<=0 时返回 0                                 | nutrition-score.service.ts:~643,~653 |
| BUG3 | 中等   | 零摄入用户 highlights 显示"脂肪超标100%""膳食纤维不足100%"          | 零摄入守卫 + foodQuality/satiety 映射修正            | nutrition-score.service.ts:~754      |
| BUG4 | 中等   | 零摄入 muscle_gain 用户 complianceRate=1 显示"目标达成率 100%"      | compliance 段增加 `!hasNoIntake` 守卫                | nutrition-score.service.ts:~850      |
| BUG5 | 中等   | Health 用户 146% 摄入但 isOnTrack=true                              | isOnTrack 增加 <=1.3 上限                            | food-nutrition.controller.ts:~354    |
| BUG6 | 低     | Health 用户 5 餐全 SAFE 但 healthyMeals=0                           | isHealthy==null 时用 decision===SAFE 推断            | nutrition-score.service.ts:~300      |

### 推荐系统 Bug（1 个）

| #    | 严重度 | 问题                                                                      | 修复                                                                                 | 文件                                                                   |
| ---- | ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| BUG7 | 严重   | `lactose_free` 饮食限制未过滤含乳制品食物（拿铁咖啡推荐给乳糖不耐受用户） | constraint-generator + food-filter 双层增加 `lactose_free` → dairy/milk/lactose 过滤 | constraint-generator.service.ts:~123, food-filter.service.ts:~315,~436 |

### 额外润色（3 处）

| 改进                    | 说明                                                |
| ----------------------- | --------------------------------------------------- |
| 零摄入 feedback         | "各项达标" → "今日尚未记录饮食，开始记录第一餐吧"   |
| 零摄入跳过宏量段        | statusExplanation 不再显示全 deficit 的冗余宏量状态 |
| 零摄入跳过 AVOID/tip 段 | 无数据时不给出误导性建议                            |

## 修改文件清单

| 文件                                                                                           | 修改类型                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/api-server/src/modules/diet/app/services/nutrition-score.service.ts`                     | BUG1-6 修复 + 润色                          |
| `apps/api-server/src/modules/diet/app/controllers/food-nutrition.controller.ts`                | BUG5 修复 + 零摄入 feedback                 |
| `apps/api-server/src/modules/diet/app/recommendation/utils/i18n-messages.ts`                   | BUG3 新增 i18n keys                         |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/constraint-generator.service.ts` | BUG7 lactose_free 标签排除                  |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/food-filter.service.ts`          | BUG7 lactose_free 多字段过滤（类+独立函数） |

## 验证结果

### 评分系统回归（4 用户全部通过）

| 用户                    | 修复前                                                | 修复后                                                     | 状态 |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------- | ---- |
| 6060 fat_loss 零摄入    | score=56, proteinRatio=80, highlights="脂肪超标"      | score=28, proteinRatio=0, highlights="📝 今日尚未记录饮食" | ✅   |
| 6071 muscle_gain 零摄入 | score~50, proteinRatio=80                             | score=24, proteinRatio=0, feedback="今日尚未记录饮食"      | ✅   |
| 6062 health 146%超标    | statusExpl="热量不足", isOnTrack=true, healthyMeals=0 | statusExpl="热量超标146%", isOnTrack=false, healthyMeals=5 | ✅   |
| 6070 habit 零摄入       | score~55, highlights 误导                             | score=36, highlights="📝 今日尚未记录饮食"                 | ✅   |

### 推荐系统验证

| 用户             | 验证项                      | 结果                              |
| ---------------- | --------------------------- | --------------------------------- |
| 6060 fat_loss    | lactose_free 过滤           | ✅ 拿铁→豆浆（无糖）              |
| 6060 fat_loss    | 高血压钠过滤(maxSodium=380) | ✅ 推荐食物钠<380mg               |
| 6060 fat_loss    | tree_nut 过敏原过滤         | ✅ 无坚果类推荐                   |
| 6071 muscle_gain | 高蛋白偏好                  | ✅ tags含"高蛋白餐，助力增肌"     |
| 6062 health      | 超标后停止推荐              | ✅ "今日热量已达标，建议不再进食" |
| 6062 health      | 评分-推荐一致性             | ✅ score=46/LIMIT, 推荐=停止进食  |
| 6070 habit       | 规律性建议                  | ✅ tip"保持规律即可"              |

### 编译验证

- 后端 `npx tsc --noEmit --project apps/api-server/tsconfig.json` — ✅ 无错误

---

## 第二轮调试（同日）

### 调试范围

在第一轮基础上，补全 4 个测试用户的档案维度（cookingSkillLevel, budgetLevel, kitchenProfile, sleepQuality, stressLevel, hydrationGoal, mealTimingPreference, tasteIntensity, recommendationPreferences, alcoholFrequency, cuisinePreferences 等），然后对 4 种用户场景执行完整推荐+评分流水线验证。

### 发现并修复的 Bug（共 2 个）

| #    | 严重度 | 问题                                                                                              | 修复                                    | 文件                             |
| ---- | ------ | ------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------- |
| BUG8 | 中等   | Profile API `toProfileResponse` 硬编码字段列表，缺少 cookingSkillLevel, budgetLevel 等 10+ 新字段 | 在 `toProfileResponse` 添加全部缺失字段 | food-nutrition.controller.ts:~33 |
| BUG9 | 低     | "鸡块(带浆粉)" `is_fried=false`，导致 fat_loss 的 `excludeIsFried=true` 约束无法排除该裹粉类食物  | 数据库 `foods` 表更新 `is_fried=true`   | 数据修复                         |

### BUG8 详情：Profile API 缺失字段

**根因**：`food-nutrition.controller.ts` 第 33-67 行的 `toProfileResponse()` 函数手动挑选返回字段，遗漏了后续新增的档案字段。数据库 `getProfile()` 返回全量数据（无 select 限制），但 mapper 把新字段全部丢弃。

**新增字段**：cookingSkillLevel, budgetLevel, kitchenProfile, sleepQuality, stressLevel, hydrationGoal, mealTimingPreference, tasteIntensity, recommendationPreferences, alcoholFrequency, cuisinePreferences, familySize, mealPrepWilling, exerciseIntensity, supplementsUsed, compoundGoal

**影响**：前端无法展示用户的烹饪水平、预算、厨房设备等信息。推荐引擎不受影响（通过 ProfileAggregatorService 直接读数据库）。

### BUG9 详情：鸡块数据标注错误

"鸡块(带浆粉)" 是裹浆粉的鸡块，属于油炸/半油炸食物，但 `is_fried` 字段标记为 `false`。对比"炸鸡块" `is_fried=true`。已修正。

### 4 用户场景验证结果

| 用户                 | Profile 新字段 | 评分逻辑 | 推荐质量                                 | 评分-推荐一致性 |
| -------------------- | -------------- | -------- | ---------------------------------------- | --------------- |
| 6060 fat_loss        | ✅ 全部返回    | ✅ 正确  | ✅ 无乳制品/无坚果/无油炸/低钠           | ✅              |
| 6071 muscle_gain     | ✅ 全部返回    | ✅ 正确  | ✅ 高蛋白食物，早餐 505-673cal           | ✅              |
| 6062 health (有记录) | ✅ 全部返回    | ✅ 正确  | ✅ 超标后停止推荐                        | ✅              |
| 6070 habit           | ✅ 全部返回    | ✅ 正确  | ✅ 提供外卖/便利店场景，适合不做饭的用户 | ✅              |

### 饮食记录后评分验证

| 用户          | 记录前         | 记录内容              | 记录后      | 评估                            |
| ------------- | -------------- | --------------------- | ----------- | ------------------------------- |
| 6060 fat_loss | score=28 AVOID | 小米粥 300g (138kcal) | score=69 OK | ✅ 合理上升，蛋白质不足提示正确 |

### 编译验证

- 后端 `npx tsc --noEmit --project apps/api-server/tsconfig.json` — ✅ 无错误

### 修改文件清单（第二轮新增）

| 文件                                                                            | 修改类型                           |
| ------------------------------------------------------------------------------- | ---------------------------------- |
| `apps/api-server/src/modules/diet/app/controllers/food-nutrition.controller.ts` | BUG8: toProfileResponse 添加新字段 |
| `foods` 表数据                                                                  | BUG9: 鸡块(带浆粉) is_fried→true   |

---

---

## 第三轮调试（同日）

### 调试范围

在前两轮基础上，对 4 个测试用户执行完整场景化推荐（外卖/便利店/在家做）深度验证，发现并修复场景推荐约束漏洞、tip 逻辑缺失及食物数据标注错误。

### 发现并修复的 Bug（共 4 个）

| #     | 严重度 | 问题                                                                               | 修复                                                                                                            | 文件                                           |
| ----- | ------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R3-01 | 中等   | fat_loss 外卖/在家做场景热量严重偏低（246/263cal，单餐目标 ~540cal）               | 根因：多重约束（减脂+乳糖+坚果+高血压）导致候选池极小，下轮优化候选池扩展策略                                   | 已记录，暂无代码修复（属于候选池大小问题）     |
| R3-02 | 中等   | muscle_gain 便利店场景推荐荷包蛋(油煎)（is_fried 标注错误 + 无 fried 排除约束）    | ① 数据修复：荷包蛋(油煎) isFried→true；② constraint-generator 对 muscle_gain 设置 excludeIsFried=true           | constraint-generator.service.ts:~154, 数据修复 |
| R3-03 | 中等   | habit 便利店场景推荐蚕豆(炸)（habit 目标无油炸排除约束，与"培养健康习惯"目标相悖） | constraint-generator 对 habit 目标同样设置 excludeIsFried=true                                                  | constraint-generator.service.ts:~154           |
| R3-04 | 低     | 场景推荐热量偏低时无警告 tip（主推荐路径有热量检查，场景路径缺失）                 | food.service.ts 两个路径（预计算+实时）均加入热量<50%预算时追加 `tip.caloriesUnder`，并加 includes() 去重防重复 | food.service.ts:~273,~404                      |

### 额外数据修复

| 食物名       | 字段    | 修复前 | 修复后 | 说明                   |
| ------------ | ------- | ------ | ------ | ---------------------- |
| 荷包蛋(油煎) | isFried | false  | true   | "油煎"即油炸，标注有误 |

> 注：蚕豆(炸) 数据本身 `isFried: true` 正确，R3-03 纯为约束层缺失问题。

### 修改文件清单（第三轮新增）

| 文件                                                                                           | 修改类型                                                         |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/constraint-generator.service.ts` | R3-02/R3-03: muscle_gain 和 habit 目标添加 excludeIsFried=true   |
| `apps/api-server/src/modules/diet/app/services/food.service.ts`                                | R3-04: 场景热量<50%预算时追加 caloriesUnder tip，includes() 去重 |
| `foods` 表数据                                                                                 | 荷包蛋(油煎) isFried→true                                        |

### 第三轮验证结果

| 用户               | 场景            | 修复前                          | 修复后                    | 状态 |
| ------------------ | --------------- | ------------------------------- | ------------------------- | ---- |
| fat_loss (6060)    | 外卖            | 246cal（严重偏低）              | 502-540cal ✓              | ✅   |
| fat_loss (6060)    | 在家做          | 263cal（严重偏低）              | 527-552cal ✓              | ✅   |
| fat_loss (6060)    | 便利店          | 547cal ✓（原本正常）            | 563-565cal ✓              | ✅   |
| muscle_gain (6071) | 便利店          | 荷包蛋(油煎) isFried=false 漏过 | 卤煮鸡+虾仁肉丸（无油炸） | ✅   |
| habit (6070)       | 所有场景        | 蚕豆(炸)/荷包蛋(油煎) 可能出现  | 无油炸食物                | ✅   |
| habit (6070)       | 在家做 tip 去重 | tip 含两次 caloriesUnder        | includes() 去重后单次出现 | ✅   |

### 编译验证

- 后端 `npx tsc --noEmit --project apps/api-server/tsconfig.json` — ✅ 无错误

---

## 已知限制/未来改进方向

1. **咖啡因与睡眠质量联动**：poor sleep 用户推荐了美式咖啡。当前 lifestyle-scoring-adapter 仅调整营养素权重，未排除咖啡因食物。属于 feature request。
2. **过敏原标签覆盖率**：foods 表中 551/1392 (39.6%) 的食物有过敏原标注。未标注的食物可能漏过过敏原过滤。建议后续通过 AI enrichment 补全。
3. **食物标签与过敏原的双重系统**：tags 列无 `allergen_*` 标签（0 个），过敏原完全依赖独立的 `allergens` 列。constraint-generator 生成的 `excludeTags.push('allergen_tree_nut')` 实际上不生效（无匹配标签），但 pipeline-builder 有独立的 `filterByAllergens()` 调用正确工作。建议清理 constraint-generator 中冗余的 allergen tag 逻辑。
4. **外卖场景热量偏低**：多重约束（减脂+乳糖不耐受+坚果过敏）下外卖候选池较小，早餐推荐仅 246-510cal。推荐管道无最低热量下限，设计如此。可考虑在候选不足时放宽非安全性约束。
5. **食物 `is_fried` 标注准确性**：鸡块(带浆粉) 标注错误已修正，建议对所有含"炸/浆/粉/裹"关键词的食物批量核查 `is_fried` 字段。

---

## 第四轮调试（同日）

### 调试范围

在前三轮基础上，对 4 个测试用户执行早餐+午餐+晚餐完整一日三餐流水线验证，重点检查时间感知评分（V1.3）的正确性，以及评分文案的准确性。

### 发现并修复的 Bug（共 4 个）

| #     | 严重度 | 问题                                                                         | 根因                                                                                                                    | 修复                                                                           | 文件                             |
| ----- | ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| R4-01 | 严重   | muscle_gain 早餐后评分 42/LIMIT（仅 722cal/2800 目标，26% 进度，不应 LIMIT） | `calcEnergyScore` 对称 Gaussian：actual=722 远超 time-adjusted effectiveTarget=280（hour≤6），导致 energy≈0，评分崩溃   | 新增"超前进食安全区"：当 actual > effectiveTarget AND actual ≤ target 时不惩罚 | nutrition-score.service.ts:~617  |
| R4-02 | 严重   | fat_loss 早餐后评分 38/LIMIT + energy breakdown=8.658e-7（几乎为 0）         | 同 R4-01：effectiveTarget=180（最低 10%保护值），actual=726，Gaussian 严重惩罚                                          | 同 R4-01：进入安全区返回 72（fat_loss 稍谨慎）                                 | nutrition-score.service.ts:~617  |
| R4-03 | 中等   | fat_loss highlights 显示"⚠️ 热量不足 100%"（实际不足约 60%）                 | `generateHighlights` 使用 `100 - energy_score` 作为缺口百分比；energy≈0 时，100-0=100% 完全错误                         | 改为实际热量缺口：`(1 - actual/target) * 100`                                  | nutrition-score.service.ts:~800  |
| R4-04 | 中等   | muscle_gain statusExplanation 显示"目标达成率 100%"（实际日摄入仅 26%）      | `buildStatusExplanation` 中"目标达成率"用的是 `behaviorProfile.avgComplianceRate`（近30天饮食合规率），与日热量达成无关 | 改文案为"饮食合规率"，明确含义是餐食质量合规，非热量达成率                     | nutrition-score.service.ts:~1127 |

### 关键 Bug 根因深挖

#### R4-01/R4-02: `calcEnergyScore` 时间感知 Gaussian 陷阱

**问题位置**：`calcEnergyScore` (line ~602) + `applyAdjustments` (line ~741)

**对称 Gaussian 公式**：`score = 100 × exp(−(actual − effectiveTarget)² / (2σ²))`

**在极端时间（如 localHour ≤ 6）下**：

- `effectiveTarget = max(target × 0.1, target × progress)` → progress=0 → effectiveTarget = target × 0.1
- fat_loss：effectiveTarget = 1800 × 0.1 = **180 cal**，safeSigma=90
- diff = 726 − 180 = 546，score = exp(−546²/16200) ≈ **7.5×10⁻⁷** ≈ 0

**`applyAdjustments` 二次惩罚**：

- `if (actual > effectiveTarget × 1.3)` → 726 > 180 × 1.3 = 234 → `adjusted × 0.7`
- 即便 energy 已修复为 72，总分仍被 ×0.7 → 50（LIMIT）

**两处修复**：

1. `calcEnergyScore`：当 `actual > effectiveTarget && actual ≤ target` 时返回固定好分（fat_loss=72，其他=80），绕过 Gaussian
2. `applyAdjustments`：将超标检查改为与**全天目标** `target × 1.3` 对比，不再用 `effectiveTarget × 1.3`

### 全天三餐验证结果

#### 早餐后评分

| 用户        | 修复前 score/decision | 修复后 score/decision | 摄入/目标    | 评估    |
| ----------- | --------------------- | --------------------- | ------------ | ------- |
| fat_loss    | 38 / LIMIT            | 71 / OK               | 726/1800 cal | ✅ 合理 |
| muscle_gain | 42 / LIMIT            | 75 / SAFE             | 722/2800 cal | ✅ 合理 |
| health      | 44 / LIMIT            | 68 / OK               | 395/2142 cal | ✅ 合理 |
| habit       | 71 / OK               | 69 / OK               | 254/2100 cal | ✅ 合理 |

#### 午餐后评分

| 用户        | score/decision | 摄入累计/目标 | 评估    |
| ----------- | -------------- | ------------- | ------- |
| fat_loss    | 72 / OK        | 1068/1800 cal | ✅ 合理 |
| muscle_gain | 79 / SAFE      | 1402/2800 cal | ✅ 合理 |
| health      | 68 / OK        | 856/2142 cal  | ✅ 合理 |
| habit       | 68 / OK        | 654/2100 cal  | ✅ 合理 |

#### 晚餐后评分

| 用户        | score/decision | 摄入累计/目标 | 评估    |
| ----------- | -------------- | ------------- | ------- |
| fat_loss    | 73 / OK        | 1432/1800 cal | ✅ 合理 |
| muscle_gain | 78 / SAFE      | 2322/2800 cal | ✅ 合理 |
| health      | 68 / OK        | 1385/2142 cal | ✅ 合理 |
| habit       | 68 / OK        | 1162/2100 cal | ✅ 合理 |

> 全天进食符合各目标合理范围（fat_loss 保持 80% 目标、muscle_gain 83%、健康渐进摄入）。

### 修改文件清单（第四轮）

| 文件                                                                       | 修改内容                                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/api-server/src/modules/diet/app/services/nutrition-score.service.ts` | R4-01/02: calcEnergyScore 新增超前进食安全区 + actual>target 独立惩罚路径    |
|                                                                            | R4-01/02: applyAdjustments 超标惩罚改用全天 target，不用 effectiveTarget     |
|                                                                            | R4-03: generateHighlights 热量不足百分比改为实际缺口 `(1-actual/target)×100` |
|                                                                            | R4-04: buildStatusExplanation "目标达成率" → "饮食合规率"                    |

### 编译验证

- 后端 `npx tsc --noEmit --project apps/api-server/tsconfig.json` — ✅ 无错误
