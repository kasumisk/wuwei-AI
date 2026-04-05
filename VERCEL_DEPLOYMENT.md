# Vercel 部署指南

本项目包含两个前端应用，分别部署到 Vercel：

## 1. Web 应用（Next.js）

### 配置文件
- **配置**: `vercel.json`
- **项目路径**: `apps/web`
- **框架**: Next.js 16

### Vercel 项目设置
1. 在 Vercel Dashboard 创建新项目
2. 连接到你的 Git 仓库
3. **Root Directory**: 保持为 `.`（根目录）
4. **Framework Preset**: 选择 `Other`（因为我们自定义了构建命令）
5. **Build and Output Settings**:
   - 勾选 "Override" 
   - **Build Command**: `cd apps/web && pnpm build`
   - **Output Directory**: `apps/web/.next`
   - **Install Command**: `pnpm install`

### 环境变量
在 Vercel 项目设置中添加：
```
NEXT_PUBLIC_API_URL=你的API地址
NEXT_TELEMETRY_DISABLED=1
```

---

## 2. Admin 应用（Vite + React）

### 配置文件
- **配置**: `vercel.admin.json`
- **项目路径**: `apps/admin`
- **框架**: Vite + React 19

### Vercel 项目设置
1. 在 Vercel Dashboard 创建新项目（或添加为第二个项目）
2. 连接到同一个 Git 仓库
3. **Root Directory**: 保持为 `.`（根目录）
4. **Framework Preset**: 选择 `Other`
5. **Build and Output Settings**:
   - 勾选 "Override"
   - **Build Command**: `pnpm install && pnpm turbo build --filter=@ai-platform/admin`
   - **Output Directory**: `apps/admin/dist`
   - **Install Command**: 留空（已包含在 buildCommand 中）

### 环境变量
在 Vercel 项目设置中添加：
```
VITE_API_URL=你的API地址
```

---

## 部署方式

### 方式一：使用 Vercel CLI（推荐）

#### 部署 Web 应用
```bash
# 在项目根目录
vercel --prod
```

#### 部署 Admin 应用
```bash
# 在项目根目录，使用 admin 配置
vercel --prod --local-config=vercel.admin.json
```

### 方式二：通过 Git 推送自动部署

1. 推送代码到 main/master 分支会自动触发生产环境部署
2. 推送到其他分支会创建预览部署

---

## 常见问题排查

### 问题 1: "No package found" 错误
**原因**: 包名不匹配  
**解决**: 确保 `vercel.json` 和 `vercel.admin.json` 中的 `--filter` 参数使用正确的包名：
- Web: `@ai-platform/web` 
- Admin: `@ai-platform/admin`

### 问题 2: "Cannot find module" 错误
**原因**: 依赖包未构建  
**解决**: 
- Admin 使用 `pnpm turbo build` 会自动构建依赖包（`@ai-platform/constants` 和 `@ai-platform/shared`）
- Web 直接使用源码（bundler mode），不需要预构建

### 问题 3: TypeScript 编译错误
**原因**: 缺少 `tsconfig.base.json`  
**解决**: 已创建根目录的 `tsconfig.base.json`，packages 会继承它

### 问题 4: "Multiple lockfiles" 警告
**原因**: `apps/web/pnpm-lock.yaml` 是旧的  
**解决**: 
- 已在 `next.config.ts` 中指定 `turbopack.root: '../../'`
- 可以删除 `apps/web/pnpm-lock.yaml`（可选）

---

## 项目结构

```
new-platform/
├── vercel.json              # Web 项目配置
├── vercel.admin.json        # Admin 项目配置
├── tsconfig.base.json       # TypeScript 基础配置
├── turbo.json              # Turborepo 配置
├── pnpm-workspace.yaml     # pnpm workspace 配置
├── apps/
│   ├── web/                # Next.js 应用
│   │   ├── .next/          # 构建输出（Vercel 使用）
│   │   └── next.config.ts
│   └── admin/              # Vite + React 应用
│       └── dist/           # 构建输出（Vercel 使用）
└── packages/
    ├── constants/          # 共享常量（需构建）
    ├── shared/             # 共享工具（需构建）
    ├── types/
    └── utils/
```

---

## 构建验证

### 本地验证 Admin 构建
```bash
pnpm install
pnpm turbo build --filter=@ai-platform/admin
# 检查 apps/admin/dist 目录
```

### 本地验证 Web 构建
```bash
cd apps/web
pnpm build
# 检查 apps/web/.next 目录
```

---

## 性能优化建议

### Admin 应用
当前单个 JS bundle 为 3.7MB，建议：

```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-antd': ['antd', '@ant-design/pro-components'],
          'vendor-charts': ['recharts'],
        }
      }
    }
  }
})
```

### Web 应用
已经是 Next.js 自动优化的代码分割。

---

## 部署检查清单

- [ ] 确认两个 Vercel 项目都已创建
- [ ] 环境变量已设置
- [ ] Build Command 和 Output Directory 正确配置
- [ ] 本地构建测试通过
- [ ] Git 推送触发自动部署
- [ ] 生产环境访问正常
