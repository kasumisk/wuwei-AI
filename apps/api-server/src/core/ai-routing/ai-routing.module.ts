import { Global, Module } from '@nestjs/common';
import { AiModelRouter } from './ai-model-router.service';

@Global()
@Module({
  providers: [AiModelRouter],
  exports: [AiModelRouter],
})
export class AiRoutingModule {}
