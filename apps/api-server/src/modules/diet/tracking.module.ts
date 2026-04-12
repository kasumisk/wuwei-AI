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
  exports: TRACKING_PROVIDERS,
})
export class TrackingModule {}
