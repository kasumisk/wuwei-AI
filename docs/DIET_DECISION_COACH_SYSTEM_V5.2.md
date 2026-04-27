# Diet Decision + AI Coach System V5.2 — 设计文档

## 概述

V5.2 在 V5.1 基础上进行深度优化，核心目标：

1. **统一分析提示词**：Text/Image 两条路径合并为一套提示词构建逻辑，消除代码冗余
2. **提示词 i18n 迁移**：将 `analysis-prompt-schema.ts` 中 5 个大型三语 Record 迁移到 labels 文件
3. **字段名对齐修复**：`fodmap`→`fodmapLevel`、`oxalate`→`oxalateLevel` 与 DB 完全对齐
4. **决策系统解耦**：评分/判定/替代/解释各环节职责更清晰
5. **可解释性增强**：决策链路每步可追溯，冲突解释更具体
6. **i18n 最终收尾**：消除所有残留内联翻译

### 约束

- **不修改**：推荐系统、用户画像系统、订阅/商业逻辑（只读）
- **不新增** DB 字段或模块（模块内新增文件可以）
- **不兼容** 旧版——自由优化
- Logger 消息：纯英文
- 用户可见错误消息：英文（前端处理显示）
- `text-food-analysis.service.ts` 中的中文 NLP 逻辑不可修改
- i18n：`cl(key, locale)` 为主系统

---

## 当前问题分析

### 问题 1：分析提示词 i18n 内联

`analysis-prompt-schema.ts` 中存在 5 个大型 `Record<string, string>` 内联翻译：

| 变量                    | 行数    | 说明              |
| ----------------------- | ------- | ----------------- |
| `FOOD_JSON_SCHEMA`      | ~250 行 | JSON 输出格式模板 |
| `ESTIMATION_RULES`      | ~115 行 | 估算规则和参考值  |
| `UNIFIED_SYSTEM_ROLE`   | 6 行    | 系统角色定义      |
| `JSON_ONLY_INSTRUCTION` | 6 行    | JSON-only 指令    |
| `USER_MESSAGE_TEMPLATE` | 12 行   | 用户消息模板      |

另外 `buildUserContextPrompt()` 中有 2 个内联 Record：`nearLabel`、`precisionNote`

**解决方案**：全部迁移到 `labels-zh/en/ja.ts` 通过 `cl()` 访问。由于 JSON Schema 和 Rules 是超长文本，使用 `cl('prompt.schema.foods', locale)` 等 key 存储完整文本块。

### 问题 2：字段名不匹配

提示词返回 `fodmap` / `oxalate`，但 DB 存储为 `fodmapLevel` / `oxalateLevel`。

**解决方案**：

- 提示词 JSON Schema 中字段名改为 `fodmapLevel` / `oxalateLevel`
- `AnalyzedFoodItem` 接口对应修改
- LLM 返回解析时做兼容映射（旧字段名→新字段名）

### 问题 3：Text/Image 提示词分离

- Text 路径：library-first → 只对未匹配项调 LLM → 使用 `buildBasePrompt()` + `buildUserContextPrompt()`
- Image 路径：直接调 vision LLM → 使用相同的 `buildGoalAwarePrompt()` 但用户消息硬编码英文

**解决方案**：

- Image 路径的用户消息改用 `getUserMessage('image', hint, locale)`（已有但未使用）
- Image 路径确保使用完整的 `buildGoalAwarePrompt()` 作为 system prompt
- 两条路径在提示词层面完全统一，只有输入形式不同（text vs multipart）

---

## 三阶段实施计划

### Phase 1：统一分析提示词 + 提示词 i18n 迁移 + 字段对齐

| #    | 目标                        | 说明                                                                                                                                                                   |
| ---- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | **提示词文本迁移到 labels** | 将 `FOOD_JSON_SCHEMA`、`ESTIMATION_RULES`、`UNIFIED_SYSTEM_ROLE`、`JSON_ONLY_INSTRUCTION`、`USER_MESSAGE_TEMPLATE` 的内容迁移到 `labels-zh/en/ja.ts`，通过 `cl()` 访问 |
| P1.2 | **内联 Record 消除**        | `buildUserContextPrompt()` 中的 `nearLabel`、`precisionNote` 迁移到 labels                                                                                             |
| P1.3 | **字段名修复**              | `fodmap`→`fodmapLevel`、`oxalate`→`oxalateLevel`，提示词 + 类型 + 解析兼容                                                                                             |
| P1.4 | **Image 路径对齐**          | Image 服务使用 `getUserMessage('image', ...)` 代替硬编码英文                                                                                                           |
| P1.5 | **tsc 0 errors**            | 确保编译通过                                                                                                                                                           |

### Phase 2：决策系统优化 + 评分增强

| #    | 目标                   | 说明                                                                             |
| ---- | ---------------------- | -------------------------------------------------------------------------------- |
| P2.1 | **评分维度权重动态化** | 根据用户目标阶段（减脂期/增肌期/维持期）动态调整 7 维权重，替代固定配置          |
| P2.2 | **决策因子可追溯**     | 每个 verdict 附带具体触发因子链（哪个维度 → 哪个阈值 → 什么数据导致）            |
| P2.3 | **替代推荐评分对比**   | 替代食物不仅显示推荐，还展示与原食物的具体差异指标（卡路里差、蛋白质差、评分差） |
| P2.4 | **决策缓存优化**       | 相同用户 + 相同食物 + 相同时段的决策结果短期缓存，避免重复计算                   |
| P2.5 | **tsc 0 errors**       | 确保编译通过                                                                     |

### Phase 3：AI Coach 优化 + 可解释性增强

| #    | 目标                   | 说明                                                             |
| ---- | ---------------------- | ---------------------------------------------------------------- |
| P3.1 | **冲突解释具体化**     | 冲突解释包含：触发食物名 + 触发营养素值 + 超标量 + 健康影响      |
| P3.2 | **决策链路可视化数据** | 返回结构化决策路径（analysis→scoring→decision 每步的关键数据点） |
| P3.3 | **Coach 语言自适应**   | Coach 输出完全根据用户 locale 生成，消除任何硬编码语言           |
| P3.4 | **教育性内容分级**     | 根据用户使用频次，新用户给详细教育，老用户给简洁要点             |
| P3.5 | **最终 i18n 审计**     | 全模块扫描，确保零内联翻译残留                                   |
| P3.6 | **tsc 0 errors**       | 确保编译通过                                                     |

---

## 文件修改范围

### Phase 1

- `apps/api-server/src/modules/food/app/services/analysis-prompt-schema.ts` — 重构为瘦访问层
- `apps/api-server/src/modules/food/app/services/image-food-analysis.service.ts` — 对齐用户消息
- `apps/api-server/src/modules/decision/i18n/labels-zh.ts` — 添加 prompt.\* keys
- `apps/api-server/src/modules/decision/i18n/labels-en.ts` — 同上
- `apps/api-server/src/modules/decision/i18n/labels-ja.ts` — 同上
- `apps/api-server/src/modules/decision/types/food-item.types.ts` — fodmapLevel/oxalateLevel
- `apps/api-server/src/modules/food/app/services/text-food-analysis.service.ts` — 字段兼容映射

### Phase 2

- `apps/api-server/src/modules/decision/config/scoring-dimensions.ts` — 动态权重
- `apps/api-server/src/modules/decision/decision/decision-engine.service.ts` — 因子追溯
- `apps/api-server/src/modules/decision/decision/alternative-suggestion.service.ts` — 评分对比增强

### Phase 3

- `apps/api-server/src/modules/decision/coach/decision-coach.service.ts` — 冲突具体化
- `apps/api-server/src/modules/decision/analyze/analysis-pipeline.service.ts` — 链路数据
- `apps/api-server/src/modules/decision/i18n/labels-*.ts` — 最终清理

---

## 决策链路设计（V5.2 增强）

```
用户输入（文本/图片）
  → 食物识别（text-food-analysis / image-food-analysis）
     ↓ 统一提示词层（buildGoalAwarePrompt via cl()）
     ↓ 字段对齐（fodmapLevel/oxalateLevel）
  → 食物库匹配（food-library.service）
  → [管线入口：analysis-pipeline.service]
     Stage 1 — 分析：
       → 营养聚合（per-100g → per-serving）
       → 用户上下文构建（画像 + 当日摄入 + 目标）
       → 评分（7维 + 健康调整 + 动态权重）[V5.2: 权重按目标阶段动态化]
       → 上下文分析（问题检测 + 宏量进度）
     Stage 2 — 决策：
       → 决策引擎（verdict + 4因子结构化）[V5.2: 因子链路追溯]
       → 替代推荐（推荐引擎主路径 + 评分对比）[V5.2: 对比指标]
       → 决策摘要
     Stage 3 — 教练：
       → 教练解释（tone-aware, i18n, 冲突具体化）[V5.2: 具体化]
       → 行动计划
       → 决策链路数据 [V5.2: 新增]
  → 响应组装
```

---

## i18n Key 命名规范（Phase 1 新增）

提示词相关 keys 统一使用 `prompt.` 前缀：

| Key                        | 内容                  |
| -------------------------- | --------------------- |
| `prompt.systemRole`        | 系统角色定义          |
| `prompt.jsonOnly`          | JSON-only 指令        |
| `prompt.schema.foods`      | 完整 JSON Schema 模板 |
| `prompt.rules`             | 估算规则完整文本      |
| `prompt.userMessage.text`  | 文本分析用户消息模板  |
| `prompt.userMessage.image` | 图片分析用户消息模板  |
| `prompt.nearLimit`         | 热量接近上限提示      |
| `prompt.precisionNote`     | 健康条件精确估算提示  |
