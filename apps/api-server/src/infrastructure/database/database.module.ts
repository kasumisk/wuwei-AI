import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Config } from '../config/configuration';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Config>) => {
        const dbConfig = configService.get('database', { infer: true });
        if (!dbConfig) {
          throw new Error('Database configuration not found');
        }
        return {
          type: 'postgres' as const,
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.username,
          password: dbConfig.password,
          database: dbConfig.database,
          autoLoadEntities: true,
          synchronize: dbConfig.synchronize,
          logging: process.env.NODE_ENV === 'development',
          ...(dbConfig.ssl && {
            ssl: { rejectUnauthorized: false },
          }),
        };
      },
    }),
  ],
})
export class DatabaseModule {}
