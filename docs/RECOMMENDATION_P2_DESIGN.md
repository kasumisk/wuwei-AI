# P2 实现细节设计文档

> 来源：`docs/RECOMMENDATION_REGIONAL_TIMEZONE_DEEP_ANALYSIS.md` §4 优先级表 P2 项
>
> 范围：本轮落地 2.2 / 2.7 / 2.12 三个子项，本文先把所有实现细节、决策点、数据流、验证点写明，再开始编码。

---

## 1. 总览

| 子项 | 标题 | 文件 |
|---|---|---|
| 2.2 | PriceFitFactor 升级（精确价格区间 + 多币种） | `scoring-chain/factors/price-fit.factor.ts` |
| 2.7 | 解释层输出地区/季节命中原因 | `explanation/explanation-generator.service.ts` |
| 2.12 | scoring/feedback today/yesterday 切日改为用户本地时区 | `feedback/*.service.ts`、`recall/collaborative-filtering.service.ts`、`listeners/recommendation-event.listener.ts`、`services/precompute.service.ts` |

落地完成后再进入 P3。

---

## 2. P2-2.2 PriceFitFactor 升级

### 2.1 现状

`price-fit.factor.ts` 只用：
- 用户端 `userProfile.budgetLevel`（`'low'|'medium'|'high'`）
- 食物端 `food.estimatedCostLevel`（1–5 整数）

实际数据库已有更精确字段：
- `UserProfiles.budgetPerMeal`（`Decimal(10,2)`）
- `UserProfiles.currencyCode`（`VarChar(3)`）
- `FoodRegionalInfo.priceMin / priceMax`（`Decimal(10,2)`）
- `FoodRegionalInfo.currencyCode`（`VarChar(3)`）
- `FoodRegionalInfo.priceUnit`（`VarChar(30)`，例如 `per_serving`、`per_kg`）

→ 全代码库 0 处读取这些精确字段。

### 2.2 数据接入

`PipelineContext.userProfile` 当前字段需扩充：

```ts
// preload-region.service.ts / context-builder 之类的入口处增加
budgetPerMeal?: number | null;
currencyCode?: string | null;
```

来源：`UserProfiles.budgetPerMeal` / `UserProfiles.currencyCode`（profile-resolver 已读 declared profile，扩字段透传即可）。

`FoodLibrary` 类型在 P0/P1 阶段已经把 `regionalInfo` 注入到食物对象（`enrich-with-regional-info`），需要确认其中已包含 `priceMin/priceMax/currencyCode/priceUnit`。如果没有，P2-2.2 第一步就是补这些字段进 enrichment。

### 2.3 多币种核心决策（已与用户确认）

**Region 共币种假设 + 不匹配跳过**：
- 假设 `regionCode='US'` 用户与 `region='US'` 食物的 `currencyCode` 都是 `USD`，正常评分。
- 当用户 `currencyCode` 与食物 `currencyCode` **存在且不一致** 时，该 factor 对该食物 `isApplicable=false` 跳过（既不加分也不降分），并在 trace 中记录 `reason='currency_mismatch'`。
- 任一侧 `currencyCode` 为空（例如老数据未填），按"区域内默认币种一致"宽容处理：跳过币种校验，进入数值比较。
- 因为本系统主要用例是"同 region 召回为主、跨 region 为辅 fallback"，这种策略不需要外部汇率服务，零网络风险，且与现有 region filter 架构一致。

未来如需跨币种对比再独立做 `CurrencyConversionService`（P3 长尾，不在本轮）。

### 2.4 价格归一化（priceUnit）

`priceUnit` 决定 priceMin/Max 与 budgetPerMeal 是否量纲可比：
- `per_serving`（最常见、enrichment 默认值）→ 直接与 `budgetPerMeal` 比较。
- `per_kg / per_lb / per_dozen` 等其他单位 → 无法直接换算到"每餐成本"，本轮**不做单位换算**，按"无价格信号"处理（fallback 到 budgetLevel 路径）。
- `priceUnit` 缺失 → 默认按 `per_serving` 处理（与 enrichment prompt 默认一致）。

设：

```ts
const SERVING_UNITS = new Set(['per_serving', 'per_meal', 'serving', null, undefined, '']);
function isServingPrice(unit?: string | null): boolean {
  return SERVING_UNITS.has(unit ?? null) || (unit ?? '').toLowerCase().includes('serving');
}
```

### 2.5 评分逻辑

精确路径（满足以下全部条件）：
1. `userProfile.budgetPerMeal > 0`
2. `food.regionalInfo.priceMin / priceMax` 至少一个有效（>0）
3. 币种校验通过（§2.3）
4. 单位为 serving（§2.4）

```
budget = userProfile.budgetPerMeal
priceMin = food.regionalInfo.priceMin ?? priceMax
priceMax = food.regionalInfo.priceMax ?? priceMin
priceMid = (priceMin + priceMax) / 2
overshoot = max(0, priceMin - budget) / budget   // 最低价仍超预算的比例

if priceMax <= budget:                            // 完全在预算内
  multiplier = 1.05                               //   微加分
elif priceMin <= budget < priceMax:               // 跨预算线
  multiplier = 1.00                               //   中性
elif overshoot <= 0.30:                           // 超预算 ≤30%
  multiplier = 0.85
elif overshoot <= 0.80:                           // 超预算 30%–80%
  multiplier = 0.70
else:                                             // 超预算 >80%
  multiplier = 0.60
```

加分上限 1.05、降分下限 0.60，与现有 budgetLevel 路径量级一致，不会破坏其他 factor 平衡。

Fallback 路径（精确条件不满足、但 `budgetLevel` 有值）：保留原 `BUDGET_MAX_COST × estimatedCostLevel` 逻辑不变。

完全无信号（`budgetLevel` 也缺失，且 `budgetPerMeal` 也缺失）：`isApplicable=false`，与现状一致。

### 2.6 解释 / Trace

新增 `ScoringAdjustment.reason` 文本，便于 trace：

| 路径 | reason 示例 |
|---|---|
| 精确-内 | `price exact-fit: priceMax=12.5 ≤ budget=15 USD` |
| 精确-跨线 | `price straddle: priceMin=12 ≤ budget=15 < priceMax=18 USD` |
| 精确-超 | `price over budget by 33%: priceMin=20 vs budget=15 USD` |
| 币种不匹配跳过 | `currency_mismatch: user=USD vs food=CNY → skip` |
| 单位不可比跳过 | `price_unit_unsupported: per_kg → fallback budgetLevel` |
| 回退-粗 | 现有 `price fit (cost=2 ≤ max=3)` 文案 |

`isApplicable=false` 时不写 trace，由 pipeline-builder 跳过。

### 2.7 测试要点

- Case A：US user budgetPerMeal=15 USD × food priceMin/Max=10/12 USD per_serving → multiplier=1.05。
- Case B：US user budgetPerMeal=15 USD × food priceMin/Max=14/20 USD → 跨线 → 1.0。
- Case C：US user budgetPerMeal=10 USD × food priceMin/Max=15/18 USD → overshoot=50% → 0.70。
- Case D：US user currency=USD × food currency=CNY → isApplicable=false（trace 记录）。
- Case E：US user budgetPerMeal=null × budgetLevel='medium' × food estimatedCostLevel=4 → fallback 路径 → 0.85。
- Case F：双方都缺失 → isApplicable=false。
- Case G：priceUnit='per_kg' → fallback 路径。

---

## 3. P2-2.7 解释层输出地区/季节命中原因

### 3.1 现状

`ExplanationGenerator.generate()` 只看 `explanation.dimensions`（11 维 + 营养标签），完全无视：
- `explanation.regionalBoost`（>1 表示本地区偏好命中）
- `explanation.dimensions.seasonality.weighted`（时令评分）

→ 用户看到的 `primaryReason` 永远不会出现"本地常见 / 当季食材"等地理-时令信号，但这些恰恰是用户最容易感知、最能提升信任度的解释。

### 3.2 触发阈值

新增 buildRegionalReason / buildSeasonalReason，在 `generate()` 主循环之后追加：

```ts
// rankDimensions 之后，reasons.length 检查之前
if (explanation.regionalBoost >= 1.08) {           // ≥ +8% 才算明显本地命中
  reasons.push(t('explain.reason.regionalLocal', { region: regionLabel }, locale));
}

const seasonRaw = explanation.dimensions.seasonality?.raw ?? 0;
if (seasonRaw >= 0.7) {                            // 评分 ≥0.7 视为"当季"
  reasons.push(t('explain.reason.inSeason', { season: seasonLabel }, locale));
}
```

阈值依据：
- regionalBoost：`RegionalBoostFactor` 上限 ~1.20，下限 ~0.85；≥1.08 表示用户/区域强偏好命中（去除 confidence 衰减后通常落在 1.05–1.15）。
- seasonality：`SeasonalityService` 输出 0–1，>0.7 表示当月匹配度高（避免淡季食物误报）。

### 3.3 标签数据来源

- `regionLabel`：从 `userProfile.regionCode` 经现有 `regional-utils.ts`（如有）或 i18n 资源映射；最简实现是 `regionCode` 直接传入 i18n 占位符（"本地（US）"/"当地（US）"等模板由 i18n JSON 处理）。
- `seasonLabel`：从 `getUserLocalMonth(timezone)` → 按月份段映射 `'spring'|'summer'|'autumn'|'winter'` → i18n。这要求 `generate()` 接受 timezone 参数（链路：recommendation-engine → comparison-explanation → generator）。

→ 修改 `UserFacingExplanation` 不需要新字段，`primaryReason` 字符串里追加即可。

### 3.4 i18n 新 keys

`apps/api-server/src/modules/diet/i18n/{zh-CN,en-US,ja-JP}.json` 各加：

```json
"recommendation.explain.reason.regionalLocal": "{{region}}本地常见食材，区域适配度高",
"recommendation.explain.reason.inSeason": "{{season}}时令食材",
"recommendation.label.season.spring": "春季",
"recommendation.label.season.summer": "夏季",
"recommendation.label.season.autumn": "秋季",
"recommendation.label.season.winter": "冬季"
```

en-US：

```json
"recommendation.explain.reason.regionalLocal": "Local favorite in {{region}}",
"recommendation.explain.reason.inSeason": "{{season}} seasonal pick",
"recommendation.label.season.spring": "Spring",
"recommendation.label.season.summer": "Summer",
"recommendation.label.season.autumn": "Autumn",
"recommendation.label.season.winter": "Winter"
```

ja-JP 同理。

### 3.5 新 helper

放在 `explanation-generator.service.ts` 内，私有方法：

```ts
private buildRegionalReason(
  explanation: ScoringExplanation,
  userProfile: UserProfileConstraints | null | undefined,
  locale?: Locale,
): string | null {
  if (explanation.regionalBoost < 1.08) return null;
  const region = (userProfile as any)?.regionCode ?? 'US';
  return t('explain.reason.regionalLocal', { region }, locale);
}

private buildSeasonalReason(
  explanation: ScoringExplanation,
  timezone: string | undefined,
  locale?: Locale,
): string | null {
  const raw = explanation.dimensions.seasonality?.raw ?? 0;
  if (raw < 0.7) return null;
  const month = getUserLocalMonth(timezone || DEFAULT_TIMEZONE);
  const season = monthToSeason(month);                      // 3-5=spring / 6-8=summer / 9-11=autumn / 其他=winter
  const seasonLabel = t(`label.season.${season}`, {}, locale);
  return t('explain.reason.inSeason', { season: seasonLabel }, locale);
}
```

`monthToSeason` 默认按北半球；南半球用户（regionCode 在 AU/NZ/AR/CL/ZA/BR 等）反相。最小可行版本：

```ts
const SOUTH_HEMI = new Set(['AU', 'NZ', 'AR', 'CL', 'ZA', 'BR', 'PE', 'UY']);
function monthToSeason(month: number, regionCode?: string): 'spring'|'summer'|'autumn'|'winter' {
  const isSouth = regionCode && SOUTH_HEMI.has(regionCode.split('-')[0]);
  const offset = isSouth ? 6 : 0;
  const m = ((month - 1 + offset) % 12) + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
```

### 3.6 集成点

`generate()` 内 reasons 主循环之后插入：

```ts
const regionalReason = this.buildRegionalReason(explanation, userProfile, locale);
if (regionalReason) reasons.unshift(regionalReason);     // 放第一位，最先看到

const seasonalReason = this.buildSeasonalReason(explanation, timezone, locale);
if (seasonalReason) reasons.push(seasonalReason);
```

→ regional 放最前是因为它是用户最直接感知的差异化信号；seasonal 作为补充。

`timezone` 参数链路：`recommendation-engine.service.ts` → `comparison-explanation.service.ts` → `explanation-generator.service.ts`。需要给 `generate()` 增加 `timezone?: string` 形参（默认值 DEFAULT_TIMEZONE，所有现有调用方零改动）。

### 3.7 测试要点

- Case A：regionalBoost=1.12 + seasonality.raw=0.85 → 第 1 reason 是 regional，最末是 seasonal。
- Case B：regionalBoost=1.05 → 不输出 regional。
- Case C：seasonality.raw=0.4 → 不输出 seasonal。
- Case D：locale='en-US' → 输出英文模板；locale 缺失 → fallback en-US。
- Case E：regionCode='AU'，月份=12（南半球夏季）→ season='summer'。

---

## 4. P2-2.12 时区日窗口

### 4.1 受影响的 today/yesterday 切日点

经 grep 全代码库后命中的非时区安全位置：

| 文件 | 行 | 现状 | 改动 |
|---|---|---|---|
| `recall/collaborative-filtering.service.ts` | 223 | `new Date(Date.now() - 86400000)` 取 24h 前 | **保持不变**：这是"近 24h 行为"的纯时间窗，不是日历切日，不需要本地化 |
| `listeners/recommendation-event.listener.ts` | 109 | `new Date().toISOString().slice(0,10)` | 取 user timezone 后用 `getUserLocalDate(tz)` |
| `services/precompute.service.ts` | 240, 319 | 同上 | 同上 |
| `services/behavior.service.ts` | 136 | `yesterday = new Date(); yesterday.setDate(...)` | 用 `getUserLocalDate(tz, new Date(Date.now() - 86400000))` |

`weight-learner.service.ts:318/375` 是 `new Date().setDate(now-N)` 取近 N 天起点，属时间窗而非日历切日 —— **不动**。

`embedding-generation.processor.ts:60` 是 enqueue 时间戳记录 —— **不动**。

`scoring-config.service.ts:308/494` 是 updatedAt 时间戳 —— **不动**。

### 4.2 实现策略

每个目标位置的处理流程：
1. 找到能拿到 `userId` 的地方读 timezone（注意 listener 异步链路里只能从事件 payload 里拿，或从 PipelineContext 透传）。
2. 调用 `getUserLocalDate(tz, date)` 替换原 `toISOString().slice(0,10)`。
3. 当 timezone 不可得（早期 listener 还没 enrichedProfile）→ 回退 `DEFAULT_TIMEZONE`，并打日志一次。

### 4.3 listener / precompute 的 timezone 来源

- `recommendation-event.listener.ts`：事件 payload 已有 `userId`；通过 `userProfileService.getDeclaredProfile(userId)` 读 timezone（profile cache 命中即可，无 DB 压力）。或在 emit 端就把 timezone 放到 payload（更高效，但要改事件契约 → 暂不动，本轮直接读 cache）。
- `precompute.service.ts`：precompute 通常按 user 维度循环，循环体内已经有 `userProfile` 对象 → 直接 `userProfile.declared?.timezone` 取。

### 4.4 测试要点

- Case A：UTC 时间 2025-05-01 02:00、`tz='America/Los_Angeles'`（仍是 4/30）→ today = `'2025-04-30'`。
- Case B：UTC 时间 2025-05-01 14:00、`tz='Asia/Tokyo'`（已是 5/1 23:00）→ today = `'2025-05-01'`。
- Case C：timezone 缺失 → today 走 `DEFAULT_TIMEZONE='America/New_York'`，并 logger.warn 一次。

---

## 5. 落地顺序

1. ✅ 文档输出（本文件）
2. P2-2.2：先扩 `PipelineContext.userProfile.budgetPerMeal/currencyCode` → 再扩 `FoodLibrary.regionalInfo` 字段（如未含 price 字段）→ 改 `price-fit.factor.ts`。
3. P2-2.7：i18n JSON → helper 方法 → `generate()` 集成。
4. P2-2.12：4 个文件逐个替换。
5. `npx tsc --noEmit` 零错误。
6. 进入 P3。

---

## 6. 不在本轮的延迟项

- 跨币种 `CurrencyConversionService`（外部 API + Redis 缓存）。
- `priceUnit` 单位换算（per_kg → per_serving 需要克数）。
- 解释层加入 currency 文案、explanation v2 结构化字段（regional/seasonal 单独成段）。
- listener emit 时直接把 timezone 放进事件 payload，省去事件接收方再读 cache。
