import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedTestClient() {
  try {
    console.log('🚀 Starting test client seed...');
    console.log('✅ Database connection established');

    const apiKey = 'test-api-key-123';
    const apiSecret = 'test-secret-456';
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    // 1. Create or Update Client
    let client = await prisma.clients.findFirst({ where: { api_key: apiKey } });

    if (client) {
      console.log('ℹ️  Client already exists, updating secret...');
      client = await prisma.clients.update({
        where: { id: client.id },
        data: {
          api_secret: hashedSecret,
          status: 'active',
        },
      });
      console.log(`✅ Client updated: ${client.id}`);
    } else {
      console.log('📝 Creating new client...');
      client = await prisma.clients.create({
        data: {
          name: 'Test Client',
          api_key: apiKey,
          api_secret: hashedSecret,
          status: 'active',
          quota_config: {
            dailyQuota: 100,
            monthlyQuota: 1000,
          },
        },
      });
      console.log(`✅ Client created: ${client.id}`);
    }

    // 2. Grant Permissions
    const capabilityType = 'text.generation';
    let permission = await prisma.client_capability_permissions.findFirst({
      where: {
        client_id: client.id,
        capability_type: capabilityType,
      },
    });

    if (permission) {
      console.log(
        `ℹ️  Permission for ${capabilityType} already exists, updating...`,
      );
      await prisma.client_capability_permissions.update({
        where: { id: permission.id },
        data: {
          enabled: true,
          allowed_providers: JSON.stringify([
            'openai',
            'deepseek',
            'anthropic',
          ]),
          allowed_models: JSON.stringify([
            'gpt-3.5-turbo',
            'deepseek-chat',
            'gpt-4o',
            'gpt-4-turbo',
          ]),
        },
      });
      console.log(`✅ Permission updated`);
    } else {
      console.log(`📝 Creating permission for ${capabilityType}...`);
      await prisma.client_capability_permissions.create({
        data: {
          client_id: client.id,
          capability_type: capabilityType,
          enabled: true,
          rate_limit: 100,
          allowed_providers: JSON.stringify([
            'openai',
            'deepseek',
            'anthropic',
          ]),
          allowed_models: JSON.stringify([
            'gpt-3.5-turbo',
            'deepseek-chat',
            'gpt-4o',
            'gpt-4-turbo',
          ]),
        },
      });
      console.log(`✅ Permission created`);
    }

    console.log('\n✅ Test client seed completed successfully!');
    console.log(`  API Key:    ${apiKey}`);
    console.log(`  API Secret: ${apiSecret}`);
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedTestClient();
