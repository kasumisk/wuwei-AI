import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { ApiKeyGuard } from './guards/api-key.guard';
import { AiRoutingModule } from '../core/ai-routing';
import { AiRuntimeModule } from '../core/ai-runtime';

@Module({
  imports: [AiRoutingModule, AiRuntimeModule],
  controllers: [GatewayController],
  providers: [GatewayService, ApiKeyGuard],
  exports: [GatewayService, ApiKeyGuard],
})
export class GatewayModule {}
