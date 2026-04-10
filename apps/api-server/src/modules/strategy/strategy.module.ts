/**
 * V6 Phase 2.1 — 策略引擎模块
 *
 * 提供推荐策略的管理和解析能力:
 * - StrategyService: 策略 CRUD + 缓存 + 分配管理
 * - StrategyResolver: 根据用户上下文解析最终策略
 * - StrategyManagementController/Service: 管理后台策略管理 API
 *
 * @Global 标记: 全局可注入，无需显式 imports。
 * 推荐引擎在 Phase 2.2 中注入 StrategyResolver 使用。
 */
import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy } from './entities/strategy.entity';
import { StrategyAssignment } from './entities/strategy-assignment.entity';
import { StrategyService } from './app/strategy.service';
import { StrategyResolver } from './app/strategy-resolver.service';
import { StrategyManagementController } from './admin/strategy-management.controller';
import { StrategyManagementService } from './admin/strategy-management.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Strategy, StrategyAssignment])],
  controllers: [StrategyManagementController],
  providers: [StrategyService, StrategyResolver, StrategyManagementService],
  exports: [StrategyService, StrategyResolver],
})
export class StrategyModule {}
