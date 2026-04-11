import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { Config } from '../config/configuration';

/**
 * V6 1.13: 自定义 Winston 格式 — 从 CLS 注入 requestId / userId
 *
 * 由于 Winston 在 CLS 模块之前初始化，这里使用惰性 require 方式
 * 在日志写入时才从 CLS 读取上下文。ClsServiceManager 提供全局静态访问。
 */
const clsContextFormat = winston.format((info) => {
  try {
    // 惰性加载，避免模块初始化顺序问题
    const { ClsServiceManager } = require('nestjs-cls');
    const cls = ClsServiceManager.getClsService();
    if (cls && cls.isActive()) {
      info.requestId = cls.get('requestId');
      info.userId = cls.get('userId');
    }
  } catch {
    // CLS 未就绪时静默忽略
  }
  return info;
});

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
                clsContextFormat(),
                winston.format.colorize(),
                winston.format.printf((info) => {
                  const {
                    timestamp,
                    level,
                    message,
                    context,
                    requestId,
                    userId,
                    ...meta
                  } = info;
                  // V6 1.13: 日志行中包含 requestId 方便链路追踪
                  const ridTag = requestId ? `[${requestId}]` : '';
                  const uidTag = userId ? `[uid=${userId}]` : '';
                  const ctxTag = context ? `[${context}]` : '';
                  return `${timestamp} [${level}] ${ctxTag}${ridTag}${uidTag} ${message} ${
                    Object.keys(meta).length ? JSON.stringify(meta) : ''
                  }`;
                }),
              ),
            }),
            // V6.4: 日志轮转 — 错误日志每日轮转，保留 14 天
            new winston.transports.DailyRotateFile({
              filename: 'logs/error-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              level: 'error',
              maxFiles: '14d',
              maxSize: '50m',
              format: winston.format.combine(
                winston.format.timestamp(),
                clsContextFormat(),
                winston.format.json(),
              ),
            }),
            // V6.4: 日志轮转 — 综合日志每日轮转，保留 7 天
            new winston.transports.DailyRotateFile({
              filename: 'logs/combined-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxFiles: '7d',
              maxSize: '100m',
              format: winston.format.combine(
                winston.format.timestamp(),
                clsContextFormat(),
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
