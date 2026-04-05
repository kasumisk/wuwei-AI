# 部署问题修复指南

## 问题描述
运行 `pnpm deploy:web` 时出现 "Missing files" 错误。

## 原因分析
1. `.vercel-web` 和 `.vercel-admin` 配置目录被删除或损坏
2. Vercel CLI 缓存与项目文件哈希不匹配
3. 修改了 monorepo 结构后，旧的配置不再有效

## 解决方案

### 步骤 1: 重新初始化 Vercel 项目链接

运行设置脚本重新创建配置：

```bash
./scripts/setup-vercel.sh
```

这个脚本会：
1. 提示你链接 Web 项目（选择 `new-platform`）
2. 将配置保存到 `.vercel-web/`
3. 提示你链接 Admin 项目（选择 `new-platform-admin`）
4. 将配置保存到 `.vercel-admin/`

### 步骤 2: 测试部署

```bash
# 部署 Web 项目
pnpm deploy:web

# 或部署 Admin 项目
pnpm deploy:admin
```

## 手动修复方法（如果脚本失败）

### 方式一：分别链接两个项目

```bash
cd /path/to/new-platform

# 1. 链接 Web 项目
rm -rf .vercel
vercel link
# 选择 kasumisk's projects -> new-platform

# 保存配置
mv .vercel .vercel-web

# 2. 链接 Admin 项目
vercel link
# 选择 kasumisk's projects -> new-platform-admin

# 保存配置
mv .vercel .vercel-admin
```

### 方式二：直接部署不使用脚本

如果你只想部署 Web 项目而不用脚本：

```bash
cd /path/to/new-platform

# 链接项目
vercel link

# 生产部署
vercel --prod --force

# 预览部署
vercel --force
```

## 部署配置说明

### Web 项目 (vercel.json)
- **构建命令**: `cd apps/web && pnpm build`
- **输出目录**: `apps/web/.next`
- **安装命令**: `pnpm install --no-frozen-lockfile`

### Admin 项目 (vercel.admin.json)
- **构建命令**: `pnpm install --no-frozen-lockfile && pnpm turbo build --filter=@ai-platform/admin`
- **输出目录**: `apps/admin/dist`
- **路由重写**: SPA 模式，所有请求重定向到 `/index.html`

## 常见问题

### Q: 为什么添加了 `--force` 参数？
A: `--force` 强制跳过构建缓存，避免 "Missing files" 错误。

### Q: 为什么使用 `--no-frozen-lockfile`？
A: Vercel 环境可能与本地环境不完全一致，允许更新 lockfile 可以避免依赖安装失败。

### Q: 部署时提示选择错误的项目怎么办？
A: 删除对应的配置目录（`.vercel-web` 或 `.vercel-admin`）然后重新运行 `./scripts/setup-vercel.sh`。

### Q: 如何查看当前的项目链接状态？
A: 运行 `pnpm deploy:status` 查看配置。

## 验证部署

部署成功后，访问：
- **Web**: https://new-platform.vercel.app
- **Admin**: https://new-platform-admin.vercel.app

## 快速命令参考

```bash
# 初始化配置
./scripts/setup-vercel.sh

# 查看状态
pnpm deploy:status

# 部署 Web（生产）
pnpm deploy:web

# 部署 Admin（生产）
pnpm deploy:admin

# 预览部署
pnpm deploy:web:preview
pnpm deploy:admin:preview

# 部署所有
pnpm deploy:all
```

## 如果还是失败

1. **更新 Vercel CLI**:
   ```bash
   npm install -g vercel@latest
   ```

2. **清理所有缓存**:
   ```bash
   rm -rf .vercel .vercel-web .vercel-admin
   rm -rf node_modules .turbo
   pnpm install
   ./scripts/setup-vercel.sh
   ```

3. **检查 Vercel Dashboard**:
   - 确认两个项目都存在
   - 检查项目的 Git 连接是否正常
   - 确认你有部署权限

4. **使用 Vercel Dashboard 手动部署**:
   - 登录 https://vercel.com
   - 选择项目
   - 点击 "Deployments" -> "Deploy"
