import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class CapabilityPermissionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const client = request.client;

    if (!client) {
      throw new ForbiddenException('客户端信息缺失');
    }

    // 从路由路径中提取能力类型
    const path = request.route.path;
    const capabilityType = this.extractCapabilityType(path);

    if (!capabilityType) {
      throw new ForbiddenException('无法识别的能力类型');
    }

    // 检查客户端是否有该能力的权限
    const permission =
      await this.prisma.client_capability_permissions.findFirst({
        where: {
          client_id: client.id,
          capability_type: capabilityType,
          enabled: true,
        },
      });

    if (!permission) {
      throw new ForbiddenException(`您没有访问 ${capabilityType} 能力的权限`);
    }

    // 将能力类型和权限配置附加到请求对象
    request.capabilityType = capabilityType;
    request.permission = permission;

    return true;
  }

  /**
   * 从路由路径提取能力类型
   * 例如：/api/gateway/text/generation -> text.generation
   */
  private extractCapabilityType(path: string): string | null {
    const match = path.match(/\/api\/gateway\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return `${match[1]}.${match[2]}`;
    }
    return null;
  }
}
