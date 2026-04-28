# Food Infrastructure 重构文档

> 分支：`refactor/food-infra`
> 启动日期：2026-04-28
> 决策方式：基于真实代码事实，非纯架构理论

## 文档导航

| 文件 | 内容 |
|---|---|
| [01-decision.md](./01-decision.md) | **核心决策**：为什么是 4 表而不是 7 表，每个字段去哪 |
| [02-target-schema.md](./02-target-schema.md) | 目标 Prisma schema 与表结构定义 |
| [03-migration-plan.md](./03-migration-plan.md) | SQL 迁移步骤、数据搬运、回滚策略 |
| [04-code-impact.md](./04-code-impact.md) | 业务代码改造清单（按文件 + 改动类型） |
| [05-repository-layer.md](./05-repository-layer.md) | FoodRepository 抽象层设计 |
| [06-rollout-checklist.md](./06-rollout-checklist.md) | 落地检查清单 |
| [07-postmortem.md](./07-postmortem.md) | 重构完成后填写：发现的边界问题 + 经验 |

## 一句话总结

> 把 `foods` 表中**行宽炸弹（embedding 向量）**、**结构化诉求（字段级溯源）**、**预计算诉求（推荐评分）** 三类字段拆出独立表，
> 主表瘦身 ~50%，业务契约 `FoodLibrary` 维持不变，
> 推荐流热路径零侵入。

## 重构边界（明确不做的事）

为避免范围蔓延，**本次重构不做以下事**：

- ❌ 不拆营养字段到独立 `food_nutrition` 表（enrichment 动态 SQL 重写代价过高，收益小）
- ❌ 不把 `tags` / `allergens` / `compatibility` / `mealTypes` 改成关联表（推荐流热路径在内存过滤，jsonb + GIN 已满足，关联表反需 JOIN）
- ❌ 不引入新的 AIProfile 表（盘点显示 `aiHealthScore` 等字段在代码中零引用，当前不存在 LLM 推断字段）
- ❌ 不改 `food_translations` / `food_regional_info` / `food_sources` / `food_change_logs` / `food_conflicts`（设计已合理）
- ❌ 不引入新的查询语言或 ORM（继续 Prisma + raw SQL 混用）

## 重构成果（预期）

| 维度 | Before | After |
|---|---|---|
| `foods` 表字段数 | ~150 | ~80 |
| 包含 embedding 字段的查询行宽 | 含 1536 维向量 | 不含 |
| 推荐流热路径 SQL | 不变 | 不变（移除 embedding 列） |
| `FoodLibrary` 接口 | 244 行 | 244 行（embedding 字段降为可选） |
| 字段级溯源能力 | jsonb（可读） | jsonb + 关联表（可索引、可统计） |
| 推荐预计算能力 | 无 | 有（`food_recommendation_profile`） |
| 模型版本能力 | 无（embedding 与主表绑定） | 有（`food_embeddings.model_name`） |
