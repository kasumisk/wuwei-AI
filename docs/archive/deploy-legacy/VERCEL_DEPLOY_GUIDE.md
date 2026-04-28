# Vercel 部署指南（更新版）

## 推荐方法：Git 推送自动部署

由于 Vercel CLI 存在 "Missing files" 的已知问题（特别是在 monorepo 项目中），**推荐使用 Git 推送自动部署**：

### 1. 确保项目已连接到 Git

```bash
git remote -v
# 应该看到你的 GitHub/GitLab 仓库
```

### 2. 推送代码触发部署

```bash
git add .
git commit -m "Update deployment configuration"
git push origin main
```

Vercel 会自动检测推送并开始构建部署。

### 3. 在 Vercel Dashboard 查看部署状态

- 访问 https://vercel.com/dashboard
- 选择对应的项目
- 查看 Deployments 标签页

---

## 替代方法：使用 Vercel CLI（如果Git方式不可用）

如果你必须使用 CLI，尝试以下步骤：

### 方法 A：使用 `vercel deploy` 而不是 `vercel --prod`

```bash
cd /path/to/new-platform

# Web 项目
cp -r .vercel-web .vercel
vercel deploy --build-env ENABLE_SOURCE_MAPS=false
# 部署成功后，在 Vercel Dashboard 手动将其提升到生产环境

# Admin 项目
cp -r .vercel-admin .vercel
cp vercel.admin.json vercel.json
vercel deploy --build-env ENABLE_SOURCE_MAPS=false
# 在 Dashboard 手动提升到生产环境
```

### 方法 B：清理本地缓存后重试

```bash
# 1. 清理所有 Vercel 相关的缓存
rm -rf .vercel .vercel-web .vercel-admin
rm -rf node_modules/.cache
rm -rf apps/web/.next apps/admin/dist
rm -rf packages/*/dist

# 2. 重新安装依赖
pnpm install

# 3. 重新链接项目
vercel link
mv .vercel .vercel-web

# 4. 尝试部署
cp -r .vercel-web .vercel
vercel --prod
```

### 方法 C：分步构建和部署

```bash
# 1. 本地预构建
cd apps/web
pnpm build

# 2. 部署预构建的产物
cd ../..
vercel --prebuilt --prod
```

---

## 为什么 CLI 会失败？

Vercel CLI 的 "Missing files" 错误通常由以下原因引起：

1. **Monorepo 复杂性**: 多个 package.json 和锁文件导致哈希计算不一致
2. **共享包更新**: `packages/shared` 和 `packages/constants` 的变更导致缓存失效
3. **CLI 版本问题**: 某些版本的 CLI 与特定项目结构不兼容
4. **网络问题**: 文件上传过程中网络中断

---

## 最佳实践

### 1. 优先使用 Git 推送部署

- ✅ 更稳定可靠
- ✅ 自动化程度高
- ✅ 避免本地环境差异
- ✅ 完整的部署历史

### 2. 在 Vercel Dashboard 配置项目

#### Web 项目设置

1. 登录 https://vercel.com/dashboard
2. 选择 `new-platform` 项目
3. Settings → General → Build & Development Settings
   - **Build Command**: `cd apps/web && pnpm build`
   - **Output Directory**: `apps/web/.next`
   - **Install Command**: `pnpm install --no-frozen-lockfile`
   - **Root Directory**: `.` (保持为根目录)

#### Admin 项目设置（如果已创建）

1. 选择 `new-platform-admin` 项目
2. Settings → General → Build & Development Settings
   - **Build Command**: `pnpm install --no-frozen-lockfile && pnpm turbo build --filter=@ai-platform/admin`
   - **Output Directory**: `apps/admin/dist`
   - **Install Command**: `pnpm install --no-frozen-lockfile`
   - **Root Directory**: `.`

### 3. 使用环境变量

在 Vercel Dashboard → Settings → Environment Variables 添加：

**Web 项目**:

```
NEXT_PUBLIC_API_URL=你的API地址
NEXT_TELEMETRY_DISABLED=1
```

**Admin 项目**:

```
VITE_API_URL=你的API地址
```

---

## 临时解决方案

如果你需要**立即**部署而 CLI 失败，使用以下快捷方法：

```bash
# 简单脚本：直接通过 Git 部署
cat > quick-deploy.sh << 'EOF'
#!/bin/bash
echo "📦 准备部署..."
git add .
git commit -m "Deploy: $(date '+%Y-%m-%d %H:%M:%S')" || true
git push origin main
echo "✅ 已推送到 Git，Vercel 会自动开始部署"
echo "📊 查看进度: https://vercel.com/dashboard"
EOF

chmod +x quick-deploy.sh
./quick-deploy.sh
```

---

## 验证部署

部署完成后访问：

- **Web**: https://new-platform.vercel.app 或你的自定义域名
- **Admin**: https://new-platform-admin.vercel.app 或自定义域名

---

## 如果 Git 推送也失败

检查 Vercel 项目的 Git 集成：

1. Dashboard → Project → Settings → Git
2. 确认 Git 仓库已正确连接
3. 检查 Production Branch 设置（通常是 `main` 或 `master`）
4. 确认没有部署保护设置阻止部署

如果仍然失败，考虑：

- 重新连接 Git 仓库
- 创建新的 Vercel 项目
- 联系 Vercel 支持
