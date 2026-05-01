/**
 * V7.2 P2-B: 评分因子 barrel export
 */
export { PreferenceSignalFactor } from './preference-signal.factor';
export { RegionalBoostFactor } from './regional-boost.factor';
export { CollaborativeFilteringFactor } from './collaborative-filtering.factor';
export { ShortTermProfileFactor } from './short-term-profile.factor';
export { SceneContextFactor } from './scene-context.factor';
export { AnalysisProfileFactor } from './analysis-profile.factor';
export { LifestyleBoostFactor } from './lifestyle-boost.factor';
export { PopularityFactor } from './popularity.factor';
export { ReplacementFeedbackFactor } from './replacement-feedback.factor';
export { RuleWeightFactor } from './rule-weight.factor';
// 区域+时区优化（阶段 4.1）：价格适配因子
export { PriceFitFactor } from './price-fit.factor';
// 渠道×时段可获得性因子（接通 AvailabilityScorerService 死代码路径）
export { ChannelAvailabilityFactor } from './channel-availability.factor';
