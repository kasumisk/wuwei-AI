import AppDataSource from '../core/database/data-source-dev';
import {
  AdminUser,
  AdminRole,
  AdminUserStatus,
} from '../modules/user/entities/admin-user.entity';
import { Role, RoleStatus } from '../modules/rbac/entities/role.entity';
import { UserRole as UserRoleEntity } from '../modules/rbac/entities/user-role.entity';
import * as bcrypt from 'bcrypt';

/**
 * 管理员种子数据脚本
 * 创建默认管理员账号并分配 SUPER_ADMIN 角色
 */
async function seedAdmin() {
  await AppDataSource.initialize();
  const userRepository = AppDataSource.getRepository(AdminUser);
  const roleRepository = AppDataSource.getRepository(Role);
  const userRoleRepository = AppDataSource.getRepository(UserRoleEntity);

  console.log('🌱 开始植入管理员种子数据...\n');

  try {
    // 1. 确保 SUPER_ADMIN 角色存在
    console.log('🔐 检查 SUPER_ADMIN 角色...');
    let superAdminRole = await roleRepository.findOne({
      where: { code: 'SUPER_ADMIN' },
    });

    if (!superAdminRole) {
      console.log('  ⚠️  SUPER_ADMIN 角色不存在，正在创建...');
      superAdminRole = await roleRepository.save({
        code: 'SUPER_ADMIN',
        name: '超级管理员',
        description: '系统超级管理员，拥有所有权限',
        isSystem: true,
        status: RoleStatus.ACTIVE,
        sort: 0,
      });
      console.log('  ✓ SUPER_ADMIN 角色创建成功');
    } else {
      console.log('  ✓ SUPER_ADMIN 角色已存在');
    }

    // 2. 创建默认管理员
    console.log('\n👤 创建默认管理员账号...');

    const adminUsername = 'admin';
    const adminPassword = 'admin123';

    // 检查管理员是否已存在
    let existingAdmin = await userRepository.findOne({
      where: { username: adminUsername },
    });

    if (existingAdmin) {
      console.log('  ⊙ 管理员账号已存在');
    } else {
      // 加密密码
      const hashedPassword = await bcrypt.hash(adminPassword, 10);

      // 创建管理员
      existingAdmin = await userRepository.save({
        username: adminUsername,
        email: 'admin@example.com',
        password: hashedPassword,
        role: AdminRole.SUPER_ADMIN,
        status: AdminUserStatus.ACTIVE,
        nickname: '系统管理员',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
      });

      console.log(
        `  ✓ 管理员创建成功: ${existingAdmin.username} (${existingAdmin.id})`,
      );
      console.log(`  📝 用户名: ${adminUsername}`);
      console.log(`  🔑 密码: ${adminPassword}`);
    }

    // 3. 分配 SUPER_ADMIN 角色给管理员
    console.log('\n🔗 分配角色到管理员...');
    const existingUserRole = await userRoleRepository.findOne({
      where: {
        userId: existingAdmin.id,
        roleId: superAdminRole.id,
      },
    });

    if (!existingUserRole) {
      await userRoleRepository.save({
        userId: existingAdmin.id,
        roleId: superAdminRole.id,
      });
      console.log('  ✓ SUPER_ADMIN 角色已分配给管理员');
    } else {
      console.log('  ⊙ 管理员已拥有 SUPER_ADMIN 角色');
    }

    // 4. 创建测试用户
    console.log('\n👥 创建测试用户...');

    const testUsers = [
      {
        username: 'testadmin',
        email: 'testadmin@example.com',
        password: 'test123',
        role: AdminRole.ADMIN,
        nickname: '测试管理员',
      },
    ];

    for (const userData of testUsers) {
      const existingUser = await userRepository.findOne({
        where: { username: userData.username },
      });

      if (!existingUser) {
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        const { password: _pwd, ...userDataWithoutPassword } = userData;
        await userRepository.save({
          ...userDataWithoutPassword,
          password: hashedPassword,
          status: AdminUserStatus.ACTIVE,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userData.username}`,
        });
        console.log(
          `  ✓ 创建: ${userData.username} (密码: ${userData.password})`,
        );
      } else {
        console.log(`  ⊙ 已存在: ${userData.username}`);
      }
    }

    console.log('\n✨ 管理员种子数据植入完成！\n');
    console.log('🚀 默认登录凭证：');
    console.log('   用户名: admin');
    console.log('   密码: admin123');
    console.log('   角色: SUPER_ADMIN (拥有所有权限)\n');
    console.log('🔐 测试账号：');
    console.log('   1. 用户名: testadmin  密码: test123');
    console.log('\n⚠️  注意事项：');
    console.log('   1. 请先运行 seed-permissions.ts 创建权限数据');
    console.log('   2. 请在生产环境中立即修改默认密码！\n');
  } catch (error) {
    console.error('❌ 管理员种子数据植入失败:', error);
  } finally {
    await AppDataSource.destroy();
  }
}

void seedAdmin();
