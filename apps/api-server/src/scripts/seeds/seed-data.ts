import { PrismaClient } from '@prisma/client';
import {
  ProviderType,
  ProviderStatus,
  ModelStatus,
  Currency,
  CapabilityType,
} from '@ai-platform/shared';

const prisma = new PrismaClient();

async function seed() {
  try {
    console.log('✅ Database connection established');

    // ============ 第一步：插入 Providers ============
    console.log('\n📦 Seeding Providers...');

    const providers = [
      {
        name: 'OpenAI',
        type: ProviderType.OPENAI,
        baseUrl: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || 'sk-placeholder-change-me',
        enabled: true,
        healthCheckUrl: 'https://api.openai.com/v1/models',
        timeout: 30000,
        retryCount: 3,
        status: ProviderStatus.ACTIVE,
        metadata: { description: 'OpenAI official API' },
      },
      {
        name: 'Anthropic',
        type: ProviderType.ANTHROPIC,
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'sk-ant-placeholder-change-me',
        enabled: true,
        healthCheckUrl: 'https://api.anthropic.com/v1/messages',
        timeout: 30000,
        retryCount: 3,
        status: ProviderStatus.ACTIVE,
        metadata: { description: 'Anthropic Claude API' },
      },
      {
        name: 'DeepSeek',
        type: ProviderType.CUSTOM,
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: process.env.DEEPSEEK_API_KEY || 'sk-placeholder-change-me',
        enabled: true,
        healthCheckUrl: 'https://api.deepseek.com/v1/models',
        timeout: 30000,
        retryCount: 3,
        status: ProviderStatus.ACTIVE,
        metadata: { description: 'DeepSeek API' },
      },
      {
        name: 'Qwen',
        type: ProviderType.ALIBABA,
        baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
        apiKey: 'sk-placeholder-change-me',
        enabled: false,
        healthCheckUrl:
          'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        timeout: 30000,
        retryCount: 3,
        status: ProviderStatus.INACTIVE,
        metadata: { description: '阿里云通义千问 API' },
      },
    ];

    const savedProviders: Array<{ id: string; name: string }> = [];
    for (const providerData of providers) {
      const existing = await prisma.providers.findFirst({
        where: { name: providerData.name },
      });
      if (existing) {
        console.log(
          `  ⏭️  Provider "${providerData.name}" already exists, skipping`,
        );
        savedProviders.push(existing);
      } else {
        const saved = await prisma.providers.create({ data: providerData });
        savedProviders.push(saved);
        console.log(`  ✅ Created provider: ${providerData.name}`);
      }
    }

    // ============ 第二步：插入 Models ============
    console.log('\n🤖 Seeding Models...');

    const openai = savedProviders.find((p) => p.name === 'OpenAI');
    const anthropic = savedProviders.find((p) => p.name === 'Anthropic');
    const deepseek = savedProviders.find((p) => p.name === 'DeepSeek');
    const qwen = savedProviders.find((p) => p.name === 'Qwen');

    const models = [
      // OpenAI Models
      ...(openai
        ? [
            {
              providerId: openai.id,
              modelName: 'gpt-4-turbo',
              displayName: 'GPT-4 Turbo',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 1,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.01,
              outputCostPer1kTokens: 0.03,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 500,
              contextWindow: 128000,
              streaming: true,
              functionCalling: true,
              vision: false,
            },
            {
              providerId: openai.id,
              modelName: 'gpt-4o',
              displayName: 'GPT-4o',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 2,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.005,
              outputCostPer1kTokens: 0.015,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 500,
              contextWindow: 128000,
              streaming: true,
              functionCalling: true,
              vision: true,
            },
            {
              providerId: openai.id,
              modelName: 'gpt-3.5-turbo',
              displayName: 'GPT-3.5 Turbo',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 3,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.0005,
              outputCostPer1kTokens: 0.0015,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 1000,
              contextWindow: 16385,
              streaming: true,
              functionCalling: true,
              vision: false,
            },
          ]
        : []),
      // Anthropic Models
      ...(anthropic
        ? [
            {
              providerId: anthropic.id,
              modelName: 'claude-3-opus-20240229',
              displayName: 'Claude 3 Opus',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 1,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.015,
              outputCostPer1kTokens: 0.075,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 200,
              contextWindow: 200000,
              streaming: true,
              functionCalling: true,
              vision: true,
            },
            {
              providerId: anthropic.id,
              modelName: 'claude-3-sonnet-20240229',
              displayName: 'Claude 3 Sonnet',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 2,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.003,
              outputCostPer1kTokens: 0.015,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 200,
              contextWindow: 200000,
              streaming: true,
              functionCalling: true,
              vision: true,
            },
          ]
        : []),
      // DeepSeek Models
      ...(deepseek
        ? [
            {
              providerId: deepseek.id,
              modelName: 'deepseek-chat',
              displayName: 'DeepSeek Chat',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 1,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.0014,
              outputCostPer1kTokens: 0.0028,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 500,
              contextWindow: 32768,
              streaming: true,
              functionCalling: true,
              vision: false,
            },
            {
              providerId: deepseek.id,
              modelName: 'deepseek-coder',
              displayName: 'DeepSeek Coder',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: true,
              priority: 2,
              status: ModelStatus.ACTIVE,
              inputCostPer1kTokens: 0.0014,
              outputCostPer1kTokens: 0.0028,
              currency: Currency.USD,
              maxTokens: 4096,
              maxRequestsPerMinute: 500,
              contextWindow: 16384,
              streaming: true,
              functionCalling: true,
              vision: false,
            },
          ]
        : []),
      // Qwen Models
      ...(qwen
        ? [
            {
              providerId: qwen.id,
              modelName: 'qwen-max',
              displayName: 'Qwen Max',
              capabilityType: CapabilityType.TEXT_GENERATION,
              enabled: false,
              priority: 1,
              status: ModelStatus.INACTIVE,
              inputCostPer1kTokens: 0.002,
              outputCostPer1kTokens: 0.006,
              currency: Currency.CNY,
              maxTokens: 6000,
              maxRequestsPerMinute: 500,
              contextWindow: 30000,
              streaming: true,
              functionCalling: true,
              vision: false,
            },
          ]
        : []),
    ];

    for (const modelData of models) {
      const existing = await prisma.modelConfigs.findFirst({
        where: {
          providerId: modelData.providerId,
          modelName: modelData.modelName,
          capabilityType: modelData.capabilityType as any,
        },
      });

      if (existing) {
        console.log(
          `  ⏭️  Model "${modelData.modelName}" already exists, skipping`,
        );
      } else {
        await prisma.modelConfigs.create({ data: modelData as any });
        console.log(`  ✅ Created model: ${modelData.displayName}`);
      }
    }

    console.log('\n✅ Seed completed successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`  - Providers: ${savedProviders.length}`);
    console.log(`  - Models: ${models.length}`);

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  }
}

// 运行 seed
seed();
