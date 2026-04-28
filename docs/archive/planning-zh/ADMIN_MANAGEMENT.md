# 后台管理功能扩展文档

> 基于推荐引擎 & 食物库优化路线图，补齐后台管理模块  
> 更新日期：2026-04-08

---

## 一、功能概览

### 1.1 新增管理模块

| 模块             | 说明                   | 管理能力                            |
| ---------------- | ---------------------- | ----------------------------------- |
| **食物库管理**   | 管理食物营养数据库     | CRUD + 批量导入 + 验证审核 + 统计   |
| **饮食记录管理** | 查看用户饮食记录       | 列表 + 详情 + 删除 + 统计           |
| **每日计划管理** | 查看推荐的每日饮食计划 | 列表 + 详情查看                     |
| **AI 对话管理**  | 查看 AI 教练对话记录   | 列表 + 对话详情 + 删除 + Token 统计 |
| **成就管理**     | 管理游戏化成就系统     | CRUD + 解锁人数统计                 |
| **挑战管理**     | 管理用户挑战活动       | CRUD + 启停 + 参与人数统计          |
| **推荐反馈管理** | 查看推荐引擎反馈数据   | 列表 + 接受率统计                   |
| **AI 决策日志**  | 查看 AI 饮食决策日志   | 列表 + 详情 + 统计                  |

### 1.2 菜单结构

```
├── 仪表盘
├── 用户管理（已有）
├── 食物库管理 ★
│   └── 食物列表
├── 内容管理 ★
│   ├── 饮食记录
│   ├── 每日计划
│   ├── AI 对话
│   ├── 推荐反馈
│   └── AI 决策日志
├── 游戏化管理 ★
│   ├── 成就管理
│   └── 挑战管理
├── 数据分析（已有）
├── 系统管理（已有）
```

---

## 二、后端 API 设计

### 2.1 食物库管理 (`/admin/food-library`)

| 方法   | 路径                                      | 说明                                                           |
| ------ | ----------------------------------------- | -------------------------------------------------------------- |
| GET    | `/admin/food-library`                     | 分页查询食物列表，支持 keyword/category/isVerified/source 筛选 |
| GET    | `/admin/food-library/statistics`          | 获取食物库统计（总数/已验证/未验证/按分类/按来源）             |
| GET    | `/admin/food-library/categories`          | 获取所有分类列表                                               |
| GET    | `/admin/food-library/:id`                 | 获取食物详情                                                   |
| POST   | `/admin/food-library`                     | 创建食物                                                       |
| POST   | `/admin/food-library/batch-import`        | 批量导入食物                                                   |
| PUT    | `/admin/food-library/:id`                 | 更新食物                                                       |
| POST   | `/admin/food-library/:id/toggle-verified` | 切换食物验证状态                                               |
| DELETE | `/admin/food-library/:id`                 | 删除食物                                                       |

**查询参数：**

```typescript
interface GetFoodLibraryQuery {
  page?: number; // 页码，默认 1
  pageSize?: number; // 每页条数，默认 20
  keyword?: string; // 搜索关键词（名称/别名模糊匹配）
  category?: string; // 分类筛选
  isVerified?: boolean; // 验证状态筛选
  source?: string; // 数据来源筛选（official/estimated/ai）
}
```

**创建/更新字段：**

```typescript
interface CreateFoodLibraryDto {
  name: string; // 名称（唯一）
  category: string; // 分类
  caloriesPer100g: number; // 热量
  proteinPer100g?: number; // 蛋白质
  fatPer100g?: number; // 脂肪
  carbsPer100g?: number; // 碳水
  fiberPer100g?: number; // 膳食纤维
  sugarPer100g?: number; // 糖
  sodiumPer100g?: number; // 钠
  glycemicIndex?: number; // GI 值
  isProcessed?: boolean; // 是否加工食品
  isFried?: boolean; // 是否油炸
  mealTypes?: string[]; // 适合餐次
  mainIngredient?: string; // 主要食材
  subCategory?: string; // 子分类
  qualityScore?: number; // 品质评分 1-10
  satietyScore?: number; // 饱腹感 1-10
  standardServingG?: number; // 标准份量
  standardServingDesc?: string;
  searchWeight?: number;
  isVerified?: boolean;
  tags?: string[];
  source?: string;
  confidence?: number;
  aliases?: string;
}
```

### 2.2 饮食记录管理 (`/admin/content/food-records`)

| 方法   | 路径                                     | 说明                                                 |
| ------ | ---------------------------------------- | ---------------------------------------------------- |
| GET    | `/admin/content/food-records`            | 分页查询，支持 userId/mealType/日期范围/keyword 筛选 |
| GET    | `/admin/content/food-records/statistics` | 统计（总数/今日/按餐次分布）                         |
| GET    | `/admin/content/food-records/:id`        | 查看详情                                             |
| DELETE | `/admin/content/food-records/:id`        | 删除记录                                             |

### 2.3 每日计划管理 (`/admin/content/daily-plans`)

| 方法 | 路径                             | 说明                                 |
| ---- | -------------------------------- | ------------------------------------ |
| GET  | `/admin/content/daily-plans`     | 分页查询，支持 userId/日期范围筛选   |
| GET  | `/admin/content/daily-plans/:id` | 查看计划详情（含四餐计划和调整历史） |

### 2.4 AI 对话管理 (`/admin/content/conversations`)

| 方法   | 路径                                      | 说明                               |
| ------ | ----------------------------------------- | ---------------------------------- |
| GET    | `/admin/content/conversations`            | 分页查询，支持 userId/keyword 筛选 |
| GET    | `/admin/content/conversations/statistics` | 统计（对话数/消息数/Token 消耗）   |
| GET    | `/admin/content/conversations/:id`        | 查看对话详情（含完整消息列表）     |
| DELETE | `/admin/content/conversations/:id`        | 删除对话（级联删除消息）           |

### 2.5 推荐反馈管理 (`/admin/content/recommendation-feedback`)

| 方法 | 路径                                                | 说明                                       |
| ---- | --------------------------------------------------- | ------------------------------------------ |
| GET  | `/admin/content/recommendation-feedback`            | 分页查询，支持 userId/action/mealType 筛选 |
| GET  | `/admin/content/recommendation-feedback/statistics` | 统计（总数/按操作分布/接受率）             |

### 2.6 AI 决策日志 (`/admin/content/ai-decision-logs`)

| 方法 | 路径                                         | 说明                                          |
| ---- | -------------------------------------------- | --------------------------------------------- |
| GET  | `/admin/content/ai-decision-logs`            | 分页查询，支持 userId/decision/riskLevel 筛选 |
| GET  | `/admin/content/ai-decision-logs/statistics` | 统计（总数/按决策分布/按风险分布）            |

### 2.7 成就管理 (`/admin/gamification/achievements`)

| 方法   | 路径                                   | 说明                                             |
| ------ | -------------------------------------- | ------------------------------------------------ |
| GET    | `/admin/gamification/achievements`     | 分页查询，支持 keyword/category 筛选，含解锁人数 |
| POST   | `/admin/gamification/achievements`     | 创建成就                                         |
| PUT    | `/admin/gamification/achievements/:id` | 更新成就                                         |
| DELETE | `/admin/gamification/achievements/:id` | 删除成就                                         |

**成就字段：**

```typescript
interface CreateAchievementDto {
  code: string; // 唯一编码
  name: string; // 名称
  description?: string; // 描述
  icon?: string; // 图标（Emoji）
  category?: string; // 分类：streak/record/diet/social
  threshold: number; // 门槛值
  rewardType?: string; // 奖励类型：points/badge/title
  rewardValue?: number; // 奖励值
}
```

### 2.8 挑战管理 (`/admin/gamification/challenges`)

| 方法   | 路径                                               | 说明                                         |
| ------ | -------------------------------------------------- | -------------------------------------------- |
| GET    | `/admin/gamification/challenges`                   | 分页查询，支持 keyword/type 筛选，含参与人数 |
| POST   | `/admin/gamification/challenges`                   | 创建挑战                                     |
| PUT    | `/admin/gamification/challenges/:id`               | 更新挑战                                     |
| POST   | `/admin/gamification/challenges/:id/toggle-active` | 切换启用/停用                                |
| DELETE | `/admin/gamification/challenges/:id`               | 删除挑战                                     |

---

## 三、前端页面说明

### 3.1 食物库管理页面

**路由**：`/food-library/list`

**功能特性**：

- 顶部统计卡片：食物总数、已验证、未验证、分类数
- ProTable 列表：名称、分类、热量、蛋白质、脂肪、碳水、品质分、饱腹感、验证状态、来源、搜索权重、标签
- 支持按关键词/分类/验证状态筛选
- 新增/编辑弹窗：完整的营养字段编辑表单（基础信息、营养数据、评分、标签等）
- 一键切换验证状态
- 删除食物

### 3.2 饮食记录管理页面

**路由**：`/content/food-records`

**功能特性**：

- 顶部统计：总记录数、今日记录、各餐次分布
- ProTable 列表：用户、餐次、食物列表、总热量、AI 决策、营养评分、来源、图片缩略图、记录时间
- 支持按 userId/餐次/日期范围筛选
- 图片预览
- 删除记录

### 3.3 每日计划管理页面

**路由**：`/content/daily-plans`

**功能特性**：

- ProTable 列表：用户、日期、总预算、策略、调整次数
- 支持按 userId/日期范围筛选
- 详情弹窗：分四餐展示（早/午/晚/加餐），每餐包含食物、热量、蛋白质、脂肪、碳水和建议

### 3.4 AI 对话管理页面

**路由**：`/content/conversations`

**功能特性**：

- 顶部统计：总对话数、总消息数、总 Token 消耗
- ProTable 列表：用户、标题、更新时间、创建时间
- 详情弹窗：聊天气泡样式展示完整对话（区分用户/AI，显示 Token 消耗）
- 删除对话

### 3.5 推荐反馈管理页面

**路由**：`/content/recommendation-feedback`

**功能特性**：

- 顶部统计：总反馈数、接受率、各操作分布
- ProTable 列表：用户、餐次、推荐食物、操作（接受/替换/跳过）、替换食物、推荐分数、目标类型

### 3.6 AI 决策日志页面

**路由**：`/content/ai-decision-logs`

**功能特性**：

- 顶部统计：总决策数、按决策类型分布
- ProTable 列表：用户、决策（SAFE/OK/LIMIT/AVOID）、风险等级（emoji 标签）、用户是否执行、用户反馈
- 详情弹窗：JSON 格式展示完整输入上下文和 AI 响应

### 3.7 成就管理页面

**路由**：`/gamification/achievements`

**功能特性**：

- ProTable 列表：图标、编码、名称、描述、分类、门槛值、奖励类型/值、解锁人数
- 新增/编辑弹窗：编码、名称、描述、图标、分类、门槛值、奖励设置

### 3.8 挑战管理页面

**路由**：`/gamification/challenges`

**功能特性**：

- ProTable 列表：标题、描述、类型、持续天数、状态（进行中/已停用）、参与人数
- 新增/编辑弹窗：标题、描述、类型、持续天数
- 一键切换启用/停用状态

---

## 四、文件结构

### 4.1 后端新增文件

```
apps/api-server/src/admin/
├── dto/
│   ├── food-library-management.dto.ts     # 食物库管理 DTO
│   └── content-management.dto.ts          # 内容管理 DTO（饮食记录/计划/对话/反馈/成就/挑战/AI日志）
├── services/
│   ├── food-library-management.service.ts # 食物库管理服务
│   └── content-management.service.ts      # 内容管理服务（统一处理）
├── controllers/
│   ├── food-library-management.controller.ts  # 食物库 API
│   ├── content-management.controller.ts       # 内容管理 API（记录/计划/对话/反馈/AI日志）
│   └── gamification-management.controller.ts  # 成就 & 挑战 API
└── admin.module.ts                        # ★ 已更新注册
```

### 4.2 前端新增文件

```
apps/admin/src/
├── services/
│   ├── foodLibraryService.ts              # 食物库 API 服务 + React Query Hooks
│   ├── contentManagementService.ts        # 内容管理 API 服务
│   ├── gamificationService.ts             # 成就/挑战 API 服务
│   └── path.ts                            # ★ 已更新路径
├── pages/
│   ├── food-library/
│   │   ├── index.tsx                      # 父级路由配置
│   │   └── list/index.tsx                 # 食物库列表（CRUD + 统计）
│   ├── content/
│   │   ├── index.tsx                      # 父级路由配置
│   │   ├── food-records/index.tsx         # 饮食记录管理
│   │   ├── daily-plans/index.tsx          # 每日计划管理
│   │   ├── conversations/index.tsx        # AI 对话管理
│   │   ├── recommendation-feedback/index.tsx  # 推荐反馈
│   │   └── ai-decision-logs/index.tsx     # AI 决策日志
│   └── gamification/
│       ├── index.tsx                      # 父级路由配置
│       ├── achievements/index.tsx         # 成就管理（CRUD）
│       └── challenges/index.tsx           # 挑战管理（CRUD + 启停）
```

---

## 五、管理流程

### 5.1 食物库管理流程

```
运营人员
  ├── 查看食物库统计（总数/已验证/未验证/分类分布/来源分布）
  ├── 浏览食物列表 → 按分类/关键词/验证状态筛选
  ├── 新增食物 → 填写营养数据 → 设置标签和评分 → 标记验证状态
  ├── 编辑食物 → 修改营养数据/评分/标签
  ├── 切换验证状态 → 通过审核的食物进入推荐池
  ├── 批量导入 → 上传食物数据批量创建
  └── 删除食物 → 从食物库移除
```

### 5.2 饮食记录管理流程

```
管理员
  ├── 查看全局饮食记录统计
  ├── 按用户/餐次/日期范围查询记录
  ├── 查看记录详情（食物列表 + AI 决策 + 营养评分）
  └── 删除违规记录
```

### 5.3 AI 对话管理流程

```
管理员
  ├── 查看对话统计（对话数/消息数/Token 消耗）
  ├── 按用户/关键词搜索对话
  ├── 查看完整对话内容（气泡列表）
  └── 删除对话（级联清理消息）
```

### 5.4 成就系统管理流程

```
运营人员
  ├── 查看成就列表（含解锁人数统计）
  ├── 创建成就 → 定义编码/名称/图标/分类/门槛/奖励
  ├── 编辑成就 → 调整门槛和奖励
  └── 删除成就
```

### 5.5 挑战活动管理流程

```
运营人员
  ├── 查看挑战列表（含参与人数）
  ├── 创建挑战 → 设置标题/类型/持续天数/规则
  ├── 编辑挑战 → 修改规则和描述
  ├── 切换状态 → 启用/停用挑战
  └── 删除挑战
```

### 5.6 数据分析流程

```
管理员/运营
  ├── 推荐反馈分析
  │   ├── 查看接受率趋势
  │   ├── 分析哪些食物被替换最多
  │   └── 按目标类型分析反馈差异
  └── AI 决策日志分析
      ├── 查看决策分布（SAFE/OK/LIMIT/AVOID）
      ├── 分析高风险决策比例
      └── 检查用户是否执行建议
```

---

## 六、权限控制

所有新增管理接口均使用现有的 RBAC 权限体系：

- **认证守卫**：`JwtAuthGuard` — 要求 Bearer Token
- **角色守卫**：`RolesGuard` — 限制 `admin` / `super_admin` 角色
- **装饰器**：`@Roles('admin', 'super_admin')`

---

## 七、技术栈

| 层级        | 技术                            |
| ----------- | ------------------------------- |
| 后端框架    | NestJS + TypeORM                |
| 数据库      | PostgreSQL                      |
| 认证        | JWT + Passport                  |
| 前端框架    | React + Vite                    |
| UI 组件     | Ant Design + ProTable           |
| 状态管理    | React Query (TanStack Query)    |
| HTTP 客户端 | Axios                           |
| 路由        | React Router v6（自动路由发现） |
