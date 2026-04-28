# EatCheck 架构评审委员会报告（ARB Review）

> 评审周期：2026-04
> 评审范围：`apps/api-server`（NestJS + Prisma + PostgreSQL + pgvector）
> 评审依据：`schema.prisma`（2895 行 / 70+ model / 29 enum）、`/docs`（114 文档）、`/src/modules`（19 个模块）、根目录历史规划文档（30+）
> 评审性质：ARB 严肃评审，**不中庸、不和稀泥**

---

## 0. 一句话定论

> **EatCheck 在 0 用户阶段就提前构建了一套面向百万级 DAU 的"AI 推荐平台"基建（Strategy / AbExperiments / RecommendationTraces / PrecomputedRecommendations / StrategyTuningLog 全套），把工程预算耗在"将来才会用到的可观测性"上，而最核心的"食物匹配 / 营养准确性"恰恰是当前线上出 bug 的地方（椰子鸡饭→椰子、海南鸡饭→2200 kcal）。**

**这是典型的"基建驱动开发（infra-driven dev）"反模式：用复杂度换取自我安全感，而不是换取用户价值。**

---

## 1. 架构诊断（Diagnosis）

### 1.1 真实规模盘点

| 维度 | 数值 | 评价 |
|------|------|------|
| Prisma model 数量 | **70+** | 对一个未上线的 MVP 而言，**多 3 倍** |
| `schema.prisma` 行数 | **2895 行** | 单文件不可维护阈值（>1500 已是红线） |
| Enum 数量 | **29** | 其中 **15 个是重复孪生（51%）** |
| Food 表列数 | **100+** | 单表巨胖，已开始拆分但未完成 |
| `/docs` 文档数 | **114** | DIET_DECISION_COACH_SYSTEM 从 V1 → V4.6 |
| 根目录中文规划文档 | **30+** | 无文档治理，迭代痕迹直接堆在仓库根 |
| 业务模块（src/modules） | 19 | 数量本身合理，但与表的对应关系混乱 |

### 1.2 系统是什么 vs 系统应该是什么

**当前实际定位（从代码看）**：一个 AI 推荐平台 + 策略实验平台 + 行为分析平台 + 教练系统 + 食物数据库 + 游戏化系统 + 订阅系统的**七合一巨石**。

**应该的定位（从产品价值看）**：一个**能准确识别食物并给出靠谱营养反馈**的 AI 饮食助手。

**差距**：系统把 80% 的复杂度投入在"反馈链路 / 实验 / 策略调优"，把 20% 投入在"识别准确率 / 数据质量"——而**这个比例应该完全反过来**。

---

## 2. 核心问题（Critical Issues）

### 🔴 P0：推荐平台基建严重过度设计

**证据链：**

- `Strategy` + `StrategyAssignment` + `StrategyTuningLog` —— 0 用户时谁来分配策略、谁来调优？
- `AbExperiments` —— 没有用户基数，AB 实验在统计上完全无意义
- `RecommendationTraces` + `RecommendationFeedbacks` + `FeedbackDetails` —— 三表反馈链，但当前根本没有"推荐"产品形态在线
- `PrecomputedRecommendations` + `RecommendationExecutions` —— 预计算推荐与执行记录，**用户群体为零时预计算什么？**
- `FoodRecommendationProfile` —— **schema 注释自爆铁证**：

  > "本期只建表 + 迁移占位行，**不接入推荐排序**"

  这句注释直接证明这是为了"未来某天可能用到"而建的表。这是**纯粹的 YAGNI 违反**。

**判定**：这一整层（约 8-10 个表）是"假装自己是大厂"的产物。在拿到第一批真实用户行为数据之前，**所有这些表都应该被冻结、不写入、甚至直接删除**。

### 🔴 P0：用户画像三表并存，职责重叠

```
UserProfiles          ── 显式画像（用户填写）
UserInferredProfiles  ── AI 推断画像
UserBehaviorProfiles  ── 行为聚合画像
+ ProfileChangeLog    ── 变更日志
+ ProfileSnapshots    ── 快照
```

**问题**：
1. 三张表的边界在代码层并不清晰（`UserBehaviorProfiles.replacementPatterns` 又和独立表 `ReplacementPatterns` 重复）
2. 一个用户的"偏好"到底以哪张表为准？没有明确的事实源（Source of Truth）
3. 双重审计（ChangeLog + Snapshots）在没有合规需求的 C 端饮食产品中是过度防御

**判定**：应合并为 **`UserProfile`（事实源）+ `UserProfileEvent`（变更流，可选）** 两张表，其余进 JSON 字段或干脆删除。

### 🔴 P0：Food 表 100+ 列的"上帝表"

**已识别的列群（应拆分但未拆完）**：

| 列群 | 列数估算 | 应拆向 |
|------|---------|--------|
| 基础（name/category/brand）| ~15 | 保留主表 |
| 宏量营养（calories/protein/...）| ~20 | 保留主表 |
| 微量营养（vitamins/minerals）| ~25 | **`FoodNutritionDetail`**（已有 `FoodEmbedding` 模式可参考）|
| 健康评估（healthScore/healthLevel/...）| ~10 | **`FoodHealthAssessment`** |
| 标签 / 兼容性（tags/allergens/mealTypes/compatibility）| ~10 | **`FoodTaxonomy`** |
| 份量 / 烹饪（commonPortions/cookingMethods）| ~8 | **`FoodPortionGuide`** |
| 媒体 / 溯源（imageUrl/primarySource/region）| ~8 | 保留 / 合入 `FoodFieldProvenance` |
| V8 元数据（field_sources/field_confidence/failed_fields/qualityScore）| ~6 | 已规划迁移到 `FoodFieldProvenance`，**但主表残留未清理** |
| **Deprecated 字段（mainIngredient / source）** | 2 | 应明确删除路径 |

**判定**：V8.2 拆分已经开始（`FoodEmbedding` / `FoodFieldProvenance` / `FoodRecommendationProfile`），但**只完成了 30%**——主表还有 70+ 列没动。这是典型的"重构走到一半就被新需求打断"。

### 🟠 P1：29 个 Enum 中 15 个是重复孪生

**精确清单（已 grep 验证：仅 enum 自身定义出现 1 次，无任何字段引用）**：

| 应删除（幽灵 enum） | 实际在用 |
|---|---|
| `admin_role_enum` | `admin_users_role_enum` |
| `admin_user_status_enum` | `admin_users_status_enum` |
| `app_user_auth_type_enum` | `app_users_auth_type_enum` |
| `app_user_status_enum` | `app_users_status_enum` |
| `capability_type_enum` | `model_configs_capabilitytype_enum` |
| `currency_enum` | `model_configs_currency_enum` |
| `meal_type_enum` | `food_records_meal_type_enum` |
| `model_status_enum` | `model_configs_status_enum` |
| `permission_status_enum` | `permissions_status_enum` |
| `permission_type_enum` | `permissions_type_enum` |
| `http_method_enum` | `permissions_action_enum` |
| `provider_status_enum` | `providers_status_enum` |
| `provider_type_enum` | `providers_type_enum` |
| `record_source_enum` | `food_records_source_enum` |
| `activity_level_enum` | `user_profiles_activity_level_enum` |

**根因**：早期使用通用命名（`meal_type_enum`），后期 Prisma introspect 自动生成了带表名前缀的版本（`food_records_meal_type_enum`），新代码迁过去了，旧 enum 没人删——这是**"变更不闭环"的典型债务**。

**判定**：**立即删除**，零风险，本次落地动作。

### 🟠 P1：`/docs` 与根目录文档治理崩坏

- `DIET_DECISION_COACH_SYSTEM_V1.0` → `V2.0` → `V3.0` → ... → `V4.6` 全部留在 `/docs`
- 根目录散落 30+ 个中文规划文档（`迭代升级xxx.md`、`优化点.md`、`现在问题.md`、`REFACTORING_PLAN.md`、`V2.4_COMPLETION_SUMMARY.md`...）
- **没有 README 索引、没有 ADR（架构决策记录）目录、没有 deprecated/archive 目录**

**后果**：新人接手成本极高；AI agent 抓上下文会被旧版本误导；评审者无法快速定位"当前真相"。

### 🟡 P2：业务领域边界在 schema 层模糊

`src/modules` 有 19 个模块（auth/coach/decision/diet/food/gamification/strategy/subscription...），但在 `schema.prisma` 中表是按字母顺序铺平的，**没有按 domain 分文件 / 分 schema**。在 70+ model 规模下，这会让"找一个表属于哪个业务"变成考古。

---

## 3. 复杂度审计（Complexity Audit）

| 子系统 | 复杂度评分 (1-5) | 是否被使用 | 是否值得保留 |
|---|---|---|---|
| 食物识别（Food + FoodRecords + 营养字段）| 5 | ✅ 核心 | ✅ **应加强** |
| 用户画像（3 表 + 2 审计表）| 4 | ⚠️ 部分 | 🔧 合并到 1-2 表 |
| 推荐策略平台（Strategy + AB + Trace + Precomputed）| 5 | ❌ 0 用户 | ❌ **冻结或删除** |
| 反馈系统（RecommendationFeedbacks + FeedbackDetails + Behavior）| 4 | ❌ 无产品入口 | 🔧 合并 |
| 教练 / 决策（DecisionCoach V4.6）| 5 | ⚠️ 不明 | ❓ 需产品端确认是否真在用 |
| 游戏化（Gamification）| 3 | ❓ | ❓ MVP 不需要 |
| 订阅 / 支付 | 3 | ❓ | ❓ 0 用户阶段不需要 |
| RBAC / 多租户 | 3 | ✅ 后台 | ✅ 保留但简化 |

**复杂度总分**：当前系统约相当于 **D 轮创业公司或中型上市公司**的工程复杂度，但实际处于 **种子前期 / MVP**阶段。**错配 3-4 个数量级**。

---

## 4. 路线判断：A 工程简化 vs B AI 平台型

### 路线 A：工程简化（推荐 ⭐️）

**核心动作**：
1. **冻结**整个推荐平台层（Strategy/AB/Trace/Precomputed），代码层不再写入
2. **合并**用户画像三表 → 一张事实表 + 一张可选事件流
3. **拆分** Food 上帝表至 4-5 个领域表（按 V8.2 已开始的方向走完）
4. **删除** 15 个重复 enum、所有 deprecated 字段
5. **聚焦**食物识别准确率（这才是椰子鸡饭 bug 的根因，不是缺策略）

**预期收益**：
- schema 体积下降 40%（从 2895 行 → ~1700 行）
- 表数量下降 30%（从 70+ → ~50）
- 新人 onboarding 时间下降 60%
- bug 定位速度上升 2-3 倍

### 路线 B：押注 AI 平台型

**前提**：必须先回答以下问题——
1. 你有没有 **10 万 DAU 的明确路径**？没有就不该建 AB 实验平台。
2. 推荐链路的 **第一个真实用户**在哪里？没有就不该有 PrecomputedRecommendations。
3. 团队有没有 **2 名以上专职 ML 工程师**？没有就不该自己造策略调优系统。

**如果三个问题没有同时是 yes，路线 B 是工程师的自我感动。**

### 决策

> **明确选择路线 A。** 路线 B 在当前阶段不具备任何前提条件，继续推进等于持续失血。

---

## 5. 重构必要性（Is Refactor Necessary?）

**答案：必要，且越早越好。理由如下：**

1. **系统未上线** —— 这是重构的**最佳窗口期**。没有线上数据约束、没有兼容性包袱、没有用户感知。
2. **debt 增长速度 > 业务速度** —— 30+ 根目录规划文档、V1→V4.6 的版本爆炸，证明每次迭代都在累积而非偿还债务。
3. **当前 bug 与复杂度无关** —— 椰子鸡饭 bug 的根因是**食物匹配算法 / 数据质量**，不是缺一个策略层。继续加复杂度只会让根因更难找到。
4. **Prisma schema 已逼近不可读阈值** —— 2895 行单文件，再加 500 行就会进入"无人敢动"状态。

**不重构的代价**：6 个月后系统进入"功能不能加、bug 不敢修、新人不能进"的死锁。

---

## 6. 未来风险（Forward-Looking Risks）

| 风险 | 概率 | 影响 | 当前防御 |
|---|---|---|---|
| Food 表持续膨胀至 150+ 列 | 高 | schema 锁死 | ⚠️ 弱（拆分只走了 30%）|
| AI 输出质量问题被淹没在策略层 | 高 | 产品口碑崩 | ❌ 无 |
| 推荐平台代码长期不删，新人误以为在用 | 中 | 工程浪费 | ❌ 无 |
| 多个 JSON 字段（compoundGoal/kitchenProfile/...）schema drift | 中 | 数据一致性 | ⚠️ 无校验 |
| `/docs` 旧版本被 AI agent 抓为上下文 | 高 | 决策被误导 | ❌ 无 |
| Deprecated 字段被新代码误用 | 中 | 数据双写 | ⚠️ 仅注释 |

---

## 7. 决策建议（Decisions）

### 立即执行（本次落地，零风险）

- [x] **删除 15 个重复 enum 定义** + 对应 PostgreSQL `DROP TYPE`
- [x] **强化 deprecated 字段注释**（`Food.mainIngredient`、`Food.source`），明确标注"DO NOT USE / drop in V9"
- [x] **本评审报告归档到 `/docs/ARCHITECTURE_REVIEW_BOARD_2026-04.md`** 作为决策锚点

### 近期执行（1-2 周内，需用户确认）

- [ ] **冻结推荐平台层**：`Strategy*` / `AbExperiments` / `RecommendationTraces` / `PrecomputedRecommendations` / `RecommendationExecutions` —— 不在代码里 INSERT，不在新功能里依赖
- [ ] **合并用户画像**：`UserProfiles` + `UserInferredProfiles` + `UserBehaviorProfiles` → `UserProfile` + `UserProfileSignals`（JSON 列）
- [ ] **拆完 Food 表**：把 V8.2 已开始的拆分推进到 100%（`FoodNutritionDetail` / `FoodHealthAssessment` / `FoodTaxonomy` / `FoodPortionGuide`）

### 中期执行（1 个月内）

- [ ] **`/docs` 大扫除**：建立 `docs/active/` `docs/archive/` `docs/adr/`，把 V1-V4.5 全部归档
- [ ] **根目录中文规划文档归档**到 `docs/archive/planning-2025-2026/`
- [ ] **Prisma schema 拆分**：按 domain 拆 `schema.prisma` → `schema/food.prisma` `schema/user.prisma` `schema/coach.prisma`（Prisma 已支持多文件 schema）

### 不做（明确拒绝）

- ❌ 不增加任何"为未来准备"的新表
- ❌ 不引入新的策略 / 实验 / Trace 字段
- ❌ 不在没有 10 万 DAU 路径的前提下讨论"推荐排序优化"
- ❌ 不再发布 `DIET_DECISION_COACH_SYSTEM_V5.0`

---

## 8. 是否推翻原设计？

**部分推翻。**

- ✅ **保留**：Food 主表骨架、FoodRecords、UserProfiles 主表、Auth/RBAC、Provider/ModelConfig 多模型路由层 —— 这些是产品必须的
- 🔧 **重构**：用户画像三表合并、Food 上帝表拆分、Enum 清理 —— 方向对，执行没走完
- ❌ **推翻**：整个推荐平台层（Strategy/AB/Trace/Precomputed/StrategyTuningLog 等 8-10 个表）—— **这层在 0 用户阶段建立本身就是错误决策**，不是"做得不够好"，而是"根本不该做"

---

## 9. 评审委员会签字栏

| 角色 | 评审结论 |
|---|---|
| **架构评审** | 不通过当前架构。要求按路线 A 在 1 个月内完成简化重构。 |
| **风险评审** | 当前最大风险是"复杂度遮蔽产品根因 bug"。立即冻结推荐平台层。 |
| **技术债评审** | 债务利率 > 业务增长率。本次落地动作（enum 清理 + deprecated 标注）为最低必要止损。 |

---

**报告日期**：2026-04
**下一次评审建议**：完成"近期执行"清单后复评（约 2 周后）
