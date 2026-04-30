# 推荐引擎 · 地区与时区能力分析（V8 当前状态）

> 输入背景：`food_regional_info` 在 V7.0 升级了 `monthWeights / availability / localPopularity / priceMin/Max / currencyCode / regulatoryInfo / seasonalityConfidence` 等字段。
> 目标：评估推荐引擎当前对"用户所在地区 + 用户所在时区"的真实利用程度，识别"已实现 / 看似实现实则失效 / 完全未实现"的边界，并给出落地路线。
> 读者：推荐 / 用户画像 / 数据治理负责人。本文同时承担问题清单与分阶段改造建议两种用途。

---

## 0. TL;DR

- **地区能力当前只用到了 `food_regional_info` 的 `availability + localPopularity` 两个字段**，作为评分末端的乘数（`RegionalBoostFactor`）。`monthWeights / priceMin/Max / currencyCode / priceUnit / regulatoryInfo / seasonalityConfidence / source / confidence` 在生产代码路径上**全部未消费**。
- **季节性评分（第 11 维 `seasonalityScore`）实际永远返回 0.5**：`SeasonalityService.preloadRegion()` 在生产代码中从未被调用（仅出现在测试 mock 与 `v6.9-integration.spec.ts`），导致 `regionalCache` 永远是空的，`getSeasonalityScore` 第一行 `if (!info) return 0.5` 直接命中，`monthWeights` 和 V6.4 的 `availability` 分支**根本进不去**。
- **召回与过滤层零地区参与**：`recall/*`、`filter/*` 全文件夹搜不到 `regionCode / FoodRegionalInfo / availability`。当前是"全库召回 + 评分末端乘数"模式，多国扩展时跨国食物会互相竞争候选池。
- **时区已正确进入"用户场景识别"和"约束生成"两条链路**（`ContextualProfileService.detectScene` / `ConstraintGeneratorService`），但**未进入评分链**：`SeasonalityService` 用 `new Date().getMonth() + 1`，取的是**服务器月份**而非用户本地月份，跨月零点与南北半球用户都会偏。
- **结构性数据坑**：`user_profiles.region_code @db.VarChar(5)`，**装不下** `food_regional_info` 设计支持的 `country-region-city`（`CN-GD-SZ` 8 字符）三级粒度。这是把地区能力下沉到用户画像层的**第一硬阻塞**。
- **缓存失效坑**：`regional_boost:{region}` TTL 5 分钟、`seasonality:region:{regionCode}` TTL 4 小时，且没有任何主动失效。运营更新地区表后最长 4 小时才生效。
- **结论**：要让"基于地区 / 季节 / 月份权重 / 价格 推荐"真正落地，需要按数据 → 列宽 → preload 接线 → PipelineContext 时区下推 → 召回层裁剪 → 价格/合规接入的顺序分阶段做，单点修复无法兑现新字段的语义。

---

## 1. 当前架构现状

### 1.1 数据模型

#### 1.1.1 `food_regional_info`（schema.prisma:755-803）
关键字段：
- `countryCode VarChar(2)`（**非空**，ISO 3166-1 alpha-2）
- `regionCode VarChar(20)?`（省/州级，可空）
- `cityCode VarChar(50)?`（城市级，可空）
- `localPopularity Int`（0–100）
- `priceMin / priceMax Decimal?` + `currencyCode VarChar(3)?` + `priceUnit`
- `availability FoodAvailability`：`YEAR_ROUND / SEASONAL / RARE / LIMITED / UNKNOWN`
- `monthWeights Json?`（V7.0：12 元素 0.0–1.0 数组）
- `seasonalityConfidence Decimal?`
- `regulatoryInfo Json?`
- `source / sourceUrl / confidence Decimal`
- 唯一键：`(foodId, countryCode, regionCode, cityCode)`

#### 1.1.2 `user_profiles`（schema.prisma:2070-2108）
- `regionCode String? @default("CN") @db.VarChar(5)` ← **关键坑：列宽 5**
- `timezone String @default("Asia/Shanghai") @db.VarChar(50)`（IANA 字符串）

> 同一份数据库设计里，地区表准备到城市级，画像表只能装 5 字符（`CN-GD` 顶天，`CN-GD-SZ` 装不下）。这是后续所有地区能力的**结构性瓶颈**。

### 1.2 工具层（已就位）

| 工具 | 文件 | 关键能力 |
|---|---|---|
| 时区工具 | `common/utils/timezone.util.ts` | `getUserLocalDate / Hour / DayOfWeek / isWeekend / DayBounds`，基于 `Intl.DateTimeFormat`，DST 友好；`DEFAULT_TIMEZONE='Asia/Shanghai'` |
| 地区解析 | `common/utils/food-regional-info.util.ts` | `parseFoodRegionScope` 用 `-` 拆 `country/region/city`，country 强制 `slice(0,2)`；`buildFoodRegionalFallbackWhere` 生成 `(c,r,city)→(c,r,null)→(c,null,null)` 三级回退；`getFoodRegionSpecificity` 支持取最具体一条 |
| Locale → Region | `common/utils/locale-region.util.ts` | `localeToFoodRegion('zh-CN')→'CN'`。**当前推荐链路未使用** |

### 1.3 推荐链路里"地区"的真实落点（仅 2 处）

#### 1.3.1 `PreferenceProfileService.getRegionalBoostMap(region)`
位置：`recommendation/profile/preference-profile.service.ts:193-242`

```text
food_regional_info  ─query→  foodId → multiplier
  YEAR_ROUND & localPopularity>50 → 1.20
  YEAR_ROUND                      → 1.05
  SEASONAL                        → 0.90
  RARE                            → 0.70
  LIMITED                         → 0.80
  UNKNOWN / 无记录                → 1.00（落到默认）
Redis: regional_boost:{region}, TTL 5 分钟
```

调用方：`ProfileAggregatorService.aggregateForRecommendation`（profile-aggregator.service.ts:152-159），传入 `enrichedProfile.regionCode || 'CN'`。

#### 1.3.2 `RegionalBoostFactor`
位置：`recommendation/scoring-chain/factors/regional-boost.factor.ts`
作用：评分链中读 `ctx.regionalBoostMap[food.id]` 作为乘数。

**这是当前推荐引擎全部的地区敏感性来源。**

### 1.4 推荐链路里"时区"的真实落点

| 落点 | 文件:行 | 是否真正按用户本地时间 |
|---|---|---|
| 场景识别 | `user/.../contextual-profile.service.ts` | ✅ localHour / dayOfWeek / isWeekend / isLateNight 全部用 timezone.util |
| 约束生成 | `pipeline/constraint-generator.service.ts:156, 191` | ✅ weakTimeSlots、暴食风险时段按本地小时 |
| 推荐主入口 | `services/recommendation-engine.service.ts:468 / 584 / 1015` | ✅ 三处显式把 `userProfile.timezone` 传给 ConstraintGenerator |
| 餐次推断 | `daily-plan.service.ts:817` / `food.service.ts:213` | ✅ 用本地小时；⚠️ 阈值硬编码中式作息（见 §4.4） |
| 季节性评分 | `recommendation/utils/seasonality.service.ts` | ❌ 用 `new Date().getMonth()+1`，**服务器月份** |
| PipelineContext | `recommendation/context/pipeline-context-factory.service.ts` | ❌ 不持有 `timezone` / `currentMonth`，下游想要本地时间只能各自再取 |

---

## 2. 已具备的能力（确实在生产生效）

1. **基于地区的食物末端 boost**：YEAR_ROUND + 高 popularity 加权、SEASONAL/RARE/LIMITED 减权，按 `regionCode`（默认 `'CN'`）。
2. **基于本地时区的"场景"识别**：早/午/晚/夜宵、工作日/周末、晚归用餐窗口判断，全部按用户 IANA 时区。
3. **基于本地时区的约束**：弱时段、暴食风险时段、夜间约束生成。
4. **食物日志/计划的时区正确性**：日界、本地小时、日范围在 `daily-plan / food / behavior / daily-summary / food-record / weekly-plan` 全部走 `timezone.util`，跨时区用户的"今天"是用户本地的"今天"。
5. **地区数据的层级回退能力**：`buildFoodRegionalFallbackWhere` 在工具层已经准备好了 `country-region-city → country-region → country` 的三级匹配。**只是上层没人调用它**。

---

## 3. 看似实现实则失效（最危险的一类）

### 3.1 SeasonalityService.preloadRegion 从未在生产被调用 ★★★★★

- 文件：`recommendation/utils/seasonality.service.ts:79`
- grep 结果：**仅出现在 `test/helpers/mock-factories.ts` 与 `test/v6.9-integration.spec.ts`**。
- 后果链：
  1. `regionalCache: Map<regionCode, Map<foodId, info>>` 永远空。
  2. `getSeasonalityScore(foodId, regionCode, currentMonth)` 第一行 `const info = cache?.get(foodId); if (!info) return 0.5`。
  3. `food-scorer.service.ts:278` 拿到的第 11 维永远是 `0.5`。
  4. **V7.0 的 `monthWeights`、V6.4 的 availability 分支都进不到**——精心填的 12 月权重在评分阶段一次都没读过。
- 这是本次审计**影响最大的失效点**：业务以为已经在用 monthWeights，实际上没有。

### 3.2 AvailabilityScorerService 是死代码 ★★★★

- 文件：`recommendation/utils/availability-scorer.service.ts`
- 公开方法：`scoreWithRegion / scoreBatchWithRegion`
- grep 全 codebase：除文件自身外**零调用**。
- 模块：`recommendation.module.ts` 注册了它，但没人 inject。
- 含义：地区级 availability 打分器写了，但 pipeline 没接上。

### 3.3 monthWeights / seasonalityConfidence / priceMin/Max / currencyCode / priceUnit / regulatoryInfo 全部未消费

| 字段 | 期望用法 | 当前调用面 |
|---|---|---|
| `monthWeights` | 月份权重→第 11 维评分 | 因 §3.1 未生效 |
| `seasonalityConfidence` | 低置信度时减弱季节性影响 | 0 引用 |
| `priceMin / priceMax / currencyCode / priceUnit` | 预算敏感推荐、价格区间过滤 | 0 引用（`modules/diet` 全文件夹 grep 0） |
| `regulatoryInfo` | 法规/进口限制过滤 | 0 引用 |
| `source / sourceUrl / confidence` | 数据置信度衰减 boost 强度 | 0 引用 |

### 3.4 召回与过滤层零地区参与

- `recommendation/recall/`（cf-recall / semantic-recall / vector-search / collaborative-filtering / recall-merger）
- `recommendation/filter/`
- 这两个目录 grep `regionCode | FoodRegionalInfo | availability` **全部 0 命中**。
- 含义：候选池在召回阶段不区分地区。当用户库扩展到多国时，跨国食物会进入同一候选池争夺评分，地区 boost 也只是末端缩放，无法把"完全不可获得"的食物剔除。

### 3.5 locale → region 兜底未打通

- `localeToFoodRegion` 已写好 `zh-CN→CN / en-US→US`。
- `ProfileAggregatorService` 仅做 `enrichedProfile.regionCode || 'CN'`。
- 用户没填 regionCode 的海外请求，会被静默归为 CN，使用 CN 的 boostMap。

---

## 4. 时区方案的问题清单

### 4.1 季节性按服务器月份取数 ★★★★★
- `SeasonalityService.getSeasonalityScore` 用 `new Date().getMonth() + 1`。
- 后果：
  - 跨月零点窗口里，服务器（UTC / Asia/Shanghai）已进入下月，但用户本地仍在上月（或反之），月份偏差 1。
  - **南半球用户拿到北半球的 monthWeights 直接反季节**（数据层也没区分半球）。
  - 即使修复 §3.1 的 preload，这个 bug 仍存在。

### 4.2 PipelineContext 没有 timezone / currentMonth ★★★★
- `pipeline-context-factory.service.ts` 不写入 timezone 与 currentMonth。
- 评分链子模块要本地时间只能再次从 profile 取，**§4.1 就是这个漏的直接案例**。
- 不解决这个，未来任何"按本地时间打分"的 factor 都会重蹈覆辙。

### 4.3 DEFAULT_TIMEZONE 静默回落 Asia/Shanghai ★★★
- `timezone.util.ts` / profile fallback 都默认 `Asia/Shanghai`。
- 海外用户 onboarding 漏配 timezone 时不会告警，会被当成 +08 处理。
- 建议至少加 warn 日志（"timezone fallback to default for user X"），监控海外漏配率。

### 4.4 餐次时间硬编码中式作息 ★★★
- `daily-plan.service.ts:817` / `food.service.ts:213`：
  ```
  hour < 9   → breakfast
  hour < 14  → lunch
  hour < 17  → snack
  else       → dinner
  ```
- 西班牙午餐 14:00–16:00、东欧晚餐 21:00、地中海"merienda"下午茶……这套阈值通通错配。
- 与时区正交：时区拿到了正确的本地小时，但映射到餐次的规则不分文化。
- 建议把餐次窗口配置化，按 `regionCode`（country 级即可）取一份。

### 4.5 AvailabilityScorerService 渠道时段未强制本地小时 ★★
- `availability-scorer.service.ts:256-259` 接受 hour 参数判断 morning/midday/evening/lateNight。
- 当前没有外部调用所以暂不暴雷；将来接通时**必须**强制要求传入用户本地小时，不能用 `new Date().getHours()`。

### 4.6 getTimezoneOffsetMs 的 DST 边角 ★
- 通过 `toLocaleString('en-US')` 反推偏移，依赖 `Date.parse` 的 AM/PM 容错。
- DST 切换瞬间（春令夏令切换那 1 小时窗口）偏移可能短暂偏 1 小时。低概率但需注意，单元测试可加固。

### 4.7 半球/反季节问题（业务设计层缺失）★★★
- `monthWeights` 是 `(foodId × regionCode)` 维度，理论上 `regionCode='AU'` 与 `regionCode='CN'` 各自填一份就能解决半球。
- 但若运营只填 country=CN 的权重，其他国家用户取不到对应记录、又因 §1.2 fallback 设计，会回退到 country=user 自己国家的 null 或者根本没有 → §3.1 让它绕开了，问题被掩盖；一旦 §3.1 修好，**半球数据缺失会立刻反弹成"南半球用户被推冬季食物"的体验事故**。
- 数据治理上需要：北半球填一次后，至少为南半球主要 country（AU/NZ/AR/BR/CL/ZA）派生一份"月份偏移 6"的权重作为兜底。

---

## 5. 接入新字段的坑清单（按"严重程度"排序）

### 5.1 user_profiles.region_code @db.VarChar(5) 装不下三级粒度 ★★★★★
- `food_regional_info` 设计支持 `CN-GD-SZ`（≥8 字符）。
- 用户画像最多塞 `CN-GD`（5 字符），城市级根本存不下。
- 这是把地区能力下沉到用户层的**第一硬阻塞**。需要数据库迁移：`@db.VarChar(20)`（含分隔符 + city 编码冗余）。
- 迁移注意：`parseFoodRegionScope` 已经会 `slice(0,2)` 处理 country，新格式无需改解析逻辑。

### 5.2 缓存无主动失效 ★★★★
- `regional_boost:{region}` TTL 5 分钟 + `seasonality:region:{regionCode}` TTL 4 小时。
- 运营在管理后台修订地区表后，**最长 4 小时才生效**。
- 需要：在 `food_regional_info` 写入路径（管理后台 / staging 同步 / 补全任务）发出失效事件，订阅清理对应 region key。

### 5.3 SeasonalityService 内存 cache 并发隐患 ★★★
- `regionalCache: Map` 是 service 单例属性、按 region 维度做 key。
- 当前 preload 没人调（§3.1），所以无暴雷。
- 一旦正确接通 preload，并发请求里同一个 region 的不同食物会互相覆盖（preload 是整 region 一次性写入），需要确认 preload 是"幂等覆写"而不是"差异合并"。建议加 mutex 或改成 Redis 唯一来源、内存只做 LRU。

### 5.4 UNKNOWN 与无记录语义混淆 ★★★
- 当前 `getRegionalBoostMap` 的 switch：UNKNOWN 不命中任何分支→默认 1.0；无记录的 food 也是 1.0。
- 业务上"我们标了 UNKNOWN"和"我们根本没数据"是两件事，前者更应该衰减，后者应该用更上层的 country 兜底（`fallbackWhere` 已经准备好了，只是上层没用）。

### 5.5 稀疏表 fallback 未启用 ★★★
- 大量食物只有 `(CN, null, null)`，没有 region/city。
- `getRegionalBoostMap` 的 query 是按 `regionCode = ?` 直接命中，没有走 `buildFoodRegionalFallbackWhere`，导致：用户在 `regionCode='CN-GD-SZ'` 时**完全拿不到** `(CN, null, null)` 那条记录的 boost。
- 修复方向：`getRegionalBoostMap` 要按 `parseFoodRegionScope + fallbackWhere`，并按 `getFoodRegionSpecificity` 分组取最具体一条。

### 5.6 priceMin/Max 接入需要货币换算 ★★
- `currencyCode` 是 ISO 4217；用户预算的货币不一定一致。
- 接入价格过滤前先确定汇率源（静态表 / 第三方 API / 缓存策略）和"本地货币偏好"放在 user_profiles 哪个字段。

### 5.7 regulatoryInfo Json 结构未文档化 ★★
- 字段是 `Json?`，无 schema。先做最小集（`forbidden boolean / restrictedAge int? / requiresLicense boolean / notes`），写进 `prisma/schema.prisma` 注释或单独 doc。

---

## 6. 分阶段落地建议

### 阶段 0 · 数据治理（零代码，1–2 周）

> 目的：让现有数据"足够"，避免后续代码上线后因数据稀疏暴雷。

- 北半球主流国家 + 至少一个主省级（CN/CN-GD/CN-BJ/US/US-CA/JP/...）填齐 `monthWeights`。
- 南半球主要国家（AU/NZ/AR/BR/CL/ZA）派生"月份偏移 6"的兜底权重。
- 高频食物补齐 `localPopularity` 与 `availability`，把 UNKNOWN 显式分流为"YEAR_ROUND 默认"或"RARE"。
- 价格字段先填 country 级 min/max + currencyCode（不接代码）。

### 阶段 1 · 修死代码 + 时区下推（1 周）

> 目的：让已经写好的代码真正跑起来；把时区从 profile 一次性带到评分链。

1. **接通 SeasonalityService.preloadRegion**：
   - 在 `pipeline-context-factory.service.ts` 构造 `PipelineContext` 时调用 `seasonalityService.preloadRegion(regionCode)`。
   - 同时把 `timezone` 与 `currentMonth = getUserLocalMonth(now, timezone)` 写进 `PipelineContext`。
2. **替换 SeasonalityService.getSeasonalityScore 的月份来源**：从 `ctx.currentMonth` 取，不再 `new Date().getMonth()+1`。新增 `getUserLocalMonth` 工具（仿 `getUserLocalDate`）。
3. **`getRegionalBoostMap` 改为按 fallback where**：用 `parseFoodRegionScope + buildFoodRegionalFallbackWhere`，按 `getFoodRegionSpecificity` 取最具体一条。
4. **把 `localeToFoodRegion` 接入 `ProfileAggregatorService` 的 fallback 链**：`enrichedProfile.regionCode || localeToFoodRegion(req.locale) || 'CN'`，并打 metric 监控海外用户 fallback 命中率。
5. **加 timezone fallback 告警日志**：`profile-resolver.service.ts:79-91, 166-167` 的 fallback 路径加 warn。

### 阶段 2 · 用户画像列宽 + 缓存失效（1–2 周，含 DB 迁移）

> 目的：解锁城市级地区能力 + 修运营痛点。

1. **DB 迁移**：`user_profiles.region_code @db.VarChar(20)`。同步审视：onboarding 表单、profile API DTO、admin profile 编辑。
2. **缓存主动失效**：
   - `food_regional_info` 写入路径发布 `food.region.changed` 事件（payload: `{ foodIds[], affectedRegions[] }`）。
   - 订阅者：`PreferenceProfileService.invalidateRegional` + `SeasonalityService.clearCache(region)`。
3. **`SeasonalityService` 并发安全**：preload 加 region-level mutex（per-region promise dedupe）。

### 阶段 3 · 召回层裁剪（2–3 周）

> 目的：把地区从"末端 boost"上升为"候选池约束"，为多国扩展打底。

1. 召回层（`cf-recall / semantic-recall / vector-search / recall-merger`）注入 `regionalCandidateFilter`：
   - 按 `(country, region, city)` fallback where 计算 `notAvailableFoodIds` 集合（availability=RARE/LIMITED + city/region 命中）。
   - 召回结果剔除该集合。
2. `RegulatoryInfoFilter`：在 filter 阶段读 `regulatoryInfo.forbidden=true` 的食物直接剔除。
3. `RegionalBoostFactor` 保留，但定位下沉为"候选池内"的微调，不再承担"完全不可得"的剔除。

### 阶段 4 · 价格 / 文化餐次 / 数据置信度（按需）

1. **价格敏感推荐**：在 user_profiles 增加 `currencyCode` + `budgetPerMeal`，新增 `PriceFitFactor`，需要汇率源（静态表起步）。
2. **餐次窗口配置化**：`meal_window_config` 按 country 配置（CN/ES/IT/DE/JP/KR/...），替换 §4.4 的硬编码。
3. **数据置信度衰减**：`SeasonalityService` 用 `seasonalityConfidence` 把 monthWeights 影响幅度按 `(0.5 + 0.5*confidence)` 缩放；`RegionalBoostFactor` 同理用 `confidence` 衰减乘数偏离 1.0 的幅度。
4. **AvailabilityScorerService 接入**：决定是合并到 `RegionalBoostFactor` 还是独立成 factor。当前两者职责重叠，应二选一，不建议同时跑。

### 阶段 5 · 半球与文化纵深（长期）

- `food_regional_info` 增加 `hemisphere` 派生视图或在 country 元数据表打标。
- 餐次/作息 / 主餐结构按 country 差异化（地中海三餐+下午茶 vs 东亚三餐 vs 北欧两热餐）。

---

## 7. 风险与回归点

| 风险 | 触发 | 缓解 |
|---|---|---|
| 修好 preload 后南半球反季节 | §3.1 修复 + 数据缺失 | 阶段 0 必须先做 |
| 列宽迁移期间老数据被截断 | `region_code` 从 5→20 | 迁移脚本 + 写入端先放宽校验、读取端继续容忍 |
| 缓存失效事件风暴 | 批量补全任务一次更新数万行 | 事件按 region 聚合去重，5s 窗口合并 |
| Locale fallback 误判 | 用户使用 en-US 但人在 JP | 优先级：profile.regionCode > IP/timezone 推断 > locale > 'CN' |
| 召回层裁剪过严 | RARE/LIMITED 数据噪声 | 阶段 3 先 shadow 跑（只记录、不剔除）2 周再切流 |

---

## 8. 关键文件索引

### 数据库
- `apps/api-server/prisma/schema.prisma`
  - 行 755-803：`FoodRegionalInfo`
  - 行 2077：`user_profiles.region_code @db.VarChar(5)` ← §5.1
  - 行 2085：`user_profiles.timezone`

### 工具
- `apps/api-server/src/common/utils/timezone.util.ts`
- `apps/api-server/src/common/utils/food-regional-info.util.ts`
- `apps/api-server/src/common/utils/locale-region.util.ts`（未接入推荐）

### 推荐 — 地区
- `recommendation/utils/seasonality.service.ts` ← preload 死链（§3.1）
- `recommendation/utils/availability-scorer.service.ts` ← 死代码（§3.2）
- `recommendation/profile/preference-profile.service.ts:193-242` ← `getRegionalBoostMap`
- `recommendation/profile/profile-aggregator.service.ts:152-159` ← regionCode 注入
- `recommendation/scoring-chain/factors/regional-boost.factor.ts`
- `recommendation/pipeline/food-scorer.service.ts:278` ← 第 11 维入口
- `recommendation/context/pipeline-context-factory.service.ts` ← timezone/currentMonth 缺位
- `modules/diet/recommendation.module.ts`

### 推荐 — 时区
- `recommendation/pipeline/constraint-generator.service.ts:156, 191`
- `user/.../profile/contextual-profile.service.ts`
- `user/.../profile/profile-resolver.service.ts:79-91, 166-167`
- `services/recommendation-engine.service.ts:468, 584, 1015`

### 召回与过滤（确认零地区）
- `recommendation/recall/`
- `recommendation/filter/`

---

_作者：推荐引擎 / 用户画像 联合审计_
_审计代码版本：当前 main_
_下一次复审建议：阶段 1 完成后 2 周内回归 §3.1、§4.1、§5.5 三处。_
