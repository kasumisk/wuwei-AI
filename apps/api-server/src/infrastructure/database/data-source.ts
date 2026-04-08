import { DataSource } from 'typeorm';
import { config } from 'dotenv';

config();

/**
 * TypeORM CLI DataSource — 仅用于 migration 命令
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'wuwei_ai',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: ['dist/modules/**/entities/*.entity.js'],
  migrations: ['dist/infrastructure/database/migrations/*.js'],
  migrationsTableName: 'migrations',
  ...(process.env.DB_SSL === 'true' && {
    ssl: { rejectUnauthorized: false },
  }),
});
