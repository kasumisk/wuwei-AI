# 无畏 AI 健康助手 - 产品开发规划文档

> 版本：v2.1 | 更新：2026-07-12
> 
> Phase 1 认证系统重构 ✅ 已完成

---

## 一、产品定位与 MVP 范围

### 核心价值主张

**让每个点外卖的人，轻松掌控自己的热量摄入，不需要手动记录任何东西。**

### MVP 必做功能（第一版严格收敛）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 外卖截图识别 | 核心卖点，用户价值的起点 |
| P0 | AI 热量分析 | 识别菜品 + 估算每道菜热量 |
| P0 | 自动饮食记录 | 零手动，识别即记录 |
| P0 | 手机号 / 微信登录 | 中国用户习惯，降低注册门槛 |
| P1 | AI 饮食建议 | 简单一句话评价，不要复杂报告 |
| P1 | 今日/历史记录 | 查看每天摄入趋势 |

### 暂不做（第一版忍住）

- 社交 / 打卡 / 分享
- 押金减肥挑战
- 精细营养素分析（脂肪/蛋白/碳水）
- 运动训练计划
- 第三方健身设备接入

### MVP 验证标准

> **成功 = 用户第二天还会打开 App**

---

## 二、整体技术架构

```
[ Flutter App / Next.js Web ]
            ↓
     NestJS API Server（已有骨架）
            ↓
  ┌─────────────────────────────┐
  │         Core Modules        │
  │  auth/  food/  record/  ai/ │
  └─────────────────────────────┘
            ↓
  ┌─────────────────────────────┐
  │       Infrastructure        │
  │  PostgreSQL  Redis  R2 OSS  │
  └─────────────────────────────┘
            ↓
       External APIs
  ┌──────────────────────────────┐
  │ GPT-4o Vision  DeepSeek      │
  │ 阿里云SMS      微信开放平台   │
  └──────────────────────────────┘
```

---

## 三、技术选型

### 后端（已有骨架，基于此扩展）

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | NestJS 11 | 已有，保持 |
| ORM | TypeORM | 已有，保持（已有 migrations 体系） |
| DB | PostgreSQL | 已有，本地 wuwei 库 |
| 缓存 | Redis | 验证码存储、热点数据缓存 |
| 文件存储 | Cloudflare R2 | 已配置，保持 |
| 认证 | JWT（自实现） | 替换 Firebase，见第四章 |

### AI 能力

| 能力 | 首选 | 备用 | 说明 |
|------|------|------|------|
| 图片识别 | GPT-4o Vision | 阿里云 OCR | 直接多模态，无需单独 OCR |
| 热量分析 | DeepSeek-V3 | Qwen-Max | 成本低，中文能力好 |
| 复杂图 | GPT-4o Vision | Gemini Pro Vision | 识别精度更高 |

> **策略**：直接用 GPT-4o Vision 一步识别图片（省去单独 OCR 步骤），精度更高、链路更短。

### 前端

| 端 | 技术 | 状态 |
|----|------|------|
| Web 管理后台 | React + Vite（apps/admin） | 已有 |
| Web 用户端 | Next.js（apps/web） | 已有骨架 |
| App | Flutter | 后续阶段 |

### 第三方服务

| 服务 | 提供商 | 用途 |
|------|--------|------|
| 短信验证码 | 阿里云 SMS / 腾讯云 SMS | 手机号登录 |
| 微信登录 | 微信开放平台 | 小程序 + App 登录 |
| Apple 登录 | Apple Sign In | iOS 强制要求 |
| 对象存储 | Cloudflare R2 | 已配置，图片存储 |

---

## 四、认证系统重构（核心变动：移除 Firebase）

### 4.1 为什么移除 Firebase

- Firebase Auth 在国内访问不稳定，依赖代理
- 中国用户几乎不用 Google 账号，Firebase 优势丧失
- 增加 SDK 体积和服务依赖，增加维护成本
- 自实现更灵活，完全掌控 token 生命周期

### 4.2 新认证方式

| 方式 | 场景 | 优先级 | 状态 |
|------|------|--------|------|
| 手机号 + 短信验证码 | 国内主流，无密码摩擦 | P0 | ✅ 已实现（万能验证码 888888） |
| 微信网页扫码登录 | Web 端微信扫码 | P0 | ✅ 已实现（测试号） |
| 微信小程序登录 | 小程序内一键登录 | P1 | 待接入 |
| Apple Sign In | iOS App 强制要求 | P1 | 待接入 |
| 匿名登录（已有） | 先体验后注册，降低门槛 | 保留 | ✅ 已有 |
| 邮箱密码（已有） | 国际用户 / 后台账号 | 保留 | ✅ 已有 |

> **开发阶段说明**：
> - 短信服务暂未接入真实 SMS 服务商，使用万能验证码 `888888` 进行开发测试
> - 微信登录使用测试号（appid: `wx615a34b78f5fb359`）实现网页扫码授权
> - Firebase 已完全移除，Google 登录接口暂时移除

### 4.3 app_users 表新增字段（Migration）

```sql
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wechat_open_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS wechat_union_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS apple_id VARCHAR(255);

-- 唯一索引
CREATE UNIQUE INDEX idx_app_users_phone
  ON app_users(phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX idx_app_users_wechat_open_id
  ON app_users(wechat_open_id) WHERE wechat_open_id IS NOT NULL;
CREATE UNIQUE INDEX idx_app_users_apple_id
  ON app_users(apple_id) WHERE apple_id IS NOT NULL;
```

### 4.4 AppUserAuthType 枚举扩展

```typescript
// entities/app-user.entity.ts
export enum AppUserAuthType {
  ANONYMOUS = 'anonymous',     // 已有，保留
  EMAIL = 'email',             // 已有，保留
  GOOGLE = 'google',           // 已有，国际版保留
  PHONE = 'phone',             // 新增
  WECHAT = 'wechat',           // 新增：微信 App/Web OAuth
  WECHAT_MINI = 'wechat_mini', // 新增：微信小程序
  APPLE = 'apple',             // 新增：Apple Sign In
}
```

### 4.5 服务文件变更规划

```
src/app/services/
  app-auth.service.ts      ← ✅ 已修改：移除 Firebase/Google，新增 phone/wechat 方法
  sms.service.ts           ← ✅ 已新增：万能验证码 888888（内存存储，TODO: Redis）
  wechat-auth.service.ts   ← ✅ 已新增：微信网页扫码登录（OAuth2 web 授权）
  apple-auth.service.ts    ← 待新增：Apple Sign In 验证
  app-update.service.ts    ← 不变
  firebase-admin.service.ts  ← ✅ 已移除引用（文件可删除）
```

### 4.6 认证接口设计（✅ 已实现部分标注）

```
# ===== 手机号登录（两步）✅ 已实现 =====
POST /api/app/auth/phone/send-code
Body: { phone: "13800138000" }
Response: { success: true, message: "验证码已发送" }
# 开发阶段：任意手机号 + 万能验证码 888888

POST /api/app/auth/phone/verify
Body: { phone: "13800138000", code: "888888", deviceId?: "xxx" }
Response: { token, user, isNewUser }

# ===== 微信网页扫码登录 ✅ 已实现 =====
POST /api/app/auth/wechat/auth-url
Body: { redirectUri: "https://...", state?: "..." }
Response: { url: "https://open.weixin.qq.com/connect/qrconnect?..." }

POST /api/app/auth/wechat/login
Body: { code: "auth_code" }
Response: { token, user, isNewUser }

GET  /api/app/auth/wechat/verify
Query: { signature, timestamp, nonce, echostr }
# 微信服务器 URL 验证回调（token: uway2026hello）

# ===== 微信小程序登录（待实现）=====
POST /api/app/auth/wechat/mini
Body: { code: "wx_login_code", encryptedData?: "...", iv?: "..." }
Response: { token, user, isNewUser }

# ===== Apple 登录（待实现）=====
POST /api/app/auth/apple
Body: { identityToken: "...", user?: { fullName, email } }
Response: { token, user, isNewUser }

# ===== 已有接口（保留）=====
POST /api/app/auth/anonymous
POST /api/app/auth/email/register
POST /api/app/auth/email/login
GET  /api/app/auth/profile          (Bearer token)
PUT  /api/app/auth/profile

# ===== 已移除接口 =====
# POST /api/app/auth/firebase        ← ✅ 已删除
# POST /api/app/auth/google          ← ✅ 已移除
```

### 4.7 手机号登录实现要点（✅ 已实现）

```typescript
// sms.service.ts 核心逻辑（当前：万能验证码模式）

// 万能验证码（开发阶段，不接入真实 SMS）
private readonly UNIVERSAL_CODE = '888888';

// 发送验证码（内存存储，TODO: 迁移到 Redis）
async sendCode(phone: string): Promise<void> {
  // 防刷：同一手机号 60 秒内不能重复发送
  const last = this.codeStore.get(`lock:${phone}`);
  if (last && Date.now() - last.timestamp < 60000)
    throw new TooManyRequestsException('发送太频繁，请 60 秒后再试');

  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // 验证码存内存，5 分钟 TTL
  this.codeStore.set(phone, { code, timestamp: Date.now() });
  this.codeStore.set(`lock:${phone}`, { code: '', timestamp: Date.now() });

  // TODO: 接入阿里云 SMS / 腾讯云 SMS 真实发送
  this.logger.log(`[DEV] 验证码: ${code}，万能验证码: ${this.UNIVERSAL_CODE}`);
}

// 验证验证码（万能码 888888 始终通过）
async verifyCode(phone: string, code: string): Promise<boolean> {
  if (code === this.UNIVERSAL_CODE) return true;

  const stored = this.codeStore.get(phone);
  if (!stored) return false;
  if (Date.now() - stored.timestamp > 5 * 60 * 1000) return false;
  if (stored.code !== code) return false;

  this.codeStore.delete(phone);
  return true;
}
```

> **生产环境 TODO**：
> 1. 将内存 Map 迁移到 Redis（支持多实例部署）
> 2. 接入阿里云/腾讯云 SMS 真实发送
> 3. 移除万能验证码或限制为特定测试号码

### 4.8 微信网页扫码登录实现要点（✅ 已实现）

```typescript
// wechat-auth.service.ts（当前：测试号模式）

// 测试号配置
// WECHAT_APPID=wx615a34b78f5fb359
// WECHAT_SECRET=9b324b9b2884934f2904c683ad4f50fe
// WECHAT_TOKEN=uway2026hello

// 1. 生成授权 URL（前端跳转此 URL 展示二维码）
getAuthUrl(redirectUri: string, state?: string): string {
  // 测试号使用 open.weixin.qq.com/connect/oauth2/authorize
  // 正式号使用 open.weixin.qq.com/connect/qrconnect
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_userinfo&state=${state}#wechat_redirect`;
}

// 2. code 换 token → 获取用户信息 → 创建/查找用户
async loginWithCode(code: string): Promise<WechatUserInfo> {
  // Step 1: code → access_token + openid
  const tokenRes = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`);

  // Step 2: access_token + openid → userinfo（头像、昵称）
  const userRes = await fetch(`https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`);

  return { openid, unionid, nickname, headimgurl };
}

// 3. 微信服务器 URL 验证（GET /wechat/verify）
verifySignature(signature: string, timestamp: string, nonce: string): boolean {
  // sha1(sort([token, timestamp, nonce])) === signature
}
```

> **微信回调地址配置**：`https://uway.dev-net.uk/api/auth/wechat/verify`

### 4.9 环境变量配置（✅ 已配置）

```bash
# ===== 当前已配置（.env）=====

# 微信网页登录（测试号）
WECHAT_APPID=wx615a34b78f5fb359
WECHAT_SECRET=9b324b9b2884934f2904c683ad4f50fe
WECHAT_TOKEN=uway2026hello

# ===== 待配置（生产环境）=====

# 微信小程序（待接入）
# WECHAT_MINI_APPID=wx...
# WECHAT_MINI_SECRET=...

# 短信服务（待接入，目前用万能验证码 888888）
# SMS_PROVIDER=aliyun
# SMS_ALIYUN_ACCESS_KEY_ID=...
# SMS_ALIYUN_ACCESS_KEY_SECRET=...
# SMS_ALIYUN_SIGN_NAME=无畏健康
# SMS_ALIYUN_VERIFY_TEMPLATE=SMS_xxxxxxxxx

# Apple Sign In（待接入）
# APPLE_CLIENT_ID=com.yourdomain.app
# APPLE_TEAM_ID=XXXXXXXXXX
# APPLE_KEY_ID=XXXXXXXXXX
# APPLE_PRIVATE_KEY_PATH=/path/to/AuthKey_xxx.p8

# AI 分析每日限制
AI_ANALYZE_DAILY_LIMIT=20
```

---

## 五、核心业务模块设计（新增）

### 5.1 当前 api-server src/ 目录现状

```
src/
  app/           ← App 用户认证 + 文件上传 + 版本更新（已有）
  admin/         ← 管理后台模块（已有）
  gateway/       ← AI 能力路由网关（已有）
  langchain/     ← LangChain AI 服务（已有）
  storage/       ← Cloudflare R2 文件存储（已有）
  entities/      ← TypeORM 实体（已有）
  migrations/    ← 数据库迁移（已有 12 个，含认证扩展）
  core/          ← 核心配置/过滤器/拦截器（已有）
  common/        ← 公共类型（已有）

  # 待新增业务模块
  food/          ← 饮食记录 CRUD（新增）
  analyze/       ← AI 图片分析（新增）
  user-profile/  ← 用户健康档案（新增）
```

### 5.2 analyze 模块（AI 分析核心）

**职责**：接收图片 → 调用 AI 分析 → 返回结构化数据，复用已有 `gateway` 路由能力

```typescript
// analyze.service.ts 核心流程

async analyzeImage(file: Express.Multer.File, userId: string): Promise<AnalysisResult> {
  // 1. 上传图片到 R2（通过已有 storage.service）
  const imageUrl = await this.storageService.upload(file);

  // 2. 调用 GPT-4o Vision（通过已有 gateway 能力路由）
  const result = await this.callVisionModel(imageUrl, userId);

  // 3. 解析 JSON 返回，写入 Redis 暂存（TTL 30min）
  const requestId = randomUUID();
  await this.redis.setex(`analyze:${requestId}`, 1800, JSON.stringify({ ...result, imageUrl }));

  return { requestId, ...result, imageUrl };
}
```

**Prompt 模板**：

```
你是专业营养师，用户上传了一张外卖或餐食图片。

请识别图中所有菜品，以 JSON 格式返回（不要输出任何其他文字）：
{
  "foods": [
    {
      "name": "宫保鸡丁",
      "calories": 520,
      "quantity": "1份约200g",
      "category": "蛋白质"
    }
  ],
  "totalCalories": 850,
  "mealType": "lunch",
  "advice": "蔬菜偏少，建议加一份绿叶菜",
  "isHealthy": true
}

规则：
- 无法识别的菜品根据外卖常见份量估算
- 热量估算保守一些（宁少不多）
- advice 必须具体且不超过 30 字
- 无法识别图片时，foods 返回空数组，并在 advice 中说明
```

### 5.3 food 模块（饮食记录）

**职责**：持久化饮食记录，提供查询和统计

**食物记录实体（新建 Migration）**：

```sql
CREATE TABLE food_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  image_url VARCHAR(500),
  source VARCHAR(20) NOT NULL DEFAULT 'screenshot',  -- screenshot|manual|camera
  recognized_text TEXT,
  foods JSONB NOT NULL DEFAULT '[]',
  total_calories INT NOT NULL DEFAULT 0,
  meal_type VARCHAR(20) DEFAULT 'lunch',             -- breakfast|lunch|dinner|snack
  advice TEXT,
  is_healthy BOOLEAN,
  recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  total_calories INT DEFAULT 0,
  calorie_goal INT,
  meal_count INT DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_food_records_user_recorded ON food_records(user_id, recorded_at DESC);
```

**FoodItem 数据结构（存在 JSONB 字段）**：

```typescript
interface FoodItem {
  name: string;       // 菜品名
  calories: number;   // 热量 kcal
  quantity?: string;  // 分量描述（"1份"/"200g"）
  category?: string;  // 分类（主食/蔬菜/蛋白质/汤类）
}
```

**接口**：

```
POST /api/app/food/analyze              → 上传图片分析（不存库，返回 requestId）
POST /api/app/food/records              → 确认保存（可带修正后 foods）
GET  /api/app/food/records/today        → 今日所有记录
GET  /api/app/food/records?page=1&date= → 分页历史记录
GET  /api/app/food/summary/today        → 今日汇总（已摄入/目标/剩余）
DELETE /api/app/food/records/:id        → 删除记录
PUT  /api/app/food/records/:id          → 修正记录内容
```

### 5.4 user-profile 模块

**职责**：用户健康档案 + 每日热量目标计算

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  gender VARCHAR(10),                  -- male | female
  birth_year INT,
  height_cm DECIMAL(5,1),
  weight_kg DECIMAL(5,1),
  target_weight_kg DECIMAL(5,1),
  activity_level VARCHAR(20) DEFAULT 'light',  -- sedentary|light|moderate|active
  daily_calorie_goal INT,              -- 可手动设置，否则按 BMR 自动计算
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**BMR 计算（Harris-Benedict 公式）**：

```typescript
// 每日基础代谢 × 活动系数
calculateDailyGoal(profile: UserProfile): number {
  const age = new Date().getFullYear() - profile.birthYear;
  const bmr = profile.gender === 'male'
    ? 88.362 + 13.397 * profile.weightKg + 4.799 * profile.heightCm - 5.677 * age
    : 447.593 + 9.247 * profile.weightKg + 3.098 * profile.heightCm - 4.330 * age;

  const activityMultiplier = {
    sedentary: 1.2,   // 久坐不动
    light: 1.375,     // 轻度活动
    moderate: 1.55,   // 中度活动
    active: 1.725,    // 高强度
  };

  // 减肥用：总热量 × 0.8（制造热量缺口 20%）
  return Math.round(bmr * activityMultiplier[profile.activityLevel] * 0.8);
}
```

---

## 六、开发排期（精细化版本，约 17 天）

### 第一阶段：认证系统重构（✅ 已完成）

**Day 1：数据库 Migration + 实体更新** ✅
- [x] 新建 Migration：app_users 添加 phone/wechat/apple 字段
- [x] 更新 `AppUserAuthType` 枚举（新增 phone/wechat/wechat_mini/apple）
- [x] 更新 `app-user.entity.ts` 字段映射（phone, wechatOpenId, wechatUnionId, appleId）
- [x] 运行迁移成功（Migration #12: AddPhoneWechatAppleAuth1741000000000）

**Day 2：短信验证码** ✅
- [x] 新建 `sms.service.ts`（万能验证码 888888 + 内存存储）
- [x] 防刷逻辑：60 秒发送间隔限制
- [x] 验证码 5 分钟 TTL
- [x] 新增接口：`POST /phone/send-code` + `POST /phone/verify`
- [ ] TODO: 接入真实 SMS 服务商（阿里云/腾讯云）
- [ ] TODO: 将内存存储迁移到 Redis

**Day 3：微信网页扫码登录** ✅
- [x] 新建 `wechat-auth.service.ts`（OAuth2 web 授权流程）
- [x] 通过测试号 (appid: wx615a34b78f5fb359) 实现
- [x] 新增接口：`POST /wechat/auth-url` + `POST /wechat/login`
- [x] 微信服务器 URL 验证：`GET /wechat/verify`（token: uway2026hello）
- [x] 回调地址：`https://uway-api.dev-net.uk/api/auth/wechat/verify`

**Day 4：清理 Firebase + 模块更新** ✅
- [x] 移除 `firebase-admin.service.ts` 所有引用
- [x] 移除 Firebase DTO 和 Google DTO 的 Controller 使用
- [x] 更新 `app-client.module.ts`（注册 SmsService + WechatAuthService）
- [x] 更新 `app-auth.service.ts`（新增 phoneLogin/wechatLogin 方法）
- [x] 环境变量配置完成（.env 中添加 WECHAT_APPID/SECRET/TOKEN）

**待做（后续迭代）**：
- [ ] Apple Sign In 接入
- [ ] 微信小程序登录
- [ ] Token 刷新机制（refresh token）
- [ ] 匿名账号升级绑定手机号

---

### 第二阶段：食物分析核心（7 天）

**Day 6：文件上传确认 + 压缩**
- [ ] 验证已有 `file.controller.ts` 支持图片上传
- [ ] 添加文件类型校验（jpg/png/webp/heic，最大 10MB）
- [ ] 大图压缩（复用已有 `compress/` 模块）

**Day 7–8：analyze 模块**
- [ ] 新建 `src/analyze/` 模块
- [ ] `analyze.service.ts`：调用 GPT-4o Vision（通过已有 gateway）
- [ ] Prompt 模板 + JSON 解析 + 容错
- [ ] Redis 暂存结果（key: `analyze:${requestId}`，TTL=30min）
- [ ] 兜底：Vision 失败 → 阿里云 OCR + DeepSeek 文字分析

**Day 9–10：food 模块**
- [ ] 新建 Migration：food_records + daily_summaries
- [ ] 新建 `food-record.entity.ts`
- [ ] 新建 `src/food/` 模块，实现完整 CRUD
- [ ] 保存记录后自动更新 daily_summaries（DB transaction）

**Day 11：user-profile 模块**
- [ ] 新建 Migration：user_profiles
- [ ] BMR 计算 + 每日热量目标接口

**Day 12：集成测试**
- [ ] 完整流程：登录 → 上传图片 → 分析 → 确认保存 → 查今日
- [ ] 异常场景：模糊图片 / 非食物 / AI 超时

---

### 第三阶段：前端对接 + 上线（5 天）

**Day 13–14：Next.js Web 核心页面**
- [ ] 登录页（手机号验证码 + 微信扫码）
- [ ] 主页：截图上传 → 分析结果展示
- [ ] 今日记录页：热量环形图 + 记录列表

**Day 15：Flutter App 基础认证**
- [ ] 手机号登录
- [ ] 微信登录（集成微信 SDK）
- [ ] Apple 登录（iOS）

**Day 16：部署配置**
- [ ] Railway 部署 api-server（已有 railway.toml）
- [ ] Vercel 部署 Next.js web（已有 vercel.json）
- [ ] 生产环境变量配置（微信/短信/Apple）

**Day 17：灰度测试**
- [ ] 内测用户 20 人体验
- [ ] 统计识别准确率反馈
- [ ] 修复关键 Bug

---

## 七、关键技术难点与解决方案

### 7.1 OCR / 图片识别不准

| 问题 | 解决方案 |
|------|---------|
| 图片模糊 | 前端上传前检测模糊度，提示用户重拍 |
| 菜名不标准 | GPT 语义理解 + 外卖常见菜品表述兜底 |
| 菜品被遮挡 | 让用户点击"纠错"，重新输入修正 |
| API 超时 | 设置 timeout=15s，超时返回空，提示重试 |

### 7.2 热量估算准确性

**MVP 策略**：用户要的是「趋势感知」而非「营养学精确值」。
- 在 UI 上标注「误差 ±20%」，降低预期
- 后期引入用户反馈，持续优化 Prompt

### 7.3 AI 成本控制

| 优化点 | 方案 |
|--------|------|
| 重复分析 | 图片 MD5 缓存，相同图片命中 Redis |
| 每日配额 | 每用户每天限 20 次（Redis 计数，零点重置） |
| 模型降级 | 文字截图 → DeepSeek，复杂图片 → GPT-4o |
| 网关限流 | 复用已有 gateway 的 maxRequestsPerMinute |

### 7.4 微信 unionId 策略

- unionId 仅在微信开放平台绑定多端（小程序+公众号+App）时才有
- MVP 阶段用 openId（小程序专属），记录在 wechat_open_id 字段
- 后期打通多端时，用 wechat_union_id 作为跨端唯一标识

### 7.5 Apple Sign In 用户信息只返回一次

- Apple 只在**首次登录**时返回 email 和 fullName
- 后端必须在首次登录时强制保存，后续仅凭 `sub`（apple_id）查找用户
- 实现关键：区分首次登录（`user` 字段存在）和后续登录

---

## 八、阶段目标与验收标准

| 阶段 | 目标 | 关键指标 |
|------|------|---------|
| Phase 1（当前）| 认证 + 饮食记录 MVP | 30 秒内完成「登录→拍照→看结果」全流程 |
| Phase 2 | 个性化 + 数据沉淀 | 7 天后能看热量趋势图 + 个性化建议 |
| Phase 3 | 社交 + 增长 | 打卡挑战、饮食日记分享卡片 |

### 最终 MVP 成功指标

| 指标 | 目标值 |
|------|--------|
| 识别准确率 | > 80% 用户认为「基本准确」 |
| 分析速度 | < 5 秒返回结果 |
| 次日留存 | > 30% |
| 人均日记录数 | ≥ 1.5 次/天 |

> **核心原则**：只有当用户每点一次外卖就会打开这个 App，产品才算成功。
