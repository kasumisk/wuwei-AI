# Gateway 模块测试指南

## 前置条件

1. **配置 OpenAI API Key**

   在 `.env` 文件中添加你的 OpenAI API Key：

   ```bash
   OPENAI_API_KEY=sk-your-openai-api-key
   ```

2. **确保数据库正在运行**

   ```bash
   cd apps/server
   docker-compose up -d postgres redis
   ```

3. **运行数据库迁移**（如果还没有运行）

   ```bash
   cd apps/server
   pnpm migration:run
   ```

## 初始化测试数据

运行以下命令创建测试客户端和配置：

```bash
cd apps/server
pnpm ts-node src/gateway/init-test-data.ts
```

这将创建：

- 测试客户端（API Key: `test-api-key-123`）
- OpenAI 能力配置（gpt-3.5-turbo 和 gpt-4o-mini）
- 客户端权限配置

## 启动服务器

```bash
cd apps/server
pnpm dev
```

服务器将在 `http://localhost:3000` 启动。

## 运行测试

在另一个终端窗口运行：

```bash
cd apps/server
pnpm ts-node src/gateway/test-gateway.ts
```

## 手动测试

使用 curl 或 Postman 测试 API：

### 1. 测试文本生成

```bash
curl -X POST http://localhost:3000/api/gateway/text/generation \
  -H "X-API-Key: test-api-key-123" \
  -H "X-API-Secret: test-secret-456" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "请用一句话介绍什么是人工智能",
    "temperature": 0.7,
    "maxTokens": 100
  }'
```

预期响应：

```json
{
  "success": true,
  "code": 200,
  "message": "文本生成成功",
  "data": {
    "text": "人工智能是...",
    "model": "gpt-3.5-turbo",
    "provider": "openai",
    "usage": {
      "promptTokens": 15,
      "completionTokens": 45,
      "totalTokens": 60
    },
    "cost": 0.00009,
    "latency": 1234,
    "finishReason": "stop"
  }
}
```

### 2. 测试无效的 API Key（应返回 401）

```bash
curl -X POST http://localhost:3000/api/gateway/text/generation \
  -H "X-API-Key: invalid-key" \
  -H "X-API-Secret: invalid-secret" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test"}'
```

### 3. 测试速率限制（发送超过限制的请求）

```bash
for i in {1..65}; do
  curl -X POST http://localhost:3000/api/gateway/text/generation \
    -H "X-API-Key: test-api-key-123" \
    -H "X-API-Secret: test-secret-456" \
    -H "Content-Type: application/json" \
    -d '{"prompt": "test", "maxTokens": 10}' &
done
wait
```

前 60 个请求应该成功，后续请求应返回 429 Too Many Requests。

### 4. 查看使用记录

在管理后台查看：

```
http://localhost:5173/clients
```

选择测试客户端，切换到"使用统计"标签页，可以看到：

- 总请求数
- 成功率
- 平均延迟
- 总费用
- Token 使用量
- 时间序列图表

## 验证功能

测试应该验证以下功能：

### ✅ 认证和授权

- [x] API Key 和 Secret 验证
- [x] 无效凭证返回 401
- [x] 能力权限检查

### ✅ 速率限制

- [x] 每分钟请求限制
- [x] 超限返回 429
- [x] 60秒后重置

### ✅ 配额管理

- [x] 日配额检查
- [x] 月配额检查
- [x] 超限返回 403

### ✅ 路由和故障转移

- [x] 根据优先级选择提供商
- [x] 主提供商失败时自动切换
- [x] 使用客户端的 preferredProvider

### ✅ 使用记录

- [x] 记录每次请求
- [x] 记录 token 使用量
- [x] 记录费用和延迟
- [x] 成功/失败状态

### ✅ 成本计算

- [x] 根据模型计算准确费用
- [x] 区分输入和输出 token 定价

## 故障排查

### 问题：获取 401 Unauthorized

**原因**：API Key 或 Secret 不正确

**解决方案**：

1. 确认已运行 `init-test-data.ts`
2. 检查数据库中的客户端记录
3. 确认使用正确的凭证

### 问题：获取 403 Forbidden

**原因**：可能是权限不足或配额超限

**解决方案**：

1. 检查客户端权限配置
2. 查看配额使用情况
3. 重置配额或增加限额

### 问题：获取 429 Too Many Requests

**原因**：超过速率限制

**解决方案**：

1. 等待 60 秒后重试
2. 调整 `maxRequestsPerMinute` 配置
3. 实施请求队列

### 问题：OpenAI API 错误

**原因**：OpenAI API Key 无效或配额用完

**解决方案**：

1. 检查 `.env` 中的 `OPENAI_API_KEY`
2. 验证 API Key 是否有效
3. 检查 OpenAI 账户余额

## 下一步

1. **添加更多提供商**：实现 Anthropic Claude、Google Gemini 等适配器
2. **流式响应**：实现 SSE 流式文本生成
3. **Redis 缓存**：替换内存缓存为 Redis
4. **监控告警**：添加 Prometheus 指标和告警
5. **单元测试**：编写完整的单元测试和集成测试

## 相关文档

- [Phase 3 Gateway Module 设计文档](../../../PHASE3_GATEWAY_MODULE.md)
- [API 响应格式](../API_RESPONSE_FORMAT.md)
- [API 使用示例](../API_USAGE_EXAMPLES.ts)
