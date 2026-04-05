# 环境变量配置说明

请在项目根目录创建一个`.env`文件，并添加以下配置：

```
# 应用配置
NODE_ENV=development
PORT=3000

# 数据库配置 (目前已注释掉TypeORM功能，但保留配置项)
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_DATABASE=card3_provider
DB_SYNCHRONIZE=true

# 日志配置
LOG_LEVEL=debug

# API 配置
API_PREFIX=api
API_VERSION=v1

# OKX 配置
OKX_API_BASE_URL=https://web3.okx.com
OKX_PROJECT=你的Project ID
OKX_API_KEY=你的API密钥
OKX_SECRET_KEY=你的密钥
OKX_PASSPHRASE=你的API密码
OKX_WEB3_RPC_URL=https://eth.llamarpc.com

# 代理配置（如果需要）
PROXY_HOST=你的代理服务器地址
PROXY_PORT=代理端口
PROXY_USERNAME=代理用户名（如果需要认证）
PROXY_PASSWORD=代理密码（如果需要认证）

# 请求配置（可选）
REQUEST_TIMEOUT=10000
REQUEST_RETRIES=3
REQUEST_RETRY_DELAY=1000
```

## 如何获取OKX API密钥

1. 注册并登录OKX账户
2. 访问开发者控制台： https://www.okx.com/account/my-api
3. 创建一个新的API密钥，记录下API Key、Secret Key和Passphrase
4. **重要：** 创建应用程序并获取Project ID: https://www.okx.com/web3/build/dashboard
5. 将这些值设置到环境变量中

## API密钥与401错误

如果你遇到401 Unauthorized错误，请检查以下几点：

1. 确保正确配置了所有必要参数：
   - OKX_PROJECT - 项目ID
   - OKX_API_KEY - API密钥
   - OKX_SECRET_KEY - 密钥
   - OKX_PASSPHRASE - API密码

2. 签名验证失败可能的原因：
   - API密钥权限不足 - 确保API密钥有对应接口的权限
   - 时间戳不同步 - 服务器与OKX服务器的时间差异超过30秒
   - 签名生成算法问题 - 检查签名生成代码是否正确

3. 调试401错误：
   ```bash
   # 启用更详细的日志
   LOG_LEVEL=debug npm run start
   
   # 观察日志中的请求头和签名信息
   # 确保每个请求有正确的以下头信息：
   # - OK-ACCESS-PROJECT
   # - OK-ACCESS-KEY
   # - OK-ACCESS-SIGN
   # - OK-ACCESS-TIMESTAMP
   # - OK-ACCESS-PASSPHRASE
   ```

## 代理配置

如果你在中国大陆或其他需要使用代理才能访问OKX API的地区，请配置代理设置：

1. 设置 `PROXY_HOST` 为你的代理服务器地址
2. 设置 `PROXY_PORT` 为代理服务器端口
3. 如果代理需要认证，设置 `PROXY_USERNAME` 和 `PROXY_PASSWORD`

### 常见代理配置示例

#### HTTP代理
```
PROXY_HOST=127.0.0.1
PROXY_PORT=7890
```

#### 带认证的Socks5代理
```
PROXY_HOST=127.0.0.1
PROXY_PORT=1080
PROXY_USERNAME=user
PROXY_PASSWORD=pass
```

## Web3 RPC URL

如果您没有自己的Web3 RPC提供商，可以使用以下公共RPC URL之一：

- ETH Mainnet: https://eth.llamarpc.com 或 https://rpc.ankr.com/eth
- BSC: https://bsc-dataseed.binance.org
- Polygon: https://polygon-rpc.com

## OKX API ChainIndex参考

在使用历史价格API时，需要提供`chainIndex`参数，以下是常用区块链的chainIndex值：

- 0: Bitcoin
- 1: Ethereum
- 2: Arbitrum
- 56: BSC
- 137: Polygon
- 10: Optimism
- 42161: Arbitrum One
- 43114: Avalanche C-Chain

## 常见错误排查

### "fetch failed" 错误

如果遇到"fetch failed"错误，请检查：

1. 网络连接是否正常
2. 是否需要配置代理（尤其是在中国大陆等特殊网络环境）
3. API密钥、密钥和密码是否正确设置
4. 使用的API端点是否正确
5. OKX API是否有访问限制或额度限制

### "EHOSTDOWN" 或 "ECONNREFUSED" 错误

如果遇到连接被拒绝或主机无法连接的错误：

1. 检查您的网络环境是否需要使用代理
2. 确认配置的代理服务器是否正常运行
3. 尝试使用其他代理服务器
4. 如果使用公司网络，检查是否有防火墙限制

### CORS 跨域问题

如果遇到跨域问题，可以：
1. 确保请求中包含 `origin=*` 参数
2. 检查浏览器控制台中的具体错误信息
3. 考虑使用代理服务器中转请求

### 连接超时

如果请求超时，可以尝试：
1. 增加 REQUEST_TIMEOUT 环境变量的值
2. 增加 REQUEST_RETRIES 次数
3. 检查网络连接质量
4. 使用更靠近您地理位置的API服务器或代理

### 请求被拒绝

对于授权错误，请确保以下内容正确：
- API KEY格式正确
- SECRET KEY未泄露
- Passphrase与创建API时设置的一致
- API密钥有相应的权限

### 检查连接状态

可以使用健康检查API来验证服务连接状态：
```
GET /api/okx/health
```

这个端点会返回OKX API和Web3连接的健康状态。 