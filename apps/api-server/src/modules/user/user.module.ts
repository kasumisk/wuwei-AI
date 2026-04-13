import { Module } from '@nestjs/common';
// App 端
import { UserProfileController } from './app/controllers/user-profile.controller';
import { UserProfileService } from './app/services/profile/user-profile.service';
import { ProfileInferenceService } from './app/services/profile/profile-inference.service';
import { ProfileCacheService } from './app/services/profile/profile-cache.service';
import { ProfileCronService } from './app/cron/profile-cron.service';
import { CollectionTriggerService } from './app/services/profile/collection-trigger.service';
import { RealtimeProfileService } from './app/services/profile/realtime-profile.service';
import { ProfileChangeLogService } from './app/services/profile/profile-change-log.service';
import { ContextualProfileService } from './app/services/profile/contextual-profile.service';
import { ProfileResolverService } from './app/services/profile/profile-resolver.service';
// V6.2 3.8: 目标达成事件监听器
import { GoalAchievedListener } from './app/listeners/goal-achieved.listener';
// Admin 端
import { AdminUserController } from './admin/admin-user.controller';
import { AppUserManagementController } from './admin/app-user-management.controller';
import { UserProfileDashboardController } from './admin/user-profile-dashboard.controller';
import { AdminUserService } from './admin/admin-user.service';
import { AppUserManagementService } from './admin/app-user-management.service';
import { UserProfileDashboardService } from './admin/user-profile-dashboard.service';
import { ChurnPredictionService } from './app/services/churn-prediction.service';
import { GoalTrackerService } from './app/services/goal/goal-tracker.service';
import { GoalPhaseService } from './app/services/goal/goal-phase.service';
import { ChurnPredictionController } from './admin/churn-prediction.controller';

@Module({
  controllers: [
    UserProfileController,
    AdminUserController,
    AppUserManagementController,
    UserProfileDashboardController,
    ChurnPredictionController, // V6.5 Phase 3L: 用户流失预测 Admin API
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
    ProfileResolverService,
    GoalAchievedListener, // V6.2 3.8: 目标达成事件监听器
    ChurnPredictionService, // V6.5 Phase 3L: 用户流失预测
    GoalTrackerService, // V7.0 Phase 2-A: 目标进度追踪
    GoalPhaseService, // V7.0 Phase 2-B: 分阶段目标管理
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
    ProfileResolverService,
    ChurnPredictionService, // V6.5 Phase 3L: 供 ProfileCronService 使用
    GoalTrackerService, // V7.0 Phase 2-A: 供 DietModule 使用
    GoalPhaseService, // V7.0 Phase 2-B: 供 DietModule 使用
  ],
})
export class UserModule {}
