/**
 * V6 Phase 1.5 — 功能开关模块
 *
 * 提供轻量级灰度发布能力。
 * - @Global() 全局可用，任何模块均可注入 FeatureFlagService
 * - Admin 控制器提供管理后台 CRUD
 * - 配合 A/B 实验系统：Feature Flag 控制"是否可见"，A/B 实验控制"用哪个版本"
 */
import { Global, Module } from '@nestjs/common';
import { FeatureFlagService } from './feature-flag.service';
import { FeatureFlagManagementController } from './admin/feature-flag-management.controller';

@Global()
@Module({
  controllers: [FeatureFlagManagementController],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagModule {}
