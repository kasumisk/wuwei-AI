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
import { FoodRecord } from '../../entities/food-record.entity';
import { DailySummary } from '../../entities/daily-summary.entity';
import { UserProfile } from '../../entities/user-profile.entity';
import { CoachConversation } from '../../entities/coach-conversation.entity';
import { CoachMessage } from '../../entities/coach-message.entity';
import { FoodLibrary } from '../../entities/food-library.entity';
import { FoodTranslation } from '../../entities/food-translation.entity';
import { FoodSource } from '../../entities/food-source.entity';
import { FoodChangeLog } from '../../entities/food-change-log.entity';
import { FoodConflict } from '../../entities/food-conflict.entity';
import { FoodRegionalInfo } from '../../entities/food-regional-info.entity';
import { DailyPlan } from '../../entities/daily-plan.entity';
import { UserBehaviorProfile } from '../../entities/user-behavior-profile.entity';
import { AiDecisionLog } from '../../entities/ai-decision-log.entity';
import { Achievement } from '../../entities/achievement.entity';
import { UserAchievement } from '../../entities/user-achievement.entity';
import { Challenge } from '../../entities/challenge.entity';
import { UserChallenge } from '../../entities/user-challenge.entity';
import { RecommendationFeedback } from '../../entities/recommendation-feedback.entity';

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
            // 饮食记录相关
            FoodRecord,
            DailySummary,
            UserProfile,
            // AI 教练
            CoachConversation,
            CoachMessage,
            // 食物库
            FoodLibrary,
            FoodTranslation,
            FoodSource,
            FoodChangeLog,
            FoodConflict,
            FoodRegionalInfo,
            // V2: 日计划
            DailyPlan,
            // V3: 行为建模
            UserBehaviorProfile,
            AiDecisionLog,
            // V4: 游戏化
            Achievement,
            UserAchievement,
            Challenge,
            UserChallenge,
            // 推荐反馈
            RecommendationFeedback,
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
