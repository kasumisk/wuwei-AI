# V8.2 升级方案 — 食物管理增强 + AI补全模块增强（第二轮迭代）

> 基于 V8.1 架构的版本演进，不新增核心系统，不扩展业务边界
> **严格限制修改范围：仅允许优化「食物管理」和「AI数据补全」两个模块**
> 聚焦：Bug修复、字段覆盖补全、统计面板修正、AI提示词优化、数据完整度校准、冗余清理

---

## 一、V8.1遗留问题分析

### 1.1 统计面板与进度面板异常

| 编号 | 问题                                                                               | 根因                                                                                                                                                                                          | 严重度 |
| ---- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| S1   | `/enrichment/stats` 统计面板异常                                                   | 仅显示BullMQ队列快照，`removeOnComplete:200`/`removeOnFail:100`导致历史数据被裁剪，计数不准确                                                                                                 | 🔴     |
| S2   | 全库补全进度面板为空                                                               | `getEnrichmentProgress`的`fullyEnriched`/`partiallyEnriched`/`notEnriched`仅基于6个核心营养素字段计算，而非`data_completeness`列；`avgCompleteness`取的是阶段覆盖率均值而非真实食物平均完整度 | 🔴     |
| S3   | `getEnrichmentProgress`与`getTaskOverview`/`getCompletenessDistribution`数据不一致 | 三个方法使用不同的完整度计算逻辑                                                                                                                                                              | 🔴     |
| S4   | `statistics-v81`端点不可达                                                         | 路由定义在`:id`通配符之后，被`:id`拦截                                                                                                                                                        | 🔴     |

### 1.2 字段覆盖缺失

| 编号 | 问题                                                       | 影响                                                   |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------ |
| F1   | `food_form`不在`ENRICHABLE_FIELDS`中                       | 未被AI补全、未在enrichmentMeta中展示、未参与完整度计算 |
| F2   | `required_equipment`不在`ENRICHABLE_FIELDS`中              | 同上                                                   |
| F3   | `processing_level`默认值为1，永远非null                    | AI永远不会补全此字段                                   |
| F4   | `commonality_score`默认值为50，永远非null                  | 同上                                                   |
| F5   | `compatibility`默认值`{}`，`enrichFoodByStage`不检测空对象 | 完整度显示缺失但补全不触发                             |
| F6   | `available_channels`默认值非空数组                         | AI永远跳过此字段，无法按食物定制                       |

### 1.3 AI提示词问题

| 编号 | 问题                                                                          | 影响                                                              |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P1   | Stage 2（微量营养素）24个字段仅800 maxTokens                                  | JSON响应约需1200+ tokens，频繁截断导致解析失败                    |
| P2   | `skill_required` FIELD_DESC值`intermediate`/`professional`超过VarChar(10)限制 | 数据库静默截断                                                    |
| P3   | 提示词缺少显式字段类型说明                                                    | AI返回类型不匹配增多                                              |
| P4   | 阶段间上下文传递不足                                                          | stages 3-5仅获得10个硬编码字段的上下文，缺少stage 2微量营养素信息 |
| P5   | AI返回null的字段不重试                                                        | 字段永久留空直到下次补全                                          |

### 1.4 冗余与代码质量

| 编号 | 问题                                                      | 处理                                                    |
| ---- | --------------------------------------------------------- | ------------------------------------------------------- |
| R1   | 旧版`enrichFood()`单次调用方法与`enrichFoodByStage()`并存 | 移除旧版，统一使用分阶段                                |
| R2   | `isFieldFilled`/`computeGroupScore`在两处重复定义         | 提取为私有方法                                          |
| R3   | 注释说"4阶段"实际是5阶段                                  | 修正注释                                                |
| R4   | `enrichFoodNow` staged模式下提前写入`data_completeness`   | staged审核通过后才应更新                                |
| R5   | `getFoodsNeedingEnrichment`返回请求字段而非实际缺失字段   | 返回per-food实际缺失字段                                |
| R6   | `cooking_method`(已废弃)和`cooking_methods`并存           | 保留`cooking_methods`，`cooking_method`标记废弃不再补全 |

---

## 二、V8.2升级方案

### Phase 1：Bug修复 + 字段补全 + 冗余清理

#### 1.1 修复统计面板（S1-S4）

**修复 `/enrichment/stats`（S1）：**

- 增加数据库维度的历史统计：从`foods`表聚合`enrichment_status`计数
- 保留队列快照作为"实时队列状态"子项
- 返回结构增加`historical`字段

```typescript
// 修复后的stats返回结构
{
  queue: { waiting, active, completed, failed, delayed },
  historical: {
    total: number,
    enriched: number,       // enrichment_status in ('completed','ai_enrichment_staged','ai_enrichment_approved')
    pending: number,        // enrichment_status = 'pending' or null
    failed: number,         // enrichment_status = 'ai_enrichment_failed'
    staged: number,         // enrichment_status = 'ai_enrichment_staged'
    avgCompleteness: number // AVG(data_completeness)
  }
}
```

**修复 `getEnrichmentProgress`（S2-S3）：**

- `avgCompleteness`改用`AVG(COALESCE(data_completeness, 0))`
- `fullyEnriched`/`partiallyEnriched`/`notEnriched`改用`data_completeness`列
- 与`getTaskOverview`/`getCompletenessDistribution`统一计算口径

**修复 `statistics-v81` 路由（S4）：**

- 将`@Get('statistics-v81')`移到`:id`通配符路由之前

#### 1.2 补全字段覆盖（F1-F6）

**新增`food_form`到补全体系：**

- 加入`ENRICHABLE_FIELDS`
- 加入Stage 5（扩展属性）的fields列表
- 加入`ENRICHMENT_FIELD_LABELS`和`ENRICHMENT_FIELD_UNITS`
- 加入`ENRICHABLE_STRING_FIELDS`

**新增`required_equipment`到补全体系：**

- 同上，加入Stage 5的fields列表
- 类型为JSON数组，加入`JSON_ARRAY_FIELDS`

**修复默认值导致的跳过问题（F3-F6）：**

- `enrichFoodByStage`的缺失字段检测增加：
  - 对`processing_level`/`commonality_score`：默认值视为"未补全"（`processing_level === 1`且source为空 → 视为缺失）
  - 对`compatibility`：空对象`{}`视为缺失
  - 对`available_channels`：检查`field_sources`中是否有此字段的来源记录，无记录则视为未定制

#### 1.3 冗余清理（R1-R6）

- **R1**：移除`enrichFood()`方法和`buildEnrichmentPrompt()`，processor改用`enrichFoodByStage()`
- **R2**：将`isFieldFilled`和`computeGroupScore`提取为类私有方法
- **R3**：修正所有"4阶段"注释为"5阶段"
- **R4**：`enrichFoodNow` staged模式不再立即更新`data_completeness`和`enrichment_status`
- **R5**：`getFoodsNeedingEnrichment`返回per-food实际缺失字段列表
- **R6**：`cooking_method`从ENRICHABLE_FIELDS移除（保留数据库字段），仅保留`cooking_methods`

#### 1.4 食品详情字段显示修复

- `buildEnrichmentMeta`的`fieldDetails`自动包含新增的`food_form`和`required_equipment`
- 确保`findOne`返回所有64+2=66个可补全字段的详情

### Phase 2：AI提示词优化 + 批量补全增强

#### 2.1 AI提示词优化（P1-P5）

**Stage 2 Token预算修复（P1）：**

- `maxTokens`从800提升到1600
- Stage 5同步提升到1000（14+2字段）

**字段类型描述强化（P3）：**

- `FIELD_DESC`每个字段增加显式类型标注
- 示例：`vitamin_a: "维生素A含量(μg RAE/100g) [数值型，范围0-50000]"`

**`skill_required`值域修复（P2）：**

- FIELD_DESC改为`"easy/medium/hard"`（匹配VarChar(10)限制）
- NUTRIENT_RANGES对应调整验证

**阶段间上下文增强（P4）：**

- `buildStagePrompt`传递所有已累积数据（不限于10个硬编码字段）
- 格式：`已补全数据: { protein: 12.5, vitamin_a: 350, ... }`

**Null字段智能重试（P5）：**

- 单次AI调用中返回null的字段，在当前阶段末尾做一次targeted retry
- 仅重试AI主动返回null（非验证拦截）的字段
- retry使用更具针对性的prompt（"请重点估算以下字段"）

#### 2.2 批量补全增强

**增加批量补全进度回调：**

- 补全processor在每个食物完成后发布进度事件
- `task-overview`增加实时进度百分比

**批量补全结果汇总：**

- 批量任务完成后生成汇总报告（成功/失败/跳过字段数）

### Phase 3：数据质量控制 + 审核优化

#### 3.1 数据完整度校准

**`computeSimpleCompleteness`增强：**

- 纳入`food_form`和`required_equipment`
- 对默认值字段（`processing_level=1`, `commonality_score=50`）：检查`field_sources`判断是否真正被补全过
- Stage 5权重从0.10调整为0.10（维持，因新增字段的影响由Stage内字段数平摊）

**完整度一致性保障：**

- 所有涉及完整度的方法统一使用`data_completeness`列
- `approveStaged`/`enrichFoodNow`（非staged模式）入库时同步更新`data_completeness`

#### 3.2 审核机制优化

**补全质量评分：**

- 每次补全计算质量指标：`fieldsFilled / fieldsRequested` 比率
- 记录到enrichment日志

**审核效率提升：**

- `batch-review`支持按完整度范围筛选待审核食物
- 审核预览增加同类食物对比参考值

#### 3.3 补全策略优化

**智能阶段跳过：**

- 如果某阶段所有字段均已填充，自动跳过（减少不必要的AI调用）
- 已有逻辑但需确认完备性

**失败字段精细管理：**

- `failed_fields`增加失败原因分类（`ai_null` / `validation_failed` / `api_error`）
- 支持按失败原因筛选和针对性重试

---

## 三、修改范围清单

### 需修改的文件

| 文件                                                       | Phase | 修改内容                                              |
| ---------------------------------------------------------- | ----- | ----------------------------------------------------- |
| `food-pipeline/services/food-enrichment.service.ts`        | 1,2,3 | stats修复、字段覆盖、冗余清理、提示词优化、完整度校准 |
| `food-pipeline/controllers/food-enrichment.controller.ts`  | 1     | stats端点增强                                         |
| `food-pipeline/food-enrichment.processor.ts`               | 1     | 改用enrichFoodByStage                                 |
| `modules/food/admin/food-library-management.controller.ts` | 1     | statistics-v81路由修复                                |
| `modules/food/admin/food-library-management.service.ts`    | 1,3   | 字段覆盖、完整度校准                                  |
| `modules/food/food.types.ts`                               | 1     | LABELS/UNITS新增字段                                  |

### 不修改的模块

- 推荐系统
- 用户画像
- 决策系统
- 可解释性系统
- 订阅/商业化
- Prisma schema（不新增数据库字段）
- 其他所有非食物管理/AI补全模块

---

## 四、验证计划

每个Phase完成后执行编译验证：

```bash
cd /Users/xiehaiji/project/outsourcing/wuwei-AI && npx tsc --noEmit --project apps/api-server/tsconfig.json
```

### Phase 1 验证点

- [ ] `GET /enrichment/stats` 返回包含historical的完整结构
- [ ] `GET /enrichment/progress` 返回基于data_completeness的准确数据
- [ ] `GET /admin/food-library/statistics-v81` 可达
- [ ] `food_form`和`required_equipment`出现在enrichmentMeta.fieldDetails中
- [ ] 旧版`enrichFood()`已移除
- [ ] 编译通过

### Phase 2 验证点

- [ ] Stage 2 maxTokens = 1600
- [ ] FIELD_DESC包含类型标注
- [ ] `skill_required`值域为easy/medium/hard
- [ ] 阶段间传递完整累积数据
- [ ] 编译通过

### Phase 3 验证点

- [ ] 完整度计算包含food_form和required_equipment
- [ ] 默认值字段的完整度判断使用field_sources
- [ ] failed_fields包含失败原因分类
- [ ] 编译通过
