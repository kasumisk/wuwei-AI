/**
 * 初始化 Gateway 测试数据
 * 创建测试客户端和能力配置
 */

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';

// 加载环境变量
config();

async function initTestData() {
  console.log('🚀 开始初始化 Gateway 测试数据...\n');

  // 创建数据库连接
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USER || 'xiehaiji',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ai_platform',
    entities: ['src/entities/*.entity.ts'],
    synchronize: false,
  });

  try {
    await dataSource.initialize();
    console.log('✅ 数据库连接成功\n');

    // 1. 创建测试客户端
    console.log('📝 创建测试客户端...');
    const apiKey = 'test-api-key-123';
    const apiSecret = 'test-secret-456';
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    // 检查客户端是否已存在
    const existingClient = await dataSource.query(
      'SELECT id FROM clients WHERE api_key = $1',
      [apiKey],
    );

    let clientId: string;

    if (existingClient.length > 0) {
      clientId = existingClient[0].id;
      console.log(`  ℹ️  测试客户端已存在 (ID: ${clientId})`);
    } else {
      const result = await dataSource.query(
        `INSERT INTO clients (
          name, 
          api_key, 
          api_secret, 
          status, 
          rate_limit,
          quota_config
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          'Gateway 测试客户端',
          apiKey,
          hashedSecret,
          'active',
          100, // 每分钟 100 次请求
          JSON.stringify({
            dailyQuota: 10, // 日配额 $10
            monthlyQuota: 100, // 月配额 $100
          }),
        ],
      );
      clientId = result[0].id;
      console.log(`  ✅ 创建成功 (ID: ${clientId})`);
    }

    // 2. 创建或更新能力配置（OpenAI GPT-3.5）
    console.log('\n📝 创建能力配置...');

    const capabilityConfigs = [
      {
        capability_type: 'text.generation',
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          maxTokens: 2000,
          temperature: 0.7,
        },
        is_active: true,
      },
      {
        capability_type: 'text.generation',
        provider: 'openai',
        model: 'gpt-4o-mini',
        config: {
          apiKey: process.env.OPENAI_API_KEY || '',
          maxTokens: 4000,
          temperature: 0.7,
        },
        is_active: true,
      },
      {
        capability_type: 'text.generation',
        provider: 'deepseek',
        model: 'deepseek-chat',
        config: {
          apiKey: process.env.DEEPSEEK_API_KEY || '',
          maxTokens: 4000,
          temperature: 0.7,
        },
        is_active: true,
      },
      {
        capability_type: 'text.generation',
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        config: {
          apiKey: process.env.DEEPSEEK_API_KEY || '',
          maxTokens: 32000,
          temperature: 0.7,
        },
        is_active: true,
      },
    ];

    const configIds: string[] = [];

    for (const config of capabilityConfigs) {
      const existing = await dataSource.query(
        'SELECT id FROM capability_configs WHERE capability_type = $1 AND provider = $2 AND model = $3',
        [config.capability_type, config.provider, config.model],
      );

      if (existing.length > 0) {
        const configId = existing[0].id;
        await dataSource.query(
          'UPDATE capability_configs SET config = $1, is_active = $2, updated_at = NOW() WHERE id = $3',
          [JSON.stringify(config.config), config.is_active, configId],
        );
        console.log(
          `  ℹ️  更新配置: ${config.provider} ${config.model} (ID: ${configId})`,
        );
        configIds.push(configId);
      } else {
        const result = await dataSource.query(
          `INSERT INTO capability_configs (
            capability_type,
            provider,
            model,
            config,
            is_active
          ) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [
            config.capability_type,
            config.provider,
            config.model,
            JSON.stringify(config.config),
            config.is_active,
          ],
        );
        const configId = result[0].id;
        console.log(
          `  ✅ 创建配置: ${config.provider} ${config.model} (ID: ${configId})`,
        );
        configIds.push(configId);
      }
    }

    // 3. 创建客户端能力权限
    console.log('\n📝 配置客户端权限...');

    for (let i = 0; i < configIds.length; i++) {
      const configId = configIds[i];
      const config = capabilityConfigs[i];

      const existing = await dataSource.query(
        'SELECT id FROM client_capability_permissions WHERE client_id = $1 AND config_id = $2',
        [clientId, configId],
      );

      if (existing.length > 0) {
        const priority =
          config.provider === 'openai' ? (i === 0 ? 10 : 9) : i === 2 ? 8 : 7;
        await dataSource.query(
          'UPDATE client_capability_permissions SET enabled = $1, priority = $2, updated_at = NOW() WHERE id = $3',
          [true, priority, existing[0].id],
        );
        console.log(
          `  ℹ️  更新权限: ${config.provider} ${config.model} (优先级: ${priority})`,
        );
      } else {
        await dataSource.query(
          `INSERT INTO client_capability_permissions (
            client_id,
            capability_type,
            config_id,
            enabled,
            priority,
            max_requests_per_minute
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            clientId,
            config.capability_type,
            configId,
            true,
            // OpenAI 优先级 10/9, DeepSeek 优先级 8/7
            config.provider === 'openai' ? (i === 0 ? 10 : 9) : i === 2 ? 8 : 7,
            100, // 统一速率限制
          ],
        );
        console.log(
          `  ✅ 创建权限: ${config.provider} ${config.model} (优先级: ${config.provider === 'openai' ? (i === 0 ? 10 : 9) : i === 2 ? 8 : 7})`,
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
    await dataSource.destroy();
  }
}

// 运行初始化
initTestData().catch((error) => {
  console.error('初始化脚本执行出错:', error);
  process.exit(1);
});
