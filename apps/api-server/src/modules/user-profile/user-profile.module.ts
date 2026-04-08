import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserProfile } from './entities/user-profile.entity';
import { UserBehaviorProfile } from './entities/user-behavior-profile.entity';
import { UserProfileService } from './services/user-profile.service';
import { UserProfileController } from './controllers/user-profile.controller';

@Module({
  imports: [TypeOrmModule.forFeature([UserProfile, UserBehaviorProfile])],
  controllers: [UserProfileController],
  providers: [UserProfileService],
  exports: [UserProfileService, TypeOrmModule],
})
export class UserProfileModule {}
