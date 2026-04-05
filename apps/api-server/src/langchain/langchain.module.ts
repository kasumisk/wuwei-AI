import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangChainService } from './langchain.service';
import { RAGService } from './services/rag.service';
import { LangChainController } from './langchain.controller';
import { GatewayModule } from '../gateway/gateway.module';

@Module({
  imports: [GatewayModule, ConfigModule],
  controllers: [LangChainController],
  providers: [LangChainService, RAGService],
  exports: [LangChainService, RAGService],
})
export class LangChainModule {}
