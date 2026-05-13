import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CapabilityType, toDbCapabilityType } from '@ai-platform/shared';
import type { AiRuntimeProvider } from '../ai-runtime/ai-runtime.types';
import { PrismaService } from '../prisma/prisma.service';
import { RegionStrategyService } from './region-strategy.service';
import type {
  RegionAiModelRoute,
  RegionCapabilityContext,
  RuntimeRegion,
} from './region.types';

export type RegionAiModelFeature = 'foodTextAnalysis' | 'foodImageAnalysis';

export interface ResolvedRegionAiModelRoute {
  region: RuntimeRegion;
  provider: AiRuntimeProvider;
  model: string;
  fallbackModel?: string;
  apiKey: string;
  baseUrl: string;
  modelConfigId?: string;
  providerId?: string;
}

@Injectable()
export class RegionAiModelRoutingService {
  constructor(
    private readonly regionStrategy: RegionStrategyService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  resolveFoodTextAnalysis(
    context: RegionCapabilityContext = {},
  ): Promise<ResolvedRegionAiModelRoute> {
    return this.resolve('foodTextAnalysis', context);
  }

  resolveFoodImageAnalysis(
    context: RegionCapabilityContext = {},
  ): Promise<ResolvedRegionAiModelRoute> {
    return this.resolve('foodImageAnalysis', context);
  }

  private async resolve(
    feature: RegionAiModelFeature,
    context: RegionCapabilityContext,
  ): Promise<ResolvedRegionAiModelRoute> {
    const profile = this.regionStrategy.resolveCapabilities(context);
    const route = profile.aiModelRouting[feature];
    const provider = this.normalizeProvider(route);
    const configuredRoute = await this.resolveFromModelConfig(
      provider,
      route.primaryModel,
    );

    if (configuredRoute) {
      return {
        ...configuredRoute,
        region: profile.region,
        fallbackModel: route.fallbackModel,
      };
    }

    return {
      region: profile.region,
      provider,
      model: route.primaryModel,
      fallbackModel: route.fallbackModel,
      apiKey: this.resolveApiKey(provider),
      baseUrl: this.resolveBaseUrl(provider),
    };
  }

  private async resolveFromModelConfig(
    provider: AiRuntimeProvider,
    modelName: string,
  ): Promise<Omit<
    ResolvedRegionAiModelRoute,
    'region' | 'fallbackModel'
  > | null> {
    const matches = await this.prisma.modelConfigs.findMany({
      where: {
        modelName,
        capabilityType: toDbCapabilityType(
          CapabilityType.TEXT_GENERATION,
        ) as any,
        enabled: true,
        providers: { enabled: true },
      },
      include: { providers: true },
      orderBy: { priority: 'asc' },
    });

    const selected =
      matches.find(
        (model) => model.providers?.name?.toLowerCase() === provider,
      ) ?? matches[0];

    if (!selected?.providers) return null;

    return {
      provider: selected.providers.name.toLowerCase(),
      model: selected.modelName,
      apiKey: selected.customApiKey || selected.providers.apiKey || '',
      baseUrl: selected.endpoint || selected.providers.baseUrl || '',
      modelConfigId: selected.id,
      providerId: selected.providers.id,
    };
  }

  private normalizeProvider(route: RegionAiModelRoute): AiRuntimeProvider {
    if (route.provider) return route.provider.toLowerCase();

    if (route.primaryModel.startsWith('qwen/')) return 'openrouter';
    if (route.primaryModel.startsWith('deepseek')) return 'deepseek';
    return 'openrouter';
  }

  private resolveApiKey(provider: AiRuntimeProvider): string {
    switch (provider) {
      case 'deepseek':
        return this.config.get<string>('DEEPSEEK_API_KEY') || '';
      case 'qwen':
        return this.config.get<string>('QWEN_API_KEY') || '';
      case 'openai':
        return this.config.get<string>('OPENAI_API_KEY') || '';
      case 'anthropic':
        return this.config.get<string>('ANTHROPIC_API_KEY') || '';
      case 'openrouter':
      default:
        return (
          this.config.get<string>('OPENROUTER_API_KEY') ||
          this.config.get<string>('OPENAI_API_KEY') ||
          ''
        );
    }
  }

  private resolveBaseUrl(provider: AiRuntimeProvider): string {
    switch (provider) {
      case 'deepseek':
        return (
          this.config.get<string>('DEEPSEEK_BASE_URL') ||
          'https://api.deepseek.com/v1'
        );
      case 'qwen':
        return (
          this.config.get<string>('QWEN_BASE_URL') ||
          'https://dashscope.aliyuncs.com/api/v1'
        );
      case 'openai':
        return (
          this.config.get<string>('OPENAI_BASE_URL') ||
          'https://api.openai.com/v1'
        );
      case 'anthropic':
        return (
          this.config.get<string>('ANTHROPIC_BASE_URL') ||
          'https://api.anthropic.com/v1'
        );
      case 'openrouter':
      default:
        return (
          this.config.get<string>('OPENROUTER_BASE_URL') ||
          'https://openrouter.ai/api/v1'
        );
    }
  }
}
