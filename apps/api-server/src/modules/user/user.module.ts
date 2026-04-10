import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { AppUser } from './entities/app-user.entity';
import { AdminUser } from './entities/admin-user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { UserInferredProfile } from './entities/user-inferred-profile.entity';
import { UserBehaviorProfile } from './entities/user-behavior-profile.entity';
import { ProfileSnapshot } from './entities/profile-snapshot.entity';
import { ProfileChangeLog } from './entities/profile-change-log.entity';
import { WeightHistory } from './entities/weight-history.entity';
import { ReminderDismissal } from './entities/reminder-dismissal.entity';
import { FoodRecord } from '../diet/entities/food-record.entity';
import { RecommendationFeedback } from '../diet/entities/recommendation-feedback.entity';
import { FoodLibrary } from '../food/entities/food-library.entity';
import { UserRole } from '../rbac/entities/user-role.entity';
import { Role } from '../rbac/entities/role.entity';
// App 端
import { UserProfileController } from './app/user-profile.controller';
import { UserProfileService } from './app/user-profile.service';
import { ProfileInferenceService } from './app/profile-inference.service';
import { ProfileCacheService } from './app/profile-cache.service';
import { ProfileCronService } from './app/profile-cron.service';
import { CollectionTriggerService } from './app/collection-trigger.service';
import { RealtimeProfileService } from './app/realtime-profile.service';
import { ProfileChangeLogService } from './app/profile-change-log.service';
import { ContextualProfileService } from './app/contextual-profile.service';
// Admin 端
import { AdminUserController } from './admin/admin-user.controller';
import { AppUserManagementController } from './admin/app-user-management.controller';
import { UserProfileDashboardController } from './admin/user-profile-dashboard.controller';
import { AdminUserService } from './admin/admin-user.service';
import { AppUserManagementService } from './admin/app-user-management.service';
import { UserProfileDashboardService } from './admin/user-profile-dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppUser,
      AdminUser,
      UserProfile,
      UserInferredProfile,
      UserBehaviorProfile,
      ProfileSnapshot,
      ProfileChangeLog,
      WeightHistory,
      ReminderDismissal,
      FoodRecord,
      RecommendationFeedback,
      FoodLibrary,
      UserRole,
      Role,
    ]),
  ],
  controllers: [
    UserProfileController,
    AdminUserController,
    AppUserManagementController,
    UserProfileDashboardController,
  ],
  providers: [
    UserProfileService,
    ProfileInferenceService,
    ProfileCacheService,
    ProfileCronService,
    CollectionTriggerService,
    RealtimeProfileService,
    ProfileChangeLogService,
    ContextualProfileService,
    AdminUserService,
    AppUserManagementService,
    UserProfileDashboardService,
  ],
  exports: [
    UserProfileService,
    ProfileInferenceService,
    ProfileCacheService,
    CollectionTriggerService,
    RealtimeProfileService,
    ProfileChangeLogService,
    ContextualProfileService,
    TypeOrmModule,
  ],
})
export class UserModule {}
