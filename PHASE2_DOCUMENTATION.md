# 无畏健康 — 第二阶段功能文档

> **版本**: v2.0 | **日期**: 2026-04-06 | **状态**: 已部署

---

## 目录

- [项目概述](#项目概述)
- [系统架构](#系统架构)
- [部署信息](#部署信息)
- [数据库设计](#数据库设计)
- [API 接口文档](#api-接口文档)
  - [认证模块](#1-认证模块)
  - [饮食分析模块](#2-饮食分析模块)
  - [饮食记录模块](#3-饮食记录模块)
  - [汇总统计模块](#4-汇总统计模块)
  - [用户健康档案模块](#5-用户健康档案模块)
- [AI 分析引擎](#ai-分析引擎)
- [BMR 热量计算](#bmr-热量计算)
- [前端页面](#前端页面)
- [环境变量配置](#环境变量配置)
- [部署流程](#部署流程)

---

## 项目概述

无畏健康是一款 AI 驱动的饮食健康管理应用。用户通过拍照或上传外卖截图，由 GPT-4o Vision 自动识别食物并估算热量，帮助用户追踪每日饮食摄入，实现科学的健康管理。

### 核心功能

| 功能 | 说明 |
|------|------|
| 🔐 多方式登录 | 手机号、邮箱、微信、匿名登录 |
| 📸 AI 食物分析 | 拍照/上传图片 → GPT-4o Vision → 食物识别 + 热量估算 |
| 📝 饮食记录 | 保存/编辑/删除记录，按日期查询历史 |
| 📊 每日汇总 | 实时统计已摄入/目标/剩余热量 |
| 📈 趋势分析 | 近 7 天热量摄入趋势图 |
| 👤 健康档案 | 身体数据 + 活动等级 → 自动计算每日热量目标 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    用户端 (Next.js)                       │
│                 https://uway.dev-net.uk                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ 首页     │ │ 分析页   │ │ 档案页   │ │ 登录页     │  │
│  │ (实时数据)│ │ (AI识别) │ │ (健康数据)│ │ (多方式)   │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────┘  │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS REST API
                      ▼
┌─────────────────────────────────────────────────────────┐
│               后端服务 (NestJS)                           │
│            https://uway-api.dev-net.uk                    │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ AuthController  │  │ FoodController│  │ StorageModule│ │
│  │ (认证/注册)     │  │ (分析/记录)   │  │ (R2 上传)   │ │
│  └────────────────┘  └──────┬───────┘  └──────────────┘ │
│                             │                            │
│  ┌──────────────┐  ┌───────┴───────┐  ┌──────────────┐ │
│  │AnalyzeService│  │  FoodService  │  │ProfileService│ │
│  │ (GPT-4o API) │  │  (CRUD+汇总)  │  │ (BMR计算)    │ │
│  └──────┬───────┘  └───────┬───────┘  └──────────────┘ │
└─────────┼──────────────────┼────────────────────────────┘
          │                  │
          ▼                  ▼
   ┌──────────────┐  ┌──────────────┐
   │ OpenAI API   │  │ PostgreSQL   │
   │ (GPT-4o)     │  │ (TypeORM)    │
   └──────────────┘  └──────────────┘
```

### 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 + TypeScript + Tailwind CSS + Zustand |
| 后端 | NestJS 11 + TypeORM + PostgreSQL |
| AI | OpenAI GPT-4o Vision（多模态图像理解） |
| 存储 | Cloudflare R2（S3 兼容） |
| 部署 | 前端 Vercel / 后端 GCloud VM + PM2 + Nginx |

---

## 部署信息

| 环境 | URL | 平台 |
|------|-----|------|
| **前端** | https://uway.dev-net.uk | Vercel |
| **后端 API** | https://uway-api.dev-net.uk | GCloud VM (34.92.33.180) |
| **API 文档** | https://uway-api.dev-net.uk/api/docs | Swagger UI |
| **管理后台** | https://uway-admin.dev-net.uk | Vercel |

### 服务器信息

- **实例**: `openclaw`（GCloud asia-east2-a）
- **进程管理**: PM2 进程名 `wuwei-api`（端口 3006）
- **反向代理**: Nginx + Let's Encrypt HTTPS
- **数据库**: PostgreSQL（远程 Supabase / 本地实例）

---

## 数据库设计

### ER 关系图

```
app_users (1) ──── (N) food_records
    │
    ├──── (N) daily_summaries  (UNIQUE: user_id + date)
    │
    └──── (1) user_profiles    (UNIQUE: user_id)
```

### 表结构

#### food_records — 饮食记录

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK, 自动生成 | 主键 |
| user_id | UUID | FK → app_users, CASCADE | 用户 ID |
| image_url | VARCHAR(500) | 可空 | 食物图片 URL |
| source | ENUM | 默认 `screenshot` | `screenshot` / `camera` / `manual` |
| recognized_text | TEXT | 可空 | OCR 识别文本 |
| foods | JSONB | 默认 `[]` | 食物列表（见 FoodItem 结构） |
| total_calories | INT | 默认 0 | 总热量(kcal) |
| meal_type | ENUM | 默认 `lunch` | `breakfast`/`lunch`/`dinner`/`snack` |
| advice | TEXT | 可空 | AI 健康建议 |
| is_healthy | BOOLEAN | 可空 | 是否健康 |
| recorded_at | TIMESTAMP | 默认 NOW | 记录时间 |
| created_at | TIMESTAMP | 默认 NOW | 创建时间 |
| updated_at | TIMESTAMP | 默认 NOW | 更新时间 |

**索引**: `idx_food_records_user_recorded (user_id, recorded_at DESC)`

**FoodItem JSON 结构**:
```json
{
  "name": "宫保鸡丁",
  "calories": 320,
  "quantity": "1份",
  "category": "蛋白质"
}
```

#### daily_summaries — 每日汇总

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| user_id | UUID | FK → app_users, CASCADE | 用户 ID |
| date | DATE | UNIQUE(user_id, date) | 日期 |
| total_calories | INT | 默认 0 | 当日总热量 |
| calorie_goal | INT | 可空 | 热量目标 |
| meal_count | INT | 默认 0 | 餐数 |

#### user_profiles — 用户健康档案

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| user_id | UUID | UNIQUE FK → app_users | 用户 ID |
| gender | VARCHAR(10) | 可空 | `male` / `female` |
| birth_year | INT | 可空 | 出生年份 |
| height_cm | DECIMAL(5,1) | 可空 | 身高(cm) |
| weight_kg | DECIMAL(5,1) | 可空 | 体重(kg) |
| target_weight_kg | DECIMAL(5,1) | 可空 | 目标体重(kg) |
| activity_level | ENUM | 默认 `light` | `sedentary`/`light`/`moderate`/`active` |
| daily_calorie_goal | INT | 可空 | 自定义热量目标(kcal) |

### 数据库迁移

迁移文件: `1742000000000-AddFoodAndProfileTables.ts`

```bash
# 运行迁移
cd apps/api-server
npx typeorm migration:run -d dist/core/database/data-source.js

# 回滚迁移
npx typeorm migration:revert -d dist/core/database/data-source.js
```

---

## API 接口文档

所有接口遵循统一响应格式:

```json
{
  "success": true,
  "code": 200,
  "message": "操作成功",
  "data": { ... }
}
```

认证方式: `Authorization: Bearer <JWT_TOKEN>`

### 1. 认证模块

路由前缀: `/api/app/auth`

#### 1.1 发送手机验证码

```
POST /api/app/auth/phone/send-code
```

**请求体**:
```json
{
  "phone": "13800138000"
}
```

**响应**:
```json
{
  "success": true,
  "code": 200,
  "message": "验证码已发送",
  "data": null
}
```

> 开发环境万能验证码: `888888`

#### 1.2 验证码登录/注册

```
POST /api/app/auth/phone/verify
```

**请求体**:
```json
{
  "phone": "13800138000",
  "code": "888888"
}
```

**响应**:
```json
{
  "success": true,
  "code": 200,
  "message": "登录成功",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "bc95939d-55bf-42aa-912a-6859d4769318",
      "authType": "phone",
      "phone": "13800138000",
      "nickname": "用户8000",
      "status": "active"
    },
    "isNewUser": true
  }
}
```

#### 1.3 其他认证方式

| 端点 | 说明 |
|------|------|
| `POST /anonymous` | 匿名登录（`{ "deviceId": "xxx" }`） |
| `POST /email/register` | 邮箱注册 |
| `POST /email/login` | 邮箱密码登录 |
| `POST /email/code-login` | 邮箱验证码登录 |
| `POST /wechat/auth-url` | 获取微信授权 URL |
| `GET /wechat/callback` | 微信 OAuth 回调（自动重定向前端） |

---

### 2. 饮食分析模块

#### 2.1 AI 食物图片分析

```
POST /api/app/food/analyze
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

**请求参数**:

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | ✅ | 食物图片（jpg/png/webp/heic, ≤10MB） |
| mealType | string | ❌ | `breakfast`/`lunch`/`dinner`/`snack` |

**cURL 示例**:
```bash
curl -X POST https://uway-api.dev-net.uk/api/app/food/analyze \
  -H "Authorization: Bearer <token>" \
  -F "file=@food.jpg" \
  -F "mealType=lunch"
```

**响应**:
```json
{
  "success": true,
  "code": 200,
  "message": "分析完成",
  "data": {
    "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "foods": [
      {
        "name": "宫保鸡丁",
        "calories": 320,
        "quantity": "1份",
        "category": "蛋白质"
      },
      {
        "name": "米饭",
        "calories": 230,
        "quantity": "1碗",
        "category": "主食"
      }
    ],
    "totalCalories": 550,
    "mealType": "lunch",
    "advice": "这顿午餐蛋白质充足，建议增加蔬菜摄入。",
    "isHealthy": true,
    "imageUrl": "https://r2.example.com/food-images/xxx.jpg"
  }
}
```

**处理流程**:

```
用户上传图片
    │
    ▼
StorageService.upload() → Cloudflare R2
    │
    ▼
AnalyzeService.analyzeImage()
    │
    ├─ 构造 GPT-4o Vision 请求
    │  (system prompt + image_url)
    │
    ▼
OpenAI API (gpt-4o, temperature=0.3, max_tokens=1000)
    │
    ▼
解析 JSON 响应 → AnalysisResult
    │
    ▼
缓存结果 (requestId → result, 30分钟TTL)
    │
    ▼
返回给前端
```

---

### 3. 饮食记录模块

#### 3.1 保存饮食记录

```
POST /api/app/food/records
Authorization: Bearer <token>
```

**请求体**:
```json
{
  "requestId": "a1b2c3d4...",
  "imageUrl": "https://r2.example.com/food-images/xxx.jpg",
  "foods": [
    { "name": "宫保鸡丁", "calories": 320, "quantity": "1份", "category": "蛋白质" },
    { "name": "米饭", "calories": 230, "quantity": "1碗", "category": "主食" }
  ],
  "totalCalories": 550,
  "mealType": "lunch",
  "advice": "蛋白质充足，建议增加蔬菜",
  "isHealthy": true
}
```

**响应** (201):
```json
{
  "success": true,
  "code": 201,
  "message": "记录已保存",
  "data": {
    "id": "record-uuid",
    "userId": "user-uuid",
    "imageUrl": "...",
    "source": "screenshot",
    "foods": [...],
    "totalCalories": 550,
    "mealType": "lunch",
    "recordedAt": "2026-04-06T12:30:00.000Z",
    "createdAt": "2026-04-06T12:35:00.000Z"
  }
}
```

> 保存记录后自动异步更新 `daily_summaries` 表。

#### 3.2 获取今日记录

```
GET /api/app/food/records/today
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": [
    {
      "id": "...",
      "foods": [...],
      "totalCalories": 550,
      "mealType": "lunch",
      "isHealthy": true,
      "recordedAt": "2026-04-06T12:30:00.000Z"
    }
  ]
}
```

#### 3.3 分页查询历史记录

```
GET /api/app/food/records?page=1&limit=20&date=2026-04-05
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | int | 1 | 页码（≥1） |
| limit | int | 20 | 每页数量（1-100） |
| date | string | — | 可选，按日期过滤（YYYY-MM-DD） |

**响应**:
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 45,
    "page": 1,
    "limit": 20
  }
}
```

#### 3.4 修改记录

```
PUT /api/app/food/records/:id
Authorization: Bearer <token>
```

**请求体**（所有字段可选）:
```json
{
  "foods": [...],
  "totalCalories": 600,
  "mealType": "dinner"
}
```

#### 3.5 删除记录

```
DELETE /api/app/food/records/:id
Authorization: Bearer <token>
```

---

### 4. 汇总统计模块

#### 4.1 今日汇总

```
GET /api/app/food/summary/today
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": {
    "totalCalories": 860,
    "calorieGoal": 2100,
    "mealCount": 2,
    "remaining": 1240
  }
}
```

> 若用户未设置热量目标，后端会根据 `UserProfile` 的 BMR 公式自动计算，无档案则默认 2000 kcal。

#### 4.2 近期趋势

```
GET /api/app/food/summary/recent?days=7
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": [
    { "id": "...", "date": "2026-04-01", "totalCalories": 1850, "mealCount": 3 },
    { "id": "...", "date": "2026-04-02", "totalCalories": 2100, "mealCount": 4 },
    ...
  ]
}
```

---

### 5. 用户健康档案模块

#### 5.1 获取健康档案

```
GET /api/app/food/profile
Authorization: Bearer <token>
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "profile-uuid",
    "userId": "user-uuid",
    "gender": "male",
    "birthYear": 1995,
    "heightCm": 175.0,
    "weightKg": 72.5,
    "targetWeightKg": 68.0,
    "activityLevel": "moderate",
    "dailyCalorieGoal": 2100
  }
}
```

> 首次调用返回 `data: null`。

#### 5.2 保存/更新健康档案

```
PUT /api/app/food/profile
Authorization: Bearer <token>
```

**请求体**（所有字段可选）:
```json
{
  "gender": "male",
  "birthYear": 1995,
  "heightCm": 175.0,
  "weightKg": 72.5,
  "targetWeightKg": 68.0,
  "activityLevel": "moderate",
  "dailyCalorieGoal": 2100
}
```

**字段验证规则**:

| 字段 | 类型 | 范围 |
|------|------|------|
| gender | string | `male` 或 `female` |
| birthYear | int | 1940 ~ 2020 |
| heightCm | number | 50 ~ 250 |
| weightKg | number | 20 ~ 300 |
| targetWeightKg | number | 20 ~ 300 |
| activityLevel | string | `sedentary`/`light`/`moderate`/`active` |
| dailyCalorieGoal | int | 800 ~ 5000（留空自动计算） |

---

## AI 分析引擎

### 模型配置

| 参数 | 值 |
|------|---|
| 模型 | GPT-4o（可通过 `VISION_MODEL` 配置） |
| Temperature | 0.3（低温度保证稳定性） |
| Max Tokens | 1000 |
| 图片质量 | `detail: low`（节省 token） |
| 超时 | 30 秒 |

### 分析 Prompt

AI 系统角色: **专业营养师**

分析任务:
1. 识别图片中所有食物/饮品
2. 估算每个食物的热量 (kcal)
3. 按类别分类: `主食` / `蔬菜` / `蛋白质` / `汤类` / `水果` / `饮品` / `零食`
4. 判断整餐是否健康
5. 给出简短营养建议（中文）

### 输出格式

```json
{
  "foods": [
    { "name": "食物名", "calories": 300, "quantity": "1份", "category": "蛋白质" }
  ],
  "totalCalories": 550,
  "mealType": "lunch",
  "advice": "营养建议...",
  "isHealthy": true
}
```

### 缓存策略

- 分析结果缓存在服务内存 Map 中
- Key: `requestId` (UUID)
- TTL: 30 分钟
- 每次新分析时自动清理过期缓存

---

## BMR 热量计算

### Harris-Benedict 公式

**男性 BMR**:
$$BMR = 88.362 + 13.397 \times W + 4.799 \times H - 5.677 \times A$$

**女性 BMR**:
$$BMR = 447.593 + 9.247 \times W + 3.098 \times H - 4.33 \times A$$

其中: $W$ = 体重(kg), $H$ = 身高(cm), $A$ = 年龄(岁)

### 活动系数

| 等级 | 系数 | 描述 |
|------|------|------|
| `sedentary` | 1.2 | 久坐不动（办公室工作） |
| `light` | 1.375 | 轻度活动（偶尔散步） |
| `moderate` | 1.55 | 中度活动（每周运动 3-5 次） |
| `active` | 1.725 | 高强度（每天运动） |

### 最终目标计算

$$每日热量目标 = BMR \times 活动系数 \times 0.8$$

> 乘以 0.8 表示减脂模式（20% 热量缺口）。无健康档案时默认 2000 kcal。

### 计算示例

男性, 1995年出生(31岁), 175cm, 72.5kg, 中度活动:

$$BMR = 88.362 + 13.397 \times 72.5 + 4.799 \times 175 - 5.677 \times 31 = 1742.7$$

$$目标 = 1742.7 \times 1.55 \times 0.8 = 2161 \text{ kcal}$$

---

## 前端页面

### 页面路由

| 路径 | 页面 | 认证 | 说明 |
|------|------|------|------|
| `/` | 首页 | ❌ | 今日汇总 + 饮食记录列表 + 快捷入口 |
| `/login` | 登录 | ❌ | 手机号/邮箱/微信登录 |
| `/analyze` | AI 分析 | ✅ | 4步向导: 上传→分析→结果→保存 |
| `/profile` | 个人中心 | ✅ | 健康档案编辑 + 退出登录 |

### 首页 (`/`)

- 顶部: AI 健康教练推荐卡片
- CTA: "拍照或上传截图" → 跳转分析页
- Bento Grid: 剩余热量 / 已摄入 / 今日记录数
- 健康打卡: 今日记录进度
- 今日记录列表: 实时显示已录入的饮食
- 底部导航: 首页 / 分析 / AI教练 / 挑战 / 我的

> 首页数据通过 `useFood()` hook 实时调用 API，不再使用 mock 数据。

### 分析页 (`/analyze`)

4 步交互流程:

```
Step 1: upload       Step 2: analyzing     Step 3: result       Step 4: saved
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 选择餐类     │ ──→ │ AI 分析中    │ ──→ │ 查看识别结果 │ ──→ │ 保存成功     │
│ 上传图片     │     │ 动画加载     │     │ 可编辑/删除  │     │ 继续/返回    │
│ 图片预览     │     │             │     │ 确认保存     │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

- 支持格式: JPG / PNG / WebP / HEIC，最大 10MB
- 餐类选择: 早餐 / 午餐 / 晚餐 / 加餐
- AI 识别结果可编辑: 删除单项食物，自动重算总热量
- 保存后可选择"继续记录"或"返回首页"

### 个人中心 (`/profile`)

- 用户信息卡片: 头像 + 昵称 + 手机号/邮箱
- 健康档案表单:
  - 性别（男/女按钮切换）
  - 出生年份（数字输入）
  - 身高/体重（双列布局）
  - 目标体重
  - 活动等级（4 级单选列表）
  - 每日热量目标（可选，留空自动计算）
- 查看模式 / 编辑模式 切换
- 退出登录

### 前端技术细节

| 模块 | 文件 | 说明 |
|------|------|------|
| API 服务 | `lib/api/food.ts` | 封装所有 food API 请求 |
| 数据 Hook | `lib/hooks/use-food.ts` | React Hook 封装 + loading 状态 |
| 认证 Hook | `lib/hooks/use-auth.ts` | 登录/注册/token 管理 |
| API 客户端 | `lib/api/client-api.ts` | 统一 HTTP 客户端，自动带 token |
| 认证状态 | `store/auth.ts` | Zustand store，token 存 `app_auth_token` |

---

## 环境变量配置

### 后端 (`apps/api-server/.env`)

```bash
# 数据库
DB_HOST=xxx
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=xxx
DB_DATABASE=ai_platform
DB_SSL=true

# JWT
APP_JWT_SECRET=xxx
APP_JWT_EXPIRES_IN=30d

# OpenAI (AI 分析必需)
OPENAI_API_KEY=sk-proj-xxx
OPENAI_BASE_URL=https://api.openai.com/v1   # 可选
VISION_MODEL=gpt-4o                          # 可选，默认 gpt-4o

# 存储 (Cloudflare R2)
S3_ENDPOINT=xxx
S3_BUCKET=xxx
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
S3_PUBLIC_URL=xxx

# 微信
WECHAT_APP_ID=xxx
WECHAT_APP_SECRET=xxx
WECHAT_TOKEN=xxx
WECHAT_FRONTEND_URL=https://uway.dev-net.uk
```

### 前端 (Vercel 环境变量)

```bash
NEXT_PUBLIC_API_URL=https://uway-api.dev-net.uk
NEXT_PUBLIC_APP_URL=https://uway.dev-net.uk
NEXT_PUBLIC_APP_NAME=无畏健康
```

---

## 部署流程

### 后端部署 (GCloud VM)

```bash
# 1. SSH 到服务器
gcloud compute ssh openclaw --zone=asia-east2-a

# 2. 拉取代码
cd ~/wuwei-api && git pull origin main

# 3. 构建
cd apps/api-server && pnpm run build

# 4. 运行迁移（有新迁移时）
npx typeorm migration:run -d dist/core/database/data-source.js

# 5. 重启
pm2 restart wuwei-api

# 6. 查看日志
pm2 logs wuwei-api --lines 20
```

### 前端部署 (Vercel)

```bash
# 方式一: CLI 直接部署
cd apps/web
vercel --prod --yes --token=<VERCEL_TOKEN>

# 方式二: 推送到 main 分支自动触发
git push origin main
```

### 快速全量部署

```bash
# 1. 本地构建验证
cd apps/api-server && pnpm run build

# 2. 提交推送
git add -A && git commit -m "feat: ..." && git push origin main

# 3. 后端: SSH → pull → build → migrate → restart
gcloud compute ssh openclaw --zone=asia-east2-a -- '
  source ~/.nvm/nvm.sh
  cd ~/wuwei-api && git pull origin main
  cd apps/api-server && pnpm run build
  npx typeorm migration:run -d dist/core/database/data-source.js
  pm2 restart wuwei-api
'

# 4. 前端: Vercel 部署
cd apps/web && vercel --prod --yes
```

---

## 文件清单

### 后端新增文件

| 文件 | 说明 |
|------|------|
| `src/entities/food-record.entity.ts` | 饮食记录实体 + MealType/RecordSource 枚举 |
| `src/entities/daily-summary.entity.ts` | 每日汇总实体 |
| `src/entities/user-profile.entity.ts` | 用户健康档案实体 + ActivityLevel 枚举 |
| `src/migrations/1742000000000-*.ts` | 建表迁移（3 表 + 3 枚举） |
| `src/app/dto/food.dto.ts` | 所有 DTO 及验证规则 |
| `src/app/services/analyze.service.ts` | GPT-4o Vision AI 食物分析服务 |
| `src/app/services/food.service.ts` | 饮食记录 CRUD + 汇总计算 |
| `src/app/services/user-profile.service.ts` | 健康档案 + BMR 计算 |
| `src/app/controllers/food.controller.ts` | 饮食模块 REST 控制器 |

### 后端已修改文件

| 文件 | 改动 |
|------|------|
| `src/app/app-client.module.ts` | 注册新实体、服务、控制器、StorageModule |
| `src/core/database/database.module.ts` | forRoot 注册 3 个新实体 |

### 前端新增文件

| 文件 | 说明 |
|------|------|
| `src/lib/api/food.ts` | 饮食 API 服务 + 类型定义 |
| `src/lib/hooks/use-food.ts` | React Hook（分析/记录/档案） |
| `src/app/[locale]/analyze/page.tsx` | AI 分析页（4步向导） |
| `src/app/[locale]/profile/page.tsx` | 个人中心页（健康档案） |

### 前端已修改文件

| 文件 | 改动 |
|------|------|
| `src/pages-component/home/index.tsx` | 接入真实 API 数据、添加页面导航链接 |
| `src/lib/api/client-api.ts` | 修复 auth token key (`app_auth_token`) |

---

## 测试验证

### API 端点验证

```bash
# 1. 登录获取 Token
curl -X POST https://uway-api.dev-net.uk/api/app/auth/phone/send-code \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000"}'

curl -X POST https://uway-api.dev-net.uk/api/app/auth/phone/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800138000","code":"888888"}'
# → 获取 token

# 2. 测试今日汇总
curl https://uway-api.dev-net.uk/api/app/food/summary/today \
  -H "Authorization: Bearer <token>"

# 3. 测试健康档案
curl https://uway-api.dev-net.uk/api/app/food/profile \
  -H "Authorization: Bearer <token>"

# 4. 测试 AI 分析
curl -X POST https://uway-api.dev-net.uk/api/app/food/analyze \
  -H "Authorization: Bearer <token>" \
  -F "file=@food.jpg" \
  -F "mealType=lunch"
```

### 前端验证

1. 访问 https://uway.dev-net.uk/login
2. 输入手机号 13800138000 + 验证码 888888 登录
3. 首页应显示今日汇总数据（首次为 0）
4. 点击"拍照或上传截图"进入分析页
5. 上传食物图片，等待 AI 分析
6. 查看识别结果，确认保存
7. 返回首页验证记录已更新
8. 进入"我的"页面，填写健康档案
9. 保存后返回首页，确认热量目标已更新
