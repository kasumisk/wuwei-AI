import { Controller, Get } from '@nestjs/common';
import { Public } from '../core/decorators/public.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelConfig } from '../entities/model-config.entity';

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(ModelConfig)
    private modelConfigRepository: Repository<ModelConfig>,
  ) {}

  /**
   * 健康检查端点
   */
  @Public()
  @Get()
  async check(): Promise<{
    status: string;
    timestamp: number;
    uptime: number;
    environment: string;
    database: string;
    capabilities: number;
  }> {
    // 检查数据库连接
    let dbStatus = 'healthy';
    let capabilityCount = 0;

    try {
      capabilityCount = await this.modelConfigRepository.count();
    } catch {
      dbStatus = 'unhealthy';
    }

    return {
      status: dbStatus === 'healthy' ? 'ok' : 'degraded',
      timestamp: Date.now(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      database: dbStatus,
      capabilities: capabilityCount,
    };
  }

  /**
   * 就绪检查
   */
  @Public()
  @Get('ready')
  async ready(): Promise<{ ready: boolean }> {
    try {
      await this.modelConfigRepository.count();
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }

  /**
   * 存活检查
   */
  @Public()
  @Get('live')
  live(): { alive: boolean } {
    return { alive: true };
  }
}
