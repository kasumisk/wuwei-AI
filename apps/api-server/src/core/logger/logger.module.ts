import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import { Config } from '../config/configuration';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Config>) => {
        const logLevel =
          configService.get<string>('logger.level', { infer: true }) || 'info';

        return {
          transports: [
            new winston.transports.Console({
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.ms(),
                winston.format.colorize(),
                winston.format.printf((info) => {
                  const { timestamp, level, message, context, ...meta } = info;
                  return `${timestamp} [${level}] ${context ? `[${context}]` : ''} ${message} ${
                    Object.keys(meta).length ? JSON.stringify(meta) : ''
                  }`;
                }),
              ),
            }),
            new winston.transports.File({
              filename: 'logs/error.log',
              level: 'error',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
            new winston.transports.File({
              filename: 'logs/combined.log',
              format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json(),
              ),
            }),
          ],
          level: logLevel,
        };
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
