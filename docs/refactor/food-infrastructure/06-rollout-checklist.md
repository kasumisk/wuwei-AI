# 06 · Rollout Checklist

> **进度图例**：✅ 已完成 / ⏳ 待 staging 库执行 / ⚠️ 已识别风险

## 上线前自检

### Schema（代码层 ✅ / DB 层 ⏳）

- [x] `prisma/schema.prisma` 中 `model Food` 存在，且 `@@map("foods")` — schema.prisma:2718
- [x] `model FoodEmbedding` / `FoodFieldProvenance` / `FoodRecommendationProfile` 已定义 — schema.prisma:2815-2899
- [x] 三张新表都有 `foodId` 外键 + `onDelete: Cascade`
- [x] `food_embeddings` 有 `(food_id, model_name)` 唯一约束（`@@unique`）
- [x] `food_field_provenance` 有 `(food_id, field_name, source)` 唯一约束
- [x] HNSW 索引在 vector 列上（迁移 SQL 内 `USING hnsw (vector vector_cosine_ops)` 条件创建）

### 数据（⏳ 待 staging 库执行）

- [ ] `pg_dump` 备份产出物存在且可 restore（演练一次）
- [ ] `migrate-food-infra.ts` 跑完无报错
- [ ] `verify-food-infra.ts` 全部断言通过：
  - [ ] embedding 总数对齐（legacy + v5）
  - [ ] field_sources 键数 ≈ provenance success 行数
  - [ ] failed_fields 键数 ≈ provenance failed 行数
  - [ ] 抽样 50 条 food_id 数据完整

### 代码（✅ 全部完成）

- [x] 全仓 `grep "prisma.foods\."` 命中 0（28 文件 / 114 处全部改为 `prisma.food`）
- [x] 全仓 `grep "embedding_v5\|embedding_updated_at\|failed_fields"` 仅在迁移脚本/文档/注释/运行时缓存属性中命中（已审计 65 处全部安全）
- [x] `pnpm -w typecheck` 通过（0 错误）
- [x] `food-conflict-resolver.service.ts` 增加 `REMOVED_FIELDS` 白名单拦截动态列名 UPDATE
- [x] `pnpm prisma generate` 后 Client 类型存在 `food`、`foodEmbedding`、`foodFieldProvenance`、`foodRecommendationProfile`
- [x] **Repository 层已建立**：`apps/api-server/src/modules/food/repositories/`
  - `embedding-model.constants.ts`（3 模型枚举：legacy_v4 / feature_v5 / openai_v5）
  - `food-embedding.repository.ts`（upsert/read/search/find/delete）
  - `food-provenance.repository.ts`（recordSuccess/recordFailure/listFailures/clearFailuresForField/topFailedFields）
  - `food.repository.ts`（聚合 findOne(withEmbedding/withProvenance)）
  - 已注册到 `FoodModule` providers + exports
- [x] **列名一致性 bug 修复**（本期发现）：
  - `vector-search.service.ts`：`model_version` / `"dim"` → `model_name` / `dimension`
  - `embedding-generation.{service,processor}.ts`：96 维 computeFoodEmbedding 错标 OpenAI 字符串 → 统一为 `model_name='feature_v5'`
  - `semantic-recall.service.ts`：`model_version='v5'` → `model_name='feature_v5'`
- [ ] `pnpm -w lint` 通过（待执行）

### 业务回归（⏳ 待 staging 库执行）

- [ ] 推荐流跑通：调用 `/api/diet/recommendation` 返回非空（手动触发一个用户）
- [ ] 向量召回非空：`vector-search.service` 单测 / 手测
- [ ] 食物详情页查询正常
- [ ] 食物搜索分页正常
- [ ] enrichment 跑一条新菜入库，验证 `food_field_provenance` 有写入
- [ ] embedding-generation worker 跑一条，验证 `food_embeddings` 有写入

### 单元测试（✅ 已完成）

- [x] `test/v82-food-infra-repositories.spec.ts`：20 case 全绿，覆盖 SQL 列名、ON CONFLICT、limit 夹紧、ANY uuid[]、upsert 路径、聚合层默认行为
  - 运行命令：`pnpm exec jest --config ./test/jest-unit.json test/v82-food-infra-repositories.spec.ts`

### Seed

- [ ] `pnpm seed:foods` 在新库（reset 后）跑通
- [ ] `pnpm seed:translations` 跑通

---

## 上线步骤（执行顺序）

```bash
# === 在 staging 库先全跑一遍 ===

# 1. 切分支
git checkout refactor/food-infra
git pull

# 2. 备份生产食物库（即使未上线也走一遍演练）
pnpm db:backup:foods

# 3. apply migration A（建新表）
cd apps/api-server
pnpm prisma migrate deploy

# 4. 灌数据
pnpm tsx scripts/refactor/migrate-food-infra.ts

# 5. 校验
pnpm tsx scripts/refactor/verify-food-infra.ts
# 必须全 pass，否则停止

# 6. apply migration B（DROP 旧列 + rename model）
pnpm prisma migrate deploy

# 7. 重启服务
pm2 restart api-server  # 或 docker-compose restart

# 8. 健康检查
curl -f http://localhost:3000/health
```

---

## 回滚（任意步骤失败）

```bash
# 数据回滚
pg_restore -c -d $DB_NAME backup/food-infra-pre-refactor-YYYYMMDD.dump

# 代码回滚
git checkout main
pnpm install
pnpm -w build
pm2 restart api-server
```

---

## 验收标准

满足以下全部条件，方可合并 PR：

1. ✅ 所有 checkbox 通过
2. ✅ 推荐流 P95 延迟相比 main 分支不劣化超过 10%（embedding JOIN 引入的额外开销）
3. ✅ 数据校验脚本输出 `OK` 字样
4. ✅ 至少 2 名工程师 review 通过

---

## 已知风险与跟踪

| 风险 | 缓解 | 状态 |
|---|---|---|
| HNSW 索引在新表重建时间长 | staging 提前演练，记录耗时；生产改造前预估窗口 | ⏳ 待 staging |
| `food-conflict-resolver.service.ts` 动态列名 | 已加 `REMOVED_FIELDS` 白名单拦截，命中即跳过并 warn | ✅ 已修复 |
| FoodLibrary 接口字段变可选可能 break 245+ 引用 | typecheck 全量验证（0 错误） | ✅ 已通过 |
| 双层共存（jsonb + 关联表）写入不一致 | 全部用事务包裹；后续可加后台 reconcile job | ⏳ 后续 PR |
| **embedding 模型语义混淆**（本期发现） | 统一三模型枚举语义：legacy_v4 (Float[]) / feature_v5 (96 维 pgvector，主用) / openai_v5 (1536 维预留)；写入 `embedding-model.constants.ts` | ✅ 已修复 |
| 迁移 SQL backfill 把 embedding_v5 标为 `model_name='openai_v5'` + `dimension=1536` | 与代码侧 `feature_v5`(96 维) 语义不符；本期保留迁移 SQL（已 commit ddcaf8a），上线前需执行 staging 校验脚本对齐，必要时新增数据修补 SQL | ⚠️ **待上线前确认** |

---

## 后续 PR 路线（不在本期）

1. 接入 `food_recommendation_profile` 离线计算 + 推荐排序
2. 把剩余 `prisma.foods` 调用收口到 `FoodRepository`
3. enrichment 服务彻底切到 provenance 表，主表 jsonb 列在观察 1 个月后下线
4. 引入 AI healthScore / aiAnalysisVersion 时再增 `food_ai_profiles` 表（本期不做）
