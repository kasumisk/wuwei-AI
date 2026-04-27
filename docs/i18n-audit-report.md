# NestJS API Server i18n 全量审计报告

**审计范围**：`apps/api-server` —— AI 推荐引擎 + AI 决策系统
**审计排除**：`**/langchain/**`、`**/*.spec.ts`、`scripts/seeds/**`、`/test/**`
**审计版本**：本次会话提交后状态
**默认 locale**：`en-US`（与 `core/i18n/i18n.types.ts:I18N_DEFAULT_LOCALE` 对齐）

---

## ① 问题总览

### 严重度分类

| 严重度 | 类别 | 数量 | 状态 |
|---|---|---|---|
| 🔴 高 | 占位符 bug：`{var}` vs `{{var}}` 永远不匹配 → 响应体出现 `{food}({cal})` | ~40 处 | ✅ 已修 |
| 🔴 高 | i18n raw key 泄漏（key 不存在 → 兜底返回字符串字面量）："goal.health"、"prompt.contextLabel.goal" 等 | 3 处 | ✅ 已修 |
| 🔴 高 | enum 字面量直接拼到响应体 message：`mealType: snack`、`allergens: [sesame, soy]` 等 | 80+ 个 enum 值 | ✅ 已修（建字典 + 接入 translateEnum） |
| 🟠 中 | 默认 locale 不一致：`'zh-CN'` vs `'en-US'` 散落在 RequestContext / FALLBACK_LOCALE | 3 处 | ✅ 已统一 `en-US` |
| 🟠 中 | `chainLabel` fallback 默认 `zh-CN`，与全局默认不一致 | 1 处 | ✅ 已修 |
| 🟠 中 | `loc === 'en-US' ? ... : loc === 'ja-JP' ? ... : ...` 三元散落（不可扩展） | 数十处（coach 模块为重灾区） | ⚠️ 部分迁移；其余由 PromptBuilder + ESLint 规则约束 |
| 🟡 低 | `coach-format.service.ts` 内置 `i18nStrings` 字典（语言硬编码于 .ts） | 1 文件 | ⚠️ 保留为兜底（首选已走 I18nManagementService） |
| 🟡 低 | Coach 模块 `.replace('{{var}}', value)` 链式插值（功能正确但风格不统一） | 5 处 | ✅ 已统一为 `cl(key, locale, vars)` |

### 修复后客观指标

- TypeScript 编译：**0 错误**（`tsc --noEmit -p apps/api-server`）
- 修改文件数：**14 业务文件 + 6 i18n 资源 + 4 基建/规则**
- 新建基建：**3 个 service / helper + 1 个 ESLint plugin + 1 个 checklist**
- 新增 i18n key：~80 个 `enum.*` + 3 个 `prompt.contextLabel.goal`

---

## ② 硬编码清单（代码级证据）

### 2.1 占位符 bug（`{var}` vs `{{var}}`）—— 用户实际能在响应体看到

**根因**：JSON 模板用 `{{var}}` 双花括号，调用方用 `.replace('{var}', value)` 单花括号 → 永远匹配不上 → 字面量 `{food}` `{cal}` `{remaining}` 出现在响应体。

**证据样本（修复前）**：
- `decision/decision/decision-summary.service.ts:62-64` — `cl('summary.headline', loc).replace('{food}', name).replace('{cal}', String(cal))`
- `decision/decision/alternative-suggestion.service.ts:118-120` — 同模式
- `decision/decision/decision-engine.service.ts:201` — 同模式
- `decision/decision/decision-explainer.service.ts:88-92` — 同模式
- `decision/decision/portion-advisor.service.ts:44-46` — 同模式
- `decision/decision/should-eat-action.service.ts:73-77` — 同模式
- `decision/decision/issue-detector.service.ts:91` — 同模式
- `decision/score/food-scoring.service.ts:178` — 同模式
- `decision/config/checks/budget-timing-checks.ts:83-85` — 同模式
- `decision/config/checks/health-condition-checks.ts:51-53` — 同模式
- `decision/analyze/user-context-builder.service.ts:80-83、249-253` — 同模式
- `food/app/services/analysis-prompt-schema.ts:122-124` — 同模式

**总计**：~40 处 `.replace('{x}', value)`，全部已替换为 `cl(key, locale, { x: value })`。

### 2.2 i18n raw key 泄漏

**根因**：JSON 文件里 key 是 `goal.label.health`，代码却调用 `cl('goal.health', locale)` → I18nService 找不到 → 兜底返回 key 字符串本身 → 响应体出现字面量 `"goal.health"`。

**证据**：
- `decision/analyze/user-context-builder.service.ts:105` — 调 `cl('goal.health', locale)`，JSON 实际 key `goal.label.health`
- `decision/analyze/user-context-builder.service.ts:254` — 同上
- `food/app/services/analysis-prompt-schema.ts:115` — `loc === 'en-US' ? 'Goal' : 'Goal'`（硬编码三元，应用 cl）

**修复**：统一调 `cl('goal.label.health', locale)`；硬编码三元改用 `cl('prompt.contextLabel.goal', locale)`，并在三个 i18n JSON 中新增对应 key。

### 2.3 Enum 值直接拼到响应体（80+ 个 enum 值未本地化）

**证据样本**：
- `mealType: "snack"`、`"breakfast"`、`"dinner"` 等 5 个值
- `activityLevel: "sedentary"`、`"light"`、`"moderate"`、`"active"`、`"very_active"` 5 个值
- `accuracyLevel`、`reviewLevel`、`analysisQualityBand`、`budgetStatus`、`gender`、`goal` 各 3-5 个值
- `allergens: ["sesame","soy","dairy","peanut","egg",...]` 列表型
- `dietaryRestrictions: ["vegan","vegetarian","halal","kosher",...]`
- `healthConditions: ["diabetes","hypertension","kidney_disease",...]`
- `impact: "critical"|"warning"|"positive"|"neutral"`
- `foodCategory: ...`（confidence-diagnostics 里直接拼到错误消息）

**修复**：
- 在 `common/i18n/{en-US,zh-CN,ja-JP}.json` 增加 `enum.<category>.<value>` 三语言字典（~80 key × 3 locale）
- 新建 `common/i18n/enum-i18n.ts` 暴露 `translateEnum(category, value)` 与 `translateEnumList(category, values)`，CLS 自动取 locale，找不到译文返回原值
- 在 user-context-builder / decision-summary / evidence-pack-builder / confidence-diagnostics / food-analyze.controller 等出口接入

### 2.4 默认 locale 不一致

**修复前**：
- `core/context/request-context.service.ts` 默认 `'zh-CN'`
- `diet/app/recommendation/utils/i18n-messages.ts` `FALLBACK_LOCALE = 'zh-CN'`
- `food/app/services/analysis-prompt-schema.ts` 默认 `'zh-CN'`

**修复后**：全部统一 `en-US`，与 `I18N_DEFAULT_LOCALE` 对齐。

### 2.5 Coach 模块语言三元（数量大但非 bug）

**证据**：`coach/app/prompt/coach-prompt-builder.service.ts` 全文 ~80 处 `const isEn = resolvedLocale === 'en-US'; const xxx = isEn ? '...' : isJa ? '...' : '...'`

**当前状态**：保留（占文件 60% 体量，逐行迁移风险大）。本次仅把使用 `.replace('{{x}}', v)` 的 5 处统一为 `cl(key, loc, vars)` 风格。**长期方案**：使用新建的 `PromptBuilderService`，把整段 prompt 模板移到 `modules/coach/i18n/prompts/<locale>/<name>.md`，由 ESLint `i18n/no-locale-ternary` 规则在新增代码上把关，存量逐步迁移。

---

## ③ 调用链 lang 传递审计

### 3.1 入口（HTTP）— ✅ 完备

`core/i18n/i18n.middleware.ts` 在每个请求上：
1. 解析 `?lang` → `x-lang` header → `Accept-Language` header
2. 通过 `I18nService.normalizeLocale` 规范成 BCP-47
3. 写入 CLS（`RequestContextService.locale`）

### 3.2 Service → Service — ✅ 由 CLS 自动透传

`cl()` / `I18nService.t()` / `LanguageContextService.t()` / `translateEnum()` 均从 CLS 读 locale，业务代码无需手动传。

### 3.3 Queue / Cron / Background job — ⚠️ 风险点

**现状**：未发现明确的 queue worker locale 透传约定。AI 异步分析（`food-analysis.processor.ts`）等场景如果在 worker 中调 `cl()`，会取不到 CLS → 兜底 `en-US`。

**建议**：
- 把 locale 作为 job payload 必填字段
- worker 入口用 `RequestContextService.run({ locale }, () => handler(...))` 重建上下文
- 已写入 `docs/i18n-checklist.md` § 5

### 3.4 AI Prompt 调用 — ⚠️ 部分依赖

**现状**：prompt 拼装时大多数走 `cl(key, locale)` 显式传 locale，但仍有 `loc === 'en-US' ? ...` 三元；且 AI 的 system prompt 是否包含 "Reply in {{language}}" 指令未做强约束。

**修复**：新建 `PromptBuilderService` 提供"按 locale 加载 prompt 文件"能力 + checklist § 7 强制要求。

---

## ④ AI Prompt 国际化

### 4.1 现状

- AI 推荐 / 决策 / 教练特性的 prompt 拼装散落在：
  - `coach/app/prompt/coach-prompt-builder.service.ts`（最大）
  - `decision/decision/decision-explainer.service.ts`
  - `food/app/services/analysis-prompt-schema.ts`
  - `decision/analyze/user-context-builder.service.ts`
- 模式：在 `.ts` 中拼字符串 + `loc === 'xx-XX' ? '...' : '...'` 三元 + 把 enum 原值塞进 prompt
- 风险：扩展到 10+ 语言需要在每处三元加分支；prompt A/B 测试和翻译人员协作困难

### 4.2 修复（基建落地）

**新建 `core/i18n/prompt-builder.service.ts`**：
- 启动期扫描 `modules/<module>/i18n/prompts/<locale>/<name>.md`
- 调用：`promptBuilder.render('coach', 'system-base', { userName, goal, calorieTarget })`
- locale 自动取 CLS；缺失 locale 自动 fallback `en-US`；插值 `{{var}}` 全局替换
- `nest-cli.json` 已加 `assets` 规则把 `.md` 模板拷到 dist

**示例模板已建**：`modules/coach/i18n/prompts/{en-US,zh-CN,ja-JP}/system-base.md`

**Prompt 中 enum 值**：所有 prompt 内拼接的 enum 已改走 `translateEnum`，避免 LLM 收到 `mealType: snack` 时输出英文。

### 4.3 强约束（由 checklist § 7 覆盖）

- System prompt 必须包含 "Reply in {{language}}"
- few-shot 示例与 prompt 同 locale
- LLM 输出的 explanation / advice / reason 由 `translateEnum` 在序列化时翻译，不让 LLM 自己生成翻译

---

## ⑤ i18n 结构

### 5.1 现有架构（保留 + 增强）

```
apps/api-server/src/
├── core/i18n/
│   ├── i18n.service.ts               # 启动期扫描，dictionary[fullKey][locale]
│   ├── i18n.middleware.ts            # ?lang / x-lang / Accept-Language → CLS
│   ├── i18n.module.ts                # @Global
│   ├── i18n.types.ts                 # I18N_LOCALES, I18N_DEFAULT_LOCALE='en-US', alias
│   ├── language-context.service.ts   # ★ 新增 facade
│   └── prompt-builder.service.ts     # ★ 新增 prompt 文件加载器
├── common/i18n/
│   ├── {en-US,zh-CN,ja-JP}.json      # 通用 + enum.*
│   └── enum-i18n.ts                  # ★ translateEnum / translateEnumList
└── modules/
    ├── decision/
    │   ├── i18n/{en-US,zh-CN,ja-JP}.json
    │   ├── i18n/_load.ts
    │   ├── i18n/decision-labels.ts   # cl(key, locale?, vars?) ★ 已支持 vars
    │   ├── i18n/explainer-labels.ts  # chainLabel(key, vars?, locale?)
    │   └── coach/coach-i18n.ts       # ci() 已委托给 cl()
    └── coach/
        ├── i18n/                     # JSON 字典
        └── i18n/prompts/{locale}/system-base.md  # ★ 示例 prompt
```

### 5.2 命名约定

- key：`<namespace>.<camelCaseKey>`，namespace = 模块文件夹名
- 占位符：`{{var}}` 双花括号
- locale：BCP-47（`en-US` / `zh-CN` / `ja-JP`）
- 同 key 跨模块重复定义 → 启动期 conflict 报错
- 缺 locale → 启动期 missing key 告警

### 5.3 Fallback 链

- 命中链：requested locale → `en-US` → 任一已有 locale → key 字面量
- 生产模式 dist 缺资源 → 启动期 fatal（防止给前端返 raw key）

---

## ⑥ 修复方案（代码级）

### 6.1 已落地（本会话已提交）

| 类别 | 文件 | 改动摘要 |
|---|---|---|
| 核心 helper | `decision/i18n/decision-labels.ts` | `cl(key, locale?, vars?)` 支持 `{{var}}` + `{var}` 双语法插值 |
| 核心 helper | `decision/coach/coach-i18n.ts` | `ci()` 委托给 `cl()`，复用插值逻辑 |
| 核心 helper | `decision/i18n/explainer-labels.ts` | fallback 由 `zh-CN` 改 `en-US` |
| 默认 locale | `core/context/request-context.service.ts` | `'zh-CN'` → `'en-US'` |
| 默认 locale | `diet/app/recommendation/utils/i18n-messages.ts` | `FALLBACK_LOCALE` 改 `'en-US'` |
| 默认 locale | `food/app/services/analysis-prompt-schema.ts` | 默认改 `'en-US'`，去硬编码三元 |
| 字典 | `common/i18n/*.json` | 新增 `enum.*` ~80 key × 3 locale |
| 字典 | `decision/i18n/*.json` | 新增 `prompt.contextLabel.goal` |
| 业务修复 | decision/decision/* (8 文件) | `.replace('{x}',v)` 全替换为 `cl(key, locale, {x:v})` |
| 业务修复 | decision/score/food-scoring.service.ts | 同上 |
| 业务修复 | decision/config/checks/* (2 文件) | 同上 |
| 业务修复 | decision/analyze/user-context-builder.service.ts | 同上 + raw key 修复 + translateEnum 接入 |
| 业务修复 | food/app/services/analysis-prompt-schema.ts | 修 has_remaining bug + 去三元 + 改 fallback |
| 响应体 enum | food/app/controllers/food-analyze.controller.ts | 加 `mealTypeLabel` 伴随字段 |
| 响应体 enum | decision/analyze/evidence-pack-builder.service.ts | analysisQualityBand / reviewLevel 接入 translateEnum |
| 响应体 enum | decision/analyze/confidence-diagnostics.service.ts | 修英文硬编码消息（line 96-103）→ `cl('diag.categoryMismatch', ...)` + foodCategory 翻译 |
| Coach 风格统一 | coach/app/prompt/coach-prompt-builder.service.ts | `nextMealTemplate` 链式 .replace → `cl(key, loc, vars)` |
| Coach 风格统一 | coach/app/formatting/coach-format.service.ts | 内置字典 fallback 的 `.replace` → 全局 regex 替换 |
| 基建 | core/i18n/language-context.service.ts | ★ 新增统一 facade |
| 基建 | core/i18n/prompt-builder.service.ts | ★ 新增 prompt 文件加载器 |
| 基建 | core/i18n/i18n.module.ts | 注册新 service 到 @Global module |
| 资源 | nest-cli.json | assets 加 `.md` / `.txt` prompt 模板 |
| 治理 | eslint-plugin-i18n.mjs | ★ 新增自定义规则 `no-cjk-literal` + `no-locale-ternary` |
| 治理 | eslint.config.mjs | 注册 i18n 规则（warn 级别） |
| 文档 | docs/i18n-checklist.md | ★ 12 节 PR 检查清单 |
| 示例 | modules/coach/i18n/prompts/{locale}/system-base.md | ★ 三语言 prompt 模板 |

### 6.2 关键代码片段

**新 cl 签名**（`decision/i18n/decision-labels.ts`）：
```ts
export function cl(
  key: string,
  locale?: string,
  vars?: Record<string, string | number>,
): string {
  const loc = (locale || ctx?.locale || 'en-US') as I18nLocale;
  const dict = LABELS[loc] ?? LABELS['en-US'];
  let text = dict[key] ?? LABELS['en-US'][key] ?? key;
  if (vars) {
    text = text.replace(/\{\{?\s*([\w.]+)\s*\}?\}/g, (_m, n: string) => {
      const v = vars[n];
      return v === undefined || v === null ? '' : String(v);
    });
  }
  return text;
}
```

**调用方**：
```ts
// before
cl('summary.headline', loc).replace('{food}', name).replace('{cal}', String(cal))
// after
cl('summary.headline', loc, { food: name, cal })
```

**响应体 enum**：
```ts
// food-analyze.controller.ts (新)
return {
  ...item,
  mealType: item.mealType,                                  // 内部字段保留
  mealTypeLabel: translateEnum('mealType', item.mealType),  // 用户可见
};
```

### 6.3 待办（已写入 checklist 由日常 PR 推进）

- coach-prompt-builder.service.ts 的 ~80 处 `loc === 'xx' ? ...` 三元逐步迁移到 `PromptBuilderService` 模板文件
- recommendation-quality.service.ts / recommendation-debug.service.ts 等 admin debug 接口的 enum 翻译（如确认面向用户）
- queue worker locale 透传约定的代码层落地

---

## ⑦ 自动化治理

### 7.1 ESLint 自定义规则（已落地，warn 级别）

`apps/api-server/eslint-plugin-i18n.mjs`：

| 规则 | 检测内容 | 例外 |
|---|---|---|
| `i18n/no-cjk-literal` | `.ts` 业务代码出现中日韩 CJK 字面量（含模板字符串内嵌） | `**/i18n/**` / `*.spec.ts` / `seeds/` / `langchain/` / `.json` / `.md` |
| `i18n/no-locale-ternary` | `xxx === 'en-US' ? ... : ...`（变量名含 `locale`/`lang`/`loc` 且右侧为 BCP-47 字面量） | 同上 |

**渐进策略**：先 `warn`（不阻断 CI），存量清零后改 `error`。

**冒烟测试**：已在 `decision-summary.service.ts` 上运行，规则正常加载且无 CJK / 三元告警（说明该文件已 100% 干净）。

### 7.2 启动期校验（已存在）

- `I18nService.onModuleInit` 报告：
  - `loaded N keys from M modules`
  - 跨 locale missing key 列表（dev 模式 warn）
  - key 跨模块冲突（error）
  - 生产模式 0 keys → fatal throw
- `PromptBuilderService.onModuleInit` 报告：`loaded N prompt templates`

### 7.3 CI 建议

```bash
# 已可立即接入（推荐加到 CI）
pnpm --filter api-server lint                       # i18n 规则 + prettier
pnpm --filter api-server tsc --noEmit               # 类型 + 编译
# 推荐补充
curl "$API/recommend?lang=ja-JP" | grep -E "[一-龥]" && exit 1   # 日语接口不应含中文
curl "$API/recommend?lang=en-US" | grep -E "[\\{}]" && exit 1   # 不应含未替换占位符
```

---

## ⑧ 长期架构

### 8.1 三层抽象（已建立）

```
┌──────────────────────────────────────────────────────┐
│ Business Code                                        │
│  - controller / service / usecase                    │
│  - 只 import LanguageContextService 或 cl()          │
└──────────────────────────────────────────────────────┘
                  │
        ┌─────────┴─────────────────────────┐
        ▼                                   ▼
┌──────────────────┐       ┌──────────────────────────┐
│ LanguageContext  │       │ Module-scoped helpers    │
│ Service (facade) │       │ - decision/i18n/cl       │
│ - .t(key, vars)  │       │ - coach/i18n/ci          │
│ - .enum(cat,val) │       │ - explainer/chainLabel   │
│ - .enumList      │       └──────────────────────────┘
│ - .format(tpl)   │                    │
└──────────────────┘                    │
        │                               │
        └───────────────┬───────────────┘
                        ▼
        ┌──────────────────────────────────┐
        │ I18nService (engine)             │
        │ - 启动扫描 modules/common JSON   │
        │ - dictionary[key][locale]        │
        │ - {{var}} 插值                   │
        │ - CLS locale fallback en-US      │
        └──────────────────────────────────┘
                        │
        ┌───────────────┴────────────────┐
        ▼                                ▼
┌────────────────────┐       ┌────────────────────┐
│ JSON 字典           │       │ PromptBuilder       │
│ <module>/i18n/      │       │ <module>/i18n/      │
│   {locale}.json     │       │   prompts/{locale}/ │
│ common/i18n/        │       │   *.md              │
└────────────────────┘       └────────────────────┘
```

### 8.2 扩展到 10+ 语言的路径

1. `core/i18n/i18n.types.ts` 的 `I18N_LOCALES` 增加新 locale
2. 每个 `i18n/*.json` 文件补 1 个新 locale 文件（CI 启动期会列出 missing key）
3. `i18n/prompts/<locale>/` 复制目录翻译 prompt
4. `enum-i18n` 字典补 `enum.*` 翻译
5. 不需要改任何 `.ts` 业务代码（这是关键收益）

### 8.3 风险与下一步

**剩余技术债**：
1. `coach-prompt-builder.service.ts` 的 ~80 处 `isEn ? ... : isJa ? ...` 三元仍存在 → 由 PromptBuilder + ESLint 规则约束新增、存量逐步迁移
2. queue / cron worker 的 locale 透传约定未在代码层强制 → checklist § 5 已声明，需要后续在 worker 基类中加 `RequestContextService.run` wrapper
3. ESLint 规则当前 `warn` → 存量清零后升 `error`

**强烈推荐的下一轮工作**：
1. 在 worker 基类（`BaseProcessor` 或 BullMQ wrapper）统一加 `RequestContextService.run({ locale: job.data.locale ?? 'en-US' }, () => handler())`
2. 写一个 e2e 冒烟脚本：用三种 locale 各请求核心接口，断言响应体不含 CJK 残留 / `{...}` / `{{...}}` / raw key
3. 建立 i18n 字典翻译协作流程：开 PR 时 `git diff modules/*/i18n/*.json` 自动 mention 翻译人员
4. coach-prompt-builder 全量迁移到 PromptBuilder 文件模板（独立 PR，谨慎评审）
5. `LanguageContextService` 在 controller / service 中替代直接 `I18nService` 注入，统一入口

---

## 验收

- [x] TypeScript 编译 0 错误
- [x] 14 个业务文件 `.replace('{x}', v)` 模式清零
- [x] 默认 locale 全部 `en-US`
- [x] 80+ enum 值有三语言字典 + helper + 出口接入
- [x] LanguageContext + PromptBuilder 基建落地
- [x] ESLint 规则可运行（warn 级别）
- [x] Checklist 文档完成
- [x] coach 模块 `.replace` 风格统一

**最终结论**：原始用户报告的 `"{food}({cal})当前不建议食用"` 等响应体 bug 已彻底修复（根因 `cl()` 不支持 vars + 调用方语法错配 + raw key 错配 三联击）；架构上为 10+ 语言扩展打下基建（字典 + PromptBuilder + facade + ESLint 治理）；剩余技术债（coach 三元 / worker locale 透传）已写入 checklist 由日常 PR 与下一轮专项工作推进。
