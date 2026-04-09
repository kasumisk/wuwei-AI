import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { Achievement } from './entities/achievement.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { Challenge } from './entities/challenge.entity';
import { UserChallenge } from './entities/user-challenge.entity';
import { UserBehaviorProfile } from '../user/entities/user-behavior-profile.entity';
// 依赖模块
import { DietModule } from '../diet/diet.module';
// App 端
import { GamificationController } from './app/gamification.controller';
import { GamificationService } from './app/gamification.service';
// Admin 端
import { GamificationManagementController } from './admin/gamification-management.controller';

@Module({
  imports: [
    DietModule,
    TypeOrmModule.forFeature([
      Achievement,
      UserAchievement,
      Challenge,
      UserChallenge,
      UserBehaviorProfile,
    ]),
  ],
  controllers: [GamificationController, GamificationManagementController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
