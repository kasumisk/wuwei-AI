import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
import { CoachService } from './services/coach.service';
import { CoachController } from './controllers/coach.controller';
import { UserProfileModule } from '../user-profile/user-profile.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CoachConversation, CoachMessage]),
    UserProfileModule,
  ],
  controllers: [CoachController],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
