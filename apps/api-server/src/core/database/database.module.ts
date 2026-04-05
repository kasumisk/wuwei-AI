import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Config } from '../config/configuration';
import {
  Client,
  ClientCapabilityPermission,
  UsageRecord,
} from '../../entities';
import { AdminUser } from '../../entities/admin-user.entity';
import { AppUser } from '../../entities/app-user.entity';
import { Provider } from '../../entities/provider.entity';
import { ModelConfig } from '../../entities/model-config.entity';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { PermissionTemplate } from '../../entities/permission-template.entity';
import { UserRole } from '../../entities/user-role.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { AppVersion } from '../../entities/app-version.entity';
import { AppVersionPackage } from '../../entities/app-version-package.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Config>) => {
        const dbConfig = configService.get('database', { infer: true });
        if (!dbConfig) {
          throw new Error('Database configuration not found');
        }
        return {
          type: 'postgres' as const,
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
          entities: [
            Client,
            ClientCapabilityPermission,
            UsageRecord,
            AdminUser,
            AppUser,
            Provider,
            ModelConfig,
            // RBAC 权限相关实体
            Role,
            Permission,
            PermissionTemplate,
            UserRole,
            RolePermission,
            // App 版本管理
            AppVersion,
            AppVersionPackage,
            // 文件转换记录
          ],
          synchronize: dbConfig.synchronize,
          logging: process.env.NODE_ENV === 'development',
          ...(dbConfig.ssl && {
            ssl: { rejectUnauthorized: false },
          }),
        };
      },
    }),
  ],
})
export class DatabaseModule {}
