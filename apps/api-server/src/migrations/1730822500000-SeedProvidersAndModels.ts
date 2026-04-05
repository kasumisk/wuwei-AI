import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始化 Providers 和 Models 配置
 *
 * 该迁移将：
 * 1. 插入常用的 AI Provider（OpenAI, Anthropic, DeepSeek, Qwen等）
 * 2. 为每个 Provider 插入常用的模型配置
 */
export class SeedProvidersAndModels1730822500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============ 第一步：插入 Providers ============

    await queryRunner.query(`
      -- OpenAI
      INSERT INTO providers (
        id,
        name,
        type,
        "baseUrl",
        "apiKey",
        enabled,
        "healthCheckUrl",
        timeout,
        "retryCount",
        status,
        metadata,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'OpenAI',
        'openai',
        'https://api.openai.com/v1',
        'sk-placeholder-change-me',
        true,
        'https://api.openai.com/v1/models',
        30000,
        3,
        'active',
        '{"description": "OpenAI official API"}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (name) DO NOTHING;

      -- Anthropic
      INSERT INTO providers (
        id,
        name,
        type,
        "baseUrl",
        "apiKey",
        enabled,
        "healthCheckUrl",
        timeout,
        "retryCount",
        status,
        metadata,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Anthropic',
        'anthropic',
        'https://api.anthropic.com/v1',
        'sk-ant-placeholder-change-me',
        true,
        'https://api.anthropic.com/v1/messages',
        30000,
        3,
        'active',
        '{"description": "Anthropic Claude API"}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (name) DO NOTHING;

      -- DeepSeek
      INSERT INTO providers (
        id,
        name,
        type,
        "baseUrl",
        "apiKey",
        enabled,
        "healthCheckUrl",
        timeout,
        "retryCount",
        status,
        metadata,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'DeepSeek',
        'deepseek',
        'https://api.deepseek.com/v1',
        'sk-placeholder-change-me',
        true,
        'https://api.deepseek.com/v1/models',
        30000,
        3,
        'active',
        '{"description": "DeepSeek API"}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (name) DO NOTHING;

      -- 阿里云通义千问
      INSERT INTO providers (
        id,
        name,
        type,
        "baseUrl",
        "apiKey",
        enabled,
        "healthCheckUrl",
        timeout,
        "retryCount",
        status,
        metadata,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Qwen',
        'qwen',
        'https://dashscope.aliyuncs.com/api/v1',
        'sk-placeholder-change-me',
        true,
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        30000,
        3,
        'active',
        '{"description": "阿里云通义千问 API"}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (name) DO NOTHING;

      -- Google Gemini
      INSERT INTO providers (
        id,
        name,
        type,
        "baseUrl",
        "apiKey",
        enabled,
        "healthCheckUrl",
        timeout,
        "retryCount",
        status,
        metadata,
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid(),
        'Google',
        'google',
        'https://generativelanguage.googleapis.com/v1',
        'AIza-placeholder-change-me',
        false,
        'https://generativelanguage.googleapis.com/v1/models',
        30000,
        3,
        'inactive',
        '{"description": "Google Gemini API"}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      ) ON CONFLICT (name) DO NOTHING;
    `);

    // ============ 第二步：插入 Models ============

    await queryRunner.query(`
      -- OpenAI Models
      INSERT INTO model_configs (
        id,
        "providerId",
        "modelName",
        "displayName",
        "capabilityType",
        enabled,
        priority,
        status,
        "inputCostPer1kTokens",
        "outputCostPer1kTokens",
        currency,
        "maxTokens",
        "maxRequestsPerMinute",
        "contextWindow",
        streaming,
        "functionCalling",
        vision,
        "createdAt",
        "updatedAt"
      )
      SELECT
        gen_random_uuid(),
        p.id,
        'gpt-4-turbo',
        'GPT-4 Turbo',
        'text.generation',
        true,
        1,
        'active',
        0.01,
        0.03,
        'USD',
        4096,
        500,
        128000,
        true,
        true,
        false,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM providers p
      WHERE p.name = 'OpenAI'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'gpt-4o', 'GPT-4o', 'text.generation',
        true, 2, 'active', 0.005, 0.015,
        'USD', 4096, 500, 128000,
        true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'OpenAI'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'gpt-3.5-turbo', 'GPT-3.5 Turbo', 'text.generation',
        true, 3, 'active', 0.0005, 0.0015,
        'USD', 4096, 1000, 16385,
        true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'OpenAI'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'text-embedding-3-large', 'Text Embedding 3 Large', 'text.embedding',
        true, 1, 'active', 0.00013, 0,
        'USD', 8191, 1000, 8191,
        false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'OpenAI'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'dall-e-3', 'DALL-E 3', 'image.generation',
        true, 1, 'active', 0.04, 0,
        'USD', 1024, 50, 1024,
        false, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'OpenAI'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      -- Anthropic Models
      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'claude-3-opus-20240229', 'Claude 3 Opus', 'text.generation',
        true, 1, 'active', 0.015, 0.075,
        'USD', 4096, 200, 200000,
        true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Anthropic'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'claude-3-sonnet-20240229', 'Claude 3 Sonnet', 'text.generation',
        true, 2, 'active', 0.003, 0.015,
        'USD', 4096, 200, 200000,
        true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Anthropic'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'claude-3-haiku-20240307', 'Claude 3 Haiku', 'text.generation',
        true, 3, 'active', 0.00025, 0.00125,
        'USD', 4096, 300, 200000,
        true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Anthropic'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      -- DeepSeek Models
      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'deepseek-chat', 'DeepSeek Chat', 'text.generation',
        true, 1, 'active', 0.0014, 0.0028,
        'USD', 4096, 500, 32768,
        true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'DeepSeek'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'deepseek-coder', 'DeepSeek Coder', 'text.generation',
        true, 2, 'active', 0.0014, 0.0028,
        'USD', 4096, 500, 16384,
        true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'DeepSeek'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      -- Qwen Models
      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'qwen-max', 'Qwen Max', 'text.generation',
        true, 1, 'active', 0.002, 0.006,
        'CNY', 6000, 500, 30000,
        true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Qwen'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'qwen-plus', 'Qwen Plus', 'text.generation',
        true, 2, 'active', 0.0004, 0.0012,
        'CNY', 6000, 1000, 30000,
        true, true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Qwen'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'qwen-turbo', 'Qwen Turbo', 'text.generation',
        true, 3, 'active', 0.0002, 0.0006,
        'CNY', 6000, 2000, 8000,
        true, false, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Qwen'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;

      INSERT INTO model_configs (
        id, "providerId", "modelName", "displayName", "capabilityType",
        enabled, priority, status, "inputCostPer1kTokens", "outputCostPer1kTokens",
        currency, "maxTokens", "maxRequestsPerMinute", "contextWindow",
        streaming, "functionCalling", vision, "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), p.id, 'qwen-vl-plus', 'Qwen VL Plus', 'text.generation',
        true, 4, 'active', 0.0008, 0.0024,
        'CNY', 6000, 500, 8000,
        true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM providers p WHERE p.name = 'Qwen'
      ON CONFLICT ("providerId", "modelName", "capabilityType") DO NOTHING;
    `);

    console.log('✅ Successfully seeded providers and models');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚：删除所有初始化的数据
    await queryRunner.query(`
      -- 删除所有模型配置
      DELETE FROM model_configs WHERE "providerId" IN (
        SELECT id FROM providers WHERE name IN ('OpenAI', 'Anthropic', 'DeepSeek', 'Qwen', 'Google')
      );

      -- 删除所有提供商
      DELETE FROM providers WHERE name IN ('OpenAI', 'Anthropic', 'DeepSeek', 'Qwen', 'Google');
    `);

    console.log('⏪ Rolled back providers and models seed');
  }
}
