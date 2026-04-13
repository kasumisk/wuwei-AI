/**
 * 初始化 Gateway 测试数据
 * 创建测试客户端和能力配置
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';

// 加载环境变量
config();

async function initTestData() {
  console.log('🚀 开始初始化 Gateway 测试数据...\n');

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ 数据库连接成功\n');

    // 1. 创建测试客户端
    console.log('📝 创建测试客户端...');
    const apiKey = 'test-api-key-123';
    const apiSecret = 'test-secret-456';
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    // 检查客户端是否已存在
    const existingClient = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM clients WHERE api_key = ${apiKey}
    `;

    let clientId: string;

    if (existingClient.length > 0) {
      clientId = existingClient[0].id;
      console.log(`  ℹ️  测试客户端已存在 (ID: ${clientId})`);
    } else {
      const quotaConfig = JSON.stringify({
        dailyQuota: 10, // 日配额 $10
        monthlyQuota: 100, // 月配额 $100
      });
      const result = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO clients (
          name, 
          api_key, 
          api_secret, 
          status, 
          rate_limit,
          quota_config
        ) VALUES (${'Gateway 测试客户端'}, ${apiKey}, ${hashedSecret}, ${'active'}, ${100}, ${quotaConfig}::jsonb) RETURNING id
      `;
      clientId = result[0].id;
      console.log(`  ✅ 创建成功 (ID: ${clientId})`);
    }

    // 2. 创建或更新能力配置（OpenAI GPT-3.5）
    console.log('\n📝 创建能力配置...');

    const capabilityConfigs = [
      {
        capabilityType: 'text.generation',
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          maxTokens: 2000,
          temperature: 0.7,
        },
        isActive: true,
      },
      {
        capabilityType: 'text.generation',
        provider: 'openai',
        model: 'gpt-4o-mini',
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          maxTokens: 4000,
          temperature: 0.7,
        },
        isActive: true,
      },
      {
        capabilityType: 'text.generation',
        provider: 'deepseek',
        model: 'deepseek-chat',
        config: {
          apiKey: process.env.DEEPSEEK_API_KEY || '',
          maxTokens: 4000,
          temperature: 0.7,
        },
        isActive: true,
      },
      {
        capabilityType: 'text.generation',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        config: {
          apiKey: process.env.DEEPSEEK_API_KEY || '',
          maxTokens: 32000,
          temperature: 0.7,
        },
        isActive: true,
      },
    ];

    const configIds: string[] = [];

    for (const capConfig of capabilityConfigs) {
      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM capability_configs WHERE capability_type = ${capConfig.capabilityType} AND provider = ${capConfig.provider} AND model = ${capConfig.model}
      `;

      if (existing.length > 0) {
        const configId = existing[0].id;
        const configJson = JSON.stringify(capConfig.config);
        await prisma.$queryRaw`
          UPDATE capability_configs SET config = ${configJson}::jsonb, is_active = ${capConfig.isActive}, updated_at = NOW() WHERE id = ${configId}::uuid
        `;
        console.log(
          `  ℹ️  更新配置: ${capConfig.provider} ${capConfig.model} (ID: ${configId})`,
        );
        configIds.push(configId);
      } else {
        const configJson = JSON.stringify(capConfig.config);
        const result = await prisma.$queryRaw<{ id: string }[]>`
          INSERT INTO capability_configs (
            capability_type,
            provider,
            model,
            config,
            is_active
          ) VALUES (${capConfig.capabilityType}, ${capConfig.provider}, ${capConfig.model}, ${configJson}::jsonb, ${capConfig.isActive}) RETURNING id
        `;
        const configId = result[0].id;
        console.log(
          `  ✅ 创建配置: ${capConfig.provider} ${capConfig.model} (ID: ${configId})`,
        );
        configIds.push(configId);
      }
    }

    // 3. 创建客户端能力权限
    console.log('\n📝 配置客户端权限...');

    for (let i = 0; i < configIds.length; i++) {
      const configId = configIds[i];
      const capConfig = capabilityConfigs[i];

      const existing = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM client_capability_permissions WHERE client_id = ${clientId}::uuid AND config_id = ${configId}::uuid
      `;

      if (existing.length > 0) {
        const priority =
          capConfig.provider === 'openai'
            ? i === 0
              ? 10
              : 9
            : i === 2
              ? 8
              : 7;
        await prisma.$queryRaw`
          UPDATE client_capability_permissions SET enabled = ${true}, priority = ${priority}, updated_at = NOW() WHERE id = ${existing[0].id}::uuid
        `;
        console.log(
          `  ℹ️  更新权限: ${capConfig.provider} ${capConfig.model} (优先级: ${priority})`,
        );
      } else {
        const priority =
          capConfig.provider === 'openai'
            ? i === 0
              ? 10
              : 9
            : i === 2
              ? 8
              : 7;
        await prisma.$queryRaw`
          INSERT INTO client_capability_permissions (
            client_id,
            capability_type,
            config_id,
            enabled,
            priority,
            max_requests_per_minute
          ) VALUES (${clientId}::uuid, ${capConfig.capabilityType}, ${configId}::uuid, ${true}, ${priority}, ${100})
        `;
        console.log(
          `  ✅ 创建权限: ${capConfig.provider} ${capConfig.model} (优先级: ${priority})`,
        );
      }
    }

    console.log('\n✅ 测试数据初始化完成！');
    console.log('\n测试客户端凭证:');
    console.log(`  API Key:    ${apiKey}`);
    console.log(`  API Secret: ${apiSecret}`);
    console.log('\n你可以使用以下命令运行测试:');
    console.log('  pnpm ts-node src/gateway/test-gateway.ts');
  } catch (error) {
    console.error('❌ 初始化失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 运行初始化
initTestData().catch((error) => {
  console.error('初始化脚本执行出错:', error);
  process.exit(1);
});
