# 智能饮食推荐系统 V7.9 升级方案

> 基于 V7.8 架构进行增量升级，不推翻已有设计。
> 项目未上线，不需要兼容旧版本。

---

## 1. V7.8 能力评估摘要

### 1.1 系统规模

| 维度 | 数值 |
|------|------|
| 业务模块 | 17 个 |
| 基础设施模块 | 18 个 |
| 数据库表 | 45+ |
| 推荐系统文件 | 80+ |
| 评分参数 | 90+ |
| 域事件 | 12 个 |
| BullMQ 队列 | 7 个 |
| Cron 任务 | 6+ |
| 策略预设 | 10 套 |

### 1.2 已有架构优势（保留不动）

- **三阶段管道**：Recall（8层过滤 + 三路召回）→ Rank（14维 + 10因子链式评分）→ Rerank（Thompson Sampling）
- **5层健康修正引擎**：一票否决 → 重度惩罚 → 目标惩罚 → 健康状况 → 正向增益
- **三表用户画像**：declared + inferred + behavior，ProfileFactory 产出领域值对象
- **4层策略合并**：GLOBAL → GOAL_TYPE → CONTEXT → USER
- **4层场景解析**：用户显式 → 行为学习 → 规则推断 → 默认
- **分级缓存**：L1 LRU + L2 Redis + Singleflight + Refresh-ahead
- **评分配置中心**：90+ 参数外部化 + Context Sharding
- **降级链**：每个阶段 try/catch + fallback + PipelineDegradation 追踪

### 1.3 已识别的问题与技术债务

| 优先级 | 问题 | 来源 |
|--------|------|------|
| 高 | Feedback → PreferenceUpdate 未解耦（TODO since V6） | `feedback.service.ts:169` |
| 中 | 线程不安全的全局 i18n（`setLocale`/`getLocale`） | `i18n-messages.ts:2425-2438` |
| 中 | 死队列常量 `PROFILE_UPDATE`、`FEEDBACK_PROCESS` | `queue.constants.ts:12,20` |
| 低 | 兼容性 shim：`calcDiversityPenalty()`、`merge()` | `daily-plan-context.service.ts:316`、`recall-merger.service.ts:206` |
| 中 | CF-only 候选使用 `null as unknown as FoodLibrary` | `recall-merger.service.ts` |
| 中 | 推荐调试能力有限：simulate 只返回结果，缺乏全链路 trace | admin controllers |
| 高 | 推荐管道无结构化日志/追踪，生产环境难以排查问题 | pipeline 各阶段 |
| 中 | `user_profiles` 40+ 字段膨胀（V7.8 已识别未处理） | schema.prisma |

---

## 2. V7.9 核心升级方向

### 设计原则

1. **增量升级**：所有改动基于 V7.8，不新增独立模块，只增强/重构现有模块
2. **做减法**：清理技术债务、删除死代码、合并冗余逻辑
3. **务实优先**：每项升级必须解决真实问题，不做理想化设计
4. **可维护性**：降低认知负荷，提升代码可读性和调试效率

### 五个升级方向

| # | 方向 | 目标 | 涉及模块 |
|---|------|------|----------|
| 1 | **推荐管道可观测性** | 全链路结构化 Trace，生产可排查 | recommendation pipeline |
| 2 | **推荐调试增强** | Admin 端完整调试工具链 | diet admin controllers/services |
| 3 | **策略系统增强** | 策略生效验证、策略 diff、策略模拟 | strategy module |
| 4 | **技术债务清理** | 删除死代码、修复已知问题 | 跨模块 |
| 5 | **性能优化** | 减少冗余计算、优化热路径 | pipeline, cache, scoring |

---

## 3. 模块级升级设计

### 3.1 推荐管道可观测性（方向 1）

**问题**：当前推荐管道没有结构化的执行追踪。`PipelineDegradation[]` 只记录降级，不记录正常流程。生产环境出现"推荐结果不合理"时，无法还原推荐过程。

**方案**：在 `PipelineContext` 中新增 `PipelineTrace` 结构，各阶段写入追踪数据，最终可选持久化。

#### 3.1.1 PipelineTrace 数据结构

```typescript
// 新增到 pipeline.types.ts
interface PipelineTrace {
  traceId: string;                    // UUID，关联一次推荐请求
  userId: string;
  mealType: string;
  startedAt: number;                  // timestamp ms
  completedAt?: number;

  stages: PipelineStageTrace[];       // 各阶段追踪
  summary: PipelineTraceSummary;      // 汇总信息
}

interface PipelineStageTrace {
  stage: 'recall' | 'rank' | 'rerank' | 'assemble' | 'health_modifier';
  durationMs: number;
  inputCount: number;                 // 输入候选数
  outputCount: number;                // 输出候选数
  details: Record<string, unknown>;   // 阶段特定详情
}

// Recall 阶段详情
interface RecallTraceDetails {
  ruleCandidates: number;
  semanticCandidates: number;
  cfCandidates: number;
  mergedTotal: number;
  filteredByAllergen: number;
  filteredByRestriction: number;
  filteredByShortTermReject: number;
}

// Rank 阶段详情
interface RankTraceDetails {
  scoringFactorsApplied: string[];     // 实际生效的 ScoringFactor 名称
  healthModifierVetoed: string[];      // 被一票否决的食物名
  topCandidates: Array<{               // Top 5 得分明细
    foodName: string;
    baseScore: number;
    chainAdjustment: number;
    healthModifier: number;
    finalScore: number;
  }>;
}

// Rerank 阶段详情
interface RerankTraceDetails {
  explorationRate: number;              // Thompson Sampling 探索率
  foodFormPromotions: number;           // dish 优先提升数
  diversityPenalties: number;           // 去重惩罚数
}

// RealisticFilter 详情
interface RealisticFilterTraceDetails {
  realismLevel: string;
  filteredByCommonality: number;
  filteredByBudget: number;
  filteredByCookTime: number;
  filteredBySkill: number;
  filteredByEquipment: number;
  filteredByFoodForm: number;
  fallbackTriggered: boolean;
}

interface PipelineTraceSummary {
  totalDurationMs: number;
  candidateFlowPath: string;           // e.g. "384→152→30→5"
  strategyName: string;
  sceneName: string;
  realismLevel: string;
  degradations: string[];
  cacheHit: boolean;                   // 是否命中预计算缓存
}
```

#### 3.1.2 实现方式

**不新增 service**，在现有 `PipelineBuilderService` 中实现：

1. `executeRolePipeline()` 开始时创建 `PipelineTrace`，挂到 `PipelineContext.trace`
2. 各阶段方法（`recallCandidates`、`rankCandidates`、`rerankAndSelect`）执行前后记录时间和候选数
3. `RealisticFilterService.filterByRealism()` 记录各过滤器淘汰数
4. `ScoringChainService.applyChain()` 记录生效的 Factor 名称
5. 管道结束时填充 `summary`
6. **存储**：
   - Debug 模式（admin simulate）：完整 trace 返回给前端
   - 生产模式：仅写入 `recommendation_traces` 表的精简摘要（已有表，扩展字段）
   - 可配置：通过 `feature_flag` 控制生产环境是否写入完整 trace

#### 3.1.3 修改文件清单

| 文件 | 改动 |
|------|------|
| `pipeline.types.ts` | 新增 PipelineTrace 相关类型定义 |
| `pipeline/pipeline-builder.service.ts` | 各阶段埋点 trace 数据 |
| `filter/realistic-filter.service.ts` | 记录各过滤器淘汰计数 |
| `scoring-chain/scoring-chain.service.ts` | 记录 factor 生效列表 |
| `modifier/health-modifier-engine.service.ts` | 记录否决列表 |
| `recall/recall-merger.service.ts` | 记录各路召回数 |

**预计改动量**：~200 行新增，~50 行修改

---

### 3.2 推荐调试增强（方向 2）

**问题**：现有 `recommendation-debug` controller 只有 `simulate` 和 `why-not` 两个端点。Admin 缺乏：
- 查看历史推荐 trace 的能力
- 批量对比不同策略的推荐差异
- 查看食物在管道中的具体得分分解

**方案**：扩展现有 `recommendation-debug` controller 和 service。

#### 3.2.1 新增端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/admin/recommendation-debug/trace/:traceId` | GET | 查看历史推荐 trace 完整详情 |
| `/admin/recommendation-debug/traces` | GET | 分页查询推荐 trace 列表（按 userId/mealType/日期过滤） |
| `/admin/recommendation-debug/score-breakdown` | POST | 输入 userId + foodId，返回该食物在 14 维 + 10 因子 + 健康修正的完整得分分解 |
| `/admin/recommendation-debug/strategy-diff` | POST | 输入 userId + 两个 strategyId，对比两种策略下的推荐差异 |
| `/admin/recommendation-debug/pipeline-stats` | GET | 管道各阶段的聚合统计（平均耗时、平均候选数、降级频率） |

#### 3.2.2 修改文件清单

| 文件 | 改动 |
|------|------|
| `diet/admin/controllers/recommendation-debug.controller.ts` | 新增 5 个端点 |
| `diet/admin/services/recommendation-debug.service.ts` | 新增对应业务逻辑 |
| `diet/admin/dto/` | 新增请求/响应 DTO |

**预计改动量**：~400 行新增

---

### 3.3 策略系统增强（方向 3）

**问题**：策略系统功能完整但缺乏验证手段：
- 修改策略后无法预览效果
- 策略参数变更没有 diff 记录
- 自动调优结果缺乏人工审核流程

**方案**：增强现有 strategy admin controller。

#### 3.3.1 新增功能

| 功能 | 实现位置 | 描述 |
|------|----------|------|
| **策略模拟** | `strategy-management.controller.ts` | 新增 `POST /:id/simulate`：输入 userId 列表，模拟该策略下的推荐结果统计（不实际应用策略） |
| **策略 Diff** | `strategy-management.controller.ts` | 新增 `GET /:id/diff?compareWith=:otherId`：对比两个策略的 9 维参数差异 |
| **调优审核** | `strategy-management.controller.ts` | 新增 `GET /auto-tune/pending`：查看待审核的自动调优建议；`POST /auto-tune/:id/approve` / `reject`：人工审批 |
| **变更日志** | `strategy-management.service.ts` | 策略更新时自动记录 before/after diff 到 `strategy_tuning_log` 表（已有表） |

#### 3.3.2 AutoTuner 审核机制

当前 `StrategyAutoTuner` 在 Wilson score 显著时自动应用策略。改为：
- 自动调优结果写入 `strategy_tuning_log`，状态设为 `pending_review`
- Admin 可在后台查看、批准或拒绝
- 批准后才实际更新策略分配
- 新增 `feature_flag`: `strategy_auto_apply`（默认 `false`），为 `true` 时保留当前自动应用行为

#### 3.3.3 修改文件清单

| 文件 | 改动 |
|------|------|
| `strategy/admin/strategy-management.controller.ts` | 新增 4 个端点 |
| `strategy/admin/strategy-management.service.ts` | 新增模拟、diff、审核逻辑 |
| `strategy/app/strategy-auto-tuner.service.ts` | 改为 pending_review 模式 |
| `strategy/admin/dto/strategy-management.dto.ts` | 新增 DTO |

**预计改动量**：~350 行新增，~50 行修改

---

### 3.4 技术债务清理（方向 4）

**全量清理，不保留兼容层（项目未上线）**。

#### 3.4.1 清理清单

| # | 清理项 | 文件 | 改动 |
|---|--------|------|------|
| 1 | 删除死队列常量 `PROFILE_UPDATE`、`FEEDBACK_PROCESS` | `queue.constants.ts` | 删 2 行 |
| 2 | 删除线程不安全的 `setLocale()`/`getLocale()`/`currentLocale` | `i18n-messages.ts` | 删 ~20 行，迁移调用方 |
| 3 | 删除 `calcDiversityPenalty()` 兼容 shim | `daily-plan-context.service.ts` | 删 ~10 行，迁移调用方 |
| 4 | 删除 `merge()` 二路合并兼容 shim | `recall-merger.service.ts` | 删 ~15 行，迁移调用方 |
| 5 | 修复 CF-only `null as unknown as FoodLibrary` | `recall-merger.service.ts` | 改为 partial hydration 或标记 |
| 6 | Feedback → PreferenceUpdate 迁移到 `@OnEvent` | `feedback.service.ts` | 重构 ~40 行 |
| 7 | 清理 `i18n-messages.ts` 中已废弃函数的所有调用方 | 多个文件 | 搜索 + 替换 |

#### 3.4.2 执行策略

- 先搜索所有调用方，确认无外部依赖
- 逐项删除，每项之后 TypeScript 编译验证

**预计改动量**：~100 行删除，~60 行修改

---

### 3.5 性能优化（方向 5）

**问题**：推荐管道在高并发下存在冗余计算。

#### 3.5.1 优化项

| # | 优化项 | 现状 | 方案 | 预期收益 |
|---|--------|------|------|----------|
| 1 | **FoodScorer 14 维评分缓存** | 每次推荐对同一食物重复计算 14 维基础分 | 基础分按 food+goal 缓存到 RequestScopedCache（同一请求内去重） | 减少 40% 评分计算 |
| 2 | **ScoringChain factor 短路** | 10 个 factor 全部执行 `isApplicable` + `computeAdjustment` | 当候选分已低于阈值时提前跳过低优先级 factor | 减少 ~20% factor 执行 |
| 3 | **RealisticFilter 提前过滤** | 先召回再过滤，召回阶段可能包含大量不现实食物 | 将 commonality 和 budget 基础过滤上移到 recall 阶段的 category filter 中 | 减少 rank 阶段候选数 |
| 4 | **健康修正引擎批量处理** | 逐食物串行修正 | 先批量执行一票否决（最便宜的检查），淘汰后再对剩余食物执行后续层 | 减少无效计算 |

#### 3.5.2 修改文件清单

| 文件 | 改动 |
|------|------|
| `pipeline/food-scorer.service.ts` | 增加 RequestScopedCache 基础分缓存 |
| `scoring-chain/scoring-chain.service.ts` | 增加分数阈值短路逻辑 |
| `pipeline/pipeline-builder.service.ts` | recall 阶段增加基础现实性过滤 |
| `modifier/health-modifier-engine.service.ts` | 一票否决批量化 |

**预计改动量**：~150 行修改

---

## 4. 数据库变更

### 4.1 扩展 recommendation_traces 表

```sql
-- 已有表，扩展字段
ALTER TABLE recommendation_traces
  ADD COLUMN IF NOT EXISTS trace_data JSONB,           -- 完整 PipelineTrace JSON
  ADD COLUMN IF NOT EXISTS strategy_name VARCHAR(100),  -- 使用的策略名
  ADD COLUMN IF NOT EXISTS scene_name VARCHAR(50),      -- 场景名
  ADD COLUMN IF NOT EXISTS realism_level VARCHAR(20),   -- 现实性级别
  ADD COLUMN IF NOT EXISTS candidate_flow VARCHAR(50),  -- e.g. "384→152→30→5"
  ADD COLUMN IF NOT EXISTS total_duration_ms INTEGER,   -- 总耗时
  ADD COLUMN IF NOT EXISTS cache_hit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS degradations TEXT[];         -- 降级列表
```

### 4.2 扩展 strategy_tuning_log 表

```sql
-- 已有表，扩展字段
ALTER TABLE strategy_tuning_log
  ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'auto_applied',
    -- 'auto_applied' | 'pending_review' | 'approved' | 'rejected'
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS review_note TEXT;
```

### 4.3 无新增表

本次升级不新增数据库表，仅扩展已有表的字段。

---

## 5. 技术路线图

### Phase 1：技术债务清理 + 管道可观测性（基础层）

**目标**：清理历史技术债务，建立推荐管道的结构化追踪基础。

| ID | 任务 | 优先级 | 预估 |
|----|------|--------|------|
| P1-01 | 删除死队列常量 `PROFILE_UPDATE`、`FEEDBACK_PROCESS` | 低 | 10min |
| P1-02 | 删除 `calcDiversityPenalty()` 兼容 shim + 迁移调用方 | 低 | 30min |
| P1-03 | 删除 `merge()` 二路合并 shim + 迁移调用方 | 低 | 30min |
| P1-04 | 删除线程不安全 `setLocale()`/`getLocale()`/`currentLocale` + 迁移调用方 | 中 | 1h |
| P1-05 | 修复 CF-only `null as unknown as FoodLibrary` | 中 | 30min |
| P1-06 | Feedback → PreferenceUpdate 迁移到 `@OnEvent` | 高 | 1h |
| P1-07 | 定义 `PipelineTrace` 类型体系 | 高 | 30min |
| P1-08 | 在 `PipelineBuilderService` 各阶段埋入 trace 数据 | 高 | 2h |
| P1-09 | `RealisticFilterService` 记录过滤计数 | 中 | 30min |
| P1-10 | `ScoringChainService` 记录 factor 列表 | 中 | 20min |
| P1-11 | `HealthModifierEngine` 记录否决列表 | 中 | 20min |
| P1-12 | `RecallMergerService` 记录各路召回数 | 中 | 20min |
| P1-13 | `recommendation_traces` 表 Prisma schema 扩展 + migration | 中 | 30min |
| P1-14 | Trace 持久化逻辑（feature_flag 控制） | 中 | 1h |
| P1-15 | TypeScript 编译验证 | 高 | 10min |

**Phase 1 合计**：~15 项，预估 8-9 小时

---

### Phase 2：推荐调试增强 + 策略系统增强

**目标**：Admin 端获得完整的推荐调试工具链和策略管理增强。

| ID | 任务 | 优先级 | 预估 |
|----|------|--------|------|
| P2-01 | `GET /trace/:traceId` — 查看历史 trace | 高 | 1h |
| P2-02 | `GET /traces` — 分页查询 trace 列表 | 高 | 1h |
| P2-03 | `POST /score-breakdown` — 食物得分分解 | 高 | 2h |
| P2-04 | `POST /strategy-diff` — 策略推荐对比 | 中 | 2h |
| P2-05 | `GET /pipeline-stats` — 管道聚合统计 | 中 | 1h |
| P2-06 | 策略模拟 `POST /strategies/:id/simulate` | 中 | 2h |
| P2-07 | 策略 Diff `GET /strategies/:id/diff` | 低 | 1h |
| P2-08 | `strategy_tuning_log` 表扩展 + migration | 中 | 30min |
| P2-09 | AutoTuner 改为 pending_review 模式 | 中 | 2h |
| P2-10 | 调优审核端点 `GET /auto-tune/pending` + `POST approve/reject` | 中 | 1.5h |
| P2-11 | 策略变更自动记录 diff | 低 | 1h |
| P2-12 | TypeScript 编译验证 | 高 | 10min |

**Phase 2 合计**：~12 项，预估 15-16 小时

---

### Phase 3：性能优化

**目标**：优化推荐管道热路径，减少冗余计算。

| ID | 任务 | 优先级 | 预估 |
|----|------|--------|------|
| P3-01 | FoodScorer 14 维基础分 RequestScopedCache | 高 | 1.5h |
| P3-02 | ScoringChain 分数阈值短路 | 中 | 1h |
| P3-03 | RealisticFilter 基础过滤上移到 recall | 中 | 1.5h |
| P3-04 | 健康修正引擎一票否决批量化 | 中 | 1h |
| P3-05 | TypeScript 编译验证 | 高 | 10min |

**Phase 3 合计**：~5 项，预估 5-6 小时

---

## 6. 数据迁移方案

### 6.1 recommendation_traces 表扩展

- **迁移类型**：非破坏性，新增字段
- **回滚**：直接 `ALTER TABLE ... DROP COLUMN`
- **数据填充**：新字段默认 NULL，不需要回填旧数据

### 6.2 strategy_tuning_log 表扩展

- **迁移类型**：非破坏性，新增字段
- **回滚**：直接 `ALTER TABLE ... DROP COLUMN`
- **数据填充**：已有记录 `review_status` 设为 `'auto_applied'`（DDL DEFAULT 已处理）

### 6.3 无破坏性变更

本次升级不删除任何数据库字段、不重命名表、不修改已有字段类型。

---

## 7. 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Trace 数据量增长 | 磁盘占用 | 仅 admin simulate 返回完整 trace；生产环境通过 feature_flag 控制 |
| 技术债务清理导致编译错误 | 开发效率 | 逐项清理，每项后编译验证 |
| AutoTuner 改审核模式后策略更新滞后 | 策略时效性 | 保留 `strategy_auto_apply` feature_flag 可切换回自动模式 |
| 性能优化引入缓存一致性问题 | 推荐准确性 | RequestScopedCache 仅限请求内，生命周期短，无一致性风险 |

---

## 8. 总改动量预估

| 类别 | 新增 | 修改 | 删除 |
|------|------|------|------|
| TypeScript 代码 | ~1100 行 | ~310 行 | ~150 行 |
| Prisma Schema | ~15 行 | 0 | 0 |
| SQL Migration | ~20 行 | 0 | 0 |

**涉及文件**：~25 个

**不涉及**：前端代码、推荐算法核心逻辑（评分权重/因子公式）、用户画像核心服务、订阅/商业化模块
