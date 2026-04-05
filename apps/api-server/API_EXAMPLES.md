# OKX API 使用示例

本文档提供了OKX API的使用示例，帮助开发者快速上手。

## 健康检查

通过健康检查API可以检查OKX服务和Web3连接的可用性：

```bash
curl -X GET "http://localhost:3000/api/okx/health" \
  -H "Content-Type: application/json"
```

响应示例：

```json
{
  "status": "healthy",
  "okxApi": true,
  "web3": true,
  "timestamp": "2024-05-22T16:58:36.022Z"
}
```

## 实时币价API

### 获取单个代币价格

```bash
# 获取ETH上的ENS代币价格
curl -X GET "http://localhost:3000/api/okx/token-price/1/0xc18360217d8f7ab5e7c516566761ea12ce7f9d72" \
  -H "Content-Type: application/json"
```

响应示例：
```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "chainIndex": "1",
      "tokenAddress": "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72",
      "time": "1716892020000",
      "price": "26.458143090226812"
    }
  ]
}
```

### 批量获取代币价格

```bash
# 批量获取多个代币价格
curl -X POST "http://localhost:3000/api/okx/real-time-price" \
  -H "Content-Type: application/json" \
  -d '{
    "tokens": [
      {
        "chainIndex": "1",
        "tokenAddress": "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72"
      },
      {
        "chainIndex": "1",
        "tokenAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7"
      }
    ]
  }'
```

响应示例：
```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "chainIndex": "1",
      "tokenAddress": "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72",
      "time": "1716892020000",
      "price": "26.458143090226812"
    },
    {
      "chainIndex": "1",
      "tokenAddress": "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "time": "1716892020000",
      "price": "0.999751"
    }
  ]
}
```

**注意**：
- 每次最多可以批量查询100个代币的实时价格
- 实时币价API只支持代币（非原生主网币）

## 历史价格API使用示例

### HTTP请求示例

```bash
# 获取ETH的历史价格 (Ethereum, chainIndex=1)
curl -X GET "http://localhost:3000/api/okx/historical-price?chainIndex=1&period=5m&limit=5" \
  -H "Content-Type: application/json"

# 获取比特币的历史价格 (Bitcoin, chainIndex=0)
curl -X GET "http://localhost:3000/api/okx/historical-price?chainIndex=0&period=1d&limit=10" \
  -H "Content-Type: application/json"

# 获取USDT在BSC上的历史价格 (BSC, chainIndex=56)
curl -X GET "http://localhost:3000/api/okx/historical-price?chainIndex=56&tokenAddress=0x55d398326f99059ff775485246999027b3197955&period=1h&limit=10" \
  -H "Content-Type: application/json"

# 获取BRC-20代币(如ORDI)的历史价格
curl -X GET "http://localhost:3000/api/okx/historical-price?chainIndex=0&tokenAddress=btc-brc20-ordi&period=1d&limit=5" \
  -H "Content-Type: application/json"
```

### 请求参数说明

| 参数         | 类型     | 必填  | 描述                                                                                      |
|-------------|---------|------|------------------------------------------------------------------------------------------|
| chainIndex   | String  | 是    | 区块链唯一标识符 (如: 0=Bitcoin, 1=Ethereum, 56=BSC)                                       |
| tokenAddress | String  | 否    | 代币地址。1: 传递空字符串""查询对应链的原生代币; 2: 传递具体的代币合约地址; 3: 对于BRC-20等铭文代币，使用特定格式  |
| limit        | String  | 否    | 每次查询的条目数，默认50，最大200                                                           |
| cursor       | String  | 否    | 游标位置，默认为第一条                                                                     |
| begin        | String  | 否    | 开始查询历史价格的时间戳 (毫秒)                                                             |
| end          | String  | 否    | 结束查询历史价格的时间戳 (毫秒)。如果未提供begin和end，则查询当前时间之前的历史价格              |
| period       | String  | 否    | 时间间隔单位: 1m(1分钟), 5m(5分钟), 30m(30分钟), 1h(1小时), 1d(1天，默认)                  |

### 响应示例

```json
{
  "code": "0",
  "msg": "success",
  "data": [
    {
      "cursor": "31",
      "prices": [
        {
          "time": "1700040600000",
          "price": "1994.430000000000000000"
        },
        {
          "time": "1700040300000",
          "price": "1994.190000000000000000"
        },
        {
          "time": "1700040000000",
          "price": "1992.090000000000000000"
        },
        {
          "time": "1700039700000",
          "price": "1992.190000000000000000"
        },
        {
          "time": "1700039400000",
          "price": "1990.190000000000000000"
        }
      ]
    }
  ]
}
```

## 其他API示例

### 获取代币列表

```bash
curl -X GET "http://localhost:3000/api/okx/currencies" \
  -H "Content-Type: application/json"
```

### 获取钱包余额

```bash
curl -X GET "http://localhost:3000/api/okx/balance" \
  -H "Content-Type: application/json"
```

### 获取账户余额（Web3）

```bash
curl -X GET "http://localhost:3000/api/okx/web3/balance/0x1234567890123456789012345678901234567890" \
  -H "Content-Type: application/json"
```

### 构造交易

```bash
curl -X POST "http://localhost:3000/api/okx/web3/transfer" \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "0x1234567890123456789012345678901234567890",
    "toAddress": "0x0987654321098765432109876543210987654321",
    "amount": "0.1"
  }'
```

### 自定义API请求

```bash
curl -X POST "http://localhost:3000/api/okx/request?api=/api/v5/asset/currencies&method=GET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 错误处理与重试机制

系统已内置自动重试机制，当遇到以下错误时会自动重试：
- 网络超时
- 连接重置
- 管道错误

默认配置：
- 请求超时：10秒
- 最大重试次数：3次
- 重试间隔：1秒

如果依然无法连接，可能需要检查：
1. API密钥是否正确配置
2. 网络连接是否正常
3. OKX服务是否可用（可通过健康检查端点验证） 