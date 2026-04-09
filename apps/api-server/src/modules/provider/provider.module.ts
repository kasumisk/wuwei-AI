import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { Provider } from './entities/provider.entity';
import { ModelConfig } from './entities/model-config.entity';
import { UsageRecord } from './entities/usage-record.entity';
// 控制器
import { ProviderController } from './admin/provider.controller';
import { ModelController } from './admin/model.controller';
// 服务
import { ProviderService } from './admin/provider.service';
import { ModelService } from './admin/model.service';

@Module({
  imports: [TypeOrmModule.forFeature([Provider, ModelConfig, UsageRecord])],
  controllers: [ProviderController, ModelController],
  providers: [ProviderService, ModelService],
  exports: [ProviderService, ModelService, TypeOrmModule],
})
export class ProviderModule {}
