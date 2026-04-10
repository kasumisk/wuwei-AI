import { Module } from '@nestjs/common';
// 依赖模块
import { DietModule } from '../diet/diet.module';
// App 端
import { GamificationController } from './app/gamification.controller';
import { GamificationService } from './app/gamification.service';
// Admin 端
import { GamificationManagementController } from './admin/gamification-management.controller';

@Module({
  imports: [DietModule],
  controllers: [GamificationController, GamificationManagementController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
