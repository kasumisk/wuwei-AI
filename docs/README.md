# EatCheck Documentation

> Last cleaned: ARB Review 2026-04
> 本目录已按"current truth / archive / decision records"三层组织。

## 📂 目录结构

```
docs/
├── README.md                              ← 你在这里
├── ARCHITECTURE_REVIEW_BOARD_2026-04.md   ← 当前架构评审决策（必读）
│
├── active/                                ← 仍在使用的活文档（按需新增）
├── adr/                                   ← Architecture Decision Records（结构化决策记录）
│
├── archive/                               ← 历史文档（不参与日常上下文）
│   ├── diet-decision-coach/               (V1 ~ V4.6, 41 份)
│   ├── intelligent-diet-system/           (V3 ~ V8.0)
│   ├── intelligent-food-enrichment/       (V1.3 ~ V2.1)
│   ├── daily-score-optimization/          (V1 ~ V1.7)
│   ├── recommendation-debug/              (R1 ~ R4 调试报告)
│   ├── deploy-legacy/                     (Vercel/Railway 旧部署文档)
│   └── planning-zh/                       (根目录中文规划/调试历史)
│
└── *.md                                   ← 顶层活文档
```

## 📌 顶层活文档清单

### 架构与决策
- **`ARCHITECTURE_REVIEW_BOARD_2026-04.md`** — ARB 架构评审报告（当前决策锚点）
- `ADMIN_SYSTEM_DESIGN_V8.md` — 后台系统当前设计
- `API_PROJECT_STRUCTURE.md` — api-server 模块结构

### 业务系统
- `FOOD_LOG_ARCHITECTURE_V8.md` / `FOOD_LOG_REFACTOR_V8.md` — 食物日志当前架构
- `FOOD_PIPELINE_GUIDE.md` — 食物补全 pipeline
- `GLOBAL_FOOD_DATABASE_DESIGN.md` — 全球食物库设计
- `CONFIDENCE_DRIVEN_FOOD_ANALYSIS_V1.md` — 置信度驱动的分析
- `USER_PROFILING_SYSTEM.md` — 用户画像系统
- `AI_DIET_MONETIZATION_PLAN.md` — 商业化方案
- `AI_DIET_DEBUG_REPORT_2026-04-18.md` — 当期 bug 调试

### 订阅 / 国际化 / API
- `SUBSCRIPTION_CONFIG_REFERENCE.md` / `SUBSCRIPTION_FEATURE_CONTROL.md`
- `i18n-audit-report.md` / `i18n-checklist.md`
- `api-explain-why-not.md`

### 重构资料
- `refactor/` — 重构相关辅助文档目录

## 🚫 文档治理原则（ARB 2026-04 起生效）

1. **不再发布带版本号的 SYSTEM 文档**（如 V5.0、V8.5）。版本演进进入 ADR。
2. **每次重大架构改动写一份 ADR** 到 `docs/adr/`，文件名 `ADR-YYYYMMDD-题目.md`。
3. **历史版本一律进 archive**，永远不删除（保留考古价值）。
4. **active 顶层只放"当前真相"**，旧版本立即归档。
5. **AI agent / 新成员上下文** 只读取顶层 + active + adr，不读 archive。

## 🗄️ 归档统计（2026-04）

- 归档总量：**140 份历史文档**
- diet-decision-coach: 41 份（V1.x ~ V4.6 全系列）
- intelligent-diet-system: 14 份（V3 ~ V8.0）
- intelligent-food-enrichment: 9 份（V1.3 ~ V2.1）
- daily-score-optimization: 8 份
- 中文规划/调试历史: ~50 份
- 其他归档: ~18 份
