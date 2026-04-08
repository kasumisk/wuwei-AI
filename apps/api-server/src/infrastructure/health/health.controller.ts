import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: Date.now(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };
  }

  @Public()
  @Get('ready')
  ready() {
    return { ready: true };
  }

  @Public()
  @Get('live')
  live() {
    return { alive: true };
  }
}
