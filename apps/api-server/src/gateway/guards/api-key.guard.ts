import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { GatewayService } from '../gateway.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly gatewayService: GatewayService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 从请求头中获取 API Key 和 Secret
    const apiKey = request.headers['x-api-key'];
    const apiSecret = request.headers['x-api-secret'];

    // 调试日志
    console.log('🔍 [ApiKeyGuard] 接收到的请求头:');
    console.log('   x-api-key:', apiKey);
    console.log(
      '   x-api-secret:',
      apiSecret ? '***' + apiSecret.slice(-4) : undefined,
    );
    console.log('   所有请求头:', Object.keys(request.headers));

    if (!apiKey || !apiSecret) {
      throw new UnauthorizedException('缺少 API Key 或 API Secret');
    }

    // 验证客户端
    const client = await this.gatewayService.validateClient(apiKey, apiSecret);

    if (!client) {
      console.log('❌ [ApiKeyGuard] 客户端验证失败');
      throw new UnauthorizedException('无效的 API Key 或 API Secret');
    }

    console.log('✅ [ApiKeyGuard] 客户端验证成功:', client.name);

    // 将客户端信息附加到请求对象
    request.client = client;

    return true;
  }
}
