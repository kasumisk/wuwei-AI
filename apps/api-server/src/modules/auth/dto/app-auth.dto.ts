import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthType } from '../entities/app-user.entity';

export class LoginAnonymousDto {
  @ApiProperty({ description: '设备唯一标识' })
  @IsString()
  deviceId: string;
}

export class LoginByPhoneDto {
  @ApiProperty({ description: '手机号' })
  @IsString()
  phone: string;

  @ApiProperty({ description: '验证码' })
  @IsString()
  code: string;
}

export class LoginByWechatMiniDto {
  @ApiProperty({ description: '微信小程序登录code' })
  @IsString()
  code: string;

  @ApiPropertyOptional({ description: '用户昵称' })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: '用户头像' })
  @IsOptional()
  @IsString()
  avatar?: string;
}

export class LoginByEmailDto {
  @ApiProperty({ description: '邮箱' })
  @IsString()
  email: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  password: string;
}

export class RegisterByEmailDto {
  @ApiProperty({ description: '邮箱' })
  @IsString()
  email: string;

  @ApiProperty({ description: '密码' })
  @IsString()
  password: string;

  @ApiPropertyOptional({ description: '昵称' })
  @IsOptional()
  @IsString()
  nickname?: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: '刷新令牌' })
  @IsString()
  refreshToken: string;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    authType: AuthType;
    nickname?: string;
    avatar?: string;
  };
}
