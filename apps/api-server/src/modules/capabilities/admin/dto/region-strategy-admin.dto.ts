import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthMethod, BillingMethod } from '../../../../core/region';

const AUTH_METHODS: AuthMethod[] = [
  'anonymous',
  'apple',
  'email',
  'google',
  'phone',
  'wechat',
];

const BILLING_METHODS: BillingMethod[] = [
  'alipay',
  'apple_iap',
  'google_play',
  'revenuecat',
  'wechat_pay',
];

class RegionAiFeaturesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  foodImageAnalysis?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  coachChat?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  streaming?: boolean;
}

class RegionAiModelRouteDto {
  @ApiPropertyOptional({ example: 'openrouter' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  provider?: string;

  @ApiPropertyOptional({ example: 'qwen/qwen3-vl-32b-instruct' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  primaryModel?: string;

  @ApiPropertyOptional({ example: 'qwen/qwen-vl-plus' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  fallbackModel?: string;
}

class RegionAiModelRoutingDto {
  @ApiPropertyOptional({ type: RegionAiModelRouteDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegionAiModelRouteDto)
  foodTextAnalysis?: RegionAiModelRouteDto;

  @ApiPropertyOptional({ type: RegionAiModelRouteDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegionAiModelRouteDto)
  foodImageAnalysis?: RegionAiModelRouteDto;
}

class RegionComplianceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  piplMode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dataResidencyRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  contentModerationRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  medicalDisclaimerRequired?: boolean;
}

export class UpdateRegionStrategyDto {
  @ApiPropertyOptional({ description: '国家/地区码', example: 'CN' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  countryCode?: string;

  @ApiPropertyOptional({ description: '默认 locale', example: 'zh-CN' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @ApiPropertyOptional({
    description: '默认 timezone',
    example: 'Asia/Shanghai',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ enum: AUTH_METHODS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(AUTH_METHODS, { each: true })
  authMethods?: AuthMethod[];

  @ApiPropertyOptional({ enum: BILLING_METHODS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(BILLING_METHODS, { each: true })
  billingMethods?: BillingMethod[];

  @ApiPropertyOptional({ type: RegionAiFeaturesDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegionAiFeaturesDto)
  aiFeatures?: RegionAiFeaturesDto;

  @ApiPropertyOptional({ type: [String], example: ['qwen', 'deepseek'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aiProviders?: string[];

  @ApiPropertyOptional({ type: RegionAiModelRoutingDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegionAiModelRoutingDto)
  aiModelRouting?: RegionAiModelRoutingDto;

  @ApiPropertyOptional({ example: 'oss' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  storageProvider?: string;

  @ApiPropertyOptional({ type: [String], example: ['apns', 'jpush'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  pushProviders?: string[];

  @ApiPropertyOptional({ example: 'aliyun' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  smsProvider?: string;

  @ApiPropertyOptional({ example: 'aliyun' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  moderationProvider?: string;

  @ApiPropertyOptional({ type: RegionComplianceDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RegionComplianceDto)
  compliance?: RegionComplianceDto;
}
