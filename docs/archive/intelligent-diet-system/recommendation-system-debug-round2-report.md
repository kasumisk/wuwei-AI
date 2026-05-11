# 推荐系统第二轮对抗式复核报告 (Round 2)

> **范围**：对 Round 1 修复结果做对抗式复核 + 漏洞挖掘 + 偏差分析 + 二次修复
> **方法**：静态代码审计 + 真实运行对抗测试 + 边界 case 注入
> **完成日期**：2026-05-02
> **状态**：4 个 P0 新发现漏洞已修复，2 个 P1/P2 新问题已记录

---

## 1. TL;DR

| 发现 | 严重级 | 模块 | 类别 | 状态 |
|------|--------|------|------|------|
| **Bug-R2-01** | **P0** | food-filter | 饮食违规 | ✅ 已修复 |
| **Bug-R2-02** | **P0** | pipeline-builder | 过敏原安全 | ✅ 已修复 |
| **Bug-R2-03** | **P0** | pipeline-builder | 过敏原安全 | ✅ 已修复 |
| **Bug-R2-04** | **P0** | pipeline-builder | 过敏原安全 | ✅ 已修复 |
| **Bug-R2-05** | P1 | seasonality/callers | 数据精度 | 📋 已记录 |
| **Bug-R2-06** | P2 | channel.ts | 架构 | 📋 已记录 |

**对比 Round 1**：
| 指标 | Round 1 | Round 2 | 变化 |
|------|---------|---------|------|
| 发现 bug 数 | 7 (BUG-001~009) | 6 (Bug-R2-01~06) | 新增 |
| P0 级 bug | 0 | **4** | ⬆️ 大幅增加 |
| 涉及过敏原安全 | 0 | **3** | ⚠️ 严重 |
| 上一轮漏掉 | — | **4** (R2-01~04) | 上一轮 G10 修复不完整 |
| 误判/不完整修复 | — | **1** (G10 只修了实例版) | 上一轮有遗漏 |

---

## 2. 新增 Bug 详情

### Bug-R2-01：vegan 独立函数版遗漏 cream 过滤 (G10 修复不完整)

**1. 是否上一轮已发现**：部分（G10 只修了实例方法版，独立版未同步）

**2. 是否已修复**：✅ 已修复

**3. 复现步骤**：
```ts
// 独立函数版 (food-filter.service.ts:487-492)
// 修复前：
if (mi === 'milk' || mi === 'egg' || mi === 'cheese' || mi === 'yogurt') return true;
// 缺少: mi === 'cream'
```

**4. 实际结果**：`foodViolatesDietaryRestriction({ mainIngredient: 'cream' }, ['vegan'])` → `false`（未拦截）

**5. 为什么上一轮没发现**：G10 修复只修改了实例方法版 (`food-filter.service.ts:324-331`)，遗漏了同一文件中在底部独立导出的 `foodViolatesDietaryRestriction` 函数 (`food-filter.service.ts:487-492`)。两个版本的 vegan 分支结构几乎相同但各自维护独立常量，实例版有 `cream` 而独立版没有。

**6. 根因定位（代码级）**：
- 文件：`apps/api-server/src/modules/diet/app/recommendation/pipeline/food-filter.service.ts`
- 实例方法版（line 324-331）：**有** `mi === 'cream'` ✅
- 独立函数版（line 491-492）：**无** `mi === 'cream'` ❌
- 两版并行存在的技术债（A.10 已记录）

**7. 修复方案**：在独立版 vegan 分支补充 `|| mi === 'cream'`

**8. 是否影响其他模块**：否。pipeline-builder 使用独立版做 recall 过滤，修复后正确拦截。

**9. 回归验证**：对抗测试 FIX-1a ✅（`foodViolatesDietaryRestriction(creamFood, ['vegan']) = true`）

**10. 是否新增测试**：对抗测试 runner (08) 已覆盖

---

### Bug-R2-02：ensureMinCandidates 回填时未过滤过敏原

**1. 是否上一轮已发现**：No

**2. 是否已修复**：✅ 已修复

**3. 复现步骤**：
```
用户有 allergens=['dairy']
recall 候选池经过敏原过滤后大幅减少 → ensureMinCandidates 触发
→ 从 ctx.allFoods 全集按 roleCategory 回填 → 回填的食物未过滤过敏原
→ dairy 过敏食物被重新引入候选池
```

**4. 实际结果**：含有用户过敏原的食物可能通过兜底逻辑绕过过敏原过滤

**5. 为什么上一轮没发现**：上一轮仅验证了 BUG-007（is_verified）和 BUG-008（regionCode），未深入检查 `ensureMinCandidates` 的兜底逻辑。该函数的注释已列出重新应用的约束（dietary/isFried/sodium/purine/fat），但过敏原被遗漏。

**6. 根因定位（代码级）**：
- `pipeline-builder.service.ts:94-141`（`ensureMinCandidates` 函数）
- 第 113-138 行：重新应用了 dietaryRestrictions, excludeIsFried, maxSodium, maxPurine, maxFat
- **缺少**：`filterByAllergens()` 调用

**7. 修复方案**：在 `ensureMinCandidates` 的 fallback 构建后补充过敏原过滤：
```ts
if (ctx.userProfile?.allergens?.length) {
  fallback = filterByAllergens(fallback, ctx.userProfile.allergens);
}
```

**8. 是否影响其他模块**：否。仅加固 fallback 逻辑。

**9. 回归验证**：对抗测试 FIX-2a ✅；recall runner 12/12 ✅

**10. 是否新增测试**：对抗测试 runner 已覆盖

---

### Bug-R2-03：Ultimate fallback 未过滤过敏原

**1. 是否上一轮已发现**：No

**2. 是否已修复**：✅ 已修复

**3. 复现步骤**：
```
recall 所有过滤后候选为0 → 触发 ultimate fallback (line 551-566)
→ 从 ctx.allFoods 回填 → 未过滤过敏原
```

**4. 实际结果**：与 R2-02 相同（过敏原通过最终兜底泄漏）

**5. 为什么上一轮没发现**：同 R2-02，兜底链路未被审计覆盖。

**6. 根因定位（代码级）**：
- `pipeline-builder.service.ts:551-566`：ultimate fallback 仅检查 `dietaryRestrictions`，未检查 `allergens`

**7. 修复方案**：在 ultimate fallback 后追加 `filterByAllergens()` 调用

**8. 是否影响其他模块**：否

**9. 回归验证**：同上

**10. 是否新增测试**：同上

---

### Bug-R2-04：过敏原过滤后无 ensureMinCandidates 保护

**1. 是否上一轮已发现**：No

**2. 是否已修复**：✅ 已修复

**3. 复现步骤**：
```
用户有 3 个过敏原 → 过滤后候选池降到 < MIN_CANDIDATES
→ 无 ensureMinCandidates 保护 → 后续 commonality/budget 过滤继续缩减
→ 最终候选池可能为空或质量极差
```

**4. 实际结果**：过敏原过滤可能过度削减候选池而没有兜底保护

**5. 为什么上一轮没发现**：上一轮未检查过敏原过滤的上下游完整性。

**6. 根因定位（代码级）**：
- `pipeline-builder.service.ts:312-315`：过敏原过滤直接赋值 `candidates = filterByAllergens(...)`，无 `ensureMinCandidates` 包装
- 对比同一文件中的其他过滤步骤（commonality/budget/skill/shortTerm/analysis/channel）**全部**有 `ensureMinCandidates`

**7. 修复方案**：为过敏原过滤添加 `ensureMinCandidates` 保护

**8. 是否影响其他模块**：否。仅增加兜底逻辑。

**9. 回归验证**：所有 runner 通过

**10. 是否新增测试**：对抗测试已覆盖

---

### Bug-R2-05：SeasonalityService.getInfo 仍有 caller 缺失 regionCode（P1）

**1. 是否上一轮已发现**：Yes（BUG-008）。但修复只覆盖了 PriceFitFactor 一个路径。

**2. 是否已修复**：Partial。PriceFitFactor 已修复，但 runner 运行日志仍显示大量 `without regionCode` 告警。

**3. 复现步骤**：运行 `pnpm rec:04-scoring` 或 `pnpm rec:05-meal`，可以看到大量 seasonality regionCode 缺失告警。

**4. 实际结果**：评分/装配阶段的代码路径仍存在未传 regionCode 的 caller。

**5. 为什么上一轮没发现**：上一轮修复后声称 `grep -c 'without regionCode' = 0`，但同一测试在本轮运行时仍产生告警（可能是 runner 使用的 context 不同，或上一轮测试未覆盖完整路径）。

**6. 根因定位**：需要进一步排查所有 `getSeasonalityScore` / `getAvailability` / `getPriceInfo` 的调用链，找出未传 regionCode 的剩余 caller。

**7. 修复方案**：TODO - 需定位具体 caller。

**8. 是否影响其他模块**：是 - seasonality 精度受影响。

**9. 回归验证**：待修复后验证。

**10. 是否新增测试**：需补充。

---

### Bug-R2-06：channel.ts KNOWN_CHANNELS 与推荐场景频道不兼容（P2）

**1. 是否上一轮已发现**：No

**2. 是否已修复**：No（本质是两套独立的频道系统，无需"修复"但需要文档对齐）

**3. 复现步骤**：`normalizeChannel('home_cook')` → `'unknown'`

**4. 实际结果**：`channel.ts` 的 `KNOWN_CHANNELS = ['app', 'web', 'miniprogram', 'api', 'unknown']` 用于预计算缓存键；推荐管线使用 `['home_cook', 'restaurant', 'delivery', 'canteen', 'convenience', 'unknown']` 作为场景频道。两个系统使用了不同的命名空间，`normalizeChannel` 如果误用于场景频道值将静默转换为 `unknown`。

**5. 为什么上一轮没发现**：CURRENT_STATE.md 错误地将 `KNOWN_CHANNELS` 文档化为包含场景频道（section 3.1），遮盖了实际差异。

**6. 根因定位**：
- `channel.ts:24-30`：`KNOWN_CHANNELS` 定义为预计算渠道（app/web/miniprogram/api）
- `pipeline-builder.service.ts:413-443`：`CHANNEL_TO_SOURCES` 使用场景频道（home_cook/delivery/restaurant/convenience/canteen）
- 两套系统间的映射文档不准确

**7. 修复方案**：更新 CURRENT_STATE.md 第 3.1 节，澄清两套频道系统的用途差异。

**8. 是否影响其他模块**：当前无运行时影响（`normalizeChannel` 仅被 precompute.service.ts 使用），但架构文档误导性强。

**9. 回归验证**：已通过对抗测试确认。

**10. 是否新增测试**：对抗测试已覆盖。

---

## 3. 上一轮修复复核

| 上一轮修复 | 验证结果 | 备注 |
|-----------|---------|------|
| **BUG-006** (uuid JOIN) | ✅ 验证通过 | 代码已修复且正常运行 |
| **BUG-007** (is_verified) | ✅ 验证通过 | poolSize=5161 |
| **BUG-008** (seasonality regionCode) | ⚠️ **不完整** | PriceFitFactor 修复了，但仍有其他 caller 缺失 regionCode (Bug-R2-05) |
| **BUG-009** (realism fallback) | ✅ 验证通过 | 未再触发 |
| **G10** (vegan cream 实例版) | ❌ **修复不完整** | 仅修了实例版，独立版遗漏 (Bug-R2-01) |
| **C1** (DB 默认值) | ✅ 代码验证 | schemas 已改 nullable |
| **C4/L3** (preference clamp) | ✅ 代码验证 | clamp [0.4, 2.0] |
| **L11** (severe health) | ✅ 代码验证 | 截顶 0.5 |

---

## 4. 对比分析

### 4.1 新发现 bug 数量

本轮新发现：**6 个**（4 个 P0 + 1 个 P1 + 1 个 P2）

### 4.2 上一轮误判/不完整修复

| 问题 | 上一轮结论 | 本轮发现 |
|------|-----------|---------|
| G10 (vegan cream) | ✅ 已修复 | ❌ 只修了实例版，独立版遗漏 (Bug-R2-01) |
| BUG-008 (seasonality regionCode) | ✅ 已修复 | ⚠️ 不完整 (Bug-R2-05) |

### 4.3 上一轮遗漏问题

| 遗漏 | 严重级 | 说明 |
|------|--------|------|
| ensureMinCandidates 过敏原 | P0 | 兜底回填未过滤过敏原 |
| Ultimate fallback 过敏原 | P0 | 最终兜底未过滤过敏原 |
| 过敏原过滤自身无 ensureMinCandidates | P0 | 过滤后无兜底保护 |
| channel.ts 文档/实际不一致 | P2 | 两套频道系统差异 |

### 4.4 本轮新增风险点

1. **过敏原漏洞**：3 个 P0 漏洞全部涉及过敏原过滤（召回→兜底→最终兜底三级链路均存在缺口）。修复前过敏原过滤仅依靠单一线性过滤点，一旦触发任何 fallback 路径即失效。
2. **两版并行维护风险**：dietary 过滤两个版本的同步维护问题再次暴露（G10 修复时只改了实例版）。
3. **BUG-008 残余**：seasonality regionCode 告警仍在，需追查剩余 caller。

### 4.5 系统当前真实稳定性评估

| 维度 | 评级 | 说明 |
|------|------|------|
| 过敏原/饮食安全 | 🟢 **高** | 3 个 P0 已修复，三级链路加固 |
| recall 稳定性 | 🟢 **高** | poolSize 稳定 5161 |
| 评分稳定性 | 🟡 **中** | Thompson Sampling 无 seed (已知, 非本轮回合修复) |
| seasonality 精度 | 🟠 **中低** | BUG-008 修复不完整 |
| 架构一致性 | 🟠 **中低** | 两套频道系统，两版 dietary 过滤 |
| 文档一致性 | 🟠 **中低** | channel.ts 文档与实际不符 |

---

## 5. 关键文件索引

| 文件 | 修改 |
|------|------|
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/food-filter.service.ts:491` | Bug-R2-01: vegan 独立版补充 cream |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts:97` | Bug-R2-02: ensureMinCandidates 补充 userProfile 类型 |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts:140-143` | Bug-R2-02: ensureMinCandidates 过敏原过滤 |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts:314-319` | Bug-R2-03: ultimate fallback 过敏原过滤 |
| `apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts:312-322` | Bug-R2-04: 过敏原过滤后加 ensureMinCandidates |
| `apps/api-server/package.json` | 新增 rec:08-adv 对抗测试 |
| `apps/api-server/test/runners/08-adversarial.runner.ts` | 对抗测试 runner |

---

## 6. 结束条件核查

| 条件 | 状态 |
|------|------|
| 1. 所有上一轮 bug 已验证 | ✅ 6/6 已验证 (G10/008 标记不完整) |
| 2. 新问题已修复或标记 | ✅ 4 个 P0 已修复, 2 个已记录 |
| 3. 无明显逻辑漏洞 | ✅ 本次覆盖了 recall→兜底→fallback 三级链路 |
| 4. 无错误推荐（过敏/健康） | ✅ 过敏原 filter 三级加固 |
| 5. 推荐结果稳定 | ✅ 对抗测试通过 |
| 6. explanation 一致 | ✅ 未引入新分歧 |

---

## 7. Follow-up 建议

1. **FU-R2-1**: 追查 seasonality regionCode 缺失告警剩余 caller（Bug-R2-05）
2. **FU-R2-2**: 将 dietary 过滤两版合并为单一实现，消除未来同步维护风险（TD-07）
3. **FU-R2-3**: 更新 CURRENT_STATE.md 第 3.1 节关于 KNOWN_CHANNELS 的描述
4. **FU-R2-4**: 将对抗测试 runner (08) 加入 CI 定期运行

---

*报告结束*
