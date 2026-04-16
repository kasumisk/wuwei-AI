import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// 依赖模块
import { UserModule } from '../user/user.module';
import { DietModule } from '../diet/diet.module';
// 控制器和服务
import { CoachController } from './app/coach.controller';
import { CoachService } from './app/coach.service';
import { CoachPromptBuilderService } from './app/prompt/coach-prompt-builder.service';

@Module({
  imports: [ConfigModule, UserModule, DietModule],
  controllers: [CoachController],
  providers: [CoachService, CoachPromptBuilderService],
  exports: [CoachService],
})
export class CoachModule {}
