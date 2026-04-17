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
    let client = await prisma.clients.findFirst({ where: { apiKey: apiKey } });

    if (client) {
      console.log('ℹ️  Client already exists, updating secret...');
      client = await prisma.clients.update({
        where: { id: client.id },
        data: {
          apiSecret: hashedSecret,
          status: 'active',
        },
      });
      console.log(`✅ Client updated: ${client.id}`);
    } else {
      console.log('📝 Creating new client...');
      client = await prisma.clients.create({
        data: {
          name: 'Test Client',
          apiKey: apiKey,
          apiSecret: hashedSecret,
          status: 'active',
          quotaConfig: {
            dailyQuota: 100,
            monthlyQuota: 1000,
          },
        },
      });
      console.log(`✅ Client created: ${client.id}`);
    }

    // 2. Grant Permissions
    const capabilityType = 'text.generation';
    let permission = await prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: client.id,
        capabilityType: capabilityType,
      },
    });

    if (permission) {
      console.log(
        `ℹ️  Permission for ${capabilityType} already exists, updating...`,
      );
      await prisma.clientCapabilityPermissions.update({
        where: { id: permission.id },
        data: {
          enabled: true,
          allowedProviders: JSON.stringify(['openai', 'deepseek', 'anthropic']),
          allowedModels: JSON.stringify([
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
      await prisma.clientCapabilityPermissions.create({
        data: {
          clientId: client.id,
          capabilityType: capabilityType,
          enabled: true,
          rateLimit: 100,
          allowedProviders: JSON.stringify(['openai', 'deepseek', 'anthropic']),
          allowedModels: JSON.stringify([
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
