import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import {
  SHARE_SOURCE_TYPES,
  SHARE_TYPES,
  SHARE_VISIBILITIES,
  ShareSourceType,
  ShareType,
  ShareVisibility,
} from '../share.types';

export class CreateShareDto {
  @IsIn(SHARE_TYPES)
  shareType!: ShareType;

  @IsIn(SHARE_SOURCE_TYPES)
  sourceType!: ShareSourceType;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @IsOptional()
  @IsIn(SHARE_VISIBILITIES)
  visibility?: ShareVisibility;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}
