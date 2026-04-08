import { Module, Global } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import { OpenRouterAdapter } from './adapters/openrouter.adapter';

@Global()
@Module({
  providers: [OpenRouterAdapter, AiGatewayService],
  exports: [AiGatewayService],
})
export class AiGatewayModule {}
