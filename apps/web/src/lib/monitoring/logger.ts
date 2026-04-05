type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogData {
  [key: string]: unknown;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';

  private formatMessage(level: LogLevel, message: string, data?: LogData): string {
    const timestamp = new Date().toISOString();
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
  }

  private log(level: LogLevel, message: string, data?: LogData) {
    const formatted = this.formatMessage(level, message, data);

    if (this.isDevelopment) {
      // 开发环境直接打印到控制台
      console[level === 'debug' ? 'log' : level](formatted);
    } else {
      // 生产环境可以发送到日志服务
      // 例如: Sentry, LogRocket, Datadog 等
      // this.sendToLogService(level, message, data);
    }
  }

  info(message: string, data?: LogData) {
    this.log('info', message, data);
  }

  warn(message: string, data?: LogData) {
    this.log('warn', message, data);
  }

  error(message: string, data?: LogData) {
    this.log('error', message, data);
  }

  debug(message: string, data?: LogData) {
    if (this.isDevelopment) {
      this.log('debug', message, data);
    }
  }

  // 生产环境发送日志的方法（示例）
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private sendToLogService(level: LogLevel, message: string, data?: LogData) {
    // 实现发送到远程日志服务的逻辑
    // fetch('/api/logs', {
    //   method: 'POST',
    //   body: JSON.stringify({ level, message, data, timestamp: new Date().toISOString() })
    // });
  }
}

export const logger = new Logger();
