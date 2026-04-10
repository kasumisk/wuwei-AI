import { Module } from '@nestjs/common';
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
  ],
})
export class UserModule {}
