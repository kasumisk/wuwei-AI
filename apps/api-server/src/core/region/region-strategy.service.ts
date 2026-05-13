import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_REGION_CODE } from '../../common/config/regional-defaults';
import {
  RegionCapabilityContext,
  RegionCapabilityProfile,
  RegionCapabilityOverride,
  RuntimeRegion,
} from './region.types';
import {
  buildDefaultChinaProfile,
  buildDefaultGlobalProfile,
  CN_COUNTRY_CODE,
} from './region-defaults';
import { RegionStrategyAdminService } from './region-strategy-admin.service';

@Injectable()
export class RegionStrategyService {
  constructor(
    @Optional()
    private readonly adminService?: RegionStrategyAdminService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  resolveCapabilities(
    context: RegionCapabilityContext,
  ): RegionCapabilityProfile {
    const forcedRegion = this.resolveForcedRegion();
    if (forcedRegion === 'CN') {
      return this.applyManagedOverrides(
        'CN',
        buildDefaultChinaProfile(context),
      );
    }
    if (forcedRegion === 'GLOBAL') {
      const countryCode = this.resolveCountryCode(context);
      return this.applyManagedOverrides(
        'GLOBAL',
        buildDefaultGlobalProfile(context, countryCode),
      );
    }

    const countryCode = this.resolveCountryCode(context);
    const region = this.resolveRuntimeRegion(countryCode);

    if (region === 'CN') {
      return this.applyManagedOverrides(
        'CN',
        buildDefaultChinaProfile(context),
      );
    }

    return this.applyManagedOverrides(
      'GLOBAL',
      buildDefaultGlobalProfile(context, countryCode),
    );
  }

  hasCapabilityOverride(
    region: RuntimeRegion,
    field: keyof RegionCapabilityOverride,
  ): boolean {
    return this.adminService?.hasOverrideField(region, field) ?? false;
  }

  private resolveRuntimeRegion(countryCode: string): RuntimeRegion {
    return countryCode === CN_COUNTRY_CODE ? 'CN' : 'GLOBAL';
  }

  private resolveForcedRegion(): RuntimeRegion | undefined {
    const value = this.configService
      ?.get<string>('REGION_STRATEGY_FORCE_REGION')
      ?.trim()
      .toUpperCase();
    if (value === 'GLOBAL' || value === 'CN') return value;
    return undefined;
  }

  private resolveCountryCode(context: RegionCapabilityContext): string {
    const fromRegion = context.regionCode?.trim().split('-')[0]?.toUpperCase();
    if (fromRegion) return fromRegion;

    const normalizedLocale = context.locale?.trim().toLowerCase();
    if (normalizedLocale === 'zh-cn') return CN_COUNTRY_CODE;
    if (normalizedLocale?.includes('-')) {
      return (
        normalizedLocale.split('-')[1]?.toUpperCase() || DEFAULT_REGION_CODE
      );
    }

    return DEFAULT_REGION_CODE;
  }
  private applyManagedOverrides(
    region: RuntimeRegion,
    profile: RegionCapabilityProfile,
  ): RegionCapabilityProfile {
    return this.adminService?.buildProfile(profile, region) ?? profile;
  }
}
