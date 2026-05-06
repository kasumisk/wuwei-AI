# Firebase Email Link Mail Service Plan

## Goal

将当前依赖 Firebase Authentication 内建发信的 Email Link 登录流程，调整为：

1. 客户端输入邮箱
2. NestJS 后端使用 Firebase Admin SDK 生成 `signInWithEmailLink`
3. 后端通过第三方邮件服务发送登录邮件
4. 用户点击邮件链接
5. Web / Flutter 客户端使用 Firebase Client SDK 完成 `signInWithEmailLink`
6. 客户端再调用业务后端 `/api/app/auth/firebase/login` 换业务 token

这样做的目的：

- 避免 Firebase 内建邮件额度和频控限制影响登录体验
- 自定义发件域名、模板、品牌文案
- 将发信频控、日志、风控能力放到业务后端控制

## Current Issues

当前链路存在这些问题：

- Flutter 直接调用 `FirebaseAuth.sendSignInLinkToEmail()`，容易触发 Firebase 发信限额
- 邮件能力完全依赖 Firebase 内建模板和配额
- 发信域名、模板、限流、审计日志不可控
- 后端目前只负责 Firebase token 换业务 token，不负责 Email Link 的生成和发信

## Target Flow

```text
Flutter / Web 输入邮箱
→ POST /api/app/auth/email/send-link
→ NestJS 用 Firebase Admin 生成 sign-in link
→ NestJS 用 Resend / Postmark 发邮件
→ 用户点击邮件中的 link
→ 跳转到 auth callback 页面
→ App / Web 收到 deep link
→ Firebase Client SDK 调用 signInWithEmailLink(email, link)
→ Firebase 登录成功
→ 客户端调用 /api/app/auth/firebase/login
→ 后端验证 Firebase ID token，换业务 JWT
```

## Firebase Console Requirements

### 1. Enable Email Link Sign-In

路径：

```text
Firebase Console
→ Authentication
→ Sign-in method
→ Email/Password
→ 开启 Email link / passwordless sign-in
```

注意：

- 即使改成后端自己发邮件，Firebase 仍然必须开启 Email Link 登录能力
- Firebase Admin 生成的链接最终仍由 Firebase Client SDK 完成登录

### 2. Authorized Domains

路径：

```text
Authentication
→ Settings
→ Authorized domains
```

建议至少包含：

- `eatcheck.app`
- `app.eatcheck.app`
- `auth.eatcheck.app`
- `eatcheck-fefee.firebaseapp.com`
- `eatcheck-fefee.web.app`

如果 Flutter / Web callback 仍落在 Firebase Hosting 域名上，也要保留 `firebaseapp.com` / `web.app`。

## Recommended Domain Structure

建议最终统一为：

- App 页面域名：`https://app.eatcheck.app`
- Auth 回调域名：`https://auth.eatcheck.app`
- API：`https://api.eatcheck.app`
- 发件人：`EatCheck <noreply@eatcheck.app>`

### Recommended Callback URL

建议将 Email Link 的 continue URL 固定为：

```text
https://auth.eatcheck.app/auth/callback
```

原因：

- 独立 auth 域名便于邮件登录、密码重置、邀请链接统一承载
- 后续更容易配置 Universal Link / App Link 和 Web fallback
- 避免把登录回调与官网、主应用页面混在一起

## Backend Responsibilities

NestJS 后端新增职责：

1. 校验邮箱格式
2. 执行频控
3. 调用 Firebase Admin SDK 生成 email sign-in link
4. 调用第三方邮件服务发送邮件
5. 记录发送日志

后端不负责：

- 直接完成 Firebase 登录
- 替代客户端执行 `signInWithEmailLink`

客户端仍必须使用 Firebase Client SDK 完成登录闭环。

## Recommended Provider

优先级建议：

1. `Resend`
2. `Postmark`
3. `SendGrid`

理由：

- Resend 集成简单，适合登录邮件
- Postmark 到达率稳定，事务邮件体验更好
- SendGrid 功能全，但配置相对更重

## Backend Environment Variables

建议后端增加以下环境变量：

```env
FIREBASE_PROJECT_ID=eatcheck-fefee
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@eatcheck-fefee.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nxxx\n-----END PRIVATE KEY-----\n"

AUTH_EMAIL_PROVIDER=resend
AUTH_EMAIL_FROM="EatCheck <noreply@eatcheck.app>"
AUTH_CALLBACK_URL=https://auth.eatcheck.app/auth/callback

RESEND_API_KEY=re_xxx
```

说明：

- `FIREBASE_PRIVATE_KEY` 必须保留 `\n`
- 如果继续沿用现有 `procify-toolkit-firebase.json` 文件加载方式，也可以不拆成三段 env
- 但生产环境建议统一改为 env 注入，避免本地文件依赖

## Suggested NestJS Modules

建议新增或拆分以下组件：

- `AuthEmailService`
- `AuthEmailController`
- `MailService` 或 `TransactionalMailService`
- `EmailRateLimitService`（可选，先做简单 Redis 限流也可以）

### Suggested API

```http
POST /api/app/auth/email/send-link
Content-Type: application/json

{
  "email": "user@example.com"
}
```

建议返回：

```json
{
  "success": true,
  "code": 200,
  "message": "Login link sent",
  "data": null
}
```

## Suggested Backend Implementation

### 1. Generate Sign-In Link

使用 Firebase Admin SDK：

```ts
await admin.auth().generateSignInWithEmailLink(email, {
  url: process.env.AUTH_CALLBACK_URL!,
  handleCodeInApp: true,
  iOS: {
    bundleId: 'com.shouldieat.app',
  },
  android: {
    packageName: 'com.shouldieat.app',
    installApp: true,
    minimumVersion: '12',
  },
});
```

### 2. Send Mail via Provider

以 Resend 为例：

```ts
await resend.emails.send({
  from: process.env.AUTH_EMAIL_FROM!,
  to: email,
  subject: 'Sign in to EatCheck',
  html: '...',
  text: '...',
});
```

### 3. Email Template Requirements

邮件内容建议包含：

- 品牌标题 `Sign in to EatCheck`
- 明确 CTA 按钮
- 明确安全说明
- 纯文本 fallback

不要只发裸链接。

## Flutter Changes

Flutter 端建议从：

```text
FirebaseAuth.sendSignInLinkToEmail()
```

改为：

```text
调用业务后端 /api/app/auth/email/send-link
```

### Current State

当前 Flutter 已经具备：

- Deep link callback 页面跳回 App
- `FirebaseAuth.signInWithEmailLink()`
- Firebase ID token 换业务 token

因此 Flutter 只需要改“发邮件”这一步，不需要推翻后半段链路。

### New Flutter Flow

```text
用户输入邮箱
→ localStorage / StorageService 保存 pending email
→ 调用后端 /api/app/auth/email/send-link
→ 用户点击邮件
→ App 收到回调链接
→ 调用 FirebaseAuth.signInWithEmailLink(email, link)
→ 再调用 /api/app/auth/firebase/login
```

## Web Callback / Hosting

当前已经有 Firebase Hosting callback 页面，可以继续使用，职责保持不变：

1. 接收 Firebase email link
2. 自动跳转到 App scheme，例如 `eatcheck:///auth/callback?...`
3. App 内完成 `signInWithEmailLink`

后续如果上 `auth.eatcheck.app`，该 callback 页面应迁移到该域名。

## Rate Limiting Requirements

上线前至少做以下限流：

### Per Email

- 同邮箱 60 秒内最多发 1 次
- 同邮箱每天最多 5 到 10 次

### Per IP

- 同 IP 每小时最多 5 到 10 次

### Optional Bot Protection

- Cloudflare Turnstile
- reCAPTCHA

### Storage

建议用 Redis 记录：

- `auth_email_send:cooldown:{email}`
- `auth_email_send:daily:{email}:{yyyy-mm-dd}`
- `auth_email_send:ip:{ip}:{hour}`

## Logging and Audit

建议记录以下字段：

- email
- IP
- userAgent
- provider（resend/postmark）
- result（success/failed）
- provider message id
- failure reason
- timestamp

可先写普通应用日志，后续再落库。

## Security Notes

### 1. Never Expose Admin Credentials to Client

Firebase Admin 只能在服务端使用。

### 2. Do Not Trust Email Link Alone for Business Session

业务登录态仍应通过：

```text
Firebase Client SDK signInWithEmailLink
→ getIdToken()
→ POST /api/app/auth/firebase/login
```

### 3. Cross-Device Handling

如果用户在另一台设备点开邮件：

- App 本地没有 pending email
- 需要提示用户重新输入邮箱

这部分 Flutter 当前已经做了基础处理。

## Migration Plan

### Phase 1

后端增加新接口：

- `POST /api/app/auth/email/send-link`

Flutter 改为调用后端发送邮件。

### Phase 2

保留旧 Firebase 客户端直接发信逻辑一小段时间，仅用于开发回退。

### Phase 3

移除客户端直接调用：

- `FirebaseAuth.sendSignInLinkToEmail()`

只保留：

- `signInWithEmailLink()`
- `getIdToken()`
- `firebase/login`

## Acceptance Criteria

以下条件全部满足才算完成：

1. 客户端不再直接调用 Firebase 发信 API
2. 后端成功生成 email sign-in link
3. 第三方邮件服务成功发信
4. 邮件点击后能成功拉起 App
5. Flutter 成功执行 `signInWithEmailLink`
6. 客户端成功调用 `/api/app/auth/firebase/login`
7. 后端成功换发业务 token
8. 同邮箱频繁请求时会被限流

## Implementation Recommendations For This Repo

基于当前仓库，建议最小改造路径：

1. 在 `apps/api-server/src/modules/auth/app/dto/auth.dto.ts`
   新增 `SendEmailLinkDto`
2. 在 `AppAuthController` 增加：
   - `POST /app/auth/email/send-link`
3. 在 `AppAuthService` 增加：
   - `sendEmailSignInLink(email: string)`
4. 新增邮件服务实现，例如：
   - `apps/api-server/src/modules/auth/app/auth-mail.service.ts`
5. 在 Flutter 登录页 `_sendMagicLink()` 中：
   - 保留 `StorageService.savePendingEmail(email)`
   - 改为请求后端接口
   - 删除客户端直接 `sendSignInLinkToEmail()`

## Open Questions

实施前还需要确认：

1. 邮件服务选 `Resend`、`Postmark` 还是其他供应商
2. 正式回调域名是否确定为 `auth.eatcheck.app`
3. 发件域名 `noreply@eatcheck.app` 的 SPF / DKIM / DMARC 是否由谁负责配置
4. 是否需要后台查看发信日志和失败原因

## Final Recommendation

最终推荐方案：

- Firebase 只负责身份体系和 email link 签发能力
- NestJS 负责生成 link、风控、发信、日志
- 第三方邮件服务负责可靠投递
- Flutter / Web 继续负责 `signInWithEmailLink` 和业务 token exchange

这是当前项目最稳妥、改动最小、可运维性最高的实现方案。
