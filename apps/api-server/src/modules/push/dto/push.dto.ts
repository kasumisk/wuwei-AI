import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import {
  PushNotificationType,
  PushPlatform,
  PushProviderType,
  PushRegion,
} from '../push.types';

export class RegisterPushTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  token!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  deviceId!: string;

  @IsEnum(PushPlatform)
  platform!: PushPlatform;

  @IsEnum(PushRegion)
  pushRegion!: PushRegion;

  @IsEnum(PushProviderType)
  providerType!: PushProviderType;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  locale?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  appVersion?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  deviceBrand?: string;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  romType?: string;
}

export class UnregisterPushTokenDto {
  @IsString()
  @IsOptional()
  @MaxLength(1024)
  token?: string;

  @IsString()
  @IsOptional()
  @MaxLength(200)
  deviceId?: string;

  @IsEnum(PushProviderType)
  @IsOptional()
  providerType?: PushProviderType;
}

export class UpdatePushPreferencesDto {
  @IsBoolean()
  @IsOptional()
  pushEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  dailyCheckInEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  noAnalysisTodayEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  weeklyReportEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  analysisFollowUpEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  premiumUpgradeHintEnabled?: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(64)
  timezone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(16)
  locale?: string;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  quietStart?: string;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  quietEnd?: string;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  dailyReminderTime?: string;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  noAnalysisReminderTime?: string;

  @IsIn([1, 2, 3, 4, 5, 6, 7])
  @IsOptional()
  weeklyReportDay?: number;

  @Matches(/^\d{2}:\d{2}$/)
  @IsOptional()
  weeklyReportTime?: string;
}

export class TestPushDto {
  @IsEnum(PushNotificationType)
  @IsOptional()
  type?: PushNotificationType;

  @IsObject()
  @IsOptional()
  payload?: Record<string, string | number | boolean | null>;
}
