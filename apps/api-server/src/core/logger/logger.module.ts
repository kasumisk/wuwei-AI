import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { Config } from '../config/configuration';

/**
 * V6 1.13 / V6.7 P1-3: 自定义 Winston 格式 — 从 CLS 注入 requestId / userId
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

/**
 * V6.7 P1-3: Cloud Run 结构化日志格式
 *
 * Cloud Run / Cloud Logging 要求 stdout 输出 JSON 对象（每行一条），
 * 并将 "severity" 字段映射为 Cloud Logging 日志级别。
 * - 开发环境：保留彩色 printf 格式，便于人类阅读
 * - 生产环境：输出纯 JSON，Cloud Logging 自动解析 severity / requestId / userId
 */
const cloudRunJsonFormat = winston.format((info) => {
  // 将 winston level 映射为 Cloud Logging severity
  const severityMap: Record<string, string> = {
    error: 'ERROR',
    warn: 'WARNING',
    info: 'INFO',
    http: 'INFO',
    verbose: 'DEBUG',
    debug: 'DEBUG',
    silly: 'DEBUG',
  };
  info.severity = severityMap[info.level] ?? 'DEFAULT';
  // Cloud Logging 使用 "message" 字段（Winston 默认已有）
  return info;
});

@Module({
  imports: [
    WinstonModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Config>) => {
        const logLevel =
          configService.get<string>('logger.level', { infer: true }) || 'info';
        const isProduction = process.env.NODE_ENV === 'production';

        /** Console transport: production → JSON (Cloud Run), dev → colorized printf */
        const consoleTransport = isProduction
          ? new winston.transports.Console({
              format: winston.format.combine(
                winston.format.timestamp(),
                clsContextFormat(),
                cloudRunJsonFormat(),
                // 去除 ANSI 颜色码，保证 JSON 干净
                winston.format.uncolorize(),
                winston.format.json(),
              ),
            })
          : new winston.transports.Console({
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
                    ms,
                    ...meta
                  } = info;
                  const ridTag = requestId ? `[${requestId}]` : '';
                  const uidTag = userId ? `[uid=${userId}]` : '';
                  const ctxTag = context ? `[${context}]` : '';
                  const msTag = ms ? ` ${ms}` : '';
                  return `${timestamp} [${level}]${msTag} ${ctxTag}${ridTag}${uidTag} ${message} ${
                    Object.keys(meta).length ? JSON.stringify(meta) : ''
                  }`;
                }),
              ),
            });

        const transports: winston.transport[] = [consoleTransport];

        // V6.4: 日志轮转 — 仅非 Cloud Run 容器环境保留文件日志
        // Cloud Run 为无状态容器，文件日志意义不大且浪费磁盘配额
        if (!isProduction) {
          transports.push(
            // 错误日志每日轮转，保留 14 天
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
            // 综合日志每日轮转，保留 7 天
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
          );
        }

        return { transports, level: logLevel };
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
