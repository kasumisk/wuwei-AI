# DeepSeek 适配器说明

## 概述

DeepSeek 适配器已成功集成到 Gateway 模块中，提供对 DeepSeek-V3.2-Exp 模型的访问。

## 支持的能力

### 1. **文本生成（Chat Completion）**

- ✅ 同步模式
- ✅ 流式模式（SSE）
- ✅ JSON 输出
- ✅ 函数调用（仅 deepseek-chat）
- ✅ 前缀补全（Beta）
- ✅ FIM 补全（Beta，仅 deepseek-chat）

## 支持的模型

### deepseek-chat

- **版本**: DeepSeek-V3.2-Exp（非思考模式）
- **上下文长度**: 128K tokens
- **最大输出**: 默认 4K，最大 8K
- **功能**:
  - ✅ JSON 输出
  - ✅ 函数调用
  - ✅ 前缀补全
  - ✅ FIM 补全
- **适用场景**: 快速对话、常规任务

### deepseek-reasoner

- **版本**: DeepSeek-V3.2-Exp（思考模式）
- **上下文长度**: 128K tokens
- **最大输出**: 默认 32K，最大 64K
- **功能**:
  - ✅ JSON 输出
  - ✅ 前缀补全
  - ❌ 函数调用（会自动回退到 deepseek-chat）
  - ❌ FIM 补全
- **适用场景**: 复杂推理、长篇生成

## 定价

### 费用（每百万 tokens）

| 类型               | 价格（USD） | 说明            |
| ------------------ | ----------- | --------------- |
| 输入（缓存未命中） | $0.28       | 常规输入 tokens |
| 输入（缓存命中）   | $0.028      | 10x 折扣        |
| 输出               | $0.42       | 所有输出 tokens |

### 成本优势

- 相比 OpenAI GPT-4: **便宜 100 倍以上**
- 相比 GPT-3.5-turbo: **便宜约 2 倍**
- 缓存命中时更加经济

## API 兼容性

DeepSeek API **完全兼容 OpenAI API 格式**，只需修改：

- Base URL: `https://api.deepseek.com`
- API Key: 使用 DeepSeek 提供的密钥

## 配置方法

### 1. 环境变量

在 `.env` 文件中添加：

```bash
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
```

### 2. 获取 API Key

访问 [DeepSeek 平台](https://platform.deepseek.com/) 注册并获取 API Key。

### 3. 初始化测试数据

```bash
cd apps/server
pnpm gateway:init
```

这将自动创建：

- DeepSeek chat 配置（优先级 8）
- DeepSeek reasoner 配置（优先级 7）
- 测试客户端权限

## 使用示例

### 基础文本生成

```bash
curl -X POST http://localhost:3000/api/gateway/text/generation \
  -H "X-API-Key: test-api-key-123" \
  -H "X-API-Secret: test-secret-456" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "请解释量子计算的基本原理",
    "model": "deepseek-chat",
    "temperature": 0.7,
    "maxTokens": 2000
  }'
```

### 使用思考模式

```bash
curl -X POST http://localhost:3000/api/gateway/text/generation \
  -H "X-API-Key: test-api-key-123" \
  -H "X-API-Secret: test-secret-456" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "设计一个高效的分布式缓存系统",
    "model": "deepseek-reasoner",
    "temperature": 0.7,
    "maxTokens": 32000
  }'
```

### 响应示例

```json
{
  "success": true,
  "code": 200,
  "message": "文本生成成功",
  "data": {
    "text": "量子计算是基于量子力学原理的计算方式...",
    "model": "deepseek-chat",
    "provider": "deepseek",
    "usage": {
      "promptTokens": 15,
      "completionTokens": 450,
      "totalTokens": 465
    },
    "cost": 0.000193,
    "latency": 2100,
    "finishReason": "stop"
  }
}
```

## 路由优先级

默认配置中的优先级（从高到低）：

1. **OpenAI GPT-3.5-turbo** - 优先级 10
2. **OpenAI GPT-4o-mini** - 优先级 9
3. **DeepSeek chat** - 优先级 8
4. **DeepSeek reasoner** - 优先级 7

可以通过修改客户端的 `preferredProvider` 字段来改变默认选择：

```sql
UPDATE clients
SET preferred_provider = 'deepseek'
WHERE api_key = 'test-api-key-123';
```

## 缓存优化

DeepSeek 支持提示词缓存（Prompt Cache），可以显著降低成本：

- **缓存命中**: 费用降低 90%
- **适用场景**: 重复的系统提示词、长上下文
- **自动启用**: API 会自动识别重复内容

### 成本计算

适配器提供两种成本计算方法：

1. **calculateCost()** - 保守估计（全部按缓存未命中）
2. **calculateCostWithCache()** - 精确计算（需要缓存信息）

```typescript
// 保守估计
const cost = adapter.calculateCost({
  promptTokens: 1000,
  completionTokens: 500,
  totalTokens: 1500,
});
// 约 $0.00049

// 精确计算（有缓存信息）
const cost = adapter.calculateCostWithCache(
  'deepseek-chat',
  { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
  { promptCacheHitTokens: 800, promptCacheMissTokens: 200 },
);
// 约 $0.000266（节省 46%）
```

## 性能特点

### 延迟

- **Chat 模式**: 通常 1-3 秒
- **Reasoner 模式**: 可能需要 5-15 秒（思考时间）

### 吞吐量

- 支持高并发请求
- 建议配置速率限制

### 可靠性

- 自动故障转移到其他提供商
- 详细的错误日志
- 请求重试机制

## 故障转移

如果 DeepSeek 请求失败，系统会自动：

1. 记录错误日志
2. 选择下一个可用提供商（如 OpenAI）
3. 重试请求
4. 记录故障转移元数据

```typescript
{
  metadata: {
    fallback: true,
    originalProvider: 'deepseek',
    error: 'API timeout'
  }
}
```

## 监控和日志

### 日志级别

- **DEBUG**: API 请求详情
- **INFO**: 成功的请求
- **WARN**: 非致命错误
- **ERROR**: 失败的请求

### 监控指标

- 请求数量
- 成功率
- 平均延迟
- Token 使用量
- 成本统计
- 缓存命中率（如果可用）

## 最佳实践

### 1. 模型选择

- **简单任务**: 使用 `deepseek-chat`（更快、更便宜）
- **复杂推理**: 使用 `deepseek-reasoner`（更准确）
- **函数调用**: 只能使用 `deepseek-chat`

### 2. 成本优化

- 重用系统提示词以利用缓存
- 设置合理的 `maxTokens` 限制
- 使用流式响应提升用户体验

### 3. 错误处理

- 配置合理的超时时间（120 秒）
- 启用自动故障转移
- 监控错误率

### 4. 安全性

- 妥善保管 API Key
- 使用环境变量，不要硬编码
- 定期轮换密钥
- 配置速率限制和配额

## 对比其他提供商

| 特性     | DeepSeek | OpenAI GPT-3.5 | OpenAI GPT-4 |
| -------- | -------- | -------------- | ------------ |
| 输入成本 | $0.28/M  | $0.5/M         | $30/M        |
| 输出成本 | $0.42/M  | $1.5/M         | $60/M        |
| 上下文   | 128K     | 16K            | 128K         |
| 思考模式 | ✅       | ❌             | ❌           |
| 缓存折扣 | 90%      | ❌             | 50%          |
| API 兼容 | OpenAI   | -              | -            |

## 限制和注意事项

1. **思考模式的函数调用**: `deepseek-reasoner` 不直接支持函数调用，会自动回退到 `deepseek-chat`
2. **超时设置**: Reasoner 模式建议设置更长的超时（120 秒）
3. **区域限制**: 检查 API 在你的地区是否可用
4. **配额管理**: 合理设置日/月配额以控制成本

## 技术支持

### 官方资源

- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [DeepSeek 平台](https://platform.deepseek.com/)
- [Discord 社区](https://discord.gg/Tc7c45Zzu5)

### 本项目相关

- 适配器代码: `apps/server/src/gateway/adapters/deepseek.adapter.ts`
- 测试脚本: `apps/server/src/gateway/test-gateway.ts`
- 初始化脚本: `apps/server/src/gateway/init-test-data.ts`

## 更新日志

### v1.0.0 (2024-11-04)

- ✅ 初始版本
- ✅ 支持 deepseek-chat 和 deepseek-reasoner
- ✅ 同步和流式文本生成
- ✅ 缓存感知的成本计算
- ✅ 完整的错误处理和日志
- ✅ 自动故障转移
- ✅ 集成测试工具

---

**状态**: ✅ 生产就绪  
**兼容性**: OpenAI API  
**推荐使用**: 高性价比场景
