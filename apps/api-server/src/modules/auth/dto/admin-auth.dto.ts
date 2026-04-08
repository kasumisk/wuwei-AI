import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminLoginDto {
  @ApiProperty({ description: '管理员用户名' })
  @IsString()
  username: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class AdminAuthResponseDto {
  accessToken: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
}
