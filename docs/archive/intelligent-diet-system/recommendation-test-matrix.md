# 推荐系统针对性测试用例矩阵

**目标**：按子系统模块切分用例，支撑"针对性快速定位 + 增量扩展"。
**用法**：每行一个用例，按模块号 + 用例号 (`M-XXX`) 唯一标识；列出输入、验证点、关联 runner 和 spec。
**配套**：每个模块有 `apps/api-server/test/skeletons/<module>.skeleton.spec.ts` 提供 `describe / it.todo` 骨架。
**优先级图例**：P0 阻塞核心链路 / P1 影响业务质量 / P2 边界与防御 / P3 监控与可观测。

---

## 总览（10 个子系统）

| # | 子系统 | 目录 | runner | skeleton |
|---|---|---|---|---|
| M1 | 用户画像 | `recommendation/profile/` | `01-profile-aggregator` | `profile.skeleton.spec.ts` |
| M2 | 决策系统（策略） | `recommendation/strategy/`、`StrategyResolverFacade` | `02-strategy-resolver` | `strategy.skeleton.spec.ts` |
| M3 | 召回 | `recommendation/recall/`、`pipeline/food-pool-cache.service.ts` | `03-recall` | `recall.skeleton.spec.ts` |
| M4 | 评分链 | `recommendation/scoring-chain/` | `04-scoring-chain` | `scoring.skeleton.spec.ts` |
| M5 | 过滤 | `recommendation/filter/` | 04 + 07 间接覆盖 | `filter.skeleton.spec.ts` |
| M6 | 餐次组装 | `recommendation/meal/` | `05-meal-assembler` | `meal.skeleton.spec.ts` |
| M7 | 场景引擎 | `recommendation/scenario/`、`ScenarioEngine` | `06-scenario-engine` | `scenario.skeleton.spec.ts` |
| M8 | 反馈与学习 | `recommendation/feedback/` | 内嵌在 01 / 07 | `feedback.skeleton.spec.ts` |
| M9 | 解释与追踪 | `recommendation/explanation/`、`tracing/` | 07 内嵌 | `explanation.skeleton.spec.ts` |
| M10 | 端到端 | `RecommendationEngineService` | `07-end-to-end` | `e2e.skeleton.spec.ts` |

---

## M1 用户画像 (`profile/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M1-001 | P0 | declared profile 完整字段透出 | seed 用户 e2e-2-fat_loss-us | enrichedProfile.declared 含 cuisinePreferences/dietaryRestrictions/familySize/budgetPerMeal | runner 01 |
| M1-002 | P0 | feedback JOIN 不报 42883 (BUG-006) | recommendation_feedbacks 含非 uuid food_id | $queryRawUnsafe SQL 含正则 sanitize + `food_id::uuid` cast | `preference-profile-uuid-join.regression.spec.ts` ✅ |
| M1-003 | P0 | feedback < 3 条返回空 profile | 2 行 feedback | categoryWeights/ingredientWeights/foodGroupWeights/foodNameWeights 全空 | ✅ |
| M1-004 | P1 | feedback ≥ 3 条按 accept rate 映射 0.3–1.3 | accept rate 0/0.5/1 → 0.3/0.8/1.3 | 边界值精确 | M1 skeleton |
| M1-005 | P1 | regionalBoostMap = regionMap ⊕ cuisineMap (max 合并) | declared.cuisinePreferences=['italian'], regionCode='US' | merged['IT'] = max(regionMap['IT']?, cuisineMap['IT']) | runner 01 |
| M1-006 | P1 | cuisinePreferenceRegions 排除本国 | regionCode='CN', cuisinePreferences=['chinese'] | 返回 [] | OBS-2 |
| M1-007 | P1 | american 归并 western 大类 | cuisinePreferences=['american'], regionCode='US' | 返回 ['GB','FR','DE','IT','ES']（5 国） | OBS-2 |
| M1-008 | P2 | normalizeCuisine 大小写/中文别名 | '日料' / 'JAPANESE' / '日本菜' | 全部 → 'japanese' | M1 skeleton |
| M1-009 | P2 | regionCode 缺失走 locale 兜底 | locale='zh-CN', regionCode=undefined | 最终 regionCode='CN' | M1 skeleton |
| M1-010 | P2 | regionCode 完全缺失走 DEFAULT_REGION_CODE | 无 locale 无 regionCode | regionCode='US' | M1 skeleton |
| M1-011 | P3 | preference cache TTL 5min | 连续两次调用 | 第二次走 redis 缓存（spy prisma 仅 1 次） | M1 skeleton |
| M1-012 | P3 | redis 不可用降级直查 | redis throw | 不抛错，profile 仍返回 | M1 skeleton |

---

## M2 决策系统 / 策略解析 (`StrategyResolverFacade`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M2-001 | P0 | 4 个 goal × 3 region 全部解析成功 | 12 用户矩阵 | 每个组合得到非空 strategy | runner 02 |
| M2-002 | P0 | strategy layer 数 ≥ 1 | seed 用户 | resolver 输出 layers.length > 0 | runner 02 |
| M2-003 | P1 | fat_loss 策略含热量缺口约束 | goal=fat_loss | strategy 含 caloric_deficit 或等价层 | M2 skeleton |
| M2-004 | P1 | muscle_gain 策略含蛋白下限 | goal=muscle_gain | strategy 含 protein_floor | M2 skeleton |
| M2-005 | P1 | health 策略含 processed food 抑制 | goal=health | strategy 抑制 isProcessed | M2 skeleton |
| M2-006 | P1 | habit 策略沿用过往偏好 | goal=habit + 有 feedback | preference-driven layer 启用 | M2 skeleton |
| M2-007 | P2 | 缺失 goalType 走默认 | goalType=null | fallback 到 default strategy | M2 skeleton |
| M2-008 | P2 | strategy 与 region 联动 | region=CN/US/JP | 各自 regionalBoostMap 不同 | M2 skeleton |
| M2-009 | P3 | strategy 解析耗时基线 | 12 用户 | mean < 50ms | runner 02 |

---

## M3 召回 (`recall/` + `food-pool-cache`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M3-001 | P0 | 池子规模 = 全量 active+verified | foods 5161 行 | poolSize === 5161 | runner 03 |
| M3-002 | P0 | is_verified=false 食物被过滤 (BUG-007) | 1 条 verified=false 食物 | 该食物不在池中 | M3 skeleton |
| M3-003 | P0 | status≠active 食物被过滤 | 1 条 status='archived' | 该食物不在池中 | M3 skeleton |
| M3-004 | P1 | mealType 过滤生效 | mealType='breakfast' | 仅含 mealTypes 包含 breakfast 的食物 | M3 skeleton |
| M3-005 | P1 | excludeTags 过滤生效 | excludeTags=['fried'] | 含 'fried' tag 的食物不出现 | M3 skeleton |
| M3-006 | P1 | usedNames 去重 | usedNames 含 '鸡胸肉' | 池中无 '鸡胸肉' | runner 03 |
| M3-007 | P1 | 过敏原过滤生效 | allergens=['peanut'] | 含 peanut 的食物全过滤 | M3 skeleton |
| M3-008 | P1 | 短期画像拒绝食物过滤 | shortTermProfile.rejected=['food-x'] | food-x 不出现 | M3 skeleton |
| M3-009 | P1 | ensureMinCandidates 兜底 | 过滤后 < MIN | 触发兜底回填 | `pipeline-builder-recall.service.spec.ts` |
| M3-010 | P1 | 烹饪技能过滤 | cookingSkillLevel='beginner' | 高难度菜被过滤 | M3 skeleton |
| M3-011 | P1 | 缓存命中率（同 category 二次召回） | 连续两次同 category | 第二次走 redis | M3 skeleton |
| M3-012 | P2 | 缓存 key 含 category 维度 | 不同 category | 不同 redis key | M3 skeleton |
| M3-013 | P3 | 召回耗时 P95 | 12 用户 × 4 mealType | P95 < 200ms | runner 03 |
| M3-014 | P3 | semantic recall 异步合并 | 启用 semanticRecall | 结果集 ≥ 基础集 | M3 skeleton |

---

## M4 评分链 (`scoring-chain/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M4-001 | P0 | 分数分布健康 | 48 cells | mean 0.24–0.78, distinct ≥ 60 | runner 04 |
| M4-002 | P0 | PriceFitFactor 透传 regionCode (BUG-008) | budgetPerMeal+currencyCode | getPriceInfo 收到 (foodId, regionCode) | `price-fit-factor-region-code.regression.spec.ts` ✅ |
| M4-003 | P0 | PriceFitFactor regionCode 缺失 → null | regionCode=undefined | getPriceInfo 第二参为 null | ✅ |
| M4-004 | P0 | PriceFitFactor 跨 region 不污染 | 先 CN 后 US 同 foodId | 两次调用 regionCode 各异 | ✅ |
| M4-005 | P1 | 路径 A 命中精确预算 | budgetPerMeal=30, priceMin=20 | adjustment.multiplier > 1 | M4 skeleton |
| M4-006 | P1 | 路径 A currency mismatch 跳过 | userCurrency=CNY, food=USD | multiplier=1.0, trace='currency_mismatch' | M4 skeleton |
| M4-007 | P1 | 路径 A priceUnit 非 per_serving 回退路径 B | priceUnit='per_kg' | 回退到 budgetLevel 评分 | M4 skeleton |
| M4-008 | P1 | 路径 B 超支 1/2/3 级 → 0.85/0.70/0.60 | costLevel = budgetMax+1/+2/+3 | multiplier 精确 | M4 skeleton |
| M4-009 | P1 | RegionalBoostFactor 命中 boostMap | regionalBoostMap['IT']=1.2 | IT 食物 multiplier ≥ 1.2 | M4 skeleton |
| M4-010 | P1 | MacroFit 评分覆盖蛋白/脂肪/碳水 | dailyTarget 设置 | adjustment 含 macroFit trace | M4 skeleton |
| M4-011 | P1 | HealthModifier veto 触发 | healthCondition + 高风险食物 | finalMultiplier=0, isVetoed=true | M4 skeleton |
| M4-012 | P2 | factor.order 决定执行顺序 | 多个 factor | 按 order 升序 | M4 skeleton |
| M4-013 | P2 | factor.isApplicable=false 跳过 | declared 缺失 | factor.computeAdjustment 不被调 | M4 skeleton |
| M4-014 | P3 | 评分链耗时基线 | 48 cells | mean < 30ms/food | runner 04 |

---

## M5 过滤 (`filter/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M5-001 | P0 | RealisticFilter 不再频繁 fallback (BUG-009) | 池 5161 | "too aggressive" warn = 0 | runner 07 |
| M5-002 | P1 | commonalityThreshold 过滤生效 | threshold=0.5 | commonalityScore < 0.5 食物被过滤 | M5 skeleton |
| M5-003 | P1 | MIN_CANDIDATES=5 兜底 | 过滤后 4 条 | 回退到过滤前 | M5 skeleton |
| M5-004 | P1 | adjustForScene homeCook | scenario=homeCook | 倾向家庭烹饪可行食物 | M5 skeleton |
| M5-005 | P1 | adjustForScene quick | scenario=quick | 倾向简易/外卖食物 | M5 skeleton |
| M5-006 | P1 | adjustForScene social | scenario=social | 倾向餐厅/聚餐场景 | M5 skeleton |
| M5-007 | P2 | scoreFood 与 filter 解耦 | scoreFood 独立调用 | 不依赖 filter 状态 | M5 skeleton |
| M5-008 | P2 | LifestyleAdapter null 时 filter 不抛错 | adapter 返回 null | filter 仍正常运行 | M5 skeleton |

---

## M6 餐次组装 (`meal/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M6-001 | P0 | 12 用户 × 4 mealType 全组装成功 | 48 cells | ok=48 | runner 05 |
| M6-002 | P1 | breakfast 含碳水+蛋白至少各 1 | mealType=breakfast | meal.items 满足 | M6 skeleton |
| M6-003 | P1 | lunch/dinner 含主食+蛋白+蔬菜 | mealType=lunch | items 覆盖 3 大类 | M6 skeleton |
| M6-004 | P1 | snack 单品/两品组合 | mealType=snack | items.length ≤ 2 | M6 skeleton |
| M6-005 | P1 | familySize 缩放 portion | familySize=4 | 总量 ≈ 单人 × 4 | M6 skeleton |
| M6-006 | P1 | 餐次总热量在 target ±15% | target.calories=600 | sum ∈ [510, 690] | M6 skeleton |
| M6-007 | P2 | 同餐内 mainIngredient 不重复 | items[*].mainIngredient | distinct == items.length | M6 skeleton |
| M6-008 | P2 | usedNames 跨餐去重 | 多次组装累计 usedNames | 后续 meal items 不含历史 name | M6 skeleton |
| M6-009 | P3 | 组装耗时基线 | 48 cells | mean < 100ms | runner 05 |

---

## M7 场景引擎 (`scenario/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M7-001 | P0 | 144 cells (12u × 4m × 3s) 全绿 | 12 用户 | ok=144 | runner 06 |
| M7-002 | P1 | homeCook 场景出 home_cook channel | scenario=homeCook | items[*].availableChannels 含 home_cook | runner 06 |
| M7-003 | P1 | quick 场景偏好 prep < N 分钟 | scenario=quick | items 平均 prepTime 较低 | M7 skeleton |
| M7-004 | P1 | social 场景倾向 restaurant | scenario=social | items[*].channels 含 restaurant | M7 skeleton |
| M7-005 | P1 | 三场景 score 分布显著差异 | 同 user × 同 meal | 3 个 scenario 出的 top food 不全相同 | M7 skeleton |
| M7-006 | P2 | scenario 缺失走 default (homeCook) | scenario=undefined | 等价 homeCook 输出 | M7 skeleton |
| M7-007 | P3 | 场景耗时基线 | 144 cells | mean < 80ms | runner 06 |

---

## M8 反馈与学习 (`feedback/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M8-001 | P0 | 反馈写入后 5min 内画像生效 | 写入 accepted feedback | 下次召回该 category 权重↑ | M8 skeleton |
| M8-002 | P1 | rejected feedback 抑制召回 | 写入 rejected | 该 food 在召回中被过滤/降权 | M8 skeleton |
| M8-003 | P1 | substitution feedback 学习替换 | 用 A 替 B 多次 | 后续 A 出现率↑ B↓ | M8 skeleton |
| M8-004 | P1 | 60 天窗口截断 | feedback createdAt > 60d | 不计入 profile | M8 skeleton |
| M8-005 | P1 | execution-tracker 记录替换模式 | 多次替换 | SubstitutionPattern 累计 | M8 skeleton |
| M8-006 | P2 | 同 food 反向反馈相互抵消 | 1 accepted + 1 rejected | 该 food 权重 ≈ 中性 | M8 skeleton |
| M8-007 | P2 | feedback 含非 uuid food_id 不污染 (BUG-006) | food_id='legacy-string' | 该行被 sanitize 子查询过滤 | ✅ |

---

## M9 解释与追踪 (`explanation/` + `tracing/`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M9-001 | P1 | trace 包含 cuisinePreferenceRegions | 用户有 cuisine prefs | trace.cuisinePreferenceRegions 非空 | runner 07 |
| M9-002 | P1 | trace 包含每个 factor 的 adjustment | 评分链命中多个 factor | trace.factors[].name + multiplier 完整 | M9 skeleton |
| M9-003 | P1 | meal-explanation 输出可读理由 | 单餐结果 | explanation 含 ≥ 1 条 reason 字符串 | M9 skeleton |
| M9-004 | P1 | comparison-explanation 对比两个候选 | 两个 ScoredFood | 输出列出关键差异 | `comparison-explanation.service.spec.ts` |
| M9-005 | P2 | trace 在异常时不阻塞主链路 | trace service throw | 推荐结果仍返回 | M9 skeleton |

---

## M10 端到端 (`RecommendationEngineService`)

| ID | P | 用例 | 输入 | 验证点 | 关联 |
|---|---|---|---|---|---|
| M10-001 | P0 | 48 cells 全绿 | 12 用户 × 4 meal | ok=48 | runner 07 |
| M10-002 | P0 | 48 scenario 全绿 | 12 用户 × 3 scenario × goal/region | ok=48 | runner 07 |
| M10-003 | P0 | 0 个 seasonality regionCode 警告 (BUG-008) | 全量跑 | grep 'without regionCode' = 0 | runner 07 |
| M10-004 | P0 | 0 个 realism filter aggressive 警告 (BUG-009) | 全量跑 | grep 'too aggressive' = 0 | runner 07 |
| M10-005 | P0 | 0 个 PG 42883 错误 (BUG-006) | 全量跑 | grep 'queryRawUnsafe' err = 0 | runner 07 |
| M10-006 | P1 | meanMealMs < 100ms | 48 cells | meanMealMs ≤ 100 | runner 07 |
| M10-007 | P1 | meanScenarioMs < 120ms | 48 scenario | meanScenarioMs ≤ 120 | runner 07 |
| M10-008 | P2 | 同 user 重复推荐不返回完全相同 meal | 连续 2 次 | 至少 1 个 item 不同（usedNames 去重） | M10 skeleton |

---

## 用例统计

| 模块 | P0 | P1 | P2 | P3 | 合计 | 已实现 |
|---|---|---|---|---|---|---|
| M1 画像 | 3 | 4 | 3 | 2 | 12 | 3 (M1-002/003 + runner) |
| M2 策略 | 2 | 4 | 2 | 1 | 9 | runner 12 cells |
| M3 召回 | 3 | 8 | 2 | 2 | 15 (含 M3-014) | M3-009 + runner 12 cells |
| M4 评分 | 4 | 6 | 2 | 1 | 13 | M4-002/003/004 + runner |
| M5 过滤 | 1 | 5 | 2 | 0 | 8 | runner 间接 |
| M6 餐次 | 1 | 5 | 2 | 1 | 9 | runner 48 cells |
| M7 场景 | 1 | 4 | 1 | 1 | 7 | runner 144 cells |
| M8 反馈 | 1 | 4 | 2 | 0 | 7 | M8-007 (= BUG-006 修复) |
| M9 解释 | 0 | 4 | 1 | 0 | 5 | comparison spec |
| M10 端到端 | 5 | 2 | 1 | 0 | 8 | runner 96 cells |
| **合计** | **21** | **46** | **18** | **8** | **93** | **核心 P0 已 100% 覆盖** |

---

## 增量执行建议

按优先级 + ROI 排序：

### Phase 1（P0 完全闭合，1 天）
- M1-008/009/010：profile 边界值（normalizeCuisine、locale 兜底、DEFAULT_REGION_CODE）—— 防止隐式契约漂移
- M3-002/003：is_verified / status 过滤精准性 —— 锁定 BUG-007 不再回归
- M5-001/003：MIN_CANDIDATES 兜底 —— 锁定 BUG-009 不再回归

### Phase 2（P1 业务质量，2–3 天）
- M2-003/004/005/006：四个 goal 的差异化策略验证
- M4-005/006/007/008：PriceFit 路径 A/B 全分支
- M4-011：HealthModifier veto 路径
- M6-005/006：familySize 缩放 + 热量误差区间
- M7-002/003/004：三场景 channel/prepTime 行为差异
- M8-001/002/003：反馈学习闭环

### Phase 3（P2/P3 边界与可观测，按需）
- M3-011/012：缓存命中
- M4-012/013：factor 编排契约
- M9-002/005：trace 完整性 + 异常隔离
- 各模块耗时基线（M2-009/M3-013/M4-014/M6-009/M7-007/M10-006/007）

---

## skeleton 文件

每个模块对应一个 `apps/api-server/test/skeletons/<module>.skeleton.spec.ts`，仅含 `describe + it.todo`，可直接：
1. `pnpm test:unit --testPathPattern=skeletons`：查看 todo 列表（jest 报告里出现 ☐）
2. 把 `it.todo(...)` 改为 `it(..., () => { ... })` 即填实

skeleton 不参与 P0 回归（保持快速），但参与 ts 编译，确保引用的服务/类型不漂移。

---

## 最终归档

- 测试矩阵：`docs/recommendation-test-matrix.md`（本文件）
- skeleton：`apps/api-server/test/skeletons/{profile,strategy,recall,scoring,filter,meal,scenario,feedback,explanation,e2e}.skeleton.spec.ts`
- 已实现回归：`test/preference-profile-uuid-join.regression.spec.ts`、`test/price-fit-factor-region-code.regression.spec.ts`
- runner 全绿快照：`apps/api-server/test/runners/reports/{01..07}/`

— END —
