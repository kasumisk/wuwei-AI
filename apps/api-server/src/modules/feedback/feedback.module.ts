import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { FeedbackAdminController } from './admin/feedback-admin.controller';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [AuthModule, RbacModule],
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
