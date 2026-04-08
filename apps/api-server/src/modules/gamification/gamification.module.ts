import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Achievement } from './entities/achievement.entity';
import { UserAchievement } from './entities/user-achievement.entity';
import { Challenge } from './entities/challenge.entity';
import { UserChallenge } from './entities/user-challenge.entity';
import { GamificationService } from './services/gamification.service';
import { GamificationController } from './controllers/gamification.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Achievement, UserAchievement, Challenge, UserChallenge]),
  ],
  controllers: [GamificationController],
  providers: [GamificationService],
  exports: [GamificationService],
})
export class GamificationModule {}
