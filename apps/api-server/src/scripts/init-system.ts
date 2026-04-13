import { PrismaClient } from '@prisma/client';
import { AdminRole, AdminUserStatus } from '../modules/user/user.types';
import {
  PermissionType,
  PermissionStatus,
  HttpMethod,
  RoleStatus,
} from '../modules/rbac/rbac.types';
import * as bcrypt from 'bcrypt';
import { seedSubscriptionPlans } from './seeds/seed-subscription-plans.shared';

const prisma = new PrismaClient();

/**
 * 系统完整初始化脚本
 * 按顺序执行：创建角色 -> 创建权限 -> 分配权限 -> 创建管理员 -> 分配角色
 */
async function initSystem() {
  console.log('🚀 开始初始化系统...\n');

  try {
    // ========== 0. 初始化默认订阅计划 ==========
    await seedSubscriptionPlans(prisma);

    // ========== 1. 创建角色 ==========
    console.log('📦 第一步：创建系统角色...\n');

    const roles = [
      {
        code: 'SUPER_ADMIN',
        name: '超级管理员',
        description: '系统超级管理员，拥有所有权限',
        is_system: true,
        status: RoleStatus.ACTIVE as unknown as 'active',
        sort: 0,
      },
      {
        code: 'ADMIN',
        name: '管理员',
        description: '系统管理员',
        is_system: true,
        status: RoleStatus.ACTIVE as unknown as 'active',
        sort: 1,
      },
    ];

    const savedRoles: Map<string, { id: string; code: string }> = new Map();

    for (const roleData of roles) {
      let role = await prisma.roles.findFirst({
        where: { code: roleData.code },
      });
      if (!role) {
        role = await prisma.roles.create({ data: roleData });
        console.log(`  ✅ 创建角色: ${roleData.name} (${roleData.code})`);
      } else {
        console.log(`  ⏭️  角色已存在: ${roleData.name} (${roleData.code})`);
      }
      savedRoles.set(role.code, role);
    }

    // ========== 2. 创建权限 ==========
    console.log('\n📦 第二步：创建系统权限...\n');

    const permissions = [
      // 仪表盘
      {
        code: 'dashboard',
        name: '仪表盘',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'DashboardOutlined',
        sort: 0,
      },

      // 用户管理
      {
        code: 'user',
        name: '用户管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'UserOutlined',
        sort: 10,
      },
      {
        code: 'user:list',
        name: '查看用户列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/users',
        sort: 0,
      },
      {
        code: 'user:detail',
        name: '查看用户详情',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/users/:id',
        sort: 1,
      },
      {
        code: 'user:create',
        name: '创建用户',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.POST as unknown as 'POST',
        resource: '/admin/users',
        sort: 2,
      },
      {
        code: 'user:update',
        name: '更新用户',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.PUT as unknown as 'PUT',
        resource: '/admin/users/:id',
        sort: 3,
      },
      {
        code: 'user:delete',
        name: '删除用户',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.DELETE as unknown as 'DELETE',
        resource: '/admin/users/:id',
        sort: 4,
      },

      // 角色管理
      {
        code: 'role',
        name: '角色管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'TeamOutlined',
        sort: 20,
      },
      {
        code: 'role:list',
        name: '查看角色列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/roles',
        sort: 0,
      },
      {
        code: 'role:create',
        name: '创建角色',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.POST as unknown as 'POST',
        resource: '/admin/roles',
        sort: 1,
      },
      {
        code: 'role:update',
        name: '更新角色',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.PUT as unknown as 'PUT',
        resource: '/admin/roles/:id',
        sort: 2,
      },
      {
        code: 'role:delete',
        name: '删除角色',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.DELETE as unknown as 'DELETE',
        resource: '/admin/roles/:id',
        sort: 3,
      },

      // 权限管理
      {
        code: 'permission',
        name: '权限管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'SafetyOutlined',
        sort: 30,
      },
      {
        code: 'permission:list',
        name: '查看权限列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/rbac-permissions',
        sort: 0,
      },
      {
        code: 'permission:create',
        name: '创建权限',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.POST as unknown as 'POST',
        resource: '/admin/rbac-permissions',
        sort: 1,
      },

      // 客户端管理
      {
        code: 'client',
        name: '客户端管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'ApiOutlined',
        sort: 40,
      },
      {
        code: 'client:list',
        name: '查看客户端列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/clients',
        sort: 0,
      },
      {
        code: 'client:create',
        name: '创建客户端',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.POST as unknown as 'POST',
        resource: '/admin/clients',
        sort: 1,
      },

      // 模型管理
      {
        code: 'model',
        name: '模型管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'RobotOutlined',
        sort: 50,
      },
      {
        code: 'model:list',
        name: '查看模型列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/models',
        sort: 0,
      },

      // 供应商管理
      {
        code: 'provider',
        name: '供应商管理',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'CloudServerOutlined',
        sort: 60,
      },
      {
        code: 'provider:list',
        name: '查看供应商列表',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/providers',
        sort: 0,
      },

      // 统计分析
      {
        code: 'analytics',
        name: '统计分析',
        type: PermissionType.MENU as unknown as 'menu',
        icon: 'AreaChartOutlined',
        sort: 70,
      },
      {
        code: 'analytics:view',
        name: '查看统计',
        type: PermissionType.OPERATION as unknown as 'operation',
        action: HttpMethod.GET as unknown as 'GET',
        resource: '/admin/analytics',
        sort: 0,
      },
    ];

    const savedPermissions: Map<
      string,
      { id: string; code: string; parent_id: string | null }
    > = new Map();

    for (const permData of permissions) {
      let perm = await prisma.permissions.findFirst({
        where: { code: permData.code },
      });
      if (!perm) {
        perm = await prisma.permissions.create({
          data: {
            ...permData,
            is_system: true,
            status: PermissionStatus.ACTIVE as unknown as 'active',
          },
        });
        console.log(`  ✅ 创建权限: ${permData.name} (${permData.code})`);
      } else {
        console.log(`  ⏭️  权限已存在: ${permData.name} (${permData.code})`);
      }
      if (perm) {
        savedPermissions.set(perm.code, perm);
      }
    }

    // ========== 3. 设置权限父子关系 ==========
    console.log('\n📦 第三步：设置权限层级关系...\n');

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
        for (const [code, perm] of savedPermissions) {
          if (code.startsWith(`${menuCode}:`) && !perm.parent_id) {
            await prisma.permissions.update({
              where: { id: perm.id },
              data: { parent_id: menuPerm.id },
            });
            perm.parent_id = menuPerm.id;
          }
        }
        console.log(`  ✅ 设置 ${menuCode} 子权限`);
      }
    }

    // ========== 4. 为 ADMIN 角色分配所有权限 ==========
    console.log('\n📦 第四步：为 ADMIN 角色分配权限...\n');

    const adminRole = savedRoles.get('ADMIN');
    if (adminRole) {
      const existingPerms = await prisma.role_permissions.findMany({
        where: { role_id: adminRole.id },
      });

      if (existingPerms.length === 0) {
        const rolePermsData = Array.from(savedPermissions.values()).map(
          (p) => ({
            role_id: adminRole.id,
            permission_id: p.id,
          }),
        );
        for (const rp of rolePermsData) {
          await prisma.role_permissions.create({ data: rp });
        }
        console.log(`  ✅ ADMIN 角色分配了 ${rolePermsData.length} 个权限`);
      } else {
        console.log(`  ⏭️  ADMIN 角色已有 ${existingPerms.length} 个权限`);
      }
    }

    // ========== 5. 创建管理员用户 ==========
    console.log('\n📦 第五步：创建管理员用户...\n');

    const adminUsername = 'admin';
    const adminPassword = 'admin123';

    let admin = await prisma.admin_users.findFirst({
      where: { username: adminUsername },
    });

    if (!admin) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      admin = await prisma.admin_users.create({
        data: {
          username: adminUsername,
          email: 'admin@example.com',
          password: hashedPassword,
          role: AdminRole.SUPER_ADMIN as unknown as 'super_admin',
          status: AdminUserStatus.ACTIVE as unknown as 'active',
          nickname: '系统管理员',
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
        },
      });
      console.log(`  ✅ 创建管理员: ${admin.username}`);
      console.log(`     用户名: ${adminUsername}`);
      console.log(`     密码: ${adminPassword}`);
    } else {
      console.log(`  ⏭️  管理员已存在: ${admin.username}`);
    }

    // ========== 6. 为管理员分配 SUPER_ADMIN 角色 ==========
    console.log('\n📦 第六步：为管理员分配角色...\n');

    const superAdminRole = savedRoles.get('SUPER_ADMIN');
    if (superAdminRole && admin) {
      const existingUserRole = await prisma.user_roles.findFirst({
        where: { user_id: admin.id, role_id: superAdminRole.id },
      });

      if (!existingUserRole) {
        await prisma.user_roles.create({
          data: {
            user_id: admin.id,
            role_id: superAdminRole.id,
          },
        });
        console.log(`  ✅ 为管理员分配 SUPER_ADMIN 角色`);
      } else {
        console.log(`  ⏭️  管理员已有 SUPER_ADMIN 角色`);
      }
    }

    // ========== 完成 ==========
    console.log('\n' + '='.repeat(60));
    console.log('✨ 系统初始化完成！\n');
    console.log('🚀 管理员登录信息：');
    console.log(`   用户名: ${adminUsername}`);
    console.log(`   密码: ${adminPassword}`);
    console.log(`   角色: SUPER_ADMIN (拥有所有权限)\n`);
    console.log('📊 初始化统计：');
    console.log(`   角色数: ${savedRoles.size}`);
    console.log(`   权限数: ${savedPermissions.size}`);
    console.log(`   管理员: 1 个\n`);
    console.log('⚠️  重要提示：');
    console.log('   请在生产环境中立即修改默认密码！');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

void initSystem();
