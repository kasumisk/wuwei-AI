import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// 实体
import { CoachConversation } from './entities/coach-conversation.entity';
import { CoachMessage } from './entities/coach-message.entity';
// 依赖模块
import { UserModule } from '../user/user.module';
import { DietModule } from '../diet/diet.module';
// 控制器和服务
import { CoachController } from './app/coach.controller';
import { CoachService } from './app/coach.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    DietModule,
    TypeOrmModule.forFeature([CoachConversation, CoachMessage]),
  ],
  controllers: [CoachController],
  providers: [CoachService],
  exports: [CoachService],
})
export class CoachModule {}
