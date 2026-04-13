# V8.0 升级方案 — 数据安全性 + AI补全预览 + 公开接口防护 + 系统健壮性

> 基于 V7.9 架构的版本演进，不新增核心系统，不扩展业务边界
> 聚焦：修补安全漏洞、增加AI补全可视化、强化系统稳定性、消除重复路由

---

## 一、能力评估（Step 1）

### 1.1 V7.9 已具备能力

| 能力域       | 状态 | 说明                              |
| ------------ | ---- | --------------------------------- |
| AI分阶段补全 | ✅   | 4阶段补全、IQR校验、分阶段入队    |
| 候选晋升     | ✅   | food_candidate → foods 批量晋升   |
| 补全统计     | ✅   | 全库进度、操作统计、一致性校验    |
| 推荐粘性缓存 | ✅   | 5分钟窗口内结果稳定               |
| 决策可信度   | ✅   | dataConfidence + DecisionValueTag |
| 快捷分析     | ✅   | 零AI成本快速分析                  |
| 文本分析缓存 | ✅   | 10分钟归一化缓存                  |
| 暂存审核     | ✅   | staged → approve/reject 流程      |

### 1.2 现存问题（按优先级）

#### 🔴 严重（直接影响数据安全/系统正确性）

| 编号 | 问题                                                                                                | 影响                                                         |
| ---- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| S1   | **SQL注入风险** — `getCategoryAverage()` 中 category/subCategory 直接字符串插值到 `$queryRawUnsafe` | 二阶SQL注入，攻击者若能控制 foods.category 值即可执行任意SQL |
| S2   | **无事务边界** — `applyEnrichment()` foods.update + changelog.create 非原子，4处同类问题            | 数据不一致：食物已更新但审计日志丢失，或反之                 |
| S3   | **路由冲突** — `POST /app/food/analyze` 在 food-analyze 和 food-record 两个控制器重复注册           | 不可预测的路由行为，一个实现成为死代码                       |

#### 🟡 高（影响系统质量与安全）

| 编号 | 问题                                                               | 影响                                                     |
| ---- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| H1   | **公开接口无限流** — `food-library.controller` 6个端点无认证无限流 | 可被爬取、DDoS，`GET /foods` 单次返回500条               |
| H2   | **AI补全预览缺失** — 后台无法预览暂存的AI补全数据与原始数据的对比  | 管理员盲审：只能看到changelog JSON，无法直观判断数据质量 |
| H3   | **线性退避策略** — AI调用失败后 1.5s×attempt 线性等待              | 密集重试加剧API限流，指数退避更合理                      |
| H4   | **预计算版本硬编码** — `CURRENT_STRATEGY_VERSION = 'v6.1.10'`      | 版本管理容易遗忘更新，导致缓存失效或过期                 |

#### 🟢 中（影响可维护性）

| 编号 | 问题                                                                             | 影响                                     |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| M1   | **SQL模式不一致** — 同一文件中混用 `$queryRawUnsafe`+插值 和 `$queryRaw`+参数化  | 代码审计困难，新开发者容易复制不安全模式 |
| M2   | **统计SQL中action硬编码插值** — `getEnrichmentStatistics` 中action字符串直接拼接 | 风险极低但违反纵深防御原则               |

---

## 二、核心升级方向（Step 2）— 4 个方向

### 方向 1：数据安全加固（解决 S1, S2, M1, M2）— 核心

**为什么需要：**

1. SQL注入是 OWASP Top 10 首位安全风险，即使是二阶注入也必须修复
2. 无事务边界导致的数据不一致会破坏审计可追溯性
3. 参数化查询是行业标准，混用模式增加维护成本

**解决方案：**

- 将所有 `$queryRawUnsafe` + 字符串插值改为 `$queryRaw` + 参数化查询
- 为 `applyEnrichment`、`applyTranslationEnrichment`、`applyRegionalEnrichment`、`approveStaged` 添加 Prisma `$transaction` 包裹
- 统一全文件SQL模式

### 方向 2：AI补全可视化与流程优化（解决 H2, H3）

**为什么需要：**

1. 管理员当前只能看到 changelog 的 JSON 原文，无法直观对比补全前后的数据差异
2. 线性退避在高并发场景下会加剧API限流问题

**解决方案：**

- 新增暂存预览端点：返回补全前数据 + 补全建议 + diff 对比
- 新增暂存预览类型定义
- AI调用改为指数退避 + 抖动

### 方向 3：系统防护加固（解决 S3, H1, H4）

**为什么需要：**

1. 重复路由导致不可预测的行为
2. 公开接口无防护可被滥用
3. 硬编码版本号容易遗忘更新

**解决方案：**

- 移除 `food-record.controller` 中的重复 `POST analyze` 路由
- 为公开食物库接口添加限流装饰器
- 预计算版本号改为基于配置的自动计算

### 方向 4：代码健壮性（解决 H3, M1, M2）

**为什么需要：**

1. 线性退避策略不适合AI API调用场景
2. SQL模式不一致增加维护成本

**解决方案：**

- 统一退避策略为指数退避+随机抖动
- 统一所有SQL查询为参数化模式

---

## 三、架构升级设计（Step 3）

### 3.1 当前架构（V7.9）— 无新模块

```
┌─────────────────────────────────────────────┐
│              Admin Dashboard                │
│         (Vite + React + TanStack)           │
└──────────────────┬──────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────┐
│              API Server (NestJS)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │ Food     │  │ Diet     │  │ Pipeline │  │
│  │ Module   │  │ Module   │  │ Module   │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│  ┌──────────┐  ┌──────────┐                │
│  │ Subscr.  │  │ Auth     │                │
│  │ Module   │  │ Module   │                │
│  └──────────┘  └──────────┘                │
└──────────────────┬──────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│ │  Redis   │  │ DeepSeek │
│+ Prisma │ │ (BullMQ) │  │   API    │
└────────┘  └──────────┘  └──────────┘
```

### 3.2 V8.0 变更标注

```
Pipeline Module:
  [修改] food-enrichment.service.ts   — SQL参数化 + 事务 + 指数退避
  [修改] food-enrichment.controller.ts — 新增预览端点

Food Module:
  [修改] food-record.controller.ts    — 移除重复路由
  [修改] food-library.controller.ts   — 添加限流
  [新增] food.types.ts                — EnrichmentPreview 类型

Diet Module:
  [修改] precompute.service.ts        — 版本号动态化
```

### 3.3 不新增模块 — 仅修改现有模块内的文件

---

## 四、模块级升级设计（Step 4）

### 4.1 SQL注入修复（核心变更）

**问题位置：** `food-enrichment.service.ts` 第 754-770 行

**当前代码（危险）：**

```typescript
const whereClause = subCategory
  ? `category = '${category}' AND sub_category = '${subCategory}'`
  : `category = '${category}'`;
// ... 后续拼接到 $queryRawUnsafe
```

**修复方案：** 改用 Prisma 的 `$queryRaw` + `Prisma.sql` tagged template：

```typescript
// 使用参数化查询，杜绝SQL注入
const countResult = subCategory
  ? await this.prisma.$queryRaw<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM foods
      WHERE category = ${category} AND sub_category = ${subCategory}`
  : await this.prisma.$queryRaw<[{ count: string }]>`
      SELECT COUNT(*)::text AS count FROM foods
      WHERE category = ${category}`;
```

**同类修复：**

- `getEnrichmentProgress()`：字段名从 `ENRICHABLE_FIELDS` 常量取得，使用 `Prisma.raw()` 安全构建
- `scanMissingFields()`：同上
- `getEnrichmentStatistics()`：action 列表参数化

### 4.2 事务边界加固

**问题位置：** `applyEnrichment()`（第 1256-1332 行）等 4 处

**修复方案：**

```typescript
// 使用 Prisma 交互式事务保证原子性
await this.prisma.$transaction(async (tx) => {
  await tx.foods.update({ where: { id: foodId }, data: updateData });
  await tx.food_change_logs.create({ data: changeLogData });
});
```

**同类修复：**

- `applyTranslationEnrichment()` — 翻译 + changelog 事务化
- `applyRegionalEnrichment()` — 区域数据 + changelog 事务化
- `approveStaged()` — apply + 状态更新事务化

### 4.3 AI补全预览端点

**新增端点：** `GET /admin/food-pipeline/enrichment/staged/:id/preview`

**返回结构：**

```typescript
interface EnrichmentPreview {
  food: {
    // 当前食物数据
    id: string;
    name: string;
    name_zh: string;
    category: string;
  };
  staged: {
    // AI补全建议
    changes: Record<string, any>;
    confidence: number;
    stage: number;
    created_at: Date;
  };
  diff: Array<{
    // 逐字段对比
    field: string;
    label: string; // 中文字段名
    currentValue: any; // 当前值
    suggestedValue: any; // AI建议值
    unit: string; // 单位
    validRange: { min: number; max: number } | null;
  }>;
  categoryAverage: Record<string, number>; // 同类平均值参考
}
```

### 4.4 公开接口限流

**问题位置：** `food-library.controller.ts` 全部 6 个端点

**修复方案：** 使用项目已有的限流装饰器：

```typescript
@Throttle({ default: { limit: 30, ttl: 60000 } })  // 每分钟30次
@Get('search')
async searchFoods(...) { ... }
```

### 4.5 重复路由清理

**问题位置：** `food-record.controller.ts` 第 65 行

**修复方案：** 移除 `food-record.controller` 中的 `@Post('analyze')` 方法，保留 `food-analyze.controller` 中功能更完整的版本（带配额/订阅检查）。

### 4.6 指数退避策略

**问题位置：** `food-enrichment.service.ts` `callAI()` 和 `callAIForStage()`

**当前：** `sleep(1500 * attempt)` — 线性退避（1.5s, 3s, 4.5s）

**修复：** `sleep(Math.min(1000 * 2 ** attempt + Math.random() * 500, 15000))` — 指数退避+抖动，上限15秒

### 4.7 预计算版本动态化

**问题位置：** `precompute.service.ts` 第 35 行

**修复方案：** 基于策略配置文件的哈希值自动生成版本号，避免人工维护遗忘。

---

## 五、技术路线图（Step 5）

### Phase 1（快速收益 — 修安全漏洞 + 修关键bug）

> 目标：消除所有SQL注入风险、添加事务边界、修复重复路由

| 编号 | 任务                                                                                           | 优先级 | 预估影响    |
| ---- | ---------------------------------------------------------------------------------------------- | ------ | ----------- |
| P1-A | SQL注入修复 — `getCategoryAverage()` 参数化重写                                                | 高     | 修改 ~40 行 |
| P1-B | SQL注入修复 — `getEnrichmentProgress/scanMissingFields/getFoodsNeedingEnrichment` 参数化       | 高     | 修改 ~60 行 |
| P1-C | SQL注入修复 — `getEnrichmentStatistics` action参数化                                           | 中     | 修改 ~20 行 |
| P1-D | 事务边界 — `applyEnrichment` + `applyTranslationEnrichment` + `applyRegionalEnrichment` 事务化 | 高     | 修改 ~80 行 |
| P1-E | 事务边界 — `approveStaged` 事务化                                                              | 高     | 修改 ~30 行 |
| P1-F | 重复路由 — 移除 `food-record.controller` 中的 `POST analyze`                                   | 高     | -50 行      |
| P1-G | 指数退避 — `callAI` + `callAIForStage` 改指数退避+抖动                                         | 中     | 修改 ~10 行 |
| P1-H | 编译验证 + 测试                                                                                | 高     | 0           |

### Phase 2（体验优化 — AI补全预览 + 接口防护）

> 目标：管理员可预览AI补全差异，公开接口有限流保护

| 编号 | 任务                                                 | 优先级 | 预估影响    |
| ---- | ---------------------------------------------------- | ------ | ----------- |
| P2-A | 类型定义 — `EnrichmentPreview` + 字段中文标签映射    | 高     | +80 行      |
| P2-B | 服务层 — `getEnrichmentPreview()` 方法实现           | 高     | +100 行     |
| P2-C | 控制器 — `GET staged/:id/preview` 端点               | 高     | +40 行      |
| P2-D | 公开接口限流 — `food-library.controller` 6个端点限流 | 高     | +15 行      |
| P2-E | 预计算版本动态化 — `precompute.service.ts`           | 中     | 修改 ~20 行 |
| P2-F | 编译验证 + 测试                                      | 高     | 0           |

### Phase 3（增长优化 — 批量预览 + 质量仪表盘增强）

> 目标：提升管理效率，增强数据质量可视化

| 编号 | 任务                                        | 优先级 | 预估影响 |
| ---- | ------------------------------------------- | ------ | -------- |
| P3-A | 批量预览 — `POST staged/batch-preview` 端点 | 中     | +60 行   |
| P3-B | 质量报告增强 — 补全覆盖率趋势、字段级完整度 | 中     | +50 行   |
| P3-C | 编译验证 + 测试                             | 高     | 0        |

---

## 六、数据迁移（Step 6）

### 6.1 无 Schema 变更

V8.0 不修改 Prisma schema，所有变更在应用层完成。

### 6.2 无数据填充

不需要数据迁移脚本。

---

## 七、风险与限制

### 7.1 SQL参数化对动态字段名的限制

Prisma 的 `$queryRaw` 不支持参数化列名。对于 `ENRICHABLE_FIELDS` 等常量来源的字段名，使用白名单校验 + `Prisma.raw()` 构建安全的列名引用。

### 7.2 事务性能影响

Prisma 交互式事务会持有数据库连接直到事务完成。由于补全操作是后台批处理任务，影响可控。

### 7.3 限流可能影响SEO爬虫

公开食物库接口添加限流后，搜索引擎爬虫可能触发限流。设置合理的限流阈值（30次/分钟）应可兼顾。

### 7.4 重复路由移除的向后兼容

移除 `food-record.controller` 中的重复路由不影响前端，因为 `food-analyze.controller` 中的实现功能更完整且已在生产中被使用。

---

## 八、文档升级（Step 7）— 差异输出

### 新增章节

- AI补全预览端点文档
- 安全加固说明

### 修改内容

- SQL查询模式说明
- 事务边界规范
- 限流配置说明

### 删除内容

- 无

---

## 九、实现记录

> 本节在实现过程中逐步补充
