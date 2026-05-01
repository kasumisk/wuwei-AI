import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { RoleStatus } from '@ai-platform/shared';

export class RoleQueryRequestDto {
  @ApiProperty({ description: '页码', required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', required: false, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 10;

  @ApiProperty({ description: '角色编码', required: false })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiProperty({ description: '角色名称', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '状态', enum: RoleStatus, required: false })
  @IsOptional()
  @IsEnum(RoleStatus)
  status?: RoleStatus;

  // 兼容前端统一 GET 防缓存参数，whitelist 会保留已声明字段并忽略其余字段。
  @IsOptional()
  @Type(() => Number)
  _t?: number;
}
