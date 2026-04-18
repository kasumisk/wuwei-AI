/**
 * V8: Barrel re-export
 * 实际定义已拆分到：
 * - food-record.dto.ts  (食物记录/分析/库相关)
 * - user-profile.dto.ts (用户画像)
 * - recommendation.dto.ts (推荐/计划/反馈/总结)
 */
export {
  AnalyzeImageDto,
  FoodItemDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  AddFromLibraryDto,
  CreateFoodLogDto,
  FoodLogQueryDto,
} from './food-record.dto';

export { SaveUserProfileDto } from './user-profile.dto';

export {
  AdjustPlanDto,
  RegeneratePlanDto,
  SubstitutesQueryDto,
  FeedbackRatingsDto,
  ImplicitSignalsDto,
  RecommendationFeedbackDto,
  ExplainWhyNotDto,
  DecisionFeedbackDto,
  RecentSummaryQueryDto,
} from './recommendation.dto';
