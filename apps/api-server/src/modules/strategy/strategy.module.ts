/**
 * V6 Phase 2.1 — 策略引擎模块
 *
 * 提供推荐策略的管理和解析能力:
 * - StrategyService: 策略 CRUD + 缓存 + 分配管理
 * - StrategyResolver: 根据用户上下文解析最终策略
 * - StrategySelectorService: V6.3 P2-2 — 分群→策略自动映射
 * - StrategySeedService: V6.3 P2-1 — 启动时种子数据（4 套预设策略）
 * - StrategyManagementController/Service: 管理后台策略管理 API
 *
 * @Global 标记: 全局可注入，无需显式 imports。
 * 推荐引擎在 Phase 2.2 中注入 StrategyResolver 使用。
 */
import { Global, Module } from '@nestjs/common';
import { StrategyService } from './app/strategy.service';
import { StrategyResolver } from './app/strategy-resolver.service';
import { StrategySelectorService } from './app/strategy-selector.service';
import { StrategySeedService } from './app/strategy-seed.service';
import { StrategyAutoTuner } from './app/strategy-auto-tuner.service';
import { SegmentDiscoveryService } from './app/segment-discovery.service';
import { StrategyManagementController } from './admin/strategy-management.controller';
import { StrategyManagementService } from './admin/strategy-management.service';

@Global()
@Module({
  controllers: [StrategyManagementController],
  providers: [
    StrategyService,
    StrategyResolver,
    StrategySelectorService,
    StrategySeedService,
    StrategyManagementService,
    StrategyAutoTuner,
    SegmentDiscoveryService, // V6.9 Phase 3-A: 用户群体自动聚类发现
  ],
  exports: [
    StrategyService,
    StrategyResolver,
    StrategySelectorService,
    StrategyAutoTuner,
    SegmentDiscoveryService, // V6.9 Phase 3-A: 供管理端/定时任务使用
  ],
})
export class StrategyModule {}
