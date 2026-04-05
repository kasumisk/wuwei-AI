# Gateway 单元测试文档

## 概述

为 AI Platform Gateway 模块创建了完整的单元测试套件，覆盖核心功能和边缘情况。

## 测试文件结构

```
apps/server/test/
├── jest-unit.json                      # 单元测试 Jest 配置
├── jest-e2e.json                       # E2E 测试 Jest 配置
├── qwen.adapter.spec.ts                # Qwen 适配器测试 (30+ 测试用例)
├── gateway.service.spec.ts             # Gateway 服务测试 (20+ 测试用例)
├── capability-router.service.spec.ts   # 路由服务测试 (20+ 测试用例)
└── app.e2e-spec.ts                     # E2E 测试
```

## 测试覆盖

### 1. QwenAdapter (qwen.adapter.spec.ts)

**测试覆盖：**

- ✅ 初始化 (2 测试)
  - 正确初始化适配器
  - 未配置 API Key 时的警告

- ✅ generateText - 同步文本生成 (7 测试)
  - 成功生成文本
  - 使用默认模型
  - API 401 错误处理
  - API 429 速率限制
  - API 400 参数错误
  - API 500 服务器错误
  - 通用错误处理

- ✅ generateTextStream - 流式文本生成 (3 测试)
  - 成功生成流式文本
  - 流式错误处理
  - 流式数据解析错误处理

- ✅ generateImage - 图像生成 (4 测试)
  - 成功生成图像
  - 任务失败处理
  - 任务超时处理 (60秒)
  - 使用默认图像模型

- ✅ calculateCost - 成本计算 (3 测试)
  - 正确计算文本生成成本
  - 正确计算指定模型成本
  - 未知模型使用默认定价

- ✅ calculateImageCost - 图像成本计算 (3 测试)
  - 正确计算图像生成成本
  - 处理未知图像模型
  - 不同图像模型的成本计算

- ✅ 边缘情况 (3 测试)
  - 空提示词处理
  - 大量 token 请求
  - 特殊字符处理

**总计：30+ 测试用例**

### 2. GatewayService (gateway.service.spec.ts)

**测试覆盖：**

- ✅ validateClient - 客户端验证 (6 测试)
  - 成功验证有效凭据
  - 客户端不存在返回 null
  - 客户端被停用抛出异常
  - API Secret 不匹配返回 null
  - 数据库查询错误处理
  - bcrypt 比较错误处理

- ✅ recordUsage - 使用记录 (10 测试)
  - 成功记录使用情况
  - 处理缺少 usage 字段
  - 记录失败状态
  - 记录超时状态
  - 保存错误处理
  - 不同能力类型记录
  - 成本计算处理
  - 响应时间记录
  - 复杂元数据处理
  - 保存数据库错误

- ✅ 边缘情况 (4 测试)
  - 空字符串 API Key
  - 空字符串 API Secret
  - 零成本使用记录
  - 极短响应时间

**总计：20+ 测试用例**

### 3. CapabilityRouter (capability-router.service.spec.ts)

**测试覆盖：**

- ✅ route - 路由选择 (12 测试)
  - 成功路由到默认模型
  - 使用自定义端点和 API Key
  - 尊重允许的提供商列表
  - 尊重允许的模型列表
  - 验证请求的模型在允许列表中
  - 优先选择首选提供商
  - 没有可用模型时抛出异常
  - 选择优先级最高的模型
  - 处理没有权限配置的情况
  - 包含配置元数据
  - 禁用的提供商处理
  - 大小写不敏感的提供商匹配

- ✅ fallback - 故障转移 (6 测试)
  - 成功找到备用模型
  - 排除失败的提供商
  - 没有备用模型时返回 null
  - 处理空的排除列表
  - 使用自定义配置
  - 选择优先级最高的备用模型

- ✅ 边缘情况 (4 测试)
  - 数据库查询错误处理
  - 权限查询错误处理
  - 禁用的提供商处理
  - 禁用的模型处理

**总计：22+ 测试用例**

## Qwen 图像生成功能完善

### 实现细节

```typescript
/**
 * 图像生成
 * 使用通义万相 (Wanx) 图像生成 API
 */
async generateImage(request: GenerateImageRequest): Promise<GenerateImageResponse> {
  // 1. 提交异步任务
  const taskResponse = await imageClient.post('/text2image/generation', {
    model: model,
    input: { prompt: request.prompt },
    parameters: {
      size: `${width}*${height}`,
      n: request.n || 1,
    },
  });

  // 2. 轮询任务状态 (最多 60 秒)
  while (attempts < maxAttempts) {
    const statusResponse = await imageClient.get(`/text2image/generation/${taskId}`);
    if (taskStatus === 'SUCCEEDED') break;
    if (taskStatus === 'FAILED') throw error;
  }

  // 3. 返回图像 URL
  return { images, model, metadata };
}
```

### 支持的模型

- `wanx-v1` - 基础图像生成 (¥0.08/张)
- `wanx-sketch-to-image-v1` - 线稿生图 (¥0.08/张)
- `wanx-background-generation-v2` - 背景生成 (¥0.08/张)

### 错误处理

- ✅ API Key 无效 (401)
- ✅ 速率限制 (429)
- ✅ 参数错误 (400)
- ✅ 任务失败 (内容违规等)
- ✅ 任务超时 (60秒)

## 测试运行

### 运行所有单元测试

```bash
npm run test:unit
```

### 运行特定测试文件

```bash
npm run test:unit -- qwen.adapter.spec.ts
npm run test:unit -- gateway.service.spec.ts
npm run test:unit -- capability-router.service.spec.ts
```

### 查看测试覆盖率

```bash
npm run test:cov
```

### 观察模式

```bash
npm run test:watch
```

## 测试结果

```
Test Suites: 3 passed, 3 total
Tests:       64 passed, 64 total
Snapshots:   0 total
Time:        ~67s
```

## Mock 策略

### Axios Mock

```typescript
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockIsAxiosError = jest.fn();
(axios as any).isAxiosError = mockIsAxiosError;
```

### Repository Mock

```typescript
const mockRepository = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
};
```

### QueryBuilder Mock

```typescript
const queryBuilder = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  leftJoinAndSelect: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
};
```

## 配置文件

### jest-unit.json

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": "..",
  "testEnvironment": "node",
  "testRegex": "test/.*\\.spec\\.ts$",
  "moduleNameMapper": {
    "^@ai-platform/shared$": "<rootDir>/../../packages/shared/src",
    "^@ai-platform/constants$": "<rootDir>/../../packages/constants/src"
  }
}
```

## 最佳实践

1. **隔离性**：每个测试独立运行，使用 `beforeEach` 重置 mock
2. **清晰性**：测试名称描述预期行为
3. **完整性**：覆盖正常流程和错误流程
4. **真实性**：Mock 数据结构符合实际 API 响应
5. **性能**：使用 Mock 避免真实 API 调用

## 持续改进

- [ ] 添加集成测试
- [ ] 提高代码覆盖率至 90%+
- [ ] 添加性能基准测试
- [ ] 实现测试数据工厂
- [ ] 添加快照测试

## 相关文档

- [NestJS Testing](https://docs.nestjs.com/fundamentals/testing)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Qwen API Documentation](https://help.aliyun.com/zh/model-studio/)
