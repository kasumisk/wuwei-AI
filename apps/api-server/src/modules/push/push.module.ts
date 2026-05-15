import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PushController } from './push.controller';
import { PushAdminController } from './admin/push-admin.controller';
import { PushScheduler } from './push-scheduler.service';
import { PushTemplateService } from './push-template.service';
import { PushService } from './push.service';
import { FcmPushProvider } from './providers/fcm-push.provider';
import {
  HuaweiPushProvider,
  JPushProvider,
} from './providers/china-push.provider';
import { MockPushProvider } from './providers/mock-push.provider';
import { PushProviderFactory } from './providers/push-provider.factory';
import { PushProviderRegistry } from './providers/push-provider.registry';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [PushController, PushAdminController],
  providers: [
    PushService,
    PushScheduler,
    PushTemplateService,
    PushProviderRegistry,
    PushProviderFactory,
    FcmPushProvider,
    JPushProvider,
    HuaweiPushProvider,
    MockPushProvider,
  ],
  exports: [PushService, PushProviderFactory, PushProviderRegistry],
})
export class PushModule {}
