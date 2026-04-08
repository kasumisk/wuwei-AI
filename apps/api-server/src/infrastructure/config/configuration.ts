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

export interface JwtConfig {
  readonly appSecret: string;
  readonly appExpiresIn: string;
  readonly adminSecret: string;
  readonly adminExpiresIn: string;
}

export interface LoggerConfig {
  readonly level: string;
}

export interface StorageConfig {
  endpoint?: string;
  region: string;
  accessKey?: string;
  secretKey?: string;
  bucket: string;
  publicUrl?: string;
}

export interface AiGatewayConfig {
  openrouterApiKey?: string;
  defaultModel: string;
}

export interface Config {
  readonly app: AppConfig;
  readonly database: DatabaseConfig;
  readonly jwt: JwtConfig;
  readonly logger: LoggerConfig;
  readonly storage: StorageConfig;
  readonly aiGateway: AiGatewayConfig;
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
    database: process.env.DB_DATABASE || 'wuwei_ai',
    synchronize:
      process.env.NODE_ENV !== 'production' &&
      process.env.DB_SYNCHRONIZE === 'true',
    ssl: process.env.DB_SSL === 'true',
  },
  jwt: {
    appSecret: process.env.JWT_APP_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me',
    appExpiresIn: process.env.JWT_APP_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '30d',
    adminSecret: process.env.JWT_ADMIN_SECRET || process.env.JWT_SECRET || 'dev-secret-change-me',
    adminExpiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '8h',
  },
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || 'auto',
    accessKey: process.env.STORAGE_ACCESS_KEY,
    secretKey: process.env.STORAGE_SECRET_KEY,
    bucket: process.env.STORAGE_BUCKET || 'uploads',
    publicUrl: process.env.STORAGE_PUBLIC_URL,
  },
  aiGateway: {
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    defaultModel: process.env.AI_DEFAULT_MODEL || 'openai/gpt-4o-mini',
  },
});
