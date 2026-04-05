import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { ModelConfig } from '../entities/model-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ModelConfig])],
  controllers: [HealthController],
})
export class HealthModule {}
