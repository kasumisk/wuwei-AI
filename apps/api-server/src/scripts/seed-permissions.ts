/**
 * 权限系统初始化种子数据
 * 运行方式：npx ts-node -r tsconfig-paths/register src/scripts/seed-permissions.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  PermissionType,
  PermissionStatus,
  HttpMethod,
  RoleStatus,
} from '../modules/rbac/rbac.types';

const prisma = new PrismaClient();

// 预定义角色
const roles = [
  {
    code: 'SUPER_ADMIN',
    name: '超级管理员',
    description: '系统超级管理员，拥有所有权限',
    is_system: true,
    status: RoleStatus.ACTIVE,
    sort: 0,
  },
  {
    code: 'ADMIN',
    name: '管理员',
    description: '系统管理员',
    is_system: true,
    status: RoleStatus.ACTIVE,
    sort: 1,
  },
  {
    code: 'OPERATOR',
    name: '运营人员',
    description: '负责日常运营管理',
    is_system: false,
    status: RoleStatus.ACTIVE,
    sort: 2,
  },
];

// 预定义权限（菜单 + 操作）
const permissions = [
  // ========== 仪表盘 ==========
  {
    code: 'dashboard',
    name: '仪表盘',
    type: PermissionType.MENU,
    icon: 'DashboardOutlined',
    is_system: true,
    sort: 0,
  },

  // ========== 用户管理 ==========
  {
    code: 'user',
    name: '用户管理',
    type: PermissionType.MENU,
    icon: 'UserOutlined',
    is_system: true,
    sort: 10,
  },
  {
    code: 'user:list',
    name: '查看用户列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/users',
    is_system: true,
    sort: 0,
  },
  {
    code: 'user:detail',
    name: '查看用户详情',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/users/:id',
    is_system: true,
    sort: 1,
  },
  {
    code: 'user:create',
    name: '创建用户',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/users',
    is_system: true,
    sort: 2,
  },
  {
    code: 'user:update',
    name: '更新用户',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/users/:id',
    is_system: true,
    sort: 3,
  },
  {
    code: 'user:delete',
    name: '删除用户',
    type: PermissionType.OPERATION,
    action: HttpMethod.DELETE,
    resource: '/admin/users/:id',
    is_system: true,
    sort: 4,
  },

  // ========== 角色管理 ==========
  {
    code: 'role',
    name: '角色管理',
    type: PermissionType.MENU,
    icon: 'TeamOutlined',
    is_system: true,
    sort: 20,
  },
  {
    code: 'role:list',
    name: '查看角色列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/roles',
    is_system: true,
    sort: 0,
  },
  {
    code: 'role:detail',
    name: '查看角色详情',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/roles/:id',
    is_system: true,
    sort: 1,
  },
  {
    code: 'role:create',
    name: '创建角色',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/roles',
    is_system: true,
    sort: 2,
  },
  {
    code: 'role:update',
    name: '更新角色',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/roles/:id',
    is_system: true,
    sort: 3,
  },
  {
    code: 'role:delete',
    name: '删除角色',
    type: PermissionType.OPERATION,
    action: HttpMethod.DELETE,
    resource: '/admin/roles/:id',
    is_system: true,
    sort: 4,
  },
  {
    code: 'role:assign',
    name: '分配权限',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/roles/:id/permissions',
    is_system: true,
    sort: 5,
  },

  // ========== 权限管理 ==========
  {
    code: 'permission',
    name: '权限管理',
    type: PermissionType.MENU,
    icon: 'SafetyOutlined',
    is_system: true,
    sort: 30,
  },
  {
    code: 'permission:list',
    name: '查看权限列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/rbac-permissions',
    is_system: true,
    sort: 0,
  },
  {
    code: 'permission:create',
    name: '创建权限',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/rbac-permissions',
    is_system: true,
    sort: 1,
  },
  {
    code: 'permission:update',
    name: '更新权限',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/rbac-permissions/:id',
    is_system: true,
    sort: 2,
  },
  {
    code: 'permission:delete',
    name: '删除权限',
    type: PermissionType.OPERATION,
    action: HttpMethod.DELETE,
    resource: '/admin/rbac-permissions/:id',
    is_system: true,
    sort: 3,
  },

  // ========== 客户端管理 ==========
  {
    code: 'client',
    name: '客户端管理',
    type: PermissionType.MENU,
    icon: 'ApiOutlined',
    is_system: true,
    sort: 40,
  },
  {
    code: 'client:list',
    name: '查看客户端列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/clients',
    is_system: true,
    sort: 0,
  },
  {
    code: 'client:create',
    name: '创建客户端',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/clients',
    is_system: true,
    sort: 1,
  },
  {
    code: 'client:update',
    name: '更新客户端',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/clients/:id',
    is_system: true,
    sort: 2,
  },
  {
    code: 'client:delete',
    name: '删除客户端',
    type: PermissionType.OPERATION,
    action: HttpMethod.DELETE,
    resource: '/admin/clients/:id',
    is_system: true,
    sort: 3,
  },

  // ========== 模型管理 ==========
  {
    code: 'model',
    name: '模型管理',
    type: PermissionType.MENU,
    icon: 'RobotOutlined',
    is_system: true,
    sort: 50,
  },
  {
    code: 'model:list',
    name: '查看模型列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/models',
    is_system: true,
    sort: 0,
  },
  {
    code: 'model:create',
    name: '创建模型',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/models',
    is_system: true,
    sort: 1,
  },
  {
    code: 'model:update',
    name: '更新模型',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/models/:id',
    is_system: true,
    sort: 2,
  },
  {
    code: 'model:delete',
    name: '删除模型',
    type: PermissionType.OPERATION,
    action: HttpMethod.DELETE,
    resource: '/admin/models/:id',
    is_system: true,
    sort: 3,
  },

  // ========== 供应商管理 ==========
  {
    code: 'provider',
    name: '供应商管理',
    type: PermissionType.MENU,
    icon: 'CloudServerOutlined',
    is_system: true,
    sort: 60,
  },
  {
    code: 'provider:list',
    name: '查看供应商列表',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/providers',
    is_system: true,
    sort: 0,
  },
  {
    code: 'provider:create',
    name: '创建供应商',
    type: PermissionType.OPERATION,
    action: HttpMethod.POST,
    resource: '/admin/providers',
    is_system: true,
    sort: 1,
  },
  {
    code: 'provider:update',
    name: '更新供应商',
    type: PermissionType.OPERATION,
    action: HttpMethod.PUT,
    resource: '/admin/providers/:id',
    is_system: true,
    sort: 2,
  },

  // ========== 统计分析 ==========
  {
    code: 'analytics',
    name: '统计分析',
    type: PermissionType.MENU,
    icon: 'AreaChartOutlined',
    is_system: true,
    sort: 70,
  },
  {
    code: 'analytics:view',
    name: '查看统计',
    type: PermissionType.OPERATION,
    action: HttpMethod.GET,
    resource: '/admin/analytics',
    is_system: true,
    sort: 0,
  },
];

// 权限模板
const templates = [
  {
    code: 'READONLY',
    name: '只读权限',
    description: '仅允许查看数据，不能修改',
    permission_patterns: '*:list,*:detail',
    is_system: true,
  },
  {
    code: 'CRUD',
    name: '增删改查',
    description: '完整的增删改查权限',
    permission_patterns: '*:list,*:detail,*:create,*:update,*:delete',
    is_system: true,
  },
  {
    code: 'OPERATOR',
    name: '运营权限',
    description: '运营人员默认权限',
    permission_patterns:
      'dashboard,user:list,user:detail,client:list,client:detail,analytics:view',
    is_system: true,
  },
];

async function seed() {
  console.log('🔄 开始初始化权限数据...');

  // 创建角色
  console.log('📦 创建角色...');
  const savedRoles: { id: string; code: string; parent_id: string | null }[] =
    [];
  for (const roleData of roles) {
    const existing = await prisma.roles.findFirst({
      where: { code: roleData.code },
    });
    if (!existing) {
      const saved = await prisma.roles.create({
        data: {
          code: roleData.code,
          name: roleData.name,
          description: roleData.description,
          is_system: roleData.is_system,
          status: roleData.status,
          sort: roleData.sort,
        },
      });
      savedRoles.push(saved);
      console.log(`  ✅ 创建角色: ${roleData.name} (${roleData.code})`);
    } else {
      savedRoles.push(existing);
      console.log(`  ⏭️  角色已存在: ${roleData.name} (${roleData.code})`);
    }
  }

  // 设置 OPERATOR 继承 ADMIN
  const adminRole = savedRoles.find((r) => r.code === 'ADMIN');
  const operatorRole = savedRoles.find((r) => r.code === 'OPERATOR');
  if (adminRole && operatorRole && !operatorRole.parent_id) {
    await prisma.roles.update({
      where: { id: operatorRole.id },
      data: { parent_id: adminRole.id },
    });
    operatorRole.parent_id = adminRole.id;
    console.log('  🔗 设置 OPERATOR 继承 ADMIN');
  }

  // 创建权限
  console.log('📦 创建权限...');
  const savedPermissions: Map<
    string,
    { id: string; code: string; parent_id: string | null }
  > = new Map();
  for (const permData of permissions) {
    const existing = await prisma.permissions.findFirst({
      where: { code: permData.code },
    });
    if (!existing) {
      const saved = await prisma.permissions.create({
        data: {
          code: permData.code,
          name: permData.name,
          type: permData.type,
          action: (permData as any).action,
          resource: (permData as any).resource,
          icon: (permData as any).icon,
          is_system: permData.is_system,
          sort: permData.sort,
          status: PermissionStatus.ACTIVE,
        },
      });
      savedPermissions.set(saved.code, saved);
      console.log(`  ✅ 创建权限: ${permData.name} (${permData.code})`);
    } else {
      savedPermissions.set(existing.code, existing);
      console.log(`  ⏭️  权限已存在: ${permData.name} (${permData.code})`);
    }
  }

  // 设置权限父子关系
  console.log('📦 设置权限父子关系...');
  const menuCodes = [
    'user',
    'role',
    'permission',
    'client',
    'model',
    'provider',
    'analytics',
  ];
  for (const menuCode of menuCodes) {
    const menuPerm = savedPermissions.get(menuCode);
    if (menuPerm) {
      // 找到所有以 menuCode: 开头的权限
      for (const [code, perm] of savedPermissions) {
        if (code.startsWith(`${menuCode}:`) && !perm.parent_id) {
          await prisma.permissions.update({
            where: { id: perm.id },
            data: { parent_id: menuPerm.id },
          });
          perm.parent_id = menuPerm.id;
        }
      }
    }
  }

  // 创建权限模板
  console.log('📦 创建权限模板...');
  for (const templateData of templates) {
    const existing = await prisma.permission_templates.findFirst({
      where: { code: templateData.code },
    });
    if (!existing) {
      await prisma.permission_templates.create({
        data: {
          code: templateData.code,
          name: templateData.name,
          description: templateData.description,
          permission_patterns: templateData.permission_patterns,
          is_system: templateData.is_system,
        },
      });
      console.log(`  ✅ 创建模板: ${templateData.name} (${templateData.code})`);
    } else {
      console.log(
        `  ⏭️  模板已存在: ${templateData.name} (${templateData.code})`,
      );
    }
  }

  // 为 ADMIN 角色分配所有权限
  console.log('📦 为 ADMIN 角色分配权限...');
  if (adminRole) {
    const existingRolePerms = await prisma.role_permissions.findMany({
      where: { role_id: adminRole.id },
    });
    if (existingRolePerms.length === 0) {
      const permValues = Array.from(savedPermissions.values());
      for (const p of permValues) {
        await prisma.role_permissions.create({
          data: {
            role_id: adminRole.id,
            permission_id: p.id,
          },
        });
      }
      console.log(`  ✅ ADMIN 角色分配了 ${permValues.length} 个权限`);
    } else {
      console.log(`  ⏭️  ADMIN 角色已有权限配置`);
    }
  }

  console.log('✅ 权限数据初始化完成！');

  await prisma.$disconnect();
}

seed().catch(async (err) => {
  console.error('❌ 初始化失败:', err);
  await prisma.$disconnect();
  process.exit(1);
});
