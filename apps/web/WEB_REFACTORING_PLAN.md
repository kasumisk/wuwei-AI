# Web 项目重构方案

> **版本**: v1.0 | **日期**: 2026-04-09  
> **范围**: `apps/web` 前端项目目录结构重构 + 用户档案收集流程优化  
> **参考**: `USER_PROFILING_SYSTEM.md` 用户画像系统设计  
> **技术栈**: Next.js 16 (App Router) + React 19 + Zustand 5 + TanStack Query 5 + Tailwind CSS 4 + shadcn/ui

---

## 目录

- [一、现状分析与问题](#一现状分析与问题)
- [二、目录结构重构](#二目录结构重构)
- [三、用户档案收集重构](#三用户档案收集重构)
- [四、API 层 & 状态管理重构](#四api-层--状态管理重构)
- [五、类型系统统一](#五类型系统统一)
- [六、实施计划与优先级](#六实施计划与优先级)
- [附录 A：文件迁移清单](#附录-a文件迁移清单)
- [附录 B：新增 API 端点清单](#附录-b新增-api-端点清单)

---

## 一、现状分析与问题

### 1.1 当前目录结构

```
src/
├── app/                          # Next.js App Router
│   ├── [locale]/                 # 国际化路由
│   │   ├── health-profile/page.tsx   # 776行 巨型单文件
│   │   ├── profile/page.tsx          # 120行
│   │   ├── analyze/page.tsx
│   │   ├── challenge/page.tsx
│   │   ├── chat/page.tsx
│   │   ├── coach/page.tsx
│   │   ├── foods/
│   │   ├── login/page.tsx
│   │   ├── gateway-test/page.tsx     # 开发测试页面
│   │   └── api-demo/                 # 开发测试页面
│   └── api/                      # API Routes (users CRUD demo)
├── components/
│   ├── ui/                       # shadcn/ui 组件 (15+)
│   ├── common/                   # 通用组件 (6个)
│   ├── features/                 # 仅含 demo 组件
│   ├── achievement-badge.tsx     # 散落在根目录
│   ├── decision-card.tsx
│   └── proactive-reminder.tsx
├── pages-component/              # 非标准命名
│   ├── home/index.tsx            # 500行 巨型单文件
│   ├── gateway/                  # 开发测试组件
│   └── legal/
├── lib/
│   ├── api/                      # API 客户端层
│   │   ├── food.ts               # 510行 巨型 API 文件
│   │   ├── http-client.ts
│   │   ├── client-api.ts
│   │   ├── server-api.ts
│   │   ├── app-auth.ts           # 已废弃
│   │   ├── user/auth.ts
│   │   ├── coach.ts
│   │   ├── food-library.ts
│   │   └── gateway-client.ts
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── use-auth.ts           # 250行
│   │   ├── use-food.ts           # 180行 包含所有食物操作
│   │   └── ...
│   ├── i18n/
│   ├── seo/
│   ├── ffmpeg/                   # 工具转换功能（非核心）
│   ├── image-converter/          # 工具转换功能（非核心）
│   ├── pdf/                      # 工具转换功能（非核心）
│   ├── constants/
│   ├── config/
│   ├── monitoring/
│   └── validations/
├── store/
│   └── auth.ts                   # 唯一 Store
├── providers/
│   ├── index.tsx
│   └── auth-provider.tsx
└── types/
    ├── api.ts
    └── next-pwa.d.ts
```

### 1.2 核心问题

| #       | 问题                                                                                         | 影响                               | 严重度 |
| ------- | -------------------------------------------------------------------------------------------- | ---------------------------------- | ------ |
| **P1**  | `health-profile/page.tsx` 776行单文件，所有表单逻辑、验证、UI 耦合                           | 难维护、难测试、违反 SRP           | 🔴 高  |
| **P2**  | `pages-component/home/index.tsx` 500行单文件，加载全部 API 数据                              | 首屏性能差、组件不可复用           | 🔴 高  |
| **P3**  | `food.ts` API 文件 510行，混合了档案/记录/推荐/成就等不同领域                                | 职责不清、难以扩展                 | 🔴 高  |
| **P4**  | 用户引导流为单页长表单（15+ 字段），无分步、无进度感知                                       | 用户放弃率高，未按画像系统设计执行 | 🔴 高  |
| **P5**  | `components/` 下 feature 组件散落在根目录，无按功能域组织                                    | 组件发现性差、归属不明             | 🟡 中  |
| **P6**  | `pages-component/` 命名非标准，与 `components/` 职责重叠                                     | 新人困惑、代码分散                 | 🟡 中  |
| **P7**  | `use-food.ts` hook 包含所有食物相关操作（分析/档案/推荐/成就）                               | 单一 hook 职责过重                 | 🟡 中  |
| **P8**  | 类型定义分散在 `food.ts` API 文件内部                                                        | 类型不可复用                       | 🟡 中  |
| **P9**  | `gateway-test/`、`api-demo/` 等开发测试页面在生产路由中                                      | 路由污染、安全隐患                 | 🟠 低  |
| **P10** | `ffmpeg/`、`image-converter/`、`pdf/` 等工具功能与核心业务无关                               | 关注点分散                         | 🟠 低  |
| **P11** | 后端已实现分步 onboarding API（Step 1-4），前端未对接                                        | 前后端设计已脱节                   | 🔴 高  |
| **P12** | 用户画像系统设计的 `allergens`、`healthConditions`、`exerciseProfile` 等 V2 字段在前端未收集 | 推荐质量受限                       | 🔴 高  |

---

## 二、目录结构重构

### 2.1 目标结构

```
src/
├── app/                              # Next.js App Router（仅路由 + 元数据）
│   ├── [locale]/
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # → 导入 HomeView
│   │   ├── login/page.tsx
│   │   ├── onboarding/              # 🆕 替换 health-profile
│   │   │   ├── page.tsx              # 分步引导入口
│   │   │   └── complete/page.tsx     # 引导完成页
│   │   ├── profile/page.tsx
│   │   ├── profile/edit/page.tsx     # 🆕 档案编辑
│   │   ├── analyze/page.tsx
│   │   ├── challenge/page.tsx
│   │   ├── chat/page.tsx
│   │   ├── coach/page.tsx
│   │   ├── foods/
│   │   │   ├── page.tsx
│   │   │   └── [name]/page.tsx
│   │   ├── terms/page.tsx
│   │   └── privacy/page.tsx
│   ├── api/                          # API Routes（保留必要的）
│   │   ├── chat/route.ts
│   │   └── compress/route.ts
│   └── layout.tsx
│   └── globals.css
│
├── features/                         # 🆕 按功能域组织（核心变更）
│   ├── onboarding/                   # 🆕 分步引导流
│   │   ├── components/
│   │   │   ├── onboarding-wizard.tsx         # 引导容器（步骤管理 + 进度条）
│   │   │   ├── step-basic.tsx                # Step 1: 性别 + 出生年
│   │   │   ├── step-body-goal.tsx            # Step 2: 身体 + 目标
│   │   │   ├── step-diet-habits.tsx          # Step 3: 饮食习惯 + 限制
│   │   │   ├── step-behavior.tsx             # Step 4: 行为 + 心理
│   │   │   ├── step-complete.tsx             # 完成页: BMR结果展示
│   │   │   └── shared/                       # 引导流共享子组件
│   │   │       ├── gender-selector.tsx
│   │   │       ├── year-picker.tsx
│   │   │       ├── slider-input.tsx
│   │   │       ├── goal-cards.tsx
│   │   │       ├── activity-level-picker.tsx
│   │   │       ├── tag-cloud.tsx             # 多选标签云
│   │   │       ├── allergen-selector.tsx      # 独立过敏原选择（安全性优先）
│   │   │       └── progress-indicator.tsx    # 4 步进度条
│   │   ├── hooks/
│   │   │   └── use-onboarding.ts             # 引导流状态管理 + API 调用
│   │   ├── lib/
│   │   │   ├── onboarding-schema.ts          # Zod 分步验证 Schema
│   │   │   └── onboarding-constants.ts       # 选项常量
│   │   └── types.ts
│   │
│   ├── profile/                      # 🆕 用户档案模块
│   │   ├── components/
│   │   │   ├── profile-view.tsx              # 档案展示（只读）
│   │   │   ├── profile-header.tsx            # 头像 + 基本信息
│   │   │   ├── health-summary-card.tsx       # 健康数据摘要卡片
│   │   │   ├── behavior-stats-card.tsx       # 行为数据统计卡片
│   │   │   ├── profile-edit-form.tsx         # 档案编辑表单
│   │   │   ├── completion-prompt.tsx         # 🆕 补全提示卡片
│   │   │   ├── goal-transition-card.tsx      # 🆕 目标迁移建议卡片
│   │   │   └── profile-menu.tsx              # 设置菜单列表
│   │   ├── hooks/
│   │   │   ├── use-profile.ts                # 档案 CRUD
│   │   │   └── use-profile-completion.ts     # 🆕 补全建议
│   │   └── types.ts
│   │
│   ├── home/                         # 🆕 重构自 pages-component/home
│   │   ├── components/
│   │   │   ├── home-view.tsx                 # 首页主视图容器
│   │   │   ├── today-status.tsx              # 今日状态（热量/营养）
│   │   │   ├── nutrition-progress.tsx        # 营养进度环
│   │   │   ├── quick-actions.tsx             # 快速操作按钮
│   │   │   ├── meal-suggestion-card.tsx      # 餐食建议卡片
│   │   │   ├── daily-plan-card.tsx           # 每日计划卡片
│   │   │   └── bottom-nav.tsx                # 底部导航栏
│   │   ├── hooks/
│   │   │   └── use-home-data.ts              # 首页数据聚合 hook
│   │   └── types.ts
│   │
│   ├── food-analysis/                # 食物分析
│   │   ├── components/
│   │   │   ├── analyze-view.tsx
│   │   │   ├── camera-capture.tsx
│   │   │   ├── analysis-result.tsx
│   │   │   └── food-record-form.tsx
│   │   ├── hooks/
│   │   │   └── use-food-analysis.ts
│   │   └── types.ts
│   │
│   ├── food-library/                 # 食物库
│   │   ├── components/
│   │   │   ├── food-list.tsx
│   │   │   ├── food-detail.tsx
│   │   │   └── food-search.tsx
│   │   ├── hooks/
│   │   │   └── use-food-library.ts
│   │   └── types.ts
│   │
│   ├── coach/                        # AI 教练
│   │   ├── components/
│   │   │   ├── coach-view.tsx
│   │   │   └── coach-style-picker.tsx
│   │   ├── hooks/
│   │   │   └── use-coach.ts
│   │   └── types.ts
│   │
│   ├── challenge/                    # 成就挑战
│   │   ├── components/
│   │   │   ├── challenge-view.tsx
│   │   │   ├── achievement-badge.tsx     # 从 components/ 移入
│   │   │   └── challenge-card.tsx
│   │   ├── hooks/
│   │   │   └── use-challenges.ts
│   │   └── types.ts
│   │
│   ├── chat/                         # 聊天
│   │   ├── components/
│   │   │   └── chat-view.tsx
│   │   └── hooks/
│   │       └── use-chat.ts
│   │
│   └── auth/                         # 认证
│       ├── components/
│       │   ├── login-view.tsx
│       │   └── auth-guard.tsx            # 🆕 统一认证守卫
│       ├── hooks/
│       │   └── use-auth.ts               # 从 lib/hooks 移入
│       ├── providers/
│       │   └── auth-provider.tsx          # 从 providers/ 移入
│       └── store/
│           └── auth-store.ts             # 从 store/ 移入
│
├── components/                       # 全局共享组件（与功能域无关）
│   ├── ui/                           # shadcn/ui 基础组件（不变）
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   └── ... (15+ 组件)
│   └── common/                       # 布局与通用组件
│       ├── site-header.tsx
│       ├── bottom-nav.tsx            # 🆕 抽取全局底部导航
│       ├── theme-toggle.tsx
│       ├── language-toggle.tsx
│       ├── localized-link.tsx
│       ├── error-boundary.tsx
│       ├── page-loading.tsx          # 🆕 页面加载骨架
│       └── toaster.tsx
│
├── lib/                              # 纯工具库（无 UI 依赖）
│   ├── api/                          # HTTP 客户端 + API 服务
│   │   ├── http-client.ts            # 基础 HTTP 类
│   │   ├── client-api.ts             # 客户端 API 实例
│   │   ├── server-api.ts             # 服务端 API 实例
│   │   ├── error-handler.ts
│   │   ├── auth.ts                   # 认证 API（合并 app-auth + user/auth）
│   │   ├── profile.ts               # 🆕 用户档案 API（从 food.ts 拆分）
│   │   ├── food-record.ts           # 🆕 食物记录 API（从 food.ts 拆分）
│   │   ├── recommendation.ts        # 🆕 推荐/计划 API（从 food.ts 拆分）
│   │   ├── food-library.ts          # 食物库 API
│   │   ├── coach.ts                 # 教练 API
│   │   ├── gamification.ts          # 🆕 成就/挑战 API（从 food.ts 拆分）
│   │   └── index.ts
│   ├── i18n/
│   │   ├── config.ts
│   │   └── request.ts
│   ├── hooks/                        # 仅保留通用 hooks
│   │   ├── use-toast.ts
│   │   ├── use-localized-router.ts
│   │   └── use-api.ts
│   ├── constants/
│   │   ├── config.ts
│   │   ├── query-keys.ts
│   │   └── index.ts
│   ├── seo/
│   ├── monitoring/
│   ├── validations/
│   ├── react-query/
│   ├── firebase.ts
│   ├── env.ts
│   └── utils.ts
│
├── providers/                        # 全局 Providers
│   └── index.tsx                     # 组合 QueryClient + Theme + Auth
│
└── types/                            # 全局类型
    ├── user.ts                       # 🆕 用户相关类型（统一）
    ├── food.ts                       # 🆕 食物相关类型（统一）
    ├── api.ts                        # 通用 API 类型
    └── next-pwa.d.ts
```

### 2.2 重构原则

| 原则              | 说明                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Feature-First** | 按功能域（feature）而非技术层（components/hooks/services）组织代码                               |
| **Colocation**    | 组件、Hook、类型就近放在同一 feature 目录下                                                      |
| **薄路由页面**    | `app/[locale]/xxx/page.tsx` 仅做布局 + 元数据，实际 UI 委托给 feature 组件                       |
| **API 拆分**      | `food.ts` 按领域拆分为 `profile.ts` / `food-record.ts` / `recommendation.ts` / `gamification.ts` |
| **渐进迁移**      | 支持新旧结构共存，按模块逐步迁移，不做一次性大改                                                 |

### 2.3 清理项

| 文件/目录                               | 处理                                     |
| --------------------------------------- | ---------------------------------------- |
| `pages-component/`                      | 全部迁移到 `features/` 后删除            |
| `components/features/users-demo.tsx`    | 删除（Demo 代码）                        |
| `components/features/users-example.tsx` | 删除（Demo 代码）                        |
| `app/[locale]/gateway-test/`            | 移到开发专用 route group `(dev)/` 或删除 |
| `app/[locale]/api-demo/`                | 移到开发专用 route group `(dev)/` 或删除 |
| `app/api/users/`                        | 删除（Demo CRUD）                        |
| `lib/api/app-auth.ts`                   | 删除（已废弃，功能在 `user/auth.ts`）    |
| `lib/api/gateway-client.ts`             | 保留但移入 `(dev)/` scope                |
| `lib/ffmpeg/`                           | 保留但考虑按需加载                       |
| `lib/image-converter/`                  | 同上                                     |
| `lib/pdf/`                              | 同上                                     |

---

## 三、用户档案收集重构

### 3.1 现状对比

| 维度       | 当前实现                       | 画像系统设计                                    | 差距                 |
| ---------- | ------------------------------ | ----------------------------------------------- | -------------------- |
| 引导步骤   | 单页长表单 15+ 字段            | 4 步分步引导                                    | 完全未实现           |
| 进度感知   | 无                             | 4 段进度条 + 即时价值反馈                       | 完全未实现           |
| 跳过机制   | 无（全部可选/空提交）          | Step 1-2 必填 + Step 3-4 可跳过 + 安全默认值    | 完全未实现           |
| 过敏原收集 | 混在 `dietaryRestrictions`     | 独立 `allergens` 字段 + 醒目 UI                 | 未实现               |
| 健康状况   | 无                             | `healthConditions` 糖尿病/高血压等              | 未实现               |
| 运动信息   | 仅 `activityLevel`             | `exerciseProfile` (类型/频率/时长)              | 部分缺失             |
| 口味偏好   | `foodPreferences` 简单多选     | `tasteIntensity` 各维度 0-5 级                  | 未实现               |
| 持续收集   | 无                             | 使用中触发 + 补全弹窗                           | 未实现               |
| 补全提示   | 无                             | `completion-suggestions` API                    | 后端已有，前端未对接 |
| BMR 展示   | 无即时反馈                     | Step 2 完成后展示计算结果                       | 未实现               |
| 前端 API   | `PUT /app/food/profile` 单接口 | 分步 `POST /user-profile/onboarding/step/:step` | 后端已有，前端未对接 |

### 3.2 分步引导流实现方案

#### 架构

```
┌────────────────────────────────────────────────────────────┐
│  /onboarding (page.tsx)                                    │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  OnboardingWizard                                     │  │
│  │                                                       │  │
│  │  ┌─ProgressIndicator ──────────────────────────┐     │  │
│  │  │  ● ━━━ ○ ━━━ ○ ━━━ ○                         │     │  │
│  │  │  Step1  Step2  Step3  Step4                   │     │  │
│  │  └───────────────────────────────────────────────┘     │  │
│  │                                                       │  │
│  │  ┌─ Current Step Content ────────────────────────┐    │  │
│  │  │                                                │    │  │
│  │  │   step=1 → <StepBasic />                       │    │  │
│  │  │   step=2 → <StepBodyGoal />                    │    │  │
│  │  │   step=3 → <StepDietHabits />                  │    │  │
│  │  │   step=4 → <StepBehavior />                    │    │  │
│  │  │                                                │    │  │
│  │  └────────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  ┌─ Action Buttons ──────────────────────────────┐    │  │
│  │  │  [← 上一步]     [跳过此步 ↓]     [下一步 →]    │    │  │
│  │  └───────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

#### Step 1: 快速启动（~3 秒，不可跳过）

```typescript
// features/onboarding/components/step-basic.tsx
interface StepBasicProps {
  data: { gender?: string; birthYear?: number };
  onChange: (data: Partial<StepBasicProps['data']>) => void;
}

// 字段
// - gender: 两选一大按钮（男/女），图标+文字
// - birthYear: 年份滚轮选择器（1940-2020）
//
// UI 要求:
// - 标题："让我们用 3 秒认识你"
// - 副标题："这两项信息帮助我们精准计算你的营养需求"
// - 无跳过按钮
// - 大按钮，单屏展示，无滚动
```

#### Step 2: 目标与身体（~15 秒，不可跳过）

```typescript
// features/onboarding/components/step-body-goal.tsx
interface StepBodyGoalProps {
  data: {
    heightCm?: number;
    weightKg?: number;
    goal?: GoalType;
    targetWeightKg?: number;
    activityLevel?: ActivityLevel;
  };
  onChange: (data: Partial<StepBodyGoalProps['data']>) => void;
}

// 字段
// - heightCm: 滑动条 (100-220cm)
// - weightKg: 滑动条 (30-200kg)
// - goal: 4选1 卡片（🔥减脂 / 💪增肌 / ❤️健康 / 🎯习惯）
// - targetWeightKg: 条件显示（仅 fat_loss/muscle_gain）
// - activityLevel: 4选1 图标（🪑久坐 / 🚶轻度 / 🏃中度 / 🏋️高强度）
//
// 提交后行为:
// - 调用后端计算 BMR/TDEE
// - 展示计算结果确认页（Step2Complete）
// - 用户可选择 [接受推荐] 或 [自定义热量]
```

#### Step 3: 饮食习惯（~20 秒，可跳过）

```typescript
// features/onboarding/components/step-diet-habits.tsx
interface StepDietHabitsProps {
  data: {
    mealsPerDay?: number;
    dietaryRestrictions?: string[];
    allergens?: string[]; // V2 独立字段
    foodPreferences?: string[];
    takeoutFrequency?: string;
  };
  onChange: (data: Partial<StepDietHabitsProps['data']>) => void;
}

// 关键设计:
// - allergens 必须独立区域 + ⚠️ 醒目标识（红/橙色标签）
// - 不可与 foodPreferences 混淆
// - 跳过时使用安全默认值: mealsPerDay=3, allergens=[], etc.
```

#### Step 4: 行为与心理（~15 秒，可跳过）

```typescript
// features/onboarding/components/step-behavior.tsx
interface StepBehaviorProps {
  data: {
    discipline?: Discipline;
    weakTimeSlots?: string[];
    bingeTriggers?: string[]; // 当前未收集，需新增
    canCook?: boolean;
  };
  onChange: (data: Partial<StepBehaviorProps['data']>) => void;
}

// discipline 措辞优化（不用"自律程度"）:
// - high: "饮食计划我都能严格执行 💪"
// - medium: "大部分时候能坚持 👍"
// - low: "我需要更灵活的方案 🤷"
//
// bingeTriggers 措辞: "什么情况下你容易多吃？"
// 选项: 压力大 / 无聊 / 社交聚餐 / 情绪波动
```

#### 引导流状态管理

```typescript
// features/onboarding/hooks/use-onboarding.ts

interface OnboardingState {
  currentStep: 1 | 2 | 3 | 4;
  stepData: {
    step1: StepBasicData;
    step2: StepBodyGoalData;
    step3: StepDietHabitsData;
    step4: StepBehaviorData;
  };
  computed: {
    bmr?: number;
    tdee?: number;
    recommendedCalories?: number;
  } | null;
  completeness: number;
  isSubmitting: boolean;
}

function useOnboarding() {
  // 状态
  const [state, setState] = useState<OnboardingState>(...);

  // 保存当步（调用分步 API）
  const saveStep = async (step: number, data: any) => {
    const result = await profileService.saveOnboardingStep(step, data);
    // result.computed → 更新 BMR/TDEE 显示
    // result.nextStep → 自动进入下一步
    // result.completeness → 更新进度
  };

  // 跳过当步
  const skipStep = async (step: number) => {
    const result = await profileService.skipOnboardingStep(step);
    setState(prev => ({ ...prev, currentStep: result.nextStep ?? 4 }));
  };

  // 上一步（纯前端，不调 API）
  const prevStep = () => {
    setState(prev => ({ ...prev, currentStep: Math.max(1, prev.currentStep - 1) }));
  };

  return { state, saveStep, skipStep, prevStep };
}
```

#### 验证 Schema（Zod）

```typescript
// features/onboarding/lib/onboarding-schema.ts
import { z } from 'zod';

export const step1Schema = z.object({
  gender: z.enum(['male', 'female', 'other']),
  birthYear: z.number().int().min(1940).max(2020),
});

export const step2Schema = z.object({
  heightCm: z.number().min(50).max(250),
  weightKg: z.number().min(20).max(300),
  goal: z.enum(['fat_loss', 'muscle_gain', 'health', 'habit']),
  targetWeightKg: z.number().min(30).max(200).optional(),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'active']),
});

export const step3Schema = z.object({
  mealsPerDay: z.number().int().min(1).max(6).optional(),
  dietaryRestrictions: z.array(z.string()).optional(),
  allergens: z.array(z.string()).optional(),
  foodPreferences: z.array(z.string()).optional(),
  takeoutFrequency: z.enum(['never', 'sometimes', 'often']).optional(),
});

export const step4Schema = z.object({
  discipline: z.enum(['high', 'medium', 'low']).optional(),
  weakTimeSlots: z.array(z.string()).optional(),
  bingeTriggers: z.array(z.string()).optional(),
  canCook: z.boolean().optional(),
});
```

### 3.3 持续收集机制（前端实现）

```typescript
// features/profile/hooks/use-profile-completion.ts

interface CompletionSuggestion {
  field: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimatedImpact: string;
}

function useProfileCompletion() {
  // 调用 GET /user-profile/completion-suggestions
  const { data } = useQuery({
    queryKey: ['profile', 'completion-suggestions'],
    queryFn: () => profileService.getCompletionSuggestions(),
    staleTime: 24 * 60 * 60 * 1000, // 24 小时
  });

  // 是否应该显示补全提示卡片
  const shouldShowPrompt = useMemo(() => {
    if (!data) return false;
    return data.currentCompleteness < 0.6 && data.suggestions.some((s) => s.priority === 'high');
  }, [data]);

  return {
    suggestions: data?.suggestions,
    shouldShowPrompt,
    completeness: data?.currentCompleteness,
  };
}
```

#### 首页补全提示集成

```typescript
// features/profile/components/completion-prompt.tsx
// 在首页 TodayStatus 下方展示补全卡片

// 触发条件:
// 1. onboardingCompleted=true（已完成引导）
// 2. dataCompleteness < 0.6
// 3. 距注册 ≥ 7 天
// 4. 今日未关闭过该提示
//
// UI: 轻量级卡片，文案："完善这些信息可以让推荐更准确 ~30%"
// 操作: [去完善] → 跳转 /profile/edit + 高亮待补全字段
//       [稍后] → 今日不再显示
```

### 3.4 路由迁移

| 旧路由                             | 新路由          | 说明             |
| ---------------------------------- | --------------- | ---------------- |
| `/health-profile?from=onboarding`  | `/onboarding`   | 分步引导入口     |
| `/health-profile`（非 onboarding） | `/profile/edit` | 已有用户编辑档案 |
| `/profile`                         | `/profile`      | 不变             |

```typescript
// 首页引导检查（更新逻辑）
useEffect(() => {
  if (!isLoggedIn) return;
  getProfile().then((p) => {
    if (!p || !p.onboardingCompleted) {
      // 检查 onboardingStep 决定从哪步继续
      const startStep = p?.onboardingStep ?? 1;
      router.replace(`/onboarding?step=${startStep}`);
    }
  });
}, [isLoggedIn]);
```

---

## 四、API 层 & 状态管理重构

### 4.1 API 服务拆分

当前 `food.ts`（510 行）拆分为 4 个独立 API 模块：

#### profile.ts（用户档案 API）

```typescript
// lib/api/profile.ts
export const profileService = {
  // --- 引导流 ---
  saveOnboardingStep(step: number, data: any): Promise<OnboardingStepResult>,
  skipOnboardingStep(step: number): Promise<{ nextStep: number | null; completeness: number }>,

  // --- 档案 CRUD ---
  getProfile(): Promise<UserProfile | null>,
  getFullProfile(): Promise<FullUserProfile>,       // 三层聚合
  updateDeclaredProfile(data: Partial<DeclaredProfile>): Promise<UserProfile>,

  // --- 旧接口兼容（渐进迁移期保留）---
  saveProfile(data: Partial<UserProfile>): Promise<UserProfile>,

  // --- 补全 & 推断 ---
  getCompletionSuggestions(): Promise<CompletionResult>,
  refreshInference(): Promise<UserInferredProfile>,
  getGoalTransition(): Promise<GoalTransitionSuggestion | null>,

  // --- 行为档案 ---
  getBehaviorProfile(): Promise<BehaviorProfile>,
};
```

#### food-record.ts（食物记录 API）

```typescript
// lib/api/food-record.ts
export const foodRecordService = {
  analyzeImage(file: File, mealType?: string): Promise<AnalysisResult>,
  saveRecord(data: SaveRecordData): Promise<FoodRecord>,
  getTodayRecords(): Promise<FoodRecord[]>,
  getRecords(params?: RecordParams): Promise<PaginatedRecords>,
  updateRecord(id: string, data: Partial<FoodRecord>): Promise<FoodRecord>,
  deleteRecord(id: string): Promise<void>,
  getTodaySummary(): Promise<DailySummary>,
  getRecentSummaries(days?: number): Promise<DailySummaryRecord[]>,
};
```

#### recommendation.ts（推荐/计划 API）

```typescript
// lib/api/recommendation.ts
export const recommendationService = {
  getMealSuggestion(): Promise<MealSuggestion>,
  getDailyPlan(): Promise<DailyPlanData>,
  adjustDailyPlan(reason: string): Promise<DailyPlanData>,
  proactiveCheck(): Promise<{ reminder: ProactiveReminder | null }>,
};
```

#### gamification.ts（成就/挑战 API）

```typescript
// lib/api/gamification.ts
export const gamificationService = {
  getAchievements(): Promise<Achievement[]>,
  getChallenges(): Promise<Challenge[]>,
  joinChallenge(id: string): Promise<void>,
  getStreak(): Promise<StreakInfo>,
};
```

### 4.2 Hook 拆分

将 `use-food.ts`（180 行，包含全部操作）拆分为功能域 Hook：

| 当前 Hook                       | 拆分后              | 位置                            |
| ------------------------------- | ------------------- | ------------------------------- |
| `useFood().getProfile()`        | `useProfile()`      | `features/profile/hooks/`       |
| `useFood().saveProfile()`       | `useProfile()`      | `features/profile/hooks/`       |
| `useFood().analyzeImage()`      | `useFoodAnalysis()` | `features/food-analysis/hooks/` |
| `useFood().getTodaySummary()`   | `useHomeData()`     | `features/home/hooks/`          |
| `useFood().getMealSuggestion()` | `useHomeData()`     | `features/home/hooks/`          |
| `useFood().getAchievements()`   | `useChallenges()`   | `features/challenge/hooks/`     |

### 4.3 React Query 集成优化

当前 Hook 层使用手动 `useState` + `useCallback` 管理服务端状态，应迁移至 React Query：

```typescript
// features/profile/hooks/use-profile.ts  — 示例

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';

export function useProfile() {
  const queryClient = useQueryClient();

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.getProfile(),
    staleTime: 5 * 60 * 1000, // 5 分钟
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<DeclaredProfile>) => profileService.updateDeclaredProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });

  return {
    profile: profileQuery.data,
    isLoading: profileQuery.isLoading,
    updateProfile: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
```

```typescript
// features/home/hooks/use-home-data.ts  — 示例

export function useHomeData() {
  // 并行请求
  const summaryQuery = useQuery({
    queryKey: ['summary', 'today'],
    queryFn: () => foodRecordService.getTodaySummary(),
    staleTime: 60 * 1000, // 1 分钟
  });

  const recordsQuery = useQuery({
    queryKey: ['records', 'today'],
    queryFn: () => foodRecordService.getTodayRecords(),
    staleTime: 60 * 1000,
  });

  const suggestionQuery = useQuery({
    queryKey: ['meal-suggestion'],
    queryFn: () => recommendationService.getMealSuggestion(),
    staleTime: 5 * 60 * 1000,
  });

  return {
    summary: summaryQuery.data,
    records: recordsQuery.data,
    suggestion: suggestionQuery.data,
    isLoading: summaryQuery.isLoading || recordsQuery.isLoading,
  };
}
```

### 4.4 Zustand Store 保持精简

Auth Store 保持不变（仅管理认证状态），功能域状态全部用 React Query 管理。不新增 Zustand Store。

---

## 五、类型系统统一

### 5.1 当前问题

类型定义分散在 `lib/api/food.ts` 内部，与 API 调用代码耦合。其他文件无法方便导入类型。

### 5.2 类型文件拆分

```typescript
// types/user.ts — 用户相关类型统一

export interface AppUserInfo {
  id: string;
  authType: AuthType;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  status: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  userId: string;
  // Layer 1: 声明数据
  gender?: string;
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;
  bodyFatPercent?: number;
  goal?: GoalType;
  goalSpeed?: GoalSpeed;
  activityLevel?: ActivityLevel;
  dailyCalorieGoal?: number;
  mealsPerDay?: number;
  takeoutFrequency?: TakeoutFrequency;
  canCook?: boolean;
  cookingSkillLevel?: CookingSkillLevel; // V2
  foodPreferences?: string[];
  dietaryRestrictions?: string[];
  allergens?: string[]; // V2
  healthConditions?: string[]; // V2
  exerciseProfile?: ExerciseProfile; // V2
  tasteIntensity?: Record<string, number>; // V2
  cuisinePreferences?: string[]; // V2
  budgetLevel?: BudgetLevel; // V2
  familySize?: number; // V2
  mealPrepWilling?: boolean; // V2
  regionCode?: string; // V2
  weakTimeSlots?: string[];
  bingeTriggers?: string[];
  discipline?: Discipline;
  // 元数据
  onboardingCompleted?: boolean;
  onboardingStep?: number; // V2
  dataCompleteness?: number; // V2
  profileVersion?: number; // V2
  createdAt: string;
  updatedAt: string;
}

export interface BehaviorProfile {
  mealTimingPatterns?: Record<string, string>; // V2
  portionTendency?: PortionTendency; // V2
  replacementPatterns?: Record<string, number>; // V2
  avgComplianceRate?: number;
  streakDays?: number;
  longestStreak?: number;
  totalRecords?: number;
  healthyRecords?: number;
}

export interface UserInferredProfile {
  // V2
  estimatedBMR?: number;
  estimatedTDEE?: number;
  recommendedCalories?: number;
  macroTargets?: MacroTargets;
  userSegment?: UserSegment;
  churnRisk?: number;
  nutritionGaps?: string[];
  goalProgress?: GoalProgress;
  confidenceScores?: Record<string, number>;
}

export interface FullUserProfile {
  declared: UserProfile;
  observed: BehaviorProfile;
  inferred: UserInferredProfile;
  meta: ProfileMeta;
}

// 枚举类型
export type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';
export type GoalSpeed = 'aggressive' | 'steady' | 'relaxed';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type Discipline = 'high' | 'medium' | 'low';
export type BudgetLevel = 'low' | 'medium' | 'high';
export type CookingSkillLevel = 'none' | 'basic' | 'intermediate' | 'advanced';
export type TakeoutFrequency = 'never' | 'sometimes' | 'often';
export type PortionTendency = 'under' | 'normal' | 'over';
export type UserSegment =
  | 'disciplined_loser'
  | 'casual_maintainer'
  | 'binge_risk'
  | 'muscle_builder';
```

```typescript
// types/food.ts — 食物相关类型统一

export interface FoodRecord { ... }
export interface DailySummary { ... }
export interface MealSuggestion { ... }
export interface DailyPlanData { ... }
export interface AnalysisResult { ... }
export interface Achievement { ... }
export interface Challenge { ... }
export interface ProactiveReminder { ... }
```

---

## 六、实施计划与优先级

### 6.1 分阶段实施

#### Phase 1: 基础重构（1-2 周） — 低风险

> 目标: 建立 `features/` 目录结构，迁移核心模块，不影响现有功能

| #   | 任务                                  | 详情                                                                        | 风险 |
| --- | ------------------------------------- | --------------------------------------------------------------------------- | ---- |
| 1.1 | 创建 `types/user.ts`、`types/food.ts` | 从 `food.ts` 中提取类型定义                                                 | 低   |
| 1.2 | 拆分 `lib/api/food.ts`                | → `profile.ts` + `food-record.ts` + `recommendation.ts` + `gamification.ts` | 低   |
| 1.3 | 创建 `features/home/`                 | 从 `pages-component/home/index.tsx`（500行）拆分为 5-6 个组件               | 中   |
| 1.4 | 创建 `features/auth/`                 | 迁移 `use-auth.ts`、`auth-provider.tsx`、`store/auth.ts`                    | 低   |
| 1.5 | 创建 `features/profile/`              | 迁移 `profile/page.tsx`，新增 `use-profile.ts` Hook（React Query）          | 低   |
| 1.6 | 清理 Demo 代码                        | 删除/移动 `gateway-test`、`api-demo`、`users-demo` 等                       | 低   |

**验收标准**: 所有现有页面功能不变，可正常构建 + 运行。

#### Phase 2: 引导流重构（1-2 周） — 核心价值

> 目标: 实现画像系统设计的 4 步分步引导流

| #   | 任务                        | 详情                                                     | 风险 |
| --- | --------------------------- | -------------------------------------------------------- | ---- |
| 2.1 | 创建 `features/onboarding/` | 完整目录结构 + 组件骨架                                  | 低   |
| 2.2 | 实现 `OnboardingWizard`     | 步骤管理 + 进度条 + 动画切换                             | 中   |
| 2.3 | 实现 Step 1-4 组件          | 按画像设计的字段和 UI 规格实现                           | 中   |
| 2.4 | 实现 `use-onboarding` Hook  | 对接后端分步 API (`/user-profile/onboarding/step/:step`) | 中   |
| 2.5 | 实现 Zod 分步验证           | Step 1-2 必填验证 + Step 3-4 可选验证                    | 低   |
| 2.6 | 实现 Step 2 完成确认页      | 展示 BMR/TDEE 计算结果 + 接受/自定义选项                 | 低   |
| 2.7 | 新增 `/onboarding` 路由     | 替换旧的 `/health-profile?from=onboarding` 入口          | 低   |
| 2.8 | 实现共享子组件              | `GenderSelector`、`TagCloud`、`AllergenSelector` 等      | 低   |
| 2.9 | 旧路由兼容重定向            | `/health-profile?from=onboarding` → `/onboarding`        | 低   |

**验收标准**: 新用户注册后进入 4 步引导流，Step 1-2 必填，Step 3-4 可跳过，完成后展示 BMR 并跳转首页。

#### Phase 3: 档案管理增强（1 周）

> 目标: 已有用户的档案编辑 + 补全提示

| #   | 任务                 | 详情                                             | 风险 |
| --- | -------------------- | ------------------------------------------------ | ---- |
| 3.1 | 实现 `/profile/edit` | 完整档案编辑（含 V2 新字段），分区域展示         | 中   |
| 3.2 | 实现补全提示组件     | 对接 `completion-suggestions` API，首页展示      | 低   |
| 3.3 | 实现目标迁移建议     | 对接 `goal-transition` API，档案页展示           | 低   |
| 3.4 | Profile 页面增强     | 展示三层数据（声明 + 行为 + 推断），推断数据只读 | 低   |

#### Phase 4: 剩余模块迁移（按需）

| #   | 任务                      | 说明                 |
| --- | ------------------------- | -------------------- |
| 4.1 | `features/food-analysis/` | 重构 analyze 页面    |
| 4.2 | `features/food-library/`  | 重构 foods 列表/详情 |
| 4.3 | `features/coach/`         | 重构教练页面         |
| 4.4 | `features/challenge/`     | 重构挑战/成就页面    |
| 4.5 | `features/chat/`          | 重构聊天页面         |

### 6.2 迁移策略

```
渐进式迁移，新旧共存，不做大爆炸重构
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 新建 features/ 目录，开始在此开发
2. 旧 pages-component/ 和 components/ 暂时保留
3. 新页面直接使用 features/ 中的组件
4. 旧页面逐步替换引用到 features/
5. 所有引用迁移完成后，删除旧目录

API 层同理:
1. 新建拆分后的 API 文件 (profile.ts, food-record.ts, ...)
2. 新代码直接使用新 API
3. 旧 food.ts 中添加 re-export 做兼容桥接
4. 旧引用逐步替换后，删除 food.ts 中的原始实现
```

### 6.3 兼容性保障

| 项目                       | 策略                                                                              |
| -------------------------- | --------------------------------------------------------------------------------- |
| 旧 `/health-profile` 路由  | `next.config.ts` 添加 redirect: `/health-profile?from=onboarding` → `/onboarding` |
| 旧 `PUT /app/food/profile` | 前端保留 `saveProfile()` 方法，内部按条件调用新/旧 API                            |
| 旧 `useFood()` Hook        | 保留但标记 `@deprecated`，内部委托到新的独立 Hook                                 |
| 类型导入                   | `food.ts` 中的类型改为从 `types/` re-export                                       |

---

## 附录 A：文件迁移清单

| 序号 | 源文件                                  | 目标位置                                                                          | 操作            |
| ---- | --------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| 1    | `pages-component/home/index.tsx`        | `features/home/components/` (拆分)                                                | 拆分为 6 个组件 |
| 2    | `app/[locale]/health-profile/page.tsx`  | `features/onboarding/components/` (重写)                                          | 按 4 步设计重写 |
| 3    | `app/[locale]/profile/page.tsx`         | `features/profile/components/profile-view.tsx`                                    | 迁移 + 增强     |
| 4    | `lib/hooks/use-auth.ts`                 | `features/auth/hooks/use-auth.ts`                                                 | 移动            |
| 5    | `lib/hooks/use-food.ts`                 | 拆分到各 feature hooks                                                            | 拆分 + 废弃     |
| 6    | `store/auth.ts`                         | `features/auth/store/auth-store.ts`                                               | 移动            |
| 7    | `providers/auth-provider.tsx`           | `features/auth/providers/auth-provider.tsx`                                       | 移动            |
| 8    | `lib/api/food.ts`                       | `lib/api/profile.ts` + `food-record.ts` + `recommendation.ts` + `gamification.ts` | 拆分            |
| 9    | `lib/api/app-auth.ts`                   | 删除                                                                              | 已废弃          |
| 10   | `components/achievement-badge.tsx`      | `features/challenge/components/`                                                  | 移动            |
| 11   | `components/decision-card.tsx`          | `features/food-analysis/components/`                                              | 移动            |
| 12   | `components/proactive-reminder.tsx`     | `features/home/components/`                                                       | 移动            |
| 13   | `components/features/users-demo.tsx`    | 删除                                                                              | Demo            |
| 14   | `components/features/users-example.tsx` | 删除                                                                              | Demo            |
| 15   | `app/api/users/`                        | 删除                                                                              | Demo API        |
| 16   | `pages-component/gateway/`              | `app/[locale]/(dev)/gateway-test/` 或删除                                         | 开发工具        |

## 附录 B：新增 API 端点清单

| 端点                                           | 方法  | 说明             | 后端状态  |
| ---------------------------------------------- | ----- | ---------------- | --------- |
| `/api/app/user-profile/onboarding/step/:step`  | POST  | 分步保存引导数据 | ✅ 已实现 |
| `/api/app/user-profile/onboarding/skip/:step`  | POST  | 跳过某步         | ✅ 已实现 |
| `/api/app/user-profile/full`                   | GET   | 获取三层聚合档案 | ✅ 已实现 |
| `/api/app/user-profile/declared`               | PATCH | 更新声明数据     | ✅ 已实现 |
| `/api/app/user-profile/completion-suggestions` | GET   | 获取补全建议     | ✅ 已实现 |
| `/api/app/user-profile/infer/refresh`          | POST  | 手动触发推断     | ✅ 已实现 |
| `/api/app/user-profile/goal-transition`        | GET   | 目标迁移建议     | ✅ 已实现 |
| `/api/app/user-profile/collection-triggers`    | GET   | 获取收集触发器   | ✅ 已实现 |

> 💡 **所有后端 API 已在 Phase 2 用户画像优化中实现**（见 repo memory `user-profiling-optimization.md`），前端仅需对接。
