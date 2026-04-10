import { Module } from '@nestjs/common';
// 控制器
import { ProviderController } from './admin/provider.controller';
import { ModelController } from './admin/model.controller';
// 服务
import { ProviderService } from './admin/provider.service';
import { ModelService } from './admin/model.service';

@Module({
  controllers: [ProviderController, ModelController],
  providers: [ProviderService, ModelService],
  exports: [ProviderService, ModelService],
})
export class ProviderModule {}
