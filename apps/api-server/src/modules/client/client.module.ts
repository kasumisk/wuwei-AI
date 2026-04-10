import { Module } from '@nestjs/common';
// 控制器
import { ClientController } from './admin/client.controller';
import { PermissionController } from './admin/permission.controller';
// 服务
import { ClientService } from './admin/client.service';
import { PermissionService } from './admin/permission.service';

@Module({
  controllers: [ClientController, PermissionController],
  providers: [ClientService, PermissionService],
  exports: [ClientService, PermissionService],
})
export class ClientModule {}
