import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { Client } from './entities/client.entity';
import { ClientCapabilityPermission } from './entities/client-capability-permission.entity';
import { UsageRecord } from '../provider/entities/usage-record.entity';
// 控制器
import { ClientController } from './admin/client.controller';
import { PermissionController } from './admin/permission.controller';
// 服务
import { ClientService } from './admin/client.service';
import { PermissionService } from './admin/permission.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Client, ClientCapabilityPermission, UsageRecord]),
  ],
  controllers: [ClientController, PermissionController],
  providers: [ClientService, PermissionService],
  exports: [ClientService, PermissionService, TypeOrmModule],
})
export class ClientModule {}
