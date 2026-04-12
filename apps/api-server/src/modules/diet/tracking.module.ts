/**
 * V7.3 P3-C: 追踪与反馈子模块
 *
 * 从 DietModule 拆分出来的用户行为追踪与反馈学习服务。
 * 包含 ExecutionTracker, WeightLearner, FeedbackService, PreferenceProfile 等。
 */
import { Module } from '@nestjs/common';
import { ExecutionTrackerService } from './app/recommendation/execution-tracker.service';
import { WeightLearnerService } from './app/recommendation/weight-learner.service';
import { RecommendationFeedbackService } from './app/recommendation/feedback.service';
import { PreferenceProfileService } from './app/recommendation/preference-profile.service';
import { PreferenceUpdaterService } from './app/recommendation/preference-updater.service';

/** 追踪反馈 providers */
const TRACKING_PROVIDERS = [
  ExecutionTrackerService,
  WeightLearnerService,
  RecommendationFeedbackService,
  PreferenceProfileService,
  PreferenceUpdaterService,
];

@Module({
  providers: TRACKING_PROVIDERS,
  exports: [
    // V7.5 P3-C: 只导出被外部模块实际注入的 3 个 service（原 5 个全部导出）
    ExecutionTrackerService, // → RecommendationEngineService
    RecommendationFeedbackService, // → RecommendationEngineService, DailyPlanService, FoodPlanController, WeeklyPlanService
    PreferenceProfileService, // → RecommendationEngineService, DailyPlanService, FoodPlanController, WeeklyPlanService, PipelineBuilderService, MealAssemblerService
  ],
})
export class TrackingModule {}
