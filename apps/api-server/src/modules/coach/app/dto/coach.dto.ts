import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CoachChatDto {
  @ApiProperty({ description: '用户消息' })
  @IsString()
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ description: '对话 ID（不传则新建会话）' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}

export class CoachMessagesQueryDto {
  @ApiPropertyOptional({ description: '页码', default: 1 })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ description: '每页数量', default: '50' })
  @IsOptional()
  @IsString()
  limit?: string;
}
