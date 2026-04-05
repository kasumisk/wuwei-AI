export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly synchronize: boolean;
  readonly ssl: boolean;
}

export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly apiPrefix: string;
  readonly apiVersion: string;
}

export interface LoggerConfig {
  readonly level: string;
}

export interface OkxConfig {
  apiBaseUrl?: string;
  project?: string;
  apiKey?: string;
  secretKey?: string;
  passphrase?: string;
  web3RpcUrl?: string;
  web3ApiUrl?: string;
}

export interface ProxyConfig {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
}

export interface StorageConfig {
  endpoint?: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  publicUrl?: string;
}

export interface Config {
  readonly app: AppConfig;
  readonly database: DatabaseConfig;
  readonly logger: LoggerConfig;
  readonly okx: OkxConfig;
  readonly proxy: ProxyConfig;
  readonly storage: StorageConfig;
}

export default (): Config => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'card3_provider',
    // 生产环境（NODE_ENV=production）永远禁用 synchronize，防止 TypeORM schema-sync 报错
    synchronize:
      process.env.NODE_ENV !== 'production' &&
      process.env.DB_SYNCHRONIZE === 'true',
    ssl: process.env.DB_SSL === 'true',
  },
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  okx: {
    apiBaseUrl: process.env.OKX_API_BASE_URL,
    project: process.env.OKX_PROJECT,
    apiKey: process.env.OKX_API_KEY,
    secretKey: process.env.OKX_SECRET_KEY,
    passphrase: process.env.OKX_PASSPHRASE,
    web3RpcUrl: process.env.OKX_WEB3_RPC_URL,
    web3ApiUrl: process.env.OKX_WEB3_API_URL,
  },
  proxy: {
    host: process.env.PROXY_HOST,
    port: process.env.PROXY_PORT
      ? parseInt(process.env.PROXY_PORT, 10)
      : undefined,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || 'auto',
    accessKey: process.env.STORAGE_ACCESS_KEY,
    secretKey: process.env.STORAGE_SECRET_KEY,
    bucket: process.env.STORAGE_BUCKET || 'uploads',
    publicUrl: process.env.STORAGE_PUBLIC_URL,
  },
});
