import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { GatewayService } from '../gateway.service';

/**
 * V6.7 P0: API Key 网关守卫
 * - 移除 console.log 凭据泄漏（原实现把 x-api-key 明文输出到日志）
 * - 仅在非生产环境输出脱敏调试信息
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  private readonly isDev = process.env.NODE_ENV !== 'production';

  constructor(private readonly gatewayService: GatewayService) {}

  private mask(value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) return '<empty>';
    if (value.length <= 4) return '***';
    return `***${value.slice(-4)}`;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const apiKey = request.headers['x-api-key'];
    const apiSecret = request.headers['x-api-secret'];

    if (!apiKey || !apiSecret) {
      if (this.isDev) {
        this.logger.debug(
          `Missing credentials: key=${this.mask(apiKey)} secret=${this.mask(apiSecret)}`,
        );
      }
      throw new UnauthorizedException('缺少 API Key 或 API Secret');
    }

    const client = await this.gatewayService.validateClient(apiKey, apiSecret);

    if (!client) {
      this.logger.warn(`API Key validation failed: key=${this.mask(apiKey)}`);
      throw new UnauthorizedException('无效的 API Key 或 API Secret');
    }

    if (this.isDev) {
      this.logger.debug(`Client authenticated: ${client.name}`);
    }

    request.client = client;
    return true;
  }
}
