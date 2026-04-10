import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as path from 'path';

// 加载环境变量
config();

const rootDir = path.join(process.cwd(), 'src');

/**
 * TypeORM DataSource 配置
 * 用于运行 migrations
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'ai_platform',
  synchronize: false, // 生产环境必须为 false
  logging: process.env.NODE_ENV === 'development',
  entities: [
    path.join(rootDir, 'entities/**/*.entity.ts'),
    path.join(rootDir, 'modules/*/entities/*.entity.ts'),
  ],
  migrations: [path.join(rootDir, 'migrations/*.ts')],
  migrationsTableName: 'migrations',
  ...(process.env.DB_SSL === 'true' && {
    ssl: { rejectUnauthorized: false },
  }),
});
