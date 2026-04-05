# 管理员账号和权限系统设置指南

## 问题说明

如果管理员登录后获取权限列表返回空，是因为系统使用了 **RBAC（基于角色的访问控制）** 权限系统，需要：

1. 创建 RBAC 角色（如 SUPER_ADMIN）
2. 创建权限数据
3. 为角色分配权限
4. 将用户关联到角色

## 快速初始化（推荐）

### 方式一：一键初始化（最简单）

运行完整的系统初始化脚本，会自动创建角色、权限、管理员并建立关联：

```bash
cd apps/server
pnpm db:init
```

这个脚本会：

- ✅ 创建 SUPER_ADMIN 和 ADMIN 角色
- ✅ 创建所有系统权限
- ✅ 为 ADMIN 角色分配所有权限
- ✅ 创建管理员账号（用户名: admin，密码: admin123）
- ✅ 为管理员分配 SUPER_ADMIN 角色

### 方式二：分步执行

如果需要更精细的控制，可以分步执行：

```bash
# 1. 创建权限数据（角色、权限、模板）
pnpm db:seed-permissions

# 2. 创建管理员并分配角色
pnpm db:seed-admin
```

## 登录信息

初始化完成后，使用以下凭证登录：

```
用户名: admin
密码: admin123
角色: SUPER_ADMIN（拥有所有权限）
```

## 验证权限

登录后，调用以下 API 验证权限：

```bash
# 获取当前用户权限
GET /admin/rbac-permissions/user/permissions
Authorization: Bearer <your-token>
```

正常情况下应该返回：

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "xxx",
      "username": "admin",
      "nickname": "系统管理员"
    },
    "roles": [
      {
        "id": "xxx",
        "code": "SUPER_ADMIN",
        "name": "超级管理员",
        "parentCode": null
      }
    ],
    "permissions": [
      "dashboard",
      "user",
      "user:list",
      "user:create",
      ...
    ],
    "menus": [...],
    "isSuperAdmin": true
  }
}
```

## 权限系统架构

### 1. 角色（Role）

系统预定义角色：

- **SUPER_ADMIN**: 超级管理员，自动拥有所有权限
- **ADMIN**: 管理员，需要显式分配权限
- **OPERATOR**: 运营人员（可选）

### 2. 权限（Permission）

权限分为两类：

- **MENU**: 菜单权限（如 `user`、`role`）
- **OPERATION**: 操作权限（如 `user:create`、`user:update`）

### 3. 关联关系

```
User ──> UserRole ──> Role ──> RolePermission ──> Permission
```

## 常见问题

### Q1: 管理员登录后权限为空？

**原因**: 用户未关联到 RBAC 角色

**解决**: 运行 `pnpm db:init` 或 `pnpm db:seed-admin`

### Q2: 如何为现有用户添加权限？

```bash
# 方法1: 直接在数据库中插入 user_roles 记录
# 方法2: 使用管理后台的用户管理功能分配角色
# 方法3: 调用 API
POST /admin/users/{userId}/roles
{
  "roleIds": ["role-uuid"]
}
```

### Q3: 如何自定义权限？

1. 在 [seed-permissions.ts](./src/scripts/seed-permissions.ts) 中添加新权限
2. 重新运行 `pnpm db:seed-permissions`
3. 在管理后台为角色分配新权限

### Q4: SUPER_ADMIN 和 ADMIN 的区别？

- **SUPER_ADMIN**: 代码级别的超级权限，自动拥有所有权限（包括未来新增的）
- **ADMIN**: 需要显式分配权限，更适合日常管理员使用

## 开发建议

### 测试环境

使用初始化脚本创建的默认账号：

```
管理员: admin / admin123 (SUPER_ADMIN)
测试用户: testuser / test123 (无特殊权限)
演示用户: demo / demo123 (无特殊权限)
```

### 生产环境

1. ⚠️ **立即修改默认密码**
2. 创建专用的管理员账号，不要使用 `admin`
3. 根据实际需要为用户分配最小权限
4. 定期审计权限分配情况

## 相关文件

- 初始化脚本: [init-system.ts](./src/scripts/init-system.ts)
- 管理员种子: [seed-admin.ts](./src/scripts/seed-admin.ts)
- 权限种子: [seed-permissions.ts](./src/scripts/seed-permissions.ts)
- 权限服务: [rbac-permission.service.ts](./src/admin/services/rbac-permission.service.ts)
- 用户实体: [user.entity.ts](./src/entities/user.entity.ts)
- 角色实体: [role.entity.ts](./src/entities/role.entity.ts)

## 数据库表结构

```sql
-- 用户表
users (id, username, password, email, ...)

-- 角色表
roles (id, code, name, parent_id, ...)

-- 权限表
permissions (id, code, name, type, parent_id, ...)

-- 用户-角色关联表
user_roles (id, user_id, role_id)

-- 角色-权限关联表
role_permissions (id, role_id, permission_id)
```

## 权限检查逻辑

1. 检查用户是否有 `SUPER_ADMIN` 角色 → 直接通过
2. 获取用户的所有角色（包括继承的父角色）
3. 获取这些角色的所有权限
4. 检查是否匹配所需权限（支持通配符）

## API 端点

```bash
# 权限管理
GET    /admin/rbac-permissions              # 获取权限列表
POST   /admin/rbac-permissions              # 创建权限
GET    /admin/rbac-permissions/user/permissions  # 获取当前用户权限

# 角色管理
GET    /admin/roles                         # 获取角色列表
POST   /admin/roles                         # 创建角色
GET    /admin/roles/:id/permissions         # 获取角色权限
POST   /admin/roles/:id/permissions         # 为角色分配权限

# 用户管理
GET    /admin/users/:id/roles               # 获取用户角色
POST   /admin/users/:id/roles               # 为用户分配角色
```
