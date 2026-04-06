# 无畏 AI 健康助手 - 产品开发规划文档

> 版本：v3.0 | 更新：2026-04-06
>
> Phase 1 认证系统重构 ✅ 已完成  
> Phase 2 食物分析 + 饮食记录 ✅ 已完成（线上通过端到端测试）

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
| Phase 1 ✅ | 认证 + 饮食记录 MVP | 30 秒内完成「登录→拍照→看结果」全流程 |
| Phase 2 ✅ | 个性化 + 数据沉淀 | 7 天后能看热量趋势图 + 个性化建议 |
| Phase 3 ✅ | AI 教练 | SSE 流式对话 + 上下文感知 + 每日问候 |

### 最终 MVP 成功指标

| 指标 | 目标值 |
|------|--------|
| 识别准确率 | > 80% 用户认为「基本准确」 |
| 分析速度 | < 5 秒返回结果 |
| 次日留存 | > 30% |
| 人均日记录数 | ≥ 1.5 次/天 |

> **核心原则**：只有当用户每点一次外卖就会打开这个 App，产品才算成功。

---

## 九、Phase 3 — AI 教练（核心新增功能）✅ 已完成

> ~~当前状态：底部导航"AI教练"入口已有，但点击还没有功能。~~
> 
> **已完成**: 2026-04-06 部署上线，所有 API + 前端页面已实现并测试通过。
> 
> 目标：**让 AI 教练感觉像一个了解你饮食习惯的私人营养顾问，而不是一个问答机器人。**

### 9.1 产品定义

AI 教练不是通用聊天机器人，它有三个专属能力：

| 能力 | 说明 | 示例 |
|------|------|------|
| **上下文感知** | 每次对话都掌握用户今日/近期饮食数据 | "你今天午饭吃了 550 卡，距离目标还差 1500 卡" |
| **主动打招呼** | 根据时间段给出不同开场建议 | 早上：建议早餐；深夜：提醒睡前不要吃高GI食物 |
| **图片分析联动** | 可在对话中直接分析上传图片 | 上传截图 → 立即给出热量 + 建议 |

### 9.2 后端设计

#### 新建数据库表

```sql
-- 对话会话（每个用户可有多个历史对话）
CREATE TABLE coach_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title VARCHAR(200),             -- 自动截取第一条消息作标题
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 消息记录
CREATE TABLE coach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES coach_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL,      -- user | assistant
  content TEXT NOT NULL,
  tokens_used INT DEFAULT 0,      -- 记录 token 消耗（成本控制）
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_coach_messages_conv ON coach_messages(conversation_id, created_at ASC);
```

#### 系统 Prompt 设计（核心）

```typescript
// coach.service.ts - buildSystemPrompt()

private async buildSystemPrompt(userId: string): Promise<string> {
  const [profile, todaySummary, recentSummaries] = await Promise.all([
    this.userProfileService.getProfile(userId),
    this.foodService.getTodaySummary(userId),
    this.foodService.getRecentSummaries(userId, 7),
  ]);

  const hour = new Date().getHours();
  const timeHint =
    hour < 10 ? '现在是早晨，用户可能还没吃早餐' :
    hour < 14 ? '现在是午餐时间' :
    hour < 18 ? '现在是下午' :
    hour < 21 ? '现在是晚餐时间' :
    '现在是夜间，提醒用户注意宵夜热量';

  const bmi = profile
    ? (profile.weightKg / (profile.heightCm / 100) ** 2).toFixed(1)
    : null;

  return `你是无畏健康的 AI 营养教练，风格亲切、专业、简洁。
用中文回复，每条消息不超过 150 字，不要使用 Markdown 格式。

【用户档案】
${profile ? `
- 性别：${profile.gender === 'male' ? '男' : '女'}
- 年龄：${new Date().getFullYear() - profile.birthYear} 岁
- BMI：${bmi}（身高 ${profile.heightCm}cm，体重 ${profile.weightKg}kg）
- 活动等级：${profile.activityLevel}
- 每日热量目标：${todaySummary.calorieGoal} kcal
` : '用户尚未填写健康档案，可引导他去填写以获得更精准建议。'}

【今日饮食】
- 已摄入：${todaySummary.totalCalories} kcal / 目标 ${todaySummary.calorieGoal} kcal
- 剩余：${todaySummary.remaining} kcal
- 今日记录餐数：${todaySummary.mealCount} 餐

【最近 7 天平均】
- 日均摄入：${Math.round(recentSummaries.reduce((s, d) => s + d.totalCalories, 0) / 7)} kcal
- 达标天数：${recentSummaries.filter(d => d.totalCalories <= (todaySummary.calorieGoal || 2000)).length} / 7 天

【时间信息】${timeHint}

根据以上信息，给出个性化、有温度的饮食建议。如果用户问某食物热量，直接给出估算值，不要说"建议咨询医生"。`;
}
```

#### API 接口

```
# 发送消息（SSE 流式响应）
POST /api/app/coach/chat
Authorization: Bearer <token>
Body: {
  "message": "我今天吃了什么？",
  "conversationId": "uuid（可选，不传则新建会话）"
}

# 获取历史对话列表
GET /api/app/coach/conversations
Authorization: Bearer <token>

# 获取某次对话的消息历史
GET /api/app/coach/conversations/:id/messages?page=1
Authorization: Bearer <token>

# 获取今日教练主动开场建议（每日首次进入时调用）
GET /api/app/coach/daily-greeting
Authorization: Bearer <token>
Response: {
  "greeting": "早上好！今天还没记录早餐，早餐很重要哦～",
  "suggestions": ["帮我分析早餐", "今天该吃点啥", "我的目标完成了吗"]
}

# 删除对话（及其消息）
DELETE /api/app/coach/conversations/:id
Authorization: Bearer <token>
```

#### 流式响应实现方案

```typescript
// coach.controller.ts - 使用 SSE 流

@Post('chat')
@UseGuards(AppJwtAuthGuard)
async chat(
  @CurrentAppUser() user: any,
  @Body() dto: CoachChatDto,
  @Res() res: Response,
): Promise<void> {
  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // 构建或加载对话上下文（最近 10 条历史）
  const { messages, conversationId } = await this.coachService.prepareContext(
    user.id, dto.conversationId, dto.message,
  );

  // 通过 OpenRouter (DeepSeek-V3，成本低且中文好) 流式输出
  const stream = await this.openRouterAdapter.generateTextStream({
    messages,
    model: 'deepseek/deepseek-chat-v3-0324',  // 中文对话首选
    temperature: 0.7,
    maxTokens: 400,
  });

  let fullText = '';
  for await (const chunk of stream) {
    if (chunk.delta) {
      fullText += chunk.delta;
      res.write(`data: ${JSON.stringify({ delta: chunk.delta, conversationId })}\n\n`);
    }
    if (chunk.done) {
      // 保存消息到数据库
      await this.coachService.saveMessage(conversationId, user.id, dto.message, fullText, chunk.usage?.totalTokens);
      res.write(`data: ${JSON.stringify({ done: true, conversationId })}\n\n`);
      res.end();
    }
  }
}
```

#### AI 模型选择

| 用途 | 模型 | 理由 |
|------|------|------|
| 日常对话 | `deepseek/deepseek-chat-v3-0324` | 亚太无限制，中文极强，成本超低（$0.27/M tokens） |
| 带图片问答 | `baidu/ernie-4.5-vl-28b-a3b` | 已验证视觉能力 + 亚太可用 |
| 降级备用 | `meta-llama/llama-4-maverick` | 亚太可用的备选 |

> 每次对话最多携带最近 **10 条**历史消息 + system prompt，控制 context 长度 ≤ 4000 tokens。

### 9.3 前端设计

#### 页面路由

`/apps/web/src/app/[locale]/coach/page.tsx`

> 注意：`apps/web/src/app/[locale]/chat/page.tsx` 已有通用聊天骨架，可重构复用其 SSE 对接逻辑（`ServerSSETransport`）。

#### 界面结构

```
┌─────────────────────────────────┐
│  AI 营养教练         [历史记录]  │  ← 顶部导航栏
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐   │
│  │ 🤖 早上好！              │   │  ← 每日开场卡片（GET /daily-greeting）
│  │ 你今天还没吃早餐，       │   │
│  │ 研究表明早餐可帮助...    │   │
│  └─────────────────────────┘   │
│                                 │
│  ────── 快捷操作 ──────────    │
│  [帮我分析早餐] [今天该吃啥]    │  ← Chip 快捷回复
│  [我的目标进度]  [✍️ 自定义]   │
│                                 │
│  ─────── 对话区 ──────────     │
│  👤 我今天能吃什么高蛋白午餐？  │
│  🤖 根据你的目标（2100卡），   │
│     今日午餐建议500-700卡，     │
│     可选择...（流式输出）       │
│                                 │
└─────────────────────────────────┤
│  ┌──────────────────────┐[📷][↑]│  ← 输入栏 + 上传图片 + 发送
│  │ 问我任何饮食问题...   │      │
│  └──────────────────────┘      │
└─────────────────────────────────┘
```

#### 关键交互逻辑

```typescript
// coach/page.tsx 核心 hook

const useCoach = () => {
  // 接收 SSE 流式输出
  const sendMessage = async (content: string) => {
    setMessages(prev => [...prev, { role: 'user', content }]);
    const assistantMsg = { role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, assistantMsg]);

    const res = await fetch('/api/app/coach/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, conversationId }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = JSON.parse(line.slice(6));
        if (data.delta) {
          // 更新最后一条消息（流式追加）
          setMessages(prev => {
            const last = { ...prev[prev.length - 1] };
            last.content += data.delta;
            return [...prev.slice(0, -1), last];
          });
        }
        if (data.done) {
          setConversationId(data.conversationId);
        }
      }
    }
  };
};
```

### 9.4 每日开场建议生成逻辑

```typescript
// coach.service.ts - getDailyGreeting()

async getDailyGreeting(userId: string): Promise<DailyGreeting> {
  const hour = new Date().getHours();
  const summary = await this.foodService.getTodaySummary(userId);

  // 根据时间 + 当日状态生成建议
  const contextMap = {
    morning_no_breakfast:  { hour: '<10', mealCount: 0 },
    lunch_time:            { hour: '10-14', mealCount: 1 },
    afternoon_over_goal:   { totalCalories: '>calorieGoal' },
    evening_under_goal:    { hour: '>17', remaining: '>500' },
  };

  // 调用 AI 生成开场白（非流式，短文本）
  const greeting = await this.openRouterAdapter.generateText({
    model: 'deepseek/deepseek-chat-v3-0324',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: '生成一条简短的开场白（30字内）和3个快捷问题' },
    ],
    maxTokens: 100,
  });

  // 固定快捷问题集（不依赖 AI，保证响应速度）
  const suggestions = this.getStaticSuggestions(hour, summary);

  return { greeting: greeting.text, suggestions };
}

private getStaticSuggestions(hour: number, summary: DailySummary): string[] {
  if (hour < 10) return ['帮我规划今日饮食', '早餐吃什么好', '今天的热量目标是多少'];
  if (hour < 14) return ['午餐怎么吃不超标', '帮我分析这顿午餐', '今天上午吃了多少'];
  if (hour < 20) return ['今天还能吃多少', '晚餐推荐', '查看今日记录'];
  return ['今天总结', '明天饮食建议', '宵夜热量低的选择'];
}
```

### 9.5 开发排期（AI 教练模块，约 5 天）

**Day 1：后端基础**
- [ ] 新建 Migration：`coach_conversations` + `coach_messages`
- [ ] 新建 `CoachEntity` × 2
- [ ] 新建 `src/app/coach/` 模块（Module + Service + Controller + DTO）
- [ ] `buildSystemPrompt()` 实现（注入用户档案 + 今日数据）

**Day 2：流式对话接口**
- [ ] `POST /api/app/coach/chat` SSE 流式端点
- [ ] 对话历史载入（携带最近 10 条）
- [ ] 消息持久化（对话结束后写库）
- [ ] `GET /api/app/coach/daily-greeting` 接口

**Day 3：前端页面**
- [ ] `/coach/page.tsx` 重构（基于 `/chat/page.tsx` 骨架）
- [ ] SSE 流式接收与逐字渲染
- [ ] 快捷 Chip 快回复组件
- [ ] 每日开场卡片（首次进入自动展示）

**Day 4：图片问询 + 历史记录**
- [ ] 对话框内上传图片 → 复用 `AnalyzeService`
- [ ] 左滑历史对话列表（`/coach/conversations`）
- [ ] 对话标题自动截取（第一条用户消息前 20 字）

**Day 5：polish + 每日限额**
- [ ] 每用户每日对话限额（`AI_COACH_DAILY_LIMIT=50` 次消息）
- [ ] 底部导航 "AI教练" 标签页接入 `/coach`
- [ ] 加载骨架屏 + 错误重试

---

## 十、热量查询 + 食物库（合并实施）

> **战略意义**：SEO 免费获客 + 降低记录门槛（用户不一定每次都能拍照）。两个功能共享同一张 `foods` 表，后端统一实施，计划本周内上线。

### 10.1 与现有代码的关系

| 维度 | 现状 | 新增 |
|------|------|------|
| 数据表 | `food_records`（已有，记录用户吃了什么）| 新增 `foods`（食物库，静态数据）|
| 后端模块 | `apps/api-server/src/app/` — `AppClientModule` | 扩展此模块 |
| 现有 food 路由 | `POST /api/app/food/analyze`（AI 分析）`GET /api/app/food/records`（记录）| 需要新增食物库路由 |
| `RecordSource` enum | `screenshot \| camera \| manual`（manual 已有）| 手动搜索记录直接用 `manual` |
| `FoodItem` 接口 | `{name, calories, quantity?, category?}` | 扩展 `foodLibraryId?` 字段 |
| 前端 web | `apps/web/src/app/[locale]/` — analyze, coach 等页面 | 新增 `/foods` 和 `/foods/[name]` |
| sitemap | `apps/web/src/app/sitemap.ts`（已有 publicRoutes 模式）| 扩展动态食物页 |

### 10.2 数据库设计

#### foods 表（新增，Migration #14）

```typescript
// 新建迁移: apps/api-server/src/migrations/1744000000000-AddFoodLibraryTable.ts

await queryRunner.query(`
  CREATE TABLE IF NOT EXISTS "foods" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL UNIQUE,
    "aliases" VARCHAR(300),                  -- 逗号分隔别名："宫爆鸡丁,宫保鸡"
    "category" VARCHAR(50) NOT NULL,         -- 主食|肉类|蔬菜|水果|豆制品|饮品|零食|汤类|调味料|外卖
    "calories_per_100g" INT NOT NULL,        -- 每100g热量 kcal
    "protein_per_100g" DECIMAL(5,1),         -- 蛋白质 g（可选，下期完善）
    "fat_per_100g" DECIMAL(5,1),             -- 脂肪 g
    "carbs_per_100g" DECIMAL(5,1),           -- 碳水 g
    "standard_serving_g" INT DEFAULT 100,    -- 标准份量克数
    "standard_serving_desc" VARCHAR(50),     -- "1份约200g"
    "search_weight" INT DEFAULT 100,         -- 搜索排序权重
    "is_verified" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// 模糊搜索索引（中文 simple 分词器）
await queryRunner.query(`
  CREATE INDEX idx_foods_name_trgm ON foods USING gin(name gin_trgm_ops);
  CREATE INDEX idx_foods_category ON foods(category);
  CREATE INDEX idx_foods_weight ON foods(search_weight DESC);
`);

// 开启 pg_trgm 扩展（已有的话幂等）
await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
```

> **注意**：优先用 `pg_trgm` 模糊匹配（中文单字匹配效果更好），配合 LIKE `%关键词%`。PostgreSQL 全文检索 `to_tsvector` 对中文无分词效果，不采用。

#### FoodItem 接口扩展（food-record.entity.ts，无需迁移）

```typescript
// apps/api-server/src/entities/food-record.entity.ts
export interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  foodLibraryId?: string; // 新增：关联食物库 ID（手动记录时填充）
}
```

### 10.3 后端实现（NestJS）

#### 文件结构（新增 + 修改）

```
apps/api-server/src/
├── entities/
│   └── food-library.entity.ts          ← 新建 TypeORM 实体
├── app/
│   ├── controllers/
│   │   ├── food.controller.ts           ← 修改：新增 from-library 端点
│   │   └── food-library.controller.ts   ← 新建：公开查询接口（不需要 JWT）
│   ├── services/
│   │   └── food-library.service.ts      ← 新建：搜索 + 分类逻辑
│   ├── dto/
│   │   └── food.dto.ts                  ← 修改：新增 from-library 相关 DTO
│   └── app-client.module.ts             ← 修改：注册新实体 + 服务 + 控制器
├── migrations/
│   └── 1744000000000-AddFoodLibraryTable.ts  ← 新建
└── scripts/
    └── seed-foods.ts                    ← 新建：种子数据脚本
```

#### FoodLibrary 实体

```typescript
// apps/api-server/src/entities/food-library.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity('foods')
@Index(['searchWeight'])
export class FoodLibrary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 300, nullable: true })
  aliases?: string;

  @Column({ type: 'varchar', length: 50 })
  category: string;

  @Column({ type: 'int', name: 'calories_per_100g' })
  caloriesPer100g: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'protein_per_100g' })
  proteinPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'fat_per_100g' })
  fatPer100g?: number;

  @Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'carbs_per_100g' })
  carbsPer100g?: number;

  @Column({ type: 'int', default: 100, name: 'standard_serving_g' })
  standardServingG: number;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'standard_serving_desc' })
  standardServingDesc?: string;

  @Column({ type: 'int', default: 100, name: 'search_weight' })
  searchWeight: number;

  @Column({ type: 'boolean', default: true, name: 'is_verified' })
  isVerified: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

#### 公开路由（FoodLibraryController — 无 JWT 守卫）

```typescript
// apps/api-server/src/app/controllers/food-library.controller.ts
@ApiTags('食物库（公开）')
@Controller('foods')                       // ← /api/foods/...（无鉴权）
export class FoodLibraryController {
  // GET /api/foods/search?q=宫保鸡丁&limit=10
  async search(@Query('q') q: string, @Query('limit') limit = 10) {}

  // GET /api/foods/popular?category=主食&limit=20
  async popular(@Query('category') category: string, @Query('limit') limit = 20) {}

  // GET /api/foods/categories
  async categories() {}

  // GET /api/foods/:name  ← SEO 落地页数据接口
  async findByName(@Param('name') name: string) {}
}
```

#### 受保护路由（在现有 FoodController 新增一个端点）

```typescript
// apps/api-server/src/app/controllers/food.controller.ts （在现有类末尾添加）

// POST /api/app/food/records/from-library
@Post('records/from-library')
@HttpCode(HttpStatus.CREATED)
@ApiOperation({ summary: '从食物库搜索记录（手动记录入口）' })
async addFromLibrary(
  @CurrentAppUser() user: any,
  @Body() dto: AddFromLibraryDto,
): Promise<ApiResponse> {
  const record = await this.foodLibraryService.addFromLibrary(user.id, dto);
  return { success: true, code: 201, message: '记录已保存', data: record };
}
```

> **设计决策**：不新增独立端点，`from-library` 内部仍调用现有 `FoodService.saveRecord()`，只是自动计算热量并设置 `source: 'manual'`。

```typescript
// AddFromLibraryDto（新增到 food.dto.ts）
export class AddFromLibraryDto {
  @IsUUID()  foodLibraryId: string;          // foods 表 ID
  @IsInt() @Min(1)  servingGrams: number;    // 用户选择的克数
  @IsEnum(MealType)  mealType: MealType;     // 餐次
}
```

#### FoodLibraryService 核心搜索逻辑

```typescript
// apps/api-server/src/app/services/food-library.service.ts

async search(q: string, limit = 10): Promise<FoodLibrary[]> {
  return this.foodRepo
    .createQueryBuilder('f')
    .where('f.name ILIKE :q OR f.aliases ILIKE :q', { q: `%${q}%` })
    .orderBy('f.search_weight', 'DESC')
    .limit(Math.min(limit, 50))
    .getMany();
}

async addFromLibrary(userId: string, dto: AddFromLibraryDto): Promise<FoodRecord> {
  const food = await this.foodRepo.findOneByOrFail({ id: dto.foodLibraryId });
  const calories = Math.round(food.caloriesPer100g * dto.servingGrams / 100);
  
  return this.foodService.saveRecord(userId, {
    foods: [{
      name: food.name,
      calories,
      quantity: `${dto.servingGrams}g`,
      category: food.category,
      foodLibraryId: food.id,      // 新增字段，JSONB 自动存储
    }],
    totalCalories: calories,
    mealType: dto.mealType,
    source: RecordSource.MANUAL,   // 关键：标记为手动记录
  });
}
```

#### AppClientModule 注册（修改）

```typescript
// apps/api-server/src/app/app-client.module.ts
// 在 TypeOrmModule.forFeature([...]) 中新增：
FoodLibrary,

// 在 providers: [...] 中新增：
FoodLibraryService,

// 在 controllers: [...] 中新增：
FoodLibraryController,
```

### 10.4 SEO 落地页（Next.js SSR）

#### 新建文件

```
apps/web/src/app/[locale]/
├── foods/
│   ├── page.tsx            ← 热量查询首页（搜索框 + 热门分类）
│   └── [name]/
│       ├── page.tsx        ← 食物详情 SSR 页（SEO 核心）
│       └── FoodDetailClient.tsx  ← 客户端交互组件（份量换算）
```

#### 食物详情页（SSR + generateMetadata）

```typescript
// apps/web/src/app/[locale]/foods/[name]/page.tsx

// 优先从 URL params.name 解码后查 API
export async function generateMetadata({ params }: { params: { name: string; locale: string } }) {
  const name = decodeURIComponent(params.name);
  const food = await fetch(`${API_URL}/api/foods/${encodeURIComponent(name)}`).then(r => r.json());
  if (!food?.data) return {};
  const f = food.data;
  const servingCal = Math.round(f.caloriesPer100g * f.standardServingG / 100);
  return {
    title: `${f.name}热量是多少？每100g含${f.caloriesPer100g}kcal | 无畏健康`,
    description: `${f.name}${f.standardServingDesc}约${servingCal}大卡，属于${f.category}类食物。查看详细营养成分并记录到今日饮食。`,
    openGraph: { title: `${f.name} — ${f.caloriesPer100g}kcal/100g`, description: `...` },
  };
}

export default async function FoodDetailPage({ params }) {
  const food = await fetchFoodByName(decodeURIComponent(params.name));
  if (!food) notFound();
  return <FoodDetailClient food={food} />;
}
```

#### Sitemap 扩展（修改现有 sitemap.ts）

```typescript
// apps/web/src/app/sitemap.ts — 在现有 publicRoutes 循环后追加：
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries = [/* 现有 publicRoutes 逻辑不变 */];

  // 动态食物页
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/foods?limit=500`, { next: { revalidate: 86400 } });
    const data = await res.json();
    for (const food of data.data?.items ?? []) {
      for (const locale of i18n.locales) {
        entries.push({
          url: getFullUrl(`/${locale}/foods/${encodeURIComponent(food.name)}`),
          lastModified: new Date(),
          changeFrequency: 'monthly' as const,
          priority: 0.75,
        });
      }
    }
  } catch { /* 构建时 API 不可达，忽略 */ }

  return entries;
}
```

### 10.5 搜索页 UI 规划

```
/foods 页面（Web + App 内嵌 WebView 通用）

┌─────────────────────────────────┐
│  热量查询                        │
├─────────────────────────────────┤
│  🔍 [搜索食物名称...     ]       │  debounce 300ms → /api/foods/search
├─────────────────────────────────┤
│  ← 搜索为空时显示 → 搜索到时隐藏  │
│  热门搜索:                       │
│  [白米饭] [宫保鸡丁] [奶茶]      │
│  [鸡胸肉] [苹果] [可乐]          │
├─────────────────────────────────┤
│  搜索结果:                       │
│  ┌─────────────────────────┐    │
│  │ 宫保鸡丁      260kcal    │    │  ← /100g
│  │ 肉类 · 1份≈200g    [→]  │    │  ← 点击进详情
│  └─────────────────────────┘    │
│                                 │
│  ── 没找到？试试 AI 分析图片 ──  │  ← 引流到 /analyze
└─────────────────────────────────┘

/foods/宫保鸡丁 页面

┌─────────────────────────────────┐
│  ← 返回                         │
├─────────────────────────────────┤
│  宫保鸡丁                        │
│  分类：肉类                      │
├─────────────────────────────────┤
│  每 100g：260 kcal               │
├─────────────────────────────────┤
│  份量换算（客户端交互）            │
│  ○ 100g         = 260 kcal      │
│  ○ 1份（200g）  = 520 kcal      │
│  ● 自定义 [___] g = ___ kcal    │
├─────────────────────────────────┤
│  [+ 加入今日记录]               │  ← 需登录，弹选餐次
├─────────────────────────────────┤
│  相关食物：麻婆豆腐 | 鱼香肉丝    │
└─────────────────────────────────┘
```

---

## 十一、种子数据规划

> **数据策略**：参照中国食物成分表（中国疾控中心），手动整理 150 条高频食物，保证数据准确性。优先录入外卖常见菜品（SEO 搜索量最大）。

### 11.1 种子数据清单（MVP 150 条）

| 分类 | 数量 | 代表食物 |
|------|------|---------|
| 主食 | 25 | 白米饭、糙米饭、馒头、包子、饺子（水煮）、煎饺、面条（煮熟）、米粉、粥（白粥）、油条、烧饼、花卷、米线、螺蛳粉、拉面 |
| 肉类/海鲜 | 35 | 宫保鸡丁、红烧肉、水煮鱼、清蒸鲈鱼、回锅肉、糖醋排骨、北京烤鸭、鸡胸肉（白水煮）、水煮虾、花甲、蒜蒸扇贝、牛排（煎）、炸鸡块、炸薯条、烤鸡腿 |
| 蔬菜/豆制品 | 25 | 蒜炒青菜、西红柿炒鸡蛋、土豆丝（清炒）、麻婆豆腐、拍黄瓜、凉拌木耳、炒豆芽、地三鲜、炒藕片、炒西兰花、皮蛋豆腐、卤豆腐、油豆腐 |
| 汤类 | 10 | 西红柿蛋汤、紫菜蛋花汤、排骨汤、冬瓜汤、豆腐汤、羊肉汤 |
| 外卖/快餐 | 20 | 麦辣鸡腿堡、麦香鱼、麦当劳薯条（大）、百胜鸡腿堡、沙县炒饭、黄焖鸡米饭、盒饭（猪排饭）、冒菜、麻辣烫（中等碗）、烧腊饭 |
| 水果 | 15 | 苹果、香蕉、西瓜、草莓、橙子、葡萄、芒果、哈密瓜、火龙果、桃子、梨、蓝莓、车厘子 |
| 饮品/奶类 | 15 | 全脂牛奶、低脂牛奶、豆浆（无糖）、珍珠奶茶（正常糖）、美式咖啡（无糖）、拿铁咖啡、可乐（330ml）、橙汁（纯果汁）、运动饮料 |
| 零食 | 5 | 薯片（薯条类）、辣条、奥利奥（4块）、核桃仁、鸡蛋 |

### 11.2 种子数据脚本

```typescript
// apps/api-server/src/scripts/seed-foods.ts
// 运行: ts-node -r tsconfig-paths/register src/scripts/seed-foods.ts

import { createConnection } from 'typeorm';
import { FoodLibrary } from '../entities/food-library.entity';

const SEED_FOODS: Partial<FoodLibrary>[] = [
  // ===== 主食 =====
  { name: '白米饭', category: '主食', caloriesPer100g: 116, proteinPer100g: 2.6, fatPer100g: 0.3, carbsPer100g: 25.6, standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 200 },
  { name: '糙米饭', category: '主食', caloriesPer100g: 110, proteinPer100g: 2.8, fatPer100g: 0.9, carbsPer100g: 23.0, standardServingG: 200, standardServingDesc: '1碗约200g', searchWeight: 130 },
  { name: '馒头', category: '主食', caloriesPer100g: 223, proteinPer100g: 7.0, fatPer100g: 1.1, carbsPer100g: 47.0, standardServingG: 80, standardServingDesc: '1个约80g', searchWeight: 180 },
  { name: '包子（猪肉）', category: '主食', caloriesPer100g: 211, proteinPer100g: 9.5, fatPer100g: 7.1, carbsPer100g: 26.6, standardServingG: 90, standardServingDesc: '1个约90g', searchWeight: 170 },
  { name: '煮饺子（猪肉白菜）', aliases: '水饺,饺子', category: '主食', caloriesPer100g: 203, proteinPer100g: 8.5, fatPer100g: 8.0, carbsPer100g: 24.5, standardServingG: 150, standardServingDesc: '1份约150g（10个）', searchWeight: 175 },
  { name: '煮面条', aliases: '面条,挂面', category: '主食', caloriesPer100g: 110, proteinPer100g: 3.6, fatPer100g: 0.6, carbsPer100g: 23.0, standardServingG: 200, standardServingDesc: '1碗约200g（熟）', searchWeight: 170 },
  { name: '油条', category: '主食', caloriesPer100g: 386, proteinPer100g: 6.9, fatPer100g: 17.6, carbsPer100g: 50.1, standardServingG: 80, standardServingDesc: '1根约80g', searchWeight: 160 },
  // ===== 肉类 =====
  { name: '宫保鸡丁', aliases: '宫爆鸡丁', category: '肉类', caloriesPer100g: 260, proteinPer100g: 15.0, fatPer100g: 17.0, carbsPer100g: 11.0, standardServingG: 200, standardServingDesc: '1份约200g', searchWeight: 200 },
  { name: '鸡胸肉（水煮）', aliases: '水煮鸡胸,白煮鸡胸肉', category: '肉类', caloriesPer100g: 133, proteinPer100g: 30.4, fatPer100g: 1.6, carbsPer100g: 0, standardServingG: 150, standardServingDesc: '1块约150g', searchWeight: 190 },
  { name: '红烧肉', category: '肉类', caloriesPer100g: 400, proteinPer100g: 14.0, fatPer100g: 35.0, carbsPer100g: 6.0, standardServingG: 150, standardServingDesc: '1份约150g', searchWeight: 185 },
  { name: '水煮鱼', category: '肉类', caloriesPer100g: 150, proteinPer100g: 17.0, fatPer100g: 8.0, carbsPer100g: 2.5, standardServingG: 300, standardServingDesc: '1份约300g', searchWeight: 180 },
  // ... (共 150 条，运行 seed 脚本填充其余数据)
];

async function seed() {
  const conn = await createConnection();
  const repo = conn.getRepository(FoodLibrary);
  for (const food of SEED_FOODS) {
    await repo.upsert(food as FoodLibrary, ['name']); // 幂等
  }
  console.log(`✅ 已导入 ${SEED_FOODS.length} 条食物数据`);
  await conn.close();
}
seed();
```

---

## 十二、Phase 8 — 分享能力（裂变增长关键）

> **战略意义**：用户主动分享饮食打卡图片到朋友圈/小红书，带来零成本获客。每次分享相当于一次品牌曝光。

### 10.2 后端设计

#### 食物数据库表

```sql
-- 食物基础信息表（静态种子数据 + 可扩展）
CREATE TABLE foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,               -- 宫保鸡丁
  aliases VARCHAR(200),                      -- 别名，逗号分隔："宫爆鸡丁,宫保鸡"
  category VARCHAR(50) NOT NULL,             -- 主食 | 蔬菜 | 肉类 | 豆制品 | 水果 | 饮品 | 零食 | 汤类 | 调味料
  calories_per_100g INT NOT NULL,            -- 每 100g 热量 kcal
  protein_per_100g DECIMAL(5,1),             -- 蛋白质 g
  fat_per_100g DECIMAL(5,1),                 -- 脂肪 g
  carbs_per_100g DECIMAL(5,1),               -- 碳水 g
  standard_serving_g INT DEFAULT 100,        -- 标准份量克数（宫保鸡丁=200g/份）
  standard_serving_desc VARCHAR(50),         -- "1份约200g"
  image_url VARCHAR(300),                    -- 食物图片
  search_weight INT DEFAULT 100,             -- 搜索权重（热门食物权重高）
  source VARCHAR(20) DEFAULT 'seed',         -- seed | user | ai
  is_verified BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 全文搜索索引
CREATE INDEX idx_foods_name_search ON foods USING gin(
  to_tsvector('simple', name || ' ' || COALESCE(aliases, ''))
);
CREATE INDEX idx_foods_category ON foods(category);
CREATE INDEX idx_foods_weight ON foods(search_weight DESC);
```

#### 种子数据规划（MVP 100~150 条）

| 分类 | 条目数 | 示例 |
|------|--------|------|
| 主食 | 25 | 白米饭、馒头、面条、包子、饺子、烧卖、米粉、粥... |
| 肉类/蛋白 | 30 | 宫保鸡丁、红烧肉、水煮鱼、清蒸虾、烤鸭、牛排... |
| 蔬菜 | 20 | 炒青菜、西红柿炒蛋、土豆丝、拍黄瓜... |
| 外卖套餐 | 20 | 麦当劳巨无霸、肯德基全家桶、沙县炒饭... |
| 水果 | 15 | 苹果、香蕉、西瓜、草莓... |
| 饮品 | 20 | 奶茶(标准款)、可乐、橙汁、咖啡拿铁... |
| 零食 | 15 | 薯片、辣条、奥利奥、坚果... |

#### API 接口

```
# 搜索食物（App 搜索框 + SEO 数据源）
GET  /api/foods/search?q=宫保鸡丁&limit=10
Response: {
  items: [{ id, name, category, calories_per_100g, standard_serving_g, standard_serving_desc, ... }],
  total: 1
}

# 获取食物详情（SEO 页渲染数据源）
GET  /api/foods/:id
GET  /api/foods/by-name/:name     ← 支持 URL 友好形式查询

# 热门食物分类列表
GET  /api/foods/categories
GET  /api/foods/popular?category=主食&limit=20

# 搜索时记录到饮食记录
POST /api/app/food/records/from-search
Body: { foodId, servingCount, mealType }
Authorization: Bearer <token>
```

### 10.3 SEO 落地页设计

```
URL 结构:
  /foods              → 热量查询首页（含搜索框 + 热门分类）
  /foods/[name]       → 单食物详情页（SSR，SEO核心）

示例:
  /foods/宫保鸡丁
  /foods/白米饭
  /foods/奶茶

页面元素:
  <title>宫保鸡丁热量是多少？每100g含520kcal | 无畏健康</title>
  <description>宫保鸡丁每份（200g）约含1040大卡，蛋白质30g，脂肪58g...</description>

落地页内容:
  ┌────────────────────────────────────┐
  │  🥜 宫保鸡丁                       │
  │  每100g: 520 kcal                  │
  ├────────────────────────────────────┤
  │  份量换算:                          │
  │  [100g] [1份≈200g] [自定义克数__]  │
  │  → 对应热量: 1040 kcal             │
  ├────────────────────────────────────┤
  │  营养成分:                          │
  │  蛋白质 30g | 脂肪 58g | 碳水 22g  │
  ├────────────────────────────────────┤
  │  [+ 加入今日记录]  [使用App查看更多] │
  └────────────────────────────────────┘
  
  相关食物推荐: 麻婆豆腐 | 鱼香肉丝 | 红烧肉
```

#### Next.js SSR 实现要点

```typescript
// apps/web/src/app/[locale]/foods/[name]/page.tsx

export async function generateMetadata({ params }) {
  const food = await fetch(`${API_URL}/api/foods/by-name/${params.name}`).then(r => r.json());
  return {
    title: `${food.name}热量是多少？每100g含${food.calories_per_100g}kcal | 无畏健康`,
    description: `${food.name}每份（${food.standard_serving_desc}）约含${Math.round(food.calories_per_100g * food.standard_serving_g / 100)}大卡...`,
    // Open Graph 用于分享预览
    openGraph: { title, description, images: [food.image_url] },
  };
}

export default async function FoodDetailPage({ params }) {
  const food = await getFoodByName(params.name); // 服务端 fetch，SEO 可索引
  return <FoodDetailClient food={food} />;
}
```

#### Sitemap 自动生成

```typescript
// apps/web/src/app/sitemap.ts
export default async function sitemap() {
  const foods = await fetch(`${API_URL}/api/foods?limit=1000`).then(r => r.json());
  return foods.items.map(f => ({
    url: `https://uway.dev-net.uk/zh/foods/${encodeURIComponent(f.name)}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: 0.8,
  }));
}
```

### 10.4 前端搜索页（App 内嵌）

```
搜索页路由: /foods

┌─────────────────────────────────┐
│  🔍 [搜索食物热量...  ]         │  ← 搜索框，实时 debounce 300ms
├─────────────────────────────────┤
│  📷 或者 上传食物图片分析        │  ← 引流到已有 AI 分析功能
├─────────────────────────────────┤
│  热门搜索:                       │
│  [白米饭] [宫保鸡丁] [奶茶]      │  ← 快捷标签
│  [麦当劳] [馒头] [可乐]          │
├─────────────────────────────────┤
│  搜索结果:                       │
│  ┌──────────────────────────┐   │
│  │ 宫保鸡丁          520kcal │   │  ← 每100g
│  │ 肉类 · 1份≈200g   [+ 记录] │  │
│  └──────────────────────────┘   │
└─────────────────────────────────┘
```

---

## 十一、Phase 8 — 分享能力（裂变增长关键）

> **战略意义**：用户主动分享饮食打卡图片到朋友圈/小红书，带来零成本获客。每次分享相当于一次品牌曝光。

### 11.1 分享场景规划

| 场景 | 触发时机 | 分享内容 | 目标平台 |
|------|---------|---------|---------|
| **今日饮食卡片** | 每天主动分享当日战报 | 今日热量 + 达标进度 + 打招呼语 | 朋友圈 / 小红书 |
| **分析结果分享** | AI 分析完成后 | 菜品分析截图 + 热量数据 | 朋友圈 / 好友 |
| **挑战完成分享** | 挑战连续打卡 N 天后 | 成就卡片（"我坚持了7天！"）| 朋友圈 / 小红书 |
| **体重里程碑** | 体重下降 5/10 斤 | 变化对比数据卡 | 朋友圈 |

### 11.2 分享图片设计（卡片模板）

#### 模板 A：今日饮食战报

```
┌─────────────────────────────┐  比例 9:16 (1080×1920)
│                             │
│   无畏健康 · 今日战报         │  Logo + 日期
│   2026年4月6日               │
│                             │
│       ┌──────────┐          │
│       │ 🍽️ 1840 │          │  热量大数字（中央）
│       │   kcal   │          │
│       └──────────┘          │
│                             │
│   目标 2100kcal              │
│   ████████████░░░  87%      │  进度条
│   剩余 260 kcal              │
│                             │
│   今日三餐:                  │
│   🌅 早餐 350kcal 燕麦粥     │
│   ☀️  午餐 720kcal 宫保鸡丁  │
│   🌙 晚餐 770kcal 清蒸鱼     │
│                             │
│   AI 教练点评:               │
│   "今天蛋白质摄入充足，        │
│    继续保持！"                │
│                             │
│   ── 扫码记录你的饮食 ──      │  二维码（可选）
│           [QR]               │
│                             │
└─────────────────────────────┘
```

#### 模板 B：分析结果卡片

```
┌─────────────────────────────┐  比例 1:1（适合小红书）
│  [食物图片缩略图]            │  用户上传的原图
│                             │
│  AI 识别结果:                │
│  • 宫保鸡丁    520kcal      │
│  • 白米饭      232kcal      │
│  • 紫菜蛋花汤  80kcal       │
│                             │
│  合计: 832 kcal             │
│  AI建议: 蔬菜偏少，建议...   │
│                             │
│  #健康饮食 #热量打卡 #无畏健康│
└─────────────────────────────┘
```

### 12.3 Flutter App 技术实现方案

#### 图片生成方案（设备端渲染）

```dart
// 推荐方案：FlutterWidget → 截图 → 分享
// 优点：完全在设备端，无服务端成本，渲染速度快

// 1. 将 Widget 渲染为图片
Future<Uint8List> captureCard(GlobalKey key) async {
  final boundary = key.currentContext!.findRenderObject() as RenderRepaintBoundary;
  final image = await boundary.toImage(pixelRatio: 3.0); // 3x 高清
  final byteData = await image.toByteData(format: ImageByteFormat.png);
  return byteData!.buffer.asUint8List();
}
```

#### 分享到微信朋友圈（推荐 fluwx 包）

```yaml
# pubspec.yaml
dependencies:
  fluwx: ^4.3.0             # 微信 SDK Flutter 封装
  share_plus: ^10.0.0       # 通用系统分享（小红书/微博等）
  image_gallery_saver: ^2.0.3  # 保存到相册
```

```dart
// 方案一：分享图片到微信朋友圈（fluwx）
import 'package:fluwx/fluwx.dart';

Future<void> shareToWeChatTimeline(Uint8List imageBytes) async {
  // 检查微信是否安装
  final isInstalled = await isWeChatInstalled;
  if (!isInstalled) {
    // 降级：保存到相册 + 提示用户手动分享
    await saveToGallery(imageBytes);
    showSnackBar('图片已保存，请手动分享到朋友圈');
    return;
  }
  
  await shareToWeChat(
    WeChatShareImageModel(
      WChatScene.timeline,          // 分享到朋友圈
      imageData: imageBytes,         // 图片二进制
      // 或者: source: WeChatImage.file(path) 
    ),
  );
}

// 方案二：微信好友聊天分享
Future<void> shareToWeChatSession(Uint8List imageBytes) async {
  await shareToWeChat(
    WeChatShareImageModel(
      WChatScene.session,
      imageData: imageBytes,
    ),
  );
}
```

#### 分享到小红书（调研结论）

> **结论：小红书无开放分享 SDK，推荐「保存图片 + 引导打开小红书」方案。**

| 方案 | 可行性 | 体验 | 建议 |
|------|-------|------|------|
| 小红书官方 SDK | ❌ 无开放 SDK 给第三方 | — | 不可用 |
| URL Scheme 直接跳转 | ⚠️ 无法直接携带图片 | 差 | 不推荐 |
| **保存相册 + 引导** | ✅ 最通用 | 中 | **推荐** |
| 系统分享菜单 | ✅ 可选小红书（若已安装）| 好 | 推荐 |

```dart
// 推荐：系统分享菜单（iOS/Android 原生），用户可选微信/小红书/微博
import 'package:share_plus/share_plus.dart';

Future<void> shareImage(Uint8List imageBytes) async {
  // 1. 将图片写入临时文件
  final tempDir = await getTemporaryDirectory();
  final file = File('${tempDir.path}/wuwei_share_${DateTime.now().millisecondsSinceEpoch}.png');
  await file.writeAsBytes(imageBytes);
  
  // 2. 调用系统分享菜单
  await Share.shareXFiles(
    [XFile(file.path, mimeType: 'image/png')],
    text: '我今天通过"无畏健康"管理热量 🥗 #健康饮食 #热量打卡',
  );
}

// 小红书独立入口：保存 + 引导跳转
Future<void> shareToXiaohongshu(Uint8List imageBytes) async {
  // 1. 保存到相册
  await saveImageToGallery(imageBytes); // image_gallery_saver 或 gal 包
  
  // 2. 显示引导 Toast
  showDialog(
    title: '图片已保存',
    content: '请打开小红书，选择「发布笔记」→「从相册选择」即可分享',
    actions: [
      TextButton('取消', onPressed: dismiss),
      TextButton('打开小红书', onPressed: () async {
        // 尝试 URL Scheme 打开小红书（若已安装）
        final uri = Uri.parse('xhsdiscover://');
        if (await canLaunchUrl(uri)) {
          await launchUrl(uri);
        } else {
          // 未安装：打开应用商店
          await launchUrl(Uri.parse('https://www.xiaohongshu.com'));
        }
      }),
    ],
  );
}
```

#### iOS 配置

```xml
<!-- ios/Runner/Info.plist -->
<!-- 微信 SDK -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>wx你的APPID</string>  <!-- 替换为真实 appid -->
    </array>
  </dict>
</array>
<key>LSApplicationQueriesSchemes</key>
<array>
  <string>weixin</string>
  <string>weixinULAPI</string>
  <string>xhsdiscover</string>   <!-- 小红书 -->
</array>
```

#### Android 配置

```xml
<!-- android/app/src/main/AndroidManifest.xml -->
<queries>
  <package android:name="com.tencent.mm" />  <!-- 微信 -->
  <package android:name="com.xingin.xhs" />   <!-- 小红书 -->
</queries>
```

### 12.4 微信开放平台接入流程

> **前提**：App 分享图片到朋友圈需要在微信开放平台注册移动应用

1. **注册微信开放平台** → https://open.weixin.qq.com
2. **创建移动应用**（填写 App 名称、包名/Bundle ID、签名）
3. **申请「分享到微信朋友圈」权限**（需要已上架，或提交审核材料）
4. **获取 AppID**（格式：`wx`开头的16位字符串）
5. **Flutter 配置**：

```dart
// main.dart
void main() async {
  await registerWxApi(
    appId: 'wx你的开放平台APPID',   // 注意：这里用开放平台 AppID，非公众号 AppID
    doOnAndroid: true,
    doOnIOS: true,
    universalLink: 'https://uway.dev-net.uk/wx-universal-link/', // iOS Universal Link
  );
  runApp(MyApp());
}
```

**审核材料（上架前内测方式）**：
- 在微信开放平台添加测试人员（最多 5 个 openid），可绕过审核直接测试

### 12.5 Web 端分享能力（Next.js）

> Web 端无法直接调用微信 JS-SDK 分享图片到朋友圈（微信限制）。推荐替代方案：

```typescript
// Web 端分享策略

// 1. 生成分享图片（Canvas + html2canvas）
import html2canvas from 'html2canvas';

async function generateShareImage(elementRef: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(elementRef, {
    scale: 2,        // 2x 高清
    useCORS: true,   // 允许跨域图片
    backgroundColor: null,
  });
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
}

// 2. 下载到本地
function downloadImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

// 3. 给 Web 用户的分享引导
// 微信内置浏览器：提示用户点击右上角「•••」→「分享到朋友圈」
// 其他浏览器：下载图片后手动分享
```

### 12.6 后端辅助接口（可选）

> 如果需要服务端渲染图片（用于 OGP 预览 / 更复杂的模板），可以考虑：

```
# 生成分享图片（服务端 Puppeteer 渲染）
POST /api/app/share/generate
Body: { type: 'daily_report' | 'food_analysis' | 'challenge', date?: string }
Authorization: Bearer <token>
Response: { imageUrl: "https://r2.storage/share/xxx.png" }
```

> **MVP 阶段建议**：先用设备端渲染（Flutter 方案），服务端渲染留给后期有高级模板需求时再做，避免引入 Puppeteer 的成本。

### 12.7 分享文案模板

```typescript
const SHARE_TEXTS = {
  daily_report: (calories, goal, date) => 
    `${date}，我摄入了${calories}kcal（目标${goal}kcal），通过"无畏健康"轻松管理热量 💪\n#健康饮食 #热量打卡 #无畏健康`,
  
  analysis: (foods, totalCalories) =>
    `AI 帮我分析了这顿饭：${foods.map(f => f.name).join('+')}，共${totalCalories}kcal ✨\n#外卖热量 #AI饮食分析`,
  
  challenge_complete: (days) =>
    `我用"无畏健康"打卡了${days}天！健康饮食，坚持从今天开始 🎉\n#健康挑战 #打卡第${days}天`,
};
```

---

## 十三、Phase 4 — 打卡挑战（轻社交增长）

> **核心目的**：提高次日留存。用户完成当日目标 → 连续打卡 → 成就感 → 留存。

### 10.1 数据设计

```sql
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,           -- "7天健康饮食挑战"
  type VARCHAR(20) DEFAULT 'calorie',   -- calorie | meal_count | no_takeout
  target_value INT,                     -- 目标值（如热量目标 2000kcal）
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'active',  -- active | completed | failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE challenge_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id),
  date DATE NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  actual_value INT,                     -- 当日实际值
  UNIQUE(challenge_id, date)
);
```

### 10.2 挑战类型

| 类型 | 说明 | 完成条件 |
|------|------|---------|
| `calorie` | 热量控制挑战 | 当日摄入 ≤ 目标热量 |
| `meal_count` | 规律饮食挑战 | 当日记录 ≥ 3 餐 |
| `record_streak` | 连续打卡挑战 | 连续 N 天有记录 |

### 10.3 API 接口

```
POST /api/app/challenges              → 创建挑战（type, days: 7/14/30）
GET  /api/app/challenges/active       → 当前进行中的挑战  
GET  /api/app/challenges/:id          → 挑战详情 + 打卡日历
POST /api/app/challenges/:id/checkin  → 手动打卡（系统每日 0 点自动执行）
GET  /api/app/challenges/history      → 历史挑战记录
```

### 10.4 前端展示

- 首页底部"每日打卡"区域改为真实数据
- 进入"挑战"页可查看 7/14/30 天日历格
- 完成当日打卡时触发动效（撒彩纸）
- 连续打卡第 3/7/14/30 天给予成就徽章

---

## 十一、Phase 5 — 工程化优化（生产就绪）

### 11.1 Redis 迁移（目前用内存存储，单实例可用）

> 当前问题：验证码存在内存 Map，重启后失效；多实例部署时每台实例独立状态。

```typescript
// sms.service.ts 迁移到 Redis
// 优先级：中（单机部署时不影响功能）

// 验证码 Key: sms:verify:{phone}  TTL: 300s
// 防刷 Key:   sms:lock:{phone}    TTL: 60s
await this.redis.setex(`sms:verify:${phone}`, 300, code);
const locked = await this.redis.exists(`sms:lock:${phone}`);
```

**涉及文件**：
- `src/app/services/sms.service.ts`（注入 Redis，替换 Map）
- `src/core/` 添加 `RedisModule`（基于 `ioredis`）
- 环境变量：`REDIS_URL=redis://localhost:6379`

### 11.2 每日定时任务

```typescript
// scheduler.service.ts（基于 @nestjs/schedule）

// 每天 0:05 批量检查所有活跃挑战的打卡状态
@Cron('5 0 * * *')
async processDailyCheckins(): Promise<void> {
  // 查找所有 active 挑战，对比 daily_summaries，自动标记
}

// 每天 0:10 生成每日 daily_summaries（确保昨日数据完整）
@Cron('10 0 * * *')
async generateDailySummaries(): Promise<void> {}
```

### 11.3 前端性能优化

| 问题 | 方案 | 优先级 |
|------|------|--------|
| 首页数据冷启动慢 | Skeleton loading + Optimistic UI | P1 |
| 图片上传无进度 | axios onUploadProgress + 进度条 | P1 |
| AI 分析等待焦虑 | 分步进度提示（"正在识别菜品..."）| P0 |
| 反复进出页面重新加载 | SWR/TanStack Query 客户端缓存（5min）| P2 |
| 移动端键盘遮挡输入框 | `visualViewport` resize 事件处理 | P1（教练页） |

### 11.4 真实 SMS 接入

```bash
# 阿里云 SMS
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=xxx
ALIYUN_ACCESS_KEY_SECRET=xxx
ALIYUN_SMS_SIGN_NAME=无畏健康
ALIYUN_SMS_TEMPLATE_CODE=SMS_xxxxxxxxx

# 腾讯云 SMS（备选）
SMS_PROVIDER=tencent
TENCENT_SECRET_ID=xxx
TENCENT_SECRET_KEY=xxx
TENCENT_SMS_APP_ID=xxx
TENCENT_SMS_SIGN=无畏健康
TENCENT_SMS_TEMPLATE_ID=xxxxxxx
```

> 接入前最终测试：移除万能验证码 `888888`（或限制为特定测试手机号）。

---

## 十二、已完成功能清单（Phase 1 & 2 & 3 & 食物库）

| 模块 | 功能 | 状态 |
|------|------|------|
| **认证（Phase 1）** | | |
| 认证 | 手机号验证码登录（万能码 888888）| ✅ |
| 认证 | 微信网页扫码登录 | ✅ |
| 认证 | 邮箱/匿名登录 | ✅ |
| **饮食记录（Phase 2）** | | |
| 饮食 | AI 食物图片分析（OpenRouter → ERNIE VL）| ✅ |
| 饮食 | 图片上传 Cloudflare R2 | ✅ |
| 饮食 | 饮食记录 CRUD | ✅ |
| 饮食 | 今日汇总（已摄入/目标/剩余）| ✅ |
| 饮食 | 近 7 天趋势 | ✅ |
| 档案 | 用户健康档案（身高体重活动等级）| ✅ |
| 档案 | BMR 自动计算热量目标 | ✅ |
| **AI 教练（Phase 3）** | | |
| 教练 | 流式对话 API（SSE + OpenRouter DeepSeek）| ✅ |
| 教练 | 对话历史持久化（coach_conversations 表）| ✅ |
| 教练 | 用户饮食上下文注入（今日/近7天数据）| ✅ |
| 教练 | 前端流式消息渲染（打字机效果）| ✅ |
| 教练 | 会话管理（新建/历史/清除）| ✅ |
| **热量查询 + 食物库** | | |
| 食物库 | FoodLibrary 实体 + Migration（pg_trgm 索引）| ✅ |
| 食物库 | 145 条中国常见食物种子数据（8 大分类）| ✅ |
| 食物库 | 公开搜索 API（ILIKE + 别名匹配）| ✅ |
| 食物库 | 分类/热门/详情/全量 API | ✅ |
| 食物库 | 从食物库一键添加饮食记录端点 | ✅ |
| 食物库 | 用户常吃食物排行端点 | ✅ |
| 食物库 | /foods 搜索页（SSR + 客户端搜索）| ✅ |
| 食物库 | /foods/[name] 详情页（SSR + SEO + JSON-LD）| ✅ |
| 食物库 | 份量计算器 + 营养成分动态计算 | ✅ |
| 食物库 | Sitemap 动态食物页 + SEO 元数据 | ✅ |
| **前端 + 运维** | | |
| 前端 | 登录/首页/分析页/个人中心/AI 教练页 | ✅ |
| 前端 | 端到端流程测试通过 | ✅ |
| 运维 | GCloud VM PM2 部署（`flutter-scaffold-4fd6c/openclaw`）| ✅ |
| 运维 | Vercel 前端部署（https://uway.dev-net.uk）| ✅ |

## 十三、热量查询 + 食物库实施计划 ✅ 已完成

> **完成于 2026-04-06** | 后端 API + SEO 落地页 + Web 搜索页全部上线。

### 实施产出清单

| 文件 | 说明 | 状态 |
|------|------|------|
| `entities/food-library.entity.ts` | FoodLibrary 实体（UUID, 营养数据, pg_trgm索引）| ✅ |
| `migrations/1744000000000-AddFoodLibraryTable.ts` | 创建 foods 表 + 3 个索引 | ✅ |
| `scripts/seed-foods.data.ts` | 145 条中国食物种子数据集 | ✅ |
| `scripts/seed-foods.ts` | 幂等导入脚本（支持 SSL） | ✅ |
| `services/food-library.service.ts` | 搜索/分类/CRUD/从库添加记录/常吃排行 | ✅ |
| `controllers/food-library.controller.ts` | 公开 API 6 个端点（无需 JWT）| ✅ |
| `controllers/food.controller.ts` | 新增 `from-library` + `frequent-foods` 端点 | ✅ |
| `dto/food.dto.ts` | 新增 AddFromLibraryDto | ✅ |
| `app-client.module.ts` | 注册 FoodLibrary 实体/服务/控制器 | ✅ |
| `database.module.ts` | 注册 FoodLibrary 实体到全局 TypeORM | ✅ |
| `web/foods/page.tsx` | 搜索首页（SSR + 客户端交互）| ✅ |
| `web/foods/FoodsClient.tsx` | 搜索页客户端组件（防抖搜索 + 分类筛选）| ✅ |
| `web/foods/[name]/page.tsx` | 食物详情 SSR 页（generateMetadata + JSON-LD） | ✅ |
| `web/foods/[name]/FoodDetailClient.tsx` | 详情页客户端（份量计算器 + 一键记录）| ✅ |
| `web/lib/api/food-library.ts` | 服务端 + 客户端 API 封装 | ✅ |
| `web/sitemap.ts` | 动态食物页入口 | ✅ |
| `web/lib/seo/metadata.ts` | /foods 加入 publicRoutes | ✅ |

### API 端点验证

```
✅ GET  /api/foods/search?q=鸡     → 返回搜索结果
✅ GET  /api/foods/popular          → 返回热门食物
✅ GET  /api/foods/categories       → 9 个分类
✅ GET  /api/foods/by-name/白米饭   → 详情 + related
✅ GET  /api/foods?limit=200        → 全量数据（sitemap 用）
✅ POST /api/app/food/records/from-library → 需登录，一键记录
✅ GET  /api/app/food/frequent-foods      → 需登录，常吃排行
```

---

## 十四、下一步优先级列表

> 更新于 2026-04 | Phase 1 + Phase 2 + Phase 3 (AI 教练) 均已完成并部署。

### 当前实施优先级

| 排序 | 任务 | 预计工时 | 本章节参考 |
|------|------|---------|-----------|
| ~~🔥 1~~ | ~~**食物库后端：实体+迁移+种子数据+API**~~ | ~~1.5 天~~ | ✅ 已完成 |
| ~~🔥 2~~ | ~~**SEO 落地页：/foods/[name] SSR**~~ | ~~1 天~~ | ✅ 已完成 |
| ~~🔥 3~~ | ~~**Web 搜索首页 /foods**~~ | ~~0.5 天~~ | ✅ 已完成 |
| ~~4~~ | ~~部署到 GCloud + Vercel~~ | ~~0.5 天~~ | ✅ 已完成 |
| **🔥 1** | 每日打卡挑战后端 + 前端 | 2 天 | 章节 十三（Phase 4）|
| **🔥 2** | Flutter App 开发启动 | — | 分享能力在 App 阶段 |
| 3 | Redis 迁移 | 0.5 天 | 章节 十四（Phase 5）|
| 4 | 真实 SMS 接入 | 0.5 天 | — |

### 关键前置条件清单

| 条件 | 状态 | 备注 |
|------|------|------|
| GCloud VM 可 SSH | ✅ | IP 34.92.33.180，PM2 运行中 |
| Vercel CI/CD | ✅ | push main 自动部署 |
| PostgreSQL pg_trgm | ⚠️ 需确认 | migration 中自动 `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| 食物种子数据 | ⚠️ 需整理 | 可先 30 条上线，分批补充 |
| 微信开放平台 | ⚠️ App 才需要 | Flutter 开发时注册 |

