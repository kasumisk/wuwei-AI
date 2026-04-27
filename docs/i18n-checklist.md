# i18n Code Review Checklist

> 适用范围：`apps/api-server` NestJS 服务（排除 `**/langchain/**`）。
> 强制门禁：本 checklist 任一项不过 → PR 不可合并。
> 工具兜底：`pnpm --filter api-server lint` 会跑自定义规则 `i18n/no-cjk-literal` 与 `i18n/no-locale-ternary`。

---

## 1. 文案外置（任何用户可见字符串）

- [ ] 没有在 `.ts` 业务代码中写中文 / 日文 / 韩文等 CJK 字面量（注释除外）
- [ ] 没有在 `.ts` 中写整段英文用户提示（>3 个单词且面向用户的，必须走 i18n key）
- [ ] 新增文案落到 `modules/<module>/i18n/{en-US,zh-CN,ja-JP}.json`，三个文件 key 完全对齐
- [ ] 通用跨模块文案放在 `common/i18n/{en-US,zh-CN,ja-JP}.json`
- [ ] AI Prompt 模板 → `modules/<module>/i18n/prompts/<locale>/<name>.md`（不要塞进 .ts 三元）

## 2. 调用入口（必须是这些之一）

- [ ] `cl(key, locale?, vars?)` —— decision / coach 模块的命名空间 helper
- [ ] `I18nService.t(key, vars?)` —— 跨模块通用
- [ ] `LanguageContextService.t(...)` / `.enum(...)` / `.enumList(...)` —— 注入式 facade（推荐）
- [ ] `PromptBuilderService.render(module, name, vars?)` —— AI Prompt 渲染
- [ ] `translateEnum(category, value)` / `translateEnumList(category, values)` —— 枚举值

**禁止**：
- ❌ `loc === 'en-US' ? 'Hello' : 'Hi'` 三元
- ❌ `lang === 'zh' ? '...' : '...'`
- ❌ 直接读 `EXTENDED_I18N_TRANSLATIONS` 私有字典
- ❌ 拼接 `'foo: ' + enumValue` 到面向用户的 message

## 3. 模板与插值

- [ ] 占位符统一用 `{{var}}` 双花括号语法（与 I18nService / cl 兼容）
- [ ] 插值通过 `cl(key, locale, { var: value })` 第三参传入；不要再链式 `.replace('{{var}}', value)`
- [ ] 同一模板里有多个相同变量（如 `{{unit}}` 出现 2 次）时，确认插值器走全局替换（cl/I18nService 已处理）

## 4. Locale 解析与默认值

- [ ] 显式 locale 用 BCP-47 形式：`en-US` / `zh-CN` / `ja-JP`
- [ ] 默认 fallback locale = `en-US`（项目统一约定，与 `I18N_DEFAULT_LOCALE` 一致）
- [ ] 不要在新代码里默认 `'zh-CN'` 或 `'zh'`
- [ ] 非请求上下文（脚本 / cron / queue worker）显式传 locale，不依赖 CLS

## 5. 调用链 lang 传递

- [ ] HTTP 入口：`I18nMiddleware` 已自动写 CLS，不需要再传
- [ ] Service → Service：CLS 自动透传，无需显式
- [ ] **Queue / Cron / Background job**：必须把 locale 作为 job payload 字段显式传入，并在 worker 入口手动 `RequestContextService.run({ locale }, ...)` 重建上下文
- [ ] AI Prompt 调用前：如需 prompt locale 与响应 locale 不同，显式传 locale 给 `PromptBuilderService.render(...)`

## 6. 枚举值

- [ ] 任何 enum 值（`mealType`、`activityLevel`、`accuracyLevel`、`reviewLevel`、`analysisQualityBand`、`budgetStatus`、`gender`、`goal`、`allergens`、`dietaryRestrictions`、`healthConditions`、`impact`）拼到面向用户字符串前必须经 `translateEnum`
- [ ] DTO 响应体若包含展示用 enum，加配套 `*Label` 字段：`mealType: "snack", mealTypeLabel: translateEnum('mealType', 'snack')`
- [ ] 内部存储 / domain event / metrics label 保持原始 enum 值，不要翻译
- [ ] 新增 enum 值同步到 `common/i18n/{en-US,zh-CN,ja-JP}.json` 的 `enum.<category>.<value>`

## 7. AI Prompt（特别针对推荐 / 决策 / 教练特性）

- [ ] System prompt 至少包含 "Reply in {{language}}" 指令
- [ ] Few-shot 示例与 prompt 同 locale（不要英文 prompt + 中文示例）
- [ ] LLM 输出的 explanation / advice / reason 字段是面向用户的：必须按用户 locale 生成
- [ ] 若 LLM 返回原始 enum 值，由 `translateEnum` 在序列化时翻译，不要让 LLM 自己生成翻译
- [ ] Prompt 里引用的枚举（如食物分类）也走 `translateEnum`，避免 prompt 出现 "snack" 时模型用英文回答

## 8. JSON 文件管理

- [ ] 三个 locale 文件 key 完全一致（启动期 I18nService 会打印 missing key 告警）
- [ ] key 命名小驼峰、点分层级（如 `prompt.contextLabel.goal`）；不要在 key 中嵌中文
- [ ] 一个 key 不要在多个模块 i18n 中重复定义（启动期会报 conflict）
- [ ] PR 涉及新 key：截图或贴出三种语言的实际渲染效果

## 9. 测试

- [ ] 影响响应体的改动写一个 spec：用 `?lang=en-US` 与 `?lang=zh-CN` 各请求一次，断言响应体不出现 raw key（`xxx.yyy`）和未替换占位符（`{...}` / `{{...}}`）
- [ ] 新加 i18n key 在测试中至少覆盖一个 locale

## 10. 部署 / 构建

- [ ] `nest-cli.json` 的 `assets` 已包含：
  - `**/i18n/*.json`
  - `common/i18n/*.json`
  - `**/i18n/prompts/**/*.md`
  - `**/i18n/prompts/**/*.txt`
- [ ] 启动日志检查 `[i18n] loaded N keys` ≥ 预期；`[prompt] loaded N templates` ≥ 预期
- [ ] 生产环境若 `loaded 0 keys` 会 fatal（防 dist 缺资源）

## 11. 自动化门禁

- [ ] CI 跑 `pnpm --filter api-server lint`，i18n 规则警告 → 阻断（项目存量清零后将级别从 `warn` 升 `error`）
- [ ] CI 可选跑 `pnpm --filter api-server tsc --noEmit` 防 i18n key 类型错配
- [ ] 推荐增加冒烟脚本：用 `?lang=ja-JP` 调几个核心接口，grep 响应体不含中文字符

## 12. 新增语言（如韩语 ko-KR）

- [ ] 在 `core/i18n/i18n.types.ts` 的 `I18N_LOCALES` 加 `'ko-KR'`
- [ ] 在每个 `i18n/*.json` 增加对应文件
- [ ] 在 `i18n/prompts/<locale>/` 增加对应目录
- [ ] 在 `enum-i18n` 字典补 `enum.*` 翻译
- [ ] 跑 `pnpm tsc --noEmit` 确认类型不裂
- [ ] 部署前运行启动期 missing-key 报告

---

**评审建议**：PR 描述里贴一段 "i18n 自检"，对照本 checklist 逐项打 ✅ 或 N/A，避免 reviewer 反复来回。
