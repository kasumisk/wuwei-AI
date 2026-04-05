/**
 * Gateway 测试脚本
 * 用于测试文本生成 API 的完整流程
 */

import axios from 'axios';

const API_BASE_URL = 'http://localhost:3005';

// 测试用的 API Key 和 Secret
// 注意：需要在数据库中先创建测试客户端
const TEST_API_KEY = 'test-api-key-123';
const TEST_API_SECRET = 'test-secret-456';

/**
 * 测试文本生成
 */
async function testTextGeneration() {
  console.log('🧪 开始测试文本生成 API...\n');

  try {
    const response = await axios.post(
      `${API_BASE_URL}/api/gateway/text/generation`,
      {
        prompt: '请用一句话介绍什么是人工智能',
        temperature: 0.7,
        maxTokens: 100,
      },
      {
        headers: {
          'X-API-Key': TEST_API_KEY,
          'X-API-Secret': TEST_API_SECRET,
          'Content-Type': 'application/json',
        },
      },
    );

    console.log('✅ 请求成功！\n');
    console.log('响应数据:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    console.error('❌ 请求失败！\n');

    if (error.response) {
      // 服务器返回了错误响应
      console.error('状态码:', error.response.status);
      console.error('错误信息:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // 请求发送但没有收到响应
      console.error('无响应:', error.message);
    } else {
      // 其他错误
      console.error('错误:', error.message);
    }
  }
}

/**
 * 测试速率限制
 */
async function testRateLimit() {
  console.log('\n🧪 开始测试速率限制...\n');

  type TestResult = {
    success: boolean;
    index: number;
    rateLimit?: boolean;
    error?: string;
  };

  const requests: Promise<TestResult>[] = [];
  const totalRequests = 65; // 超过默认的 60 次/分钟限制

  for (let i = 0; i < totalRequests; i++) {
    requests.push(
      axios
        .post(
          `${API_BASE_URL}/api/gateway/text/generation`,
          {
            prompt: `测试请求 ${i + 1}`,
            maxTokens: 10,
          },
          {
            headers: {
              'X-API-Key': TEST_API_KEY,
              'X-API-Secret': TEST_API_SECRET,
              'Content-Type': 'application/json',
            },
          },
        )
        .then(() => {
          console.log(`✅ 请求 ${i + 1} 成功`);
          return { success: true, index: i + 1 };
        })
        .catch((error) => {
          if (error.response?.status === 429) {
            console.log(`🚫 请求 ${i + 1} 被限制（429）`);
            return { success: false, rateLimit: true, index: i + 1 };
          }
          console.log(`❌ 请求 ${i + 1} 失败: ${error.message}`);
          return { success: false, error: error.message, index: i + 1 };
        }),
    );
  }

  const results = await Promise.all(requests);
  const successCount = results.filter((r) => r.success).length;
  const rateLimitCount = results.filter((r) => r.rateLimit).length;

  console.log('\n📊 速率限制测试结果:');
  console.log(`  成功请求: ${successCount}`);
  console.log(`  被限制请求: ${rateLimitCount}`);
  console.log(`  其他失败: ${results.length - successCount - rateLimitCount}`);
}

/**
 * 测试无效的 API Key
 */
async function testInvalidApiKey() {
  console.log('\n🧪 开始测试无效的 API Key...\n');

  try {
    await axios.post(
      `${API_BASE_URL}/api/gateway/text/generation`,
      {
        prompt: '测试',
      },
      {
        headers: {
          'X-API-Key': 'invalid-key',
          'X-API-Secret': 'invalid-secret',
          'Content-Type': 'application/json',
        },
      },
    );

    console.log('❌ 应该返回 401 错误');
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.log('✅ 正确返回 401 未授权错误');
      console.log('错误信息:', error.response.data);
    } else {
      console.log('❌ 返回了意外的错误码:', error.response?.status);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 Gateway API 测试套件\n');
  console.log('='.repeat(50));

  // 检查服务器是否运行
  try {
    await axios.get(`${API_BASE_URL}/health`);
    console.log('✅ 服务器正在运行\n');
  } catch (error) {
    console.error('❌ 无法连接到服务器，请确保服务器正在运行');
    process.exit(1);
  }

  // 运行测试
  await testTextGeneration();
  await testInvalidApiKey();

  // 可选：取消注释以测试速率限制（会发送大量请求）
  // await testRateLimit();

  console.log('\n' + '='.repeat(50));
  console.log('✅ 测试完成！');
}

// 运行测试
main().catch((error) => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
