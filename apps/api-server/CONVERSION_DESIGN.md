# PDF 转换系统 - 技术设计文档

> 可控成本的文件转换系统，基于 NestJS + CloudConvert SDK + Redis

---

## 一、整体架构

```
Flutter App
    │
    │  multipart/form-data 或 JSON
    ▼
NestJS API  (api-server)
    │
    ├─ ConversionRateLimitGuard  ← IP & 用户配额检查（Redis）
    │
    ├─ ConversionController      ← 路由层
    │
    ├─ ConversionService         ← 业务编排层
    │    ├─ MIME / 文件大小校验
    │    ├─ 上传到 S3（可选）
    │    ├─ 调用 CloudConvertService
    │    ├─ 等待结果 / Webhook 接收
    │    └─ 写入 ConversionRecord（PostgreSQL）
    │
    └─ CloudConvertService       ← 第三方适配层（官方 SDK）
         ├─ sdk.jobs.create()
         ├─ sdk.tasks.upload()
         ├─ sdk.jobs.wait()      ← long-polling（非定时器）
         ├─ sdk.jobs.getExportUrls()
         └─ sdk.webhooks.verify()
```

**核心原则：Flutter 永远不直接接触 CloudConvert**

---

## 二、模块目录结构

```
src/conversion/
├── conversion.module.ts          # 主模块（已注册到 AppModule）
├── conversion.controller.ts      # API 路由（4个端点）
├── conversion.service.ts         # 核心业务逻辑
├── index.ts
│
├── cloudconvert/                 # CloudConvert 官方 SDK 封装
│   ├── cloudconvert.module.ts    # Global 模块
│   ├── cloudconvert.service.ts   # SDK 调用封装
│   ├── cloudconvert.types.ts     # 自定义类型（Config / Result / Webhook）
│   └── index.ts
│
├── rate-limit/                   # Redis 限流模块
│   ├── rate-limit.module.ts      # Global 模块
│   ├── rate-limit.service.ts     # 限流逻辑
│   ├── rate-limit.guard.ts       # NestJS Guard（路由层拦截）
│   ├── rate-limit.types.ts       # 类型定义
│   ├── redis.service.ts          # Redis 客户端（含内存降级）
│   └── index.ts
│
├── dto/
│   └── conversion.dto.ts         # 请求 / 响应 DTO
│
└── entities/
    └── conversion-record.entity.ts  # TypeORM 实体（转换日志）
```

---

## 三、API 接口完整说明

> **Base URL**: `https://your-api.com/api`
> 所有响应均包裹在统一格式中：`{ code, data, message, success }`

---

### 3.1 上传文件转换

**Flutter 最常用的接口** — 用户从手机选择文件后直传服务器。

```
POST /conversion/convert
Content-Type: multipart/form-data
```

#### 请求字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 待转换文件（PDF 或 DOCX） |
| `type` | string | ✅ | 转换类型，见下表 |
| `deviceId` | string | ❌ | 设备唯一标识，用于限流计数（未登录用户必传） |

#### 转换类型 (`type`)

| 值 | 含义 |
|----|------|
| `pdf_to_docx` | PDF → Word (.docx) |
| `docx_to_pdf` | Word (.docx) → PDF |

#### 文件限制

| 限制 | 值 |
|------|-----|
| 最大文件大小 | **10 MB** |
| 允许的 MIME 类型 | `application/pdf` / `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

#### 成功响应（同步转换完成）

HTTP 200
```json
{
  "code": 200,
  "success": true,
  "message": "操作成功",
  "data": {
    "conversionId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "downloadUrl": "https://storage.cloudconvert.com/...",
    "remainingQuota": 2
  }
}
```

#### 成功响应（异步，有 Webhook 时）

HTTP 200
```json
{
  "code": 200,
  "success": true,
  "message": "操作成功",
  "data": {
    "conversionId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "processing",
    "remainingQuota": 2
  }
}
```
> 此情况下 `downloadUrl` 为空，Flutter 需轮询 `/conversion/status?id=...` 获取结果。

#### 错误响应

**配额超限（HTTP 429）**
```json
{
  "code": 429,
  "success": false,
  "message": "今日免费次数已用完",
  "data": {
    "code": "LIMIT_EXCEEDED",
    "message": "今日免费次数已用完",
    "remaining": 0,
    "dailyLimit": 3,
    "dailyUsed": 3
  }
}
```

**IP 频率超限（HTTP 429）**
```json
{
  "code": 429,
  "success": false,
  "data": {
    "code": "IP_LIMIT_EXCEEDED",
    "message": "请求过于频繁，请稍后再试",
    "remaining": 0,
    "resetIn": 43200
  }
}
```

**文件类型错误（HTTP 400）**
```json
{
  "code": 400,
  "success": false,
  "message": "只允许上传 PDF 或 Word 文件"
}
```

**转换失败（HTTP 500）**
```json
{
  "code": 500,
  "success": false,
  "message": "转换失败，请稍后重试"
}
```

---

### 3.2 通过 URL 转换

文件已在其他地方（如用户相册上传至 S3），直接传 URL。

```
POST /conversion/convert-url
Content-Type: application/json
```

#### 请求 Body

```json
{
  "type": "pdf_to_docx",
  "fileUrl": "https://your-s3.com/uploads/xxx.pdf",
  "deviceId": "flutter-device-uuid"
}
```

#### 响应字段（同 3.1）

---

### 3.3 查询转换状态

转换处于 `processing` 时使用此接口轮询（建议间隔 **2秒**）。

```
GET /conversion/status?id={conversionId}
```

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 转换 ID（`conversionId`） |

#### 响应

```json
{
  "code": 200,
  "success": true,
  "data": {
    "conversionId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "completed",
    "downloadUrl": "https://storage.cloudconvert.com/...",
    "remainingQuota": 0
  }
}
```

#### `status` 状态值

| 值 | 含义 | Flutter 处理 |
|----|------|-------------|
| `pending` | 排队中 | 继续轮询 |
| `processing` | 转换中 | 继续轮询 |
| `completed` | 转换完成 | 读取 `downloadUrl` |
| `failed` | 转换失败 | 显示 `error` 字段 |
| `timeout` | 超时（30s） | 提示用户重试 |

---

### 3.4 查询用户配额

Flutter 打开功能页时调用，展示剩余次数。

```
GET /conversion/quota?deviceId={deviceId}
```

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `deviceId` | string | ❌ | 设备 ID，不传则按 IP 计算 |

也可以通过 Header 传递：
```
X-Device-Id: flutter-device-uuid
```

#### 响应

```json
{
  "code": 200,
  "success": true,
  "data": {
    "dailyUsed": 1,
    "dailyLimit": 3,
    "remaining": 2
  }
}
```

---

### 3.5 Webhook 回调（后端内部，Flask 不需要实现）

```
POST /conversion/webhook
Header: CloudConvert-Signature: {hmac_sha256_signature}
```

> 此接口仅供 CloudConvert 服务器回调，Flutter 无需关心。

---

## 四、Flutter 对接完整流程

### 4.1 完整流程图

```
用户选择文件（FilePicker）
         │
         ▼
校验文件（大小 ≤ 10MB，格式 PDF/DOCX）
         │
         ▼
        调用 POST /conversion/convert
      （multipart/form-data）
         │
    ┌────┴────┐
    │         │
  同步完成   异步处理中
(status=    (status=
 completed)  processing)
    │              │
    │        轮询 GET /conversion/status?id=xxx
    │              │ 每2秒一次，超过60s停止
    │              │
    └──────┬────────┘
           │ status=completed
           ▼
     获取 downloadUrl
           │
           ▼
  提示用户选择：
  ┌─────────────────┐
  │ 1. 浏览器打开   │
  │ 2. 下载到本地   │
  │ 3. 分享文件     │
  └─────────────────┘
```

### 4.2 用户标识策略（deviceId）

Flutter 端建议使用 `device_info_plus` 或 `uuid` 生成稳定的设备 ID：

```dart
// 方案：SharedPreferences 持久化 UUID
Future<String> getDeviceId() async {
  final prefs = await SharedPreferences.getInstance();
  String? id = prefs.getString('device_id');
  if (id == null) {
    id = const Uuid().v4();
    await prefs.setString('device_id', id);
  }
  return id;
}
```

所有接口请求时带上此 `deviceId`，服务端以此为维度计算限流。

### 4.3 推荐 Header

```
Content-Type: multipart/form-data  (上传接口)
Content-Type: application/json     (JSON接口)
X-Device-Id: {deviceId}            (可选，与 deviceId 字段二选一)
```

---

## 五、Redis 限流设计

### 5.1 Key 结构

```
pdf_limit:user:{deviceId}:{YYYY-MM-DD}   → 用户维度（每天 3 次）
pdf_limit:ip:{ip}:{YYYY-MM-DD}           → IP 维度（每天 10 次）
```

- Type：String（计数器）
- TTL：86400 秒（24小时），每天零点自动重置
- 原子操作：`INCR key` → 如果是新 key（返回 1）则 `EXPIRE key 86400`

### 5.2 限流检查顺序

Guard 在业务逻辑前执行，**先拦截后不调用 CloudConvert**：

```
请求 → IP 限流检查（INCR） → 用户配额检查（GET） → 业务逻辑 → 消耗配额（INCR）
```

> 注意：**检查 ≠ 消耗**。Guard 只读不扣，业务成功后才扣。
> 这样可以避免转换失败仍然消耗次数的问题。

### 5.3 降级策略

Redis 不可用时自动切换到内存 Map（单机可用），集群部署必须配置 Redis。

---

## 六、CloudConvert SDK 核心实现

### 6.1 为什么用官方 SDK

| 对比项 | 手写 axios | 官方 SDK |
|--------|-----------|---------|
| 文件上传 | 手动构造 S3 multipart form | `sdk.tasks.upload()` 一行 |
| 等待完成 | 手写定时轮询 | `sdk.jobs.wait()` long-polling |
| Webhook 验证 | 手写 HMAC | `sdk.webhooks.verify()` |
| 结果解析 | 手动遍历 tasks | `sdk.jobs.getExportUrls()` |

### 6.2 等待完成实现（SDK long-polling + 超时控制）

```typescript
// 服务端实现（参考）
const waitPromise = sdk.jobs.wait(jobId);          // SDK long-polling
const timeoutPromise = timeout(30000);              // 30s 超时

const job = await Promise.race([waitPromise, timeoutPromise]);

if (job.status === 'finished') {
  const urls = sdk.jobs.getExportUrls(job);        // 自动提取结果文件
  return urls[0].url;                              // 下载链接
}
```

### 6.3 Webhook 验证（SDK 内置）

```typescript
// 服务端实现（参考）
const isValid = sdk.webhooks.verify(
  rawBody,       // 原始 body 字符串
  signature,     // CloudConvert-Signature header
  webhookSecret  // 在 CloudConvert Dashboard 生成
);
```

---

## 七、转换记录（数据库）

每次转换均写入 `conversion_records` 表，用于：
- 成本审计
- 后续收费对账
- 异常排查

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID | 即 `conversionId`，返回给 Flutter |
| `userId` | string | deviceId 或登录用户 ID |
| `ip` | string | 客户端 IP |
| `conversionType` | string | `pdf_to_docx` / `docx_to_pdf` |
| `jobId` | string | CloudConvert Job ID |
| `status` | enum | pending / processing / completed / failed / timeout |
| `originalFileName` | string | 原始文件名 |
| `fileSize` | bigint | 文件大小（字节） |
| `downloadUrl` | string | 转换结果下载链接 |
| `creditsEstimate` | decimal | 估算消耗的 credits |
| `durationMs` | int | 耗时（毫秒） |
| `createdAt` | timestamp | 创建时间 |

---

## 八、环境变量

```env
# ===== CloudConvert =====
CLOUDCONVERT_API_KEY=your-api-key
CLOUDCONVERT_SANDBOX=true             # 开发用 sandbox，生产改为 false
CLOUDCONVERT_WEBHOOK_SECRET=          # 从 Dashboard Webhooks 页面获取

# ===== Redis =====
REDIS_URL=redis://localhost:6379      # 优先使用，或分开配置：
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=0

# ===== 限制配置 =====
CONVERSION_USER_DAILY_LIMIT=3         # 每用户每天最多 N 次
CONVERSION_IP_DAILY_LIMIT=10          # 每 IP 每天最多 N 次
CONVERSION_MAX_FILE_SIZE=10485760     # 最大文件（字节），默认 10MB
CONVERSION_MAX_PAGE_COUNT=20          # 最大页数（预留，暂不强制校验）

# ===== Webhook（生产必配）=====
# 设置后服务端使用 Webhook 模式，不设置则用 SDK long-polling 等待
CONVERSION_WEBHOOK_BASE_URL=https://api.yourdomain.com
```

---

## 九、成本控制层级

| 层级 | 措施 | 拦截时机 |
|------|------|---------|
| L1 | IP 每日 10 次 | Guard（请求进入时） |
| L2 | 用户每日 3 次 | Guard（请求进入时） |
| L3 | 文件 ≤ 10MB（Multer 硬限制） | Controller 层 |
| L4 | MIME 类型白名单 | Controller + Service 双重校验 |
| L5 | 30s 超时自动取消 Job | Service 层 |
| L6 | 记录每次 credits 估算 | 数据库日志 |

---

## 十、安全设计

| 项目 | 措施 |
|------|------|
| CloudConvert Key | 仅存服务端环境变量，前端不可见 |
| Webhook 签名 | SDK `webhooks.verify()` + HMAC-SHA256 |
| 文件类型 | Multer fileFilter + Service validateMimeType 双重校验 |
| 文件存储 | 使用 `memoryStorage`，不写磁盘 |
| 防时序攻击 | SDK 内置 `timingSafeEqual` |

---

## 十一、快速测试

```bash
# 1. 查询配额
curl "http://localhost:3000/api/conversion/quota?deviceId=my-device-001"

# 2. 上传 PDF 转换为 DOCX
curl -X POST http://localhost:3000/api/conversion/convert \
  -F "file=@test.pdf" \
  -F "type=pdf_to_docx" \
  -F "deviceId=my-device-001"

# 3. 查询转换状态（把上面返回的 conversionId 填入）
curl "http://localhost:3000/api/conversion/status?id=550e8400-xxxx"

# 4. 通过 URL 转换
curl -X POST http://localhost:3000/api/conversion/convert-url \
  -H "Content-Type: application/json" \
  -d '{"type":"pdf_to_docx","fileUrl":"https://example.com/test.pdf","deviceId":"my-device-001"}'
```


---

## 一、整体架构

```
Flutter App / Web
       ↓
NestJS API（核心控制层）
       ↓
┌──────────────────────────────────┐
│  ConversionController            │
│  ├─ 参数校验                     │
│  ├─ 限流检查（Guard）            │
│  └─ 调用 ConversionService       │
├──────────────────────────────────┤
│  ConversionService（业务编排）    │
│  ├─ MIME 校验                    │
│  ├─ 文件大小/页数限制            │
│  ├─ 消耗配额                     │
│  ├─ 上传到 S3（可选）            │
│  ├─ 调用 CloudConvert            │
│  ├─ 轮询 / Webhook 等待结果      │
│  └─ 记录日志                     │
├──────────────────────────────────┤
│  CloudConvertService（适配层）    │  ← 可替换为 ConvertAPI
│  ├─ 创建 Job                    │
│  ├─ 上传文件                     │
│  ├─ 轮询等待                     │
│  ├─ 解析 Webhook                 │
│  └─ 下载结果                     │
├──────────────────────────────────┤
│  ConversionRateLimitService      │
│  ├─ Redis 用户日限               │
│  ├─ Redis IP 限流                │
│  └─ 内存降级（Redis 不可用时）   │
└──────────────────────────────────┘
       ↓
CloudConvert API (外部)
```

**核心原则：前端永远不直接接触 CloudConvert**

---

## 二、模块目录结构

```
src/conversion/
├── conversion.module.ts          # 主模块（注册到 AppModule）
├── conversion.controller.ts      # API 路由
├── conversion.service.ts         # 核心业务逻辑
├── index.ts                      # 模块导出
│
├── cloudconvert/                 # 第三方适配层
│   ├── cloudconvert.module.ts    # Global 模块
│   ├── cloudconvert.service.ts   # CloudConvert API 封装
│   ├── cloudconvert.types.ts     # 类型定义
│   └── index.ts
│
├── rate-limit/                   # 限流模块
│   ├── rate-limit.module.ts      # Global 模块
│   ├── rate-limit.service.ts     # 限流逻辑（Redis-backed）
│   ├── rate-limit.guard.ts       # NestJS Guard
│   ├── rate-limit.types.ts       # 类型定义
│   ├── redis.service.ts          # Redis 客户端（带内存降级）
│   └── index.ts
│
├── dto/
│   └── conversion.dto.ts         # 请求/响应 DTO
│
└── entities/
    └── conversion-record.entity.ts  # TypeORM 实体（日志记录）
```

---

## 三、Redis 限流设计（详细）

### 3.1 Key 结构设计

```
┌────────────────────────────────────────────────────────┐
│  用户维度：                                              │
│  Key:  pdf_limit:user:{userId}:{YYYY-MM-DD}            │
│  Type: String (counter)                                │
│  TTL:  86400s (24小时)                                  │
│  说明: 每次转换 INCR +1                                 │
│  限制: 每天 3 次（可配）                                │
├────────────────────────────────────────────────────────┤
│  IP 维度：                                              │
│  Key:  pdf_limit:ip:{ip}:{YYYY-MM-DD}                  │
│  Type: String (counter)                                │
│  TTL:  86400s (24小时)                                  │
│  说明: 每次请求 INCR +1                                 │
│  限制: 每天 10 次（可配）                               │
└────────────────────────────────────────────────────────┘
```

### 3.2 限流检查流程

```
请求进入
    │
    ▼
┌──────────────┐     ┌───────────────────┐
│ IP 限流检查  │────→│ INCR pdf_limit:ip │
│              │     │ 超限? → 429 返回  │
└──────┬───────┘     └───────────────────┘
       │ 通过
       ▼
┌──────────────┐     ┌─────────────────────┐
│ 用户配额检查 │────→│ GET pdf_limit:user  │
│ (只读不消耗) │     │ >= 3? → 429 返回    │
└──────┬───────┘     └─────────────────────┘
       │ 通过
       ▼
    进入业务逻辑
       │
       ▼ (业务成功后)
┌──────────────┐     ┌──────────────────────┐
│ 消耗用户配额 │────→│ INCR pdf_limit:user  │
└──────────────┘     └──────────────────────┘
```

### 3.3 Redis 操作原子性

```redis
-- 限流计数（原子操作）
INCR pdf_limit:user:user123:2026-04-04
-- 如果是新 key (返回值 = 1)，设置 TTL
EXPIRE pdf_limit:user:user123:2026-04-04 86400

-- 查询当前使用量
GET pdf_limit:user:user123:2026-04-04

-- 查询剩余时间
TTL pdf_limit:user:user123:2026-04-04
```

### 3.4 超限响应格式

```json
// HTTP 429 Too Many Requests
{
  "code": "LIMIT_EXCEEDED",
  "message": "今日免费次数已用完",
  "remaining": 0,
  "dailyLimit": 3,
  "dailyUsed": 3
}

// IP 限流
{
  "code": "IP_LIMIT_EXCEEDED",
  "message": "请求过于频繁，请稍后再试",
  "remaining": 0,
  "resetIn": 43200
}
```

### 3.5 降级策略

当 Redis 不可用时，自动降级到内存 Map：
- `RedisService` 内置 `fallbackStore: Map<string, { value, expireAt }>`
- 启动时尝试连接 Redis，失败则 warn 并使用内存
- 单实例部署可接受；集群部署必须使用 Redis

### 3.6 环境变量配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `REDIS_URL` | - | Redis 连接 URL（优先级最高） |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | - | Redis 密码 |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `CONVERSION_USER_DAILY_LIMIT` | `3` | 用户每日转换次数 |
| `CONVERSION_IP_DAILY_LIMIT` | `10` | IP 每日转换次数 |
| `CONVERSION_MAX_FILE_SIZE` | `10485760` | 最大文件大小（字节，10MB） |
| `CONVERSION_MAX_PAGE_COUNT` | `20` | 最大页数 |

---

## 四、CloudConvert Webhook 实现方案

### 4.1 两种等待模式

| 模式 | 场景 | 原理 | 延迟 |
|------|------|------|------|
| **轮询** | MVP / 开发 | 每 2s GET /jobs/{id} | 2-30s |
| **Webhook** | 生产环境 | CloudConvert POST 回调 | 实时 |

### 4.2 轮询模式（默认）

当 `CONVERSION_WEBHOOK_BASE_URL` 未配置时自动启用：

```
1. 创建 Job → 获取 jobId
2. 循环: GET /v2/jobs/{jobId}
   ├─ status = finished → 返回下载链接
   ├─ status = error → 返回错误
   └─ 超过 30s → 超时退出
3. 每次间隔 2 秒
```

### 4.3 Webhook 模式（生产推荐）

#### 配置步骤

1. **设置环境变量**
   ```env
   CONVERSION_WEBHOOK_BASE_URL=https://api.yourdomain.com
   CLOUDCONVERT_WEBHOOK_SECRET=your-webhook-signing-secret
   ```

2. **CloudConvert 后台配置**
   - 进入 Dashboard → Webhooks
   - 添加 Webhook URL: `https://api.yourdomain.com/api/conversion/webhook`
   - 选择事件: `job.finished`, `job.failed`
   - 记录 Signing Secret

#### Webhook 流程

```
CloudConvert
     │
     │ POST /api/conversion/webhook
     │ Header: cloudconvert-signature: {hmac_sha256}
     │ Body: { event, job: { id, tag, status, tasks } }
     │
     ▼
┌──────────────────────────────────────┐
│  ConversionController.handleWebhook  │
│  1. 提取 raw body + signature       │
│  2. 调用 service.handleWebhook()    │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  ConversionService.handleWebhook     │
│  1. 验证 HMAC-SHA256 签名           │
│  2. 解析 job result                  │
│  3. 通过 tag 找到 ConversionRecord   │
│  4. 更新状态 + downloadUrl           │
└──────────────────────────────────────┘
```

#### 签名验证

```typescript
// HMAC-SHA256 签名验证
const expected = crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex');

// 防时序攻击
crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(signature)
);
```

#### Webhook Payload 示例

```json
{
  "event": "job.finished",
  "job": {
    "id": "c6a1a4a4-e0ff-46b0-a914-xxxxxxxxxxxx",
    "tag": "conversion-record-uuid",
    "status": "finished",
    "tasks": [
      {
        "id": "task-1",
        "name": "import-file",
        "operation": "import/url",
        "status": "finished"
      },
      {
        "id": "task-2",
        "name": "convert-file",
        "operation": "convert",
        "status": "finished"
      },
      {
        "id": "task-3",
        "name": "export-file",
        "operation": "export/url",
        "status": "finished",
        "result": {
          "files": [
            {
              "filename": "output.docx",
              "url": "https://storage.cloudconvert.com/...",
              "size": 123456
            }
          ]
        }
      }
    ]
  }
}
```

### 4.4 Tag 机制

- 创建 Job 时传入 `tag = conversionRecord.id`（UUID）
- Webhook 回调时通过 `job.tag` 找到对应的数据库记录
- 这样无需额外映射表

---

## 五、API 接口文档

### 5.1 上传文件转换

```
POST /api/conversion/convert
Content-Type: multipart/form-data
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | PDF 或 DOCX 文件 |
| `type` | string | ✅ | `pdf_to_docx` 或 `docx_to_pdf` |
| `deviceId` | string | ❌ | 设备标识（未登录用户） |

**响应：**
```json
{
  "code": 200,
  "data": {
    "conversionId": "uuid",
    "status": "completed",
    "downloadUrl": "https://...",
    "remainingQuota": 2
  },
  "message": "操作成功",
  "success": true
}
```

### 5.2 通过 URL 转换

```
POST /api/conversion/convert-url
Content-Type: application/json
```

```json
{
  "type": "pdf_to_docx",
  "fileUrl": "https://example.com/file.pdf",
  "deviceId": "device-xxx"
}
```

### 5.3 查询转换状态

```
GET /api/conversion/status?id={conversionId}
```

### 5.4 查询用户配额

```
GET /api/conversion/quota?deviceId={deviceId}
```

**响应：**
```json
{
  "code": 200,
  "data": {
    "dailyUsed": 1,
    "dailyLimit": 3,
    "remaining": 2
  },
  "success": true
}
```

### 5.5 Webhook 回调（内部）

```
POST /api/conversion/webhook
Header: cloudconvert-signature: {signature}
```

---

## 六、数据库设计

### conversion_records 表

```sql
CREATE TABLE conversion_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       VARCHAR(255) NOT NULL,
  ip            VARCHAR(64),
  conversion_type VARCHAR(32) NOT NULL,   -- pdf_to_docx / docx_to_pdf
  job_id        VARCHAR(255),              -- CloudConvert Job ID
  status        VARCHAR(32) DEFAULT 'pending',
  original_file_name VARCHAR(512),
  file_size     BIGINT,
  source_url    VARCHAR(2048),
  download_url  VARCHAR(2048),
  error_message TEXT,
  credits_estimate DECIMAL(10,4) DEFAULT 0,
  duration_ms   INT,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_conversion_user_date ON conversion_records(user_id, created_at);
CREATE INDEX idx_conversion_job ON conversion_records(job_id);
```

---

## 七、环境变量完整清单

```env
# ===== Redis =====
REDIS_URL=redis://localhost:6379
# 或分开配置：
# REDIS_HOST=127.0.0.1
# REDIS_PORT=6379
# REDIS_PASSWORD=
# REDIS_DB=0

# ===== CloudConvert =====
CLOUDCONVERT_API_KEY=your-api-key
CLOUDCONVERT_SANDBOX=true          # 开发环境用 sandbox
CLOUDCONVERT_WEBHOOK_SECRET=       # Webhook 签名密钥

# ===== 转换限制 =====
CONVERSION_USER_DAILY_LIMIT=3      # 每用户每天 3 次
CONVERSION_IP_DAILY_LIMIT=10       # 每 IP 每天 10 次
CONVERSION_MAX_FILE_SIZE=10485760  # 10MB
CONVERSION_MAX_PAGE_COUNT=20       # 最多 20 页

# ===== Webhook（生产环境配置） =====
CONVERSION_WEBHOOK_BASE_URL=https://api.yourdomain.com
```

---

## 八、成本控制策略

### 8.1 多层防护

| 层级 | 措施 | 说明 |
|------|------|------|
| **L1** | IP 限流 | 防刷接口 |
| **L2** | 用户日限 | 控制单用户成本 |
| **L3** | 文件限制 | 大小 10MB / 页数 20页 |
| **L4** | 超时终止 | 30s 自动失败 |
| **L5** | 日志审计 | 记录每次消耗 |

### 8.2 日志记录字段

每次转换记录：
- `userId` - 用户标识
- `fileSize` - 文件大小
- `creditsEstimate` - 估算消耗
- `durationMs` - 耗时
- `status` - 成功/失败
- `conversionType` - 转换类型

### 8.3 未来扩展接口

```typescript
// 已在 ConversionRateLimitService 预留
checkUserQuota(userId: string): Promise<QuotaCheckResult>
consumeUserQuota(userId: string): Promise<RateLimitResult>

// 后续可对接：
// - 积分系统：检查积分余额 → 扣除积分
// - 订阅系统：检查订阅等级 → 调整限额
// - VIP 用户：动态调整 userDailyLimit
```

### 8.4 多供应商策略（预留）

CloudConvertService 作为 Global Provider：
- 当前使用 CloudConvert
- 后续可创建 `ConvertApiService` 实现相同接口
- 在 `ConversionService` 中按策略切换：

```typescript
// 未来实现
if (fileSizeMB < 2 && format === 'pdf_to_docx') {
  return this.convertApi.convert(file); // 更便宜
} else {
  return this.cloudConvert.convert(file); // 更稳定
}
```

---

## 九、安全设计

| 项目 | 措施 |
|------|------|
| 文件类型 | 只允许 `application/pdf` + `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| MIME 校验 | Controller 层 fileFilter + Service 层双重校验 |
| 文件大小 | Multer 10MB 硬限制 + Service 层可配限制 |
| Webhook 验证 | HMAC-SHA256 签名 + `timingSafeEqual` 防时序攻击 |
| 临时文件 | 使用 `memoryStorage`，不写磁盘 |
| API Key 隐藏 | CloudConvert Key 仅存在服务端环境变量 |

---

## 十、快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置环境变量

复制以下到 `.env`：

```env
# 必须
CLOUDCONVERT_API_KEY=your-sandbox-key
CLOUDCONVERT_SANDBOX=true

# Redis（可选，不配则用内存降级）
REDIS_URL=redis://localhost:6379
```

### 3. 数据库迁移

如果 `DB_SYNCHRONIZE=true`（开发环境），TypeORM 会自动创建表。

生产环境需手动迁移：
```bash
npx typeorm migration:generate -d src/core/database/data-source.ts src/migrations/AddConversionRecords
npx typeorm migration:run -d src/core/database/data-source.ts
```

### 4. 启动服务

```bash
pnpm run start:dev
```

### 5. 测试接口

```bash
# 查询配额
curl http://localhost:3000/api/conversion/quota?deviceId=test-device

# 上传文件转换
curl -X POST http://localhost:3000/api/conversion/convert \
  -F "file=@test.pdf" \
  -F "type=pdf_to_docx" \
  -F "deviceId=test-device"

# 查询状态
curl http://localhost:3000/api/conversion/status?id={conversionId}
```

---

## 十一、核心设计原则总结

1. **CloudConvert 必须封装** — 不散落在业务代码
2. **限流必须在最前面** — Guard 层拦截，不先调 API 再判断
3. **所有操作必须可中断** — 30s 超时，防长任务拖垮
4. **一切围绕成本可控** — 这不是"PDF转换功能"，而是"可控成本的转换系统"
5. **Redis 可降级** — 内存兜底，不因 Redis 挂掉影响可用性
6. **适配层可替换** — CloudConvert 是 Provider，后续可换 ConvertAPI
