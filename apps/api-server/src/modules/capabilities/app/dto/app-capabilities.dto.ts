import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GetAppCapabilitiesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  regionCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  store?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;
}
