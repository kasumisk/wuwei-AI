import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { RedisCacheService } from '../redis/redis-cache.service';
import type {
  RegionCapabilityContext,
  RegionCapabilityOverride,
  RegionCapabilityProfile,
  RuntimeRegion,
} from './region.types';
import {
  buildDefaultChinaProfile,
  buildDefaultGlobalProfile,
} from './region-defaults';

const REGION_CONFIG_KEY_PREFIX = 'region_strategy:override:';
const REGION_CONFIG_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 10;
const REGIONS: RuntimeRegion[] = ['GLOBAL', 'CN'];

export interface RegionStrategyConfigView {
  region: RuntimeRegion;
  hasOverride: boolean;
  override: RegionCapabilityOverride | null;
  defaultProfile: RegionCapabilityProfile;
  effectiveProfile: RegionCapabilityProfile;
}

@Injectable()
export class RegionStrategyAdminService implements OnModuleInit {
  private readonly logger = new Logger(RegionStrategyAdminService.name);
  private readonly overrides = new Map<
    RuntimeRegion,
    RegionCapabilityOverride
  >();

  constructor(
    @Optional()
    private readonly redis?: RedisCacheService,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all(REGIONS.map((region) => this.loadOverride(region)));
  }

  list(): RegionStrategyConfigView[] {
    return REGIONS.map((region) => this.get(region));
  }

  get(region: RuntimeRegion): RegionStrategyConfigView {
    const defaultProfile = this.getDefaultProfile(region);
    const override = this.getOverride(region);

    return {
      region,
      hasOverride: !!override,
      override,
      defaultProfile,
      effectiveProfile: this.applyOverride(defaultProfile, override),
    };
  }

  async update(
    region: RuntimeRegion,
    override: RegionCapabilityOverride,
  ): Promise<RegionStrategyConfigView> {
    const sanitized = this.sanitizeOverride(override);
    this.overrides.set(region, sanitized);

    void this.redis
      ?.set(this.key(region), sanitized, REGION_CONFIG_TTL_MS)
      .catch((error) => {
        this.logger.warn(
          `Failed to persist region strategy override for ${region}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      });

    return this.get(region);
  }

  async reset(region: RuntimeRegion): Promise<RegionStrategyConfigView> {
    this.overrides.delete(region);

    void this.redis?.del(this.key(region)).catch((error) => {
      this.logger.warn(
        `Failed to delete region strategy override for ${region}: ${
          error instanceof Error ? error.message : error
        }`,
      );
    });

    return this.get(region);
  }

  getOverride(region: RuntimeRegion): RegionCapabilityOverride | null {
    return this.overrides.get(region) ?? null;
  }

  hasOverrideField(
    region: RuntimeRegion,
    field: keyof RegionCapabilityOverride,
  ): boolean {
    const override = this.overrides.get(region);
    return !!override && Object.prototype.hasOwnProperty.call(override, field);
  }

  buildProfile(
    base: RegionCapabilityProfile,
    region: RuntimeRegion,
  ): RegionCapabilityProfile {
    return this.applyOverride(base, this.getOverride(region));
  }

  private async loadOverride(region: RuntimeRegion): Promise<void> {
    const override = await this.redis?.get<RegionCapabilityOverride>(
      this.key(region),
    );
    if (!override) return;
    this.overrides.set(region, this.sanitizeOverride(override));
  }

  private getDefaultProfile(region: RuntimeRegion): RegionCapabilityProfile {
    return region === 'CN'
      ? buildDefaultChinaProfile()
      : buildDefaultGlobalProfile();
  }

  private applyOverride(
    profile: RegionCapabilityProfile,
    override: RegionCapabilityOverride | null,
  ): RegionCapabilityProfile {
    if (!override) return profile;

    return {
      ...profile,
      ...override,
      region: profile.region,
      countryCode: override.countryCode ?? profile.countryCode,
      locale: override.locale ?? profile.locale,
      timezone: override.timezone ?? profile.timezone,
      aiFeatures: {
        ...profile.aiFeatures,
        ...(override.aiFeatures ?? {}),
      },
      aiModelRouting: {
        ...profile.aiModelRouting,
        ...Object.fromEntries(
          Object.entries(override.aiModelRouting ?? {}).map(([key, route]) => [
            key,
            {
              ...profile.aiModelRouting[
                key as keyof typeof profile.aiModelRouting
              ],
              ...(route ?? {}),
            },
          ]),
        ),
      },
      compliance: {
        ...profile.compliance,
        ...(override.compliance ?? {}),
      },
      requestContext: profile.requestContext,
    };
  }

  private sanitizeOverride(
    override: RegionCapabilityOverride,
  ): RegionCapabilityOverride {
    const sanitized: RegionCapabilityOverride = {};
    for (const [key, value] of Object.entries(override) as Array<
      [keyof RegionCapabilityOverride, any]
    >) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        sanitized[key] = value.filter(Boolean) as never;
        continue;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) sanitized[key] = trimmed as never;
        continue;
      }
      sanitized[key] = value;
    }
    return sanitized;
  }

  private key(region: RuntimeRegion): string {
    return `${REGION_CONFIG_KEY_PREFIX}${region}`;
  }
}
