# V7.9 升级方案 — 数据完整性 + AI补全增强 + 后台流程 + 增长优化

> 基于 V7.8 架构的版本演进，聚焦：食物数据库质量提升、AI补全能力增强、后台数据流优化、系统稳定性、增长能力。
> 强约束：不新增核心系统，不扩展业务边界，优先优化已有能力，渐进上线，低成本高收益。

---

## 一、能力评估（Step 1）

### 1.1 V7.8 已具备能力

| 能力域       | 状态    | 说明                                                                 |
| ------------ | ------- | -------------------------------------------------------------------- |
| 用户画像     | ✅ 成熟 | 3 层画像 + 事件驱动 + 领域模型（V7.8 exercise_intensity 合并完成）   |
| 推荐管道     | ✅ 成熟 | Recall→Rank→Rerank 三阶段 + 10 ScoringFactor + 14 维评分             |
| 策略引擎     | ✅ 双层 | V6 细粒度 Policy + V7.4 宏观策略 + V7.8 新增 6 个策略预设            |
| 场景系统     | ✅ 完整 | 12 场景 + 6 渠道 + 4 档 Realism + SceneResolver 行为学习             |
| 缓存         | ✅ 三级 | L0 请求级 + L1 内存 LRU + L2 Redis + 预热                            |
| 可解释性     | ✅ 深度 | 14 维解释 + 对比 + 替代 + 叙事体 + 多语言                            |
| 决策系统     | ✅ 可用 | SAFE/WARN/STOP 三级 + 替代建议 + 补偿方案                            |
| 商业化       | ✅ 基础 | 4 档订阅 + 配额门控 + Paywall 触发 + 解释分层                        |
| 食物数据管道 | ⚠️ 不足 | AI补全效果差，Prompt设计不合理，缺失字段多，候选食品库未充分利用     |
| 后台管理     | ⚠️ 不足 | API已有但流程不连贯，数据质量监控弱，批量操作能力不足                |
| AI补全系统   | ⚠️ 弱   | 一次性补全37个字段，Prompt过长，输出不可控，置信度判断粗糙           |
| 数据质量     | ⚠️ 弱   | 无宏量营养素交叉验证后修正，无同类食物一致性校验，去重仅在导入时触发 |

### 1.2 现存问题（按优先级）

#### 🔴 严重（直接影响核心体验）

| #   | 问题                                 | 影响                                                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------ |
| S1  | **AI补全效果差**                     | 一次请求补全 37 个字段，Prompt 过长导致 AI 输出质量低，confidence 普遍 < 0.7   |
| S2  | **食物数据缺失严重**                 | ~80% 食物缺少微量营养素，~60% 缺少 GI/GL，~50% 缺少 meal_types/common_portions |
| S3  | **AI补全失败后无恢复机制**           | callAI 3次重试后直接返回 null，数据永远缺失，无降级策略                        |
| S4  | **候选食品库(food_candidate)未利用** | 用户分析产生的 candidate 数据未回流到 foods 主库，数据积累浪费                 |

#### 🟡 高（影响系统质量）

| #   | 问题                          | 影响                                                            |
| --- | ----------------------------- | --------------------------------------------------------------- |
| H1  | **后台AI补全流程不完整**      | 缺少补全进度追踪、补全结果统计、失败任务重试管理                |
| H2  | **数据质量无持续监控**        | 质量报告只能手动触发，无告警，无趋势追踪                        |
| H3  | **AI直连DeepSeek绕过Gateway** | FoodEnrichmentService 直接 axios 调用，未经 AI Gateway 统一管控 |
| H4  | **推荐结果稳定性不足**        | 同一用户短时间内多次请求可能得到差异较大的推荐结果              |
| H5  | **使用频率不稳定**            | 食物分析入口输入成本高，结果可信度受数据质量影响                |

#### 🟢 中（影响可维护性/扩展性）

| #   | 问题                                  | 影响                                                                       |
| --- | ------------------------------------- | -------------------------------------------------------------------------- |
| M1  | **数据流断裂：分析→入库**             | 分析产生的食物数据只存 food_candidate，未自动流入 foods 补全流程           |
| M2  | **源优先级不一致**                    | FoodConflictResolverService 和 OrchestratorService 的 AI 优先级不同(50/40) |
| M3  | **enrichment 逐字段 NULL 扫描性能差** | scanMissingFields 对 37 个字段逐一发 SQL COUNT，数据量大时慢               |

---

## 二、核心升级方向（Step 2）— 5 个方向

### 方向 1：AI补全能力增强（解决 S1, S3）— 核心

**为什么需要：** 当前 AI 补全一次请求所有 37 个缺失字段，导致：

1. **Prompt 过长**：包含食物上下文 + 37 个字段描述 + 输出格式，总 token 可能超过 2000，AI 注意力分散
2. **输出不可控**：字段类型混杂（数值/枚举/JSON数组/JSON对象），AI 频繁格式错误
3. **全有或全无**：一个字段解析失败可能导致整条结果被 validateAndClean 丢弃
4. **无降级策略**：3 次重试均失败后数据永远缺失

**解决方案（多阶段分字段补全）：**

- 将 37 个字段分为 4 个补全阶段，按优先级和类型分组
- 每阶段独立 Prompt、独立验证、独立入库
- 前阶段补全结果作为后阶段的输入上下文
- 引入 fallback 机制：AI 失败时使用同类食物均值/规则推断

### 方向 2：食物数据质量体系（解决 S2, H2, M1）

**为什么需要：** 数据缺失严重但缺乏系统性的数据质量管理：

1. 无法量化「当前数据库健康度」
2. 无法追踪「补全进度趋势」
3. 宏量营养素交叉验证只做警告不做修正
4. 同类食物数据不一致（如同类蔬菜 GI 差异过大）

**解决方案：**

- 增强 validateAndClean：宏量营养素交叉验证 + 自动修正
- 新增同类食物一致性校验（基于 category+sub_category 的统计校验）
- 优化 scanMissingFields 为单次 SQL 聚合
- 新增数据完整度评分（per food + 全库）

### 方向 3：候选食品库→主库数据流打通（解决 S4, M1）

**为什么需要：** 用户食物分析每天产生候选食品(food_candidate)数据，但这些数据只在 candidate 表中积累，未流入 foods 主库和 AI 补全流程：

1. CandidateAggregationService 已有去重合并逻辑
2. 满足条件的 candidate (hits>=10, confidence>=0.8) 可被标记为 review_ready
3. 但 review_ready 的 candidate 没有自动进入 enrichment pipeline

**解决方案：**

- 新增 candidate→foods 的晋升流程
- 晋升后自动进入分阶段 AI 补全
- 后台管理界面增加 candidate 管理入口

### 方向 4：后台流程与数据流优化（解决 H1, H3, M2, M3）

**为什么需要：**

1. 补全任务入队后缺乏进度追踪和结果统计
2. FoodEnrichmentService 直接 axios 调用 DeepSeek，绕过 AI Gateway
3. 源优先级在两个 service 中定义不一致
4. 数据质量缺乏持续监控

**解决方案：**

- 补全任务增加进度统计和批量重试
- 统一源优先级常量
- 优化 scanMissingFields 性能
- 增强数据质量监控（自动报告 + 告警阈值）

### 方向 5：增长与稳定性优化（解决 H4, H5）

**为什么需要：**

1. 推荐结果在短时间内不稳定，影响用户信任
2. 食物分析输入成本高（需手动输入食物名称/拍照）
3. 数据质量直接影响「该不该吃」决策可信度
4. 转化路径中价值感知不足

**解决方案：**

- 推荐结果短期缓存 + 版本锚定
- 食物分析快捷入口（历史记录 + 常吃食物）
- 决策结果强化展示
- 数据质量驱动的可信度展示

---

## 三、架构升级设计（Step 3）

### 3.1 当前架构（V7.8）— 无新模块

```
FoodEnrichmentService (AI补全核心)
  ├── callAI() → DeepSeek (直连 axios)
  ├── buildEnrichmentPrompt() → 单次全字段补全
  ├── validateAndClean() → 基础范围校验
  └── shouldStage() → confidence < 0.7 转暂存

FoodPipelineOrchestratorService (管道编排)
  ├── Fetchers (USDA / OFF / CN)
  ├── Processing (Cleaner / Dedup / Conflict / RuleEngine)
  └── AI (Label / Translate / ImageRecog)

food_candidate → (手动审核) → foods (断裂)
```

### 3.2 V7.9 变更标注

```
变更类型说明: [新增] [修改] [删除] [数据]

FoodEnrichmentService
  ├── [修改] callAI() → 增加 timeout 分级 + 更智能的重试
  ├── [新增] enrichFoodByStage() → 分阶段补全（4阶段）
  ├── [新增] buildStagePrompt() → 按阶段构造精准 Prompt
  ├── [修改] validateAndClean() → 增强交叉验证 + 自动修正
  ├── [新增] fallbackFromCategory() → 同类食物均值降级
  ├── [新增] validateCrossNutrient() → 宏量营养素交叉验证
  ├── [新增] validateCategoryConsistency() → 同类一致性校验
  ├── [修改] scanMissingFields() → 单次 SQL 聚合优化
  └── [新增] computeCompletenessScore() → 数据完整度评分

FoodPipelineOrchestratorService
  ├── [新增] promoteCandidates() → 候选食品晋升流程
  ├── [新增] batchEnrichByStage() → 分阶段批量补全编排
  └── [修改] getSourcePriority() → 提取为共享常量

FoodEnrichmentController
  ├── [新增] POST enqueue-staged → 分阶段补全入队
  ├── [新增] GET progress → 补全进度统计
  ├── [新增] POST retry-failed → 失败任务批量重试
  └── [新增] GET completeness → 数据完整度报告

FoodEnrichmentProcessor
  └── [修改] process() → 支持分阶段任务 + fallback

数据层变更:
  └── [数据] 无 schema 变更 — 所有优化在应用层
```

### 3.3 不新增模块 — 仅修改现有模块

| 模块/文件                          | 变更类型 | 说明                                          |
| ---------------------------------- | -------- | --------------------------------------------- |
| food-enrichment.service.ts         | 修改     | 分阶段补全 + fallback + 交叉验证 + 完整度评分 |
| food-pipeline-orchestrator.service | 修改     | candidate晋升 + 分阶段批量编排                |
| food-enrichment.controller.ts      | 修改     | 新增进度/重试/完整度端点                      |
| food-enrichment.processor.ts       | 修改     | 支持分阶段任务处理                            |
| food-quality-monitor.service.ts    | 修改     | 增强质量报告 + 完整度趋势                     |
| food-data-cleaner.service.ts       | 修改     | 增强交叉验证修正                              |

---

## 四、模块级升级设计（Step 4）

### 4.1 AI补全分阶段设计（核心变更）

**4 个补全阶段：**

| 阶段 | 名称       | 字段                                                                                          | 说明                    |
| ---- | ---------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| 1    | 核心营养素 | protein, fat, carbs, fiber, sugar, sodium, calories(校验)                                     | 最关键，影响决策和推荐  |
| 2    | 微量营养素 | calcium, iron, potassium, cholesterol, vitamin_a/c/d/e/b12, folate, zinc, magnesium, etc      | 需要阶段1结果作为上下文 |
| 3    | 健康属性   | glycemic_index, glycemic_load, fodmap_level, oxalate_level, processing_level, allergens, tags | 需要营养素数据辅助判断  |
| 4    | 使用属性   | meal_types, common_portions, flavor_profile, cuisine, cooking_method, commonality_score, etc  | 最主观，优先级最低      |

**每阶段独立 Prompt 设计原则：**

1. System message 不变（权威食品营养数据库专家）
2. User prompt 只包含当前阶段需要的字段（3-10个）
3. 前阶段已补全的字段加入「已知数据」上下文
4. 输出格式简化（每阶段仅 3-10 个字段的 JSON）
5. max_tokens 按阶段调整（阶段1: 400, 阶段2: 600, 阶段3: 500, 阶段4: 800）

**Fallback 降级策略：**

1. AI 补全失败 → 查找同 category + sub_category 的已有食物取均值
2. 同类食物不足 → 查找同 category 的食物取均值
3. 均值也不足 → 标记为 `needs_manual_review`，不填充
4. 规则可推断的字段（如 is_processed 由 processing_level 推断）直接规则填充

### 4.2 数据质量增强

**交叉验证与自动修正：**

```
宏量营养素公式：expected_cal = protein*4 + carbs*4 + fat*9 + fiber*2
误差率 = |calories - expected_cal| / calories

if 误差率 > 25%:
  - 如果 calories 来自权威数据源(USDA/CN) → 按 calories 反推 macro 比例微调
  - 如果 calories 来自 AI → 用 macro 重算 calories
  - 记录修正日志
```

**同类一致性校验：**

```
对同 category + sub_category 的食物：
1. 计算 calories/protein/fat/carbs 的 IQR（四分位距）
2. 超出 Q1-1.5*IQR 或 Q3+1.5*IQR 的标记为异常值
3. 异常值不自动修正，标记 needs_review + 日志
```

**数据完整度评分（per food）：**

```
completeness_score = 加权计算
  - 核心营养素(6字段): 权重 0.40 → 每字段非NULL得 0.40/6
  - 微量营养素(15字段): 权重 0.25 → 每字段非NULL得 0.25/15
  - 健康属性(7字段): 权重 0.20 → 每字段非NULL得 0.20/7
  - 使用属性(9字段): 权重 0.15 → 每字段非NULL得 0.15/9
```

### 4.3 候选食品晋升流程

```
food_candidate (review_ready)
  → 去重检查 (FoodDedupService.findDuplicate)
  → 如果重复: 合并数据到已有 food
  → 如果新食物: 创建 foods 记录 (status=draft)
  → 自动入队分阶段 AI 补全
  → 补全完成后 status → active
  → 触发 CANDIDATE_PROMOTED 事件（已有）
```

### 4.4 后台流程优化

**补全进度统计：**

- 当前批次进度（已完成/总数/失败数）
- 按阶段的补全成功率
- 按字段的补全覆盖率变化趋势

**失败任务管理：**

- 查看 DLQ 中的失败任务
- 一键重试失败任务
- 失败原因统计（API超时/格式错误/范围越界）

**源优先级统一：**

```typescript
// 提取到 packages/constants/source-priority.ts
export const SOURCE_PRIORITY: Record<string, number> = {
  usda: 100,
  cn_food_composition: 95,
  openfoodfacts: 80,
  manual: 70,
  ai: 50,
  crawl: 30,
};
```

### 4.5 增长与稳定性

**推荐结果稳定性：**

- 同一用户 30 分钟内的推荐请求返回缓存结果（已有 L2 缓存，增加粘性窗口）
- 推荐结果附带版本号，刷新时告知用户「已更新」vs「未变化」

**食物分析快捷入口：**

- 用户最近分析记录作为快捷入口
- 「常吃食物」列表（基于 food_records 频率）
- 减少重复输入

**决策可信度展示：**

- 决策结果附带数据质量评分
- 当数据完整度 > 80% 时显示「高可信度」标识
- 数据完整度低时提示「基于有限数据的参考结果」

---

## 五、技术路线图（Step 5）

### Phase 1（快速收益 — 修 AI 补全 + 修关键流程）

> 目标：解决 AI 补全效果差的根本问题，建立分阶段补全能力

| 编号 | 任务                                                             | 优先级 | 预估影响    |
| ---- | ---------------------------------------------------------------- | ------ | ----------- |
| P1-A | 食物补全分阶段常量定义（ENRICHMENT_STAGES 4阶段字段分组）        | 高     | +60 行      |
| P1-B | 分阶段 Prompt 构造器（buildStagePrompt 4 个专用 Prompt 模板）    | 高     | +200 行     |
| P1-C | 分阶段补全核心方法（enrichFoodByStage 逐阶段调用+结果累积）      | 高     | +120 行     |
| P1-D | Fallback 降级机制（fallbackFromCategory 同类均值/规则推断）      | 高     | +100 行     |
| P1-E | 交叉验证增强（validateCrossNutrient 宏量营养素一致性修正）       | 高     | +80 行      |
| P1-F | Processor 支持分阶段任务（enrichment processor 识别 stage 参数） | 高     | +40 行      |
| P1-G | scanMissingFields 性能优化（单次 SQL 聚合替代 37 次查询）        | 中     | 修改 ~50 行 |
| P1-H | 数据完整度评分（computeCompletenessScore per food）              | 中     | +60 行      |
| P1-I | Controller 新增端点（分阶段入队 + 进度 + 重试）                  | 中     | +120 行     |
| P1-J | 源优先级统一（提取常量，修改两处引用）                           | 低     | ±15 行      |
| P1-K | 编译验证 + 测试                                                  | 高     | 0           |

### Phase 2（体验优化 — 数据质量 + 后台 + 候选库）

> 目标：建立数据质量体系，打通候选食品流转

| 编号 | 任务                                                            | 优先级 | 预估影响 |
| ---- | --------------------------------------------------------------- | ------ | -------- |
| P2-A | 同类食物一致性校验（validateCategoryConsistency IQR 检测）      | 高     | +80 行   |
| P2-B | 候选食品晋升流程（promoteCandidates → dedup → create → enrich） | 高     | +100 行  |
| P2-C | 候选食品晋升 Controller 端点                                    | 中     | +40 行   |
| P2-D | 数据质量监控增强（completeness 趋势 + 告警阈值）                | 中     | +80 行   |
| P2-E | 补全结果统计（按阶段成功率 + 按字段覆盖率）                     | 中     | +60 行   |
| P2-F | 失败任务批量重试（retry-failed 端点 + DLQ 读取）                | 中     | +50 行   |
| P2-G | 编译验证 + 测试                                                 | 高     | 0        |

### Phase 3（增长优化 — 使用频率 + 转化率）

> 目标：提升用户使用频率和付费转化

| 编号 | 任务                                                              | 优先级 | 预估影响 |
| ---- | ----------------------------------------------------------------- | ------ | -------- |
| P3-A | 推荐结果粘性缓存（30min 窗口内返回稳定结果）                      | 高     | +30 行   |
| P3-B | 决策结果可信度展示（completeness→confidence 映射 + API 响应扩展） | 高     | +40 行   |
| P3-C | 食物分析快捷入口（最近分析 + 常吃食物 API）                       | 中     | +60 行   |
| P3-D | 分析结果缓存（相同食物名 24h 内复用分析结果）                     | 中     | +40 行   |
| P3-E | 决策价值强化（决策结果增加营养差距提示 + 改善建议优化）           | 中     | +50 行   |
| P3-F | 编译验证 + 测试                                                   | 高     | 0        |

---

## 六、数据迁移（Step 6）

### 6.1 无 Schema 变更

V7.9 所有优化在应用层实现，不修改 Prisma schema。
已有的 `foods` 表字段足以支撑所有优化：

- `confidence` 字段存储 AI 补全置信度
- `data_version` 字段追踪数据版本
- `food_change_logs` 记录所有变更审计
- `food_candidate` 表已有晋升所需的所有字段

### 6.2 数据填充

```sql
-- 无需执行 —— 所有数据填充通过 AI 分阶段补全 + fallback 自动完成
```

---

## 七、风险与限制

### 7.1 AI 数据不准确

- **风险**：AI 估算的营养数据可能与实际偏差较大
- **缓解**：分阶段补全提高单阶段精度 + 交叉验证 + 同类一致性校验 + confidence 分级
- **兜底**：低于 0.6 confidence 的数据强制 staging，高于 0.7 的标记为「AI估算」

### 7.2 系统复杂度增加

- **风险**：分阶段补全增加了管道复杂度
- **缓解**：每阶段独立可测试，向后兼容（旧的全字段补全仍可用），渐进上线

### 7.3 Fallback 质量

- **风险**：同类食物均值作为 fallback 可能不够精准
- **缓解**：均值仅用于核心营养素（6个字段），其他字段不使用均值 fallback

### 7.4 性能影响

- **风险**：分阶段补全需要 4 次 AI 调用（vs 原来 1 次）
- **缓解**：单次调用更快（token少），总体成功率更高，失败后只需重试失败阶段

---

## 八、文档升级（Step 7）— 差异输出

### 新增章节

- `docs/INTELLIGENT_DIET_SYSTEM_V7_9_UPGRADE.md` — 本文件

### 修改内容

- 无需修改旧版文档（各版本独立）

### 删除内容

- 无

---

## 九、Phase 3 实现记录（增长优化）

### 9.1 推荐结果粘性缓存（Phase 3-1）

**修改文件**: `modules/diet/app/services/food.service.ts`

**实现方案**:

- 内存 Map 缓存，键 = `userId:mealType:date`
- TTL 5分钟，同一用户+餐次在窗口内返回相同推荐
- 智能失效：用户已摄入热量变化超过 10kcal 自动失效（说明记录了新饮食）
- 容量淘汰：上限 500 条，超限时清理最旧一半
- 覆盖预计算命中和实时计算两条路径

**效果**: 避免用户短时间内反复请求推荐时结果跳变，提升体验一致性

### 9.2 决策可信度展示（Phase 3-2）

**修改文件**:

- `recommendation/types/meal.types.ts` — 新增 `dataConfidence` 和 `DecisionValueTag` 类型
- `recommendation/meal/meal-assembler.service.ts` — `aggregateMealResult()` 中自动计算

**实现方案**:

- `dataConfidence`: 基于每道食物的 `confidence` 字段按热量占比加权平均
- 热量占比高的食物对整餐可信度影响更大
- 原始 confidence（0-100）归一化到 0-1 输出

### 9.3 食物分析快捷入口（Phase 3-3）

**修改文件**: `food/app/controllers/food-analyze.controller.ts`

**新增端点**: `GET /api/app/food/analyze-quick/:foodId`

**实现方案**:

- 直接从 `foods` 表查询食物数据，零 AI 调用
- 基于食物属性（quality_score, nutrient_density 等）构建 FoodAnalysisResultV61
- 简化决策逻辑：quality_score >= 70 → recommend, >= 40 → caution, < 40 → avoid
- 不消耗 AI 分析配额，限流 60次/分钟
- 保持与文本/图片分析相同的返回结构，前端无需适配

### 9.4 分析结果缓存（Phase 3-4）

**修改文件**: `food/app/controllers/food-analyze.controller.ts`

**实现方案**:

- 内存 Map 缓存，键 = SHA256(userId + mealType + text)，取前24位
- TTL 10分钟
- 缓存命中时不消耗 AI 分析配额（在配额扣减之前检查）
- 缓存存储完整结果，读取时按当前订阅等级实时裁剪（处理订阅变更场景）
- 容量淘汰：上限 200 条，超限时清理最旧一半

### 9.5 决策价值强化（Phase 3-5）

**修改文件**:

- `recommendation/types/meal.types.ts` — 新增 `DecisionValueTag` 接口
- `modules/diet/app/services/food.service.ts` — `generateDecisionValueTags()` 方法

**新增类型**:

```typescript
interface DecisionValueTag {
  type: 'compliance' | 'achievement' | 'warning' | 'bonus';
  label: string;
  dimension?: string;
  value?: number;
  target?: number;
}
```

**标签生成规则**:

- **compliance**: 热量在预算内 / 热量略超预算
- **achievement**: 蛋白质充足（达到日目标 90%+）
- **bonus**: 今日热量进度正常（70%~105%）
- **goal-specific**: 减脂目标下低热量加分 / 增肌目标下高蛋白加分

**效果**: 推荐返回中新增 `decisionValueTags` 字段，前端可直接渲染为结构化标签
