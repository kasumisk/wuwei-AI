#!/bin/bash

# 简单的 SQL 脚本创建测试客户端和 DeepSeek 配置

psql -h localhost -U xiehaiji -d ai_platform <<EOF

-- 1. 创建测试客户端（如果不存在）
INSERT INTO clients (name, api_key, api_secret, status, rate_limit, quota_config)
SELECT 
    'Gateway 测试客户端',
    'test-api-key-123',
    '\$2b\$10\$6uVK.2Y3mQ9rLQ9kZJ2d0eXVZWJQGZ3xH7F8Y0xH7F8Y0xH7F8Y0x',
    'active',
    100,
    '{"dailyQuota": 10, "monthlyQuota": 100}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE api_key = 'test-api-key-123');

-- 获取客户端 ID
DO \$\$
DECLARE
    client_uuid UUID;
    config_id_openai UUID;
    config_id_deepseek_chat UUID;
    config_id_deepseek_reasoner UUID;
BEGIN
    SELECT id INTO client_uuid FROM clients WHERE api_key = 'test-api-key-123';
    
    -- 2. 创建 DeepSeek Chat 配置
    INSERT INTO capability_configs (capability_type, provider, model, config, is_active)
    VALUES ('text.generation', 'deepseek', 'deepseek-chat', '{"maxTokens": 4000}'::jsonb, true)
    ON CONFLICT (capability_type, provider, model) DO UPDATE SET is_active = true
    RETURNING id INTO config_id_deepseek_chat;
    
    -- 3. 创建 DeepSeek Reasoner 配置
    INSERT INTO capability_configs (capability_type, provider, model, config, is_active)
    VALUES ('text.generation', 'deepseek', 'deepseek-reasoner', '{"maxTokens": 32000}'::jsonb, true)
    ON CONFLICT (capability_type, provider, model) DO UPDATE SET is_active = true
    RETURNING id INTO config_id_deepseek_reasoner;
    
    -- 4. 为客户端授权 DeepSeek Chat
    INSERT INTO client_capability_permissions (client_id, capability_type, config_id, enabled, priority, max_requests_per_minute)
    VALUES (client_uuid, 'text.generation', config_id_deepseek_chat, true, 10, 100)
    ON CONFLICT (client_id, config_id) DO UPDATE SET enabled = true, priority = 10;
    
    -- 5. 为客户端授权 DeepSeek Reasoner
    INSERT INTO client_capability_permissions (client_id, capability_type, config_id, enabled, priority, max_requests_per_minute)
    VALUES (client_uuid, 'text.generation', config_id_deepseek_reasoner, true, 8, 100)
    ON CONFLICT (client_id, config_id) DO UPDATE SET enabled = true, priority = 8;
    
    RAISE NOTICE 'Test client and DeepSeek configurations created successfully!';
END \$\$;

-- 验证配置
SELECT 
    c.name,
    c.api_key,
    cc.provider,
    cc.model,
    ccp.priority,
    ccp.enabled
FROM clients c
JOIN client_capability_permissions ccp ON c.id = ccp.client_id
JOIN capability_configs cc ON ccp.config_id = cc.id
WHERE c.api_key = 'test-api-key-123'
ORDER BY ccp.priority DESC;

EOF

echo "✅ Database setup complete!"
echo "API Key: test-api-key-123"
echo "API Secret: test-secret-456"
