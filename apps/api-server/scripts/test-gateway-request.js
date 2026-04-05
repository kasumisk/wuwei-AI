const axios = require('axios');

async function testGatewayRequest() {
  const apiKey = 'test-api-key-123';
  const apiSecret = 'test-api-secret-456';
  const gatewayUrl = 'http://localhost:3005/api/gateway/text/generation';

  console.log('🧪 测试 Gateway API 请求\n');
  console.log(`URL: ${gatewayUrl}`);
  console.log(`API Key: ${apiKey}`);
  console.log(`API Secret: ${apiSecret}\n`);

  try {
    // 发送请求 - 使用 OpenAI 标准的 messages 格式
    const response = await axios.post(
      gatewayUrl,
      {
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant.',
          },
          {
            role: 'user',
            content: '你好，请用一句话介绍你自己。',
          },
        ],
        model: 'deepseek-chat',
        temperature: 0.7,
        maxTokens: 100,
      },
      {
        headers: {
          'X-API-Key': apiKey,
          'X-API-Secret': apiSecret,
          'Content-Type': 'application/json',
        },
        validateStatus: null, // 接受所有状态码，方便查看错误信息
      },
    );

    console.log('✅ 请求成功！\n');
    console.log('响应状态:', response.status);
    console.log('响应数据:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ 请求失败！\n');

    if (error.response) {
      console.log('响应状态:', error.response.status);
      console.log('响应数据:', JSON.stringify(error.response.data, null, 2));
      console.log('\n发送的请求头:');
      console.log('  X-API-Key:', apiKey);
      console.log('  X-API-Secret:', apiSecret);
    } else {
      console.log('错误信息:', error.message);
    }
  }
}

testGatewayRequest();
