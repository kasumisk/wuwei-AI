# uWay 小程序 (miniapp)

> Taro 4 + React + TypeScript + Zustand + TanStack React Query + UnoCSS + NutUI

## 技术栈

| 类别 | 方案 | 版本 |
|------|------|------|
| 框架 | Taro 4 (Vite) | 4.1.11 |
| UI | React | ^18.0.0 |
| 组件库 | NutUI React Taro | ^2.6.14 |
| 状态管理 | Zustand | latest |
| 服务端状态 | TanStack React Query | latest |
| 原子化样式 | UnoCSS (preset-wind3) | latest |
| 请求层 | Taro.request 封装 | — |
| API 后端 | https://uway-api.dev-net.uk | NestJS |

## 目录结构

```
apps/miniapp/
├── config/                  # Taro 构建配置
│   ├── index.ts             # 主配置（Vite、UnoCSS、NutUI、alias）
│   ├── dev.ts               # 开发环境
│   └── prod.ts              # 生产环境
├── src/
│   ├── app.ts               # 入口（QueryClientProvider + 登录态恢复）
│   ├── app.config.ts        # 小程序路由页面注册
│   ├── app.scss             # 全局样式
│   ├── pages/
│   │   ├── index/           # 首页（需登录）
│   │   └── login/           # 登录页（微信一键 / 手机号）
│   ├── services/
│   │   ├── request.ts       # Taro.request 统一封装（自动 token、错误处理）
│   │   ├── auth.ts          # 认证 API（微信小程序登录、手机号登录等）
│   │   └── queryClient.ts   # React Query 实例
│   ├── store/
│   │   └── auth.ts          # Zustand 登录状态（wxLogin、phoneLogin、logout）
│   ├── types/
│   │   └── api.ts           # API 类型定义
│   └── utils/
│       └── storage.ts       # Taro Storage 封装（token、user 缓存）
├── types/
│   └── uno.d.ts             # UnoCSS virtual 模块类型声明
├── uno.config.ts            # UnoCSS 配置（rem→px、选择器转义）
├── tsconfig.json            # TypeScript 配置（@/ alias）
├── project.config.json      # 微信小程序项目配置
└── package.json
```

## 快速启动

### 前置条件

- Node.js >= 18
- pnpm >= 8
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)

### 1. 安装依赖

```bash
# 在项目根目录执行（monorepo 统一管理）
cd /path/to/wuwei-AI
pnpm install
```

### 2. 开发模式（热更新）

```bash
cd apps/miniapp

# 微信小程序
pnpm dev:weapp

# H5
pnpm dev:h5
```

### 3. 微信开发者工具导入

1. 打开微信开发者工具
2. 选择「导入项目」
3. 项目目录选择 `apps/miniapp/dist`（**注意是 dist 目录**）
4. AppID 填写你的小程序 AppID（或使用测试号）
5. 点击导入即可预览

### 4. 生产构建

```bash
pnpm build:weapp
```

构建产物在 `dist/` 目录，可直接上传到微信公众平台。

## 环境配置

### 后端 API

请求层默认指向 `https://uway-api.dev-net.uk/api`。

如需修改，编辑 [src/services/request.ts](src/services/request.ts) 中的 `BASE_URL`。

### 微信小程序 AppID

编辑 [project.config.json](project.config.json) 中的 `appid` 字段：

```json
{
  "appid": "你的小程序AppID"
}
```

### 后端环境变量（小程序登录）

后端需要配置以下环境变量：

```env
WECHAT_MINI_APPID=你的小程序AppID
WECHAT_MINI_SECRET=你的小程序AppSecret
```

## 架构说明

### 请求层 (`services/request.ts`)

基于 `Taro.request` 封装，特性：
- 自动注入 `Authorization: Bearer <token>`
- 统一错误处理 & Toast 提示
- 401 自动清除登录态并跳转登录页
- 支持 `noAuth` 选项跳过 token 注入

```typescript
import { get, post } from '@/services/request'

// 需要登录的接口
const user = await get<UserInfo>('/app/auth/profile')

// 无需登录的接口
const res = await post('/app/auth/phone/send-code', { phone }, { noAuth: true })
```

### 状态管理 (`store/auth.ts`)

Zustand store，管理登录态：

```typescript
const { isLoggedIn, user, wxLogin, phoneLogin, logout } = useAuthStore()

// 微信一键登录
await wxLogin()    // Taro.login() → API → 存 token

// 手机号登录
await phoneLogin('13800138000', '888888')

// 退出
logout()
```

### React Query (`services/queryClient.ts`)

全局 QueryClient 已在 `app.ts` 中通过 `QueryClientProvider` 注入：

```typescript
import { useQuery } from '@tanstack/react-query'
import { getProfile } from '@/services/auth'

function MyComponent() {
  const { data: user } = useQuery({
    queryKey: ['profile'],
    queryFn: getProfile,
  })
}
```

### UnoCSS

已集成 `preset-wind3`（Tailwind CSS 兼容），支持在小程序中使用原子化 class：

- rem 自动转为 px，由 Taro pxtransform 统一处理
- 小程序不支持的特殊字符自动转义（`:`→`-cl-`、`[`→`-bl-` 等）

```tsx
<View className="flex items-center justify-center p-4 text-sm text-gray-600">
  Hello UnoCSS
</View>
```

## 登录流程

```
┌─────────────────────────────────────────────────┐
│                小程序启动                         │
│                   │                              │
│     app.ts: restore() 从 Storage 恢复 token      │
│                   │                              │
│         ┌─── 有 token ───┐                       │
│         │                │                       │
│     首页 index       无 token                     │
│     (显示内容)       redirectTo → /pages/login    │
│                          │                       │
│              ┌─── 选择登录方式 ───┐               │
│              │                   │               │
│       微信一键登录          手机号+验证码          │
│       Taro.login()         发送验证码             │
│           │                   │                  │
│     POST /wechat/mini-login  POST /phone/verify  │
│           │                   │                  │
│           └──── 返回 token + user ────┘           │
│                       │                          │
│         Taro.setStorageSync 存储                  │
│         Zustand 更新状态                          │
│         switchTab → /pages/index                 │
└─────────────────────────────────────────────────┘
```

### 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/app/auth/wechat/mini-login` | 小程序 wx.login code 换 token |
| POST | `/api/app/auth/phone/send-code` | 发送手机验证码 |
| POST | `/api/app/auth/phone/verify` | 手机号 + 验证码登录 |
| GET  | `/api/app/auth/profile` | 获取当前用户信息（需 token） |
| PUT  | `/api/app/auth/profile` | 更新用户资料（需 token） |
| POST | `/api/app/auth/refresh` | 刷新 token |

## 常用命令

```bash
# 微信小程序开发
pnpm dev:weapp

# 微信小程序构建
pnpm build:weapp

# H5 开发
pnpm dev:h5

# H5 构建
pnpm build:h5

# 支付宝小程序
pnpm dev:alipay / pnpm build:alipay

# 抖音小程序
pnpm dev:tt / pnpm build:tt
```

## 新增页面

1. 在 `src/pages/` 下创建页面目录和文件
2. 在 `src/app.config.ts` 的 `pages` 数组中注册路径
3. 使用 `Taro.navigateTo` / `Taro.redirectTo` / `Taro.switchTab` 进行跳转

```typescript
// app.config.ts
export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/login/index',
    'pages/my-new-page/index',  // 新增
  ],
})
```

## 注意事项

1. **路径别名**：使用 `@/` 指向 `src/`，已在 `tsconfig.json` 和 `config/index.ts` 中配置
2. **NutUI 按需引入**：通过 `vite-plugin-imp` 自动处理，直接 import 即可
3. **pxtransform**：NutUI 组件的选择器已加入黑名单 `selectorBlackList: ['nut-']`
4. **UnoCSS 选择器转义**：在 `uno.config.ts` 中处理小程序不支持的字符
5. **不要用 Axios**：小程序不支持 XMLHttpRequest，请使用封装好的 `@/services/request`
