import * as bcrypt from 'bcrypt';
import AppDataSource from '../core/database/data-source-dev';
import { Client } from '../entities/client.entity';
import { ClientCapabilityPermission } from '../entities/client-capability-permission.entity';

async function seedTestClient() {
  try {
    console.log('🚀 Starting test client seed...');
    await AppDataSource.initialize();
    console.log('✅ Database connection established');

    const clientRepo = AppDataSource.getRepository(Client);
    const permissionRepo = AppDataSource.getRepository(
      ClientCapabilityPermission,
    );

    const apiKey = 'test-api-key-123';
    const apiSecret = 'test-secret-456';
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    // 1. Create or Update Client
    let client = await clientRepo.findOne({ where: { apiKey } });

    if (client) {
      console.log('ℹ️  Client already exists, updating secret...');
      client.apiSecret = hashedSecret;
      client.status = 'active';
      await clientRepo.save(client);
      console.log(`✅ Client updated: ${client.id}`);
    } else {
      console.log('📝 Creating new client...');
      client = clientRepo.create({
        name: 'Test Client',
        apiKey,
        apiSecret: hashedSecret,
        status: 'active',
        quotaConfig: {
          dailyQuota: 100,
          monthlyQuota: 1000,
        },
      });
      await clientRepo.save(client);
      console.log(`✅ Client created: ${client.id}`);
    }

    // 2. Grant Permissions
    const capabilityType = 'text.generation';
    let permission = await permissionRepo.findOne({
      where: {
        clientId: client.id,
        capabilityType,
      },
    });

    if (permission) {
      console.log(
        `ℹ️  Permission for ${capabilityType} already exists, updating...`,
      );
      permission.enabled = true;
      permission.allowedProviders = ['openai', 'deepseek', 'anthropic'];
      permission.allowedModels = [
        'gpt-3.5-turbo',
        'deepseek-chat',
        'gpt-4o',
        'gpt-4-turbo',
      ];
      await permissionRepo.save(permission);
      console.log(`✅ Permission updated`);
    } else {
      console.log(`📝 Creating permission for ${capabilityType}...`);
      permission = permissionRepo.create({
        clientId: client.id,
        capabilityType,
        enabled: true,
        rateLimit: 100,
        allowedProviders: ['openai', 'deepseek', 'anthropic'],
        allowedModels: [
          'gpt-3.5-turbo',
          'deepseek-chat',
          'gpt-4o',
          'gpt-4-turbo',
        ],
      });
      await permissionRepo.save(permission);
      console.log(`✅ Permission created`);
    }

    console.log('\n✅ Test client seed completed successfully!');
    console.log(`  API Key:    ${apiKey}`);
    console.log(`  API Secret: ${apiSecret}`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await AppDataSource.destroy();
  }
}

seedTestClient();
