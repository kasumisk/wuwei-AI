import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * 全局异常过滤器
 *
 * 安全 / 可观测性目标：
 * 1. 永远不向客户端泄露：SQL 片段、文件路径、Stack、内部表名、第三方原始报错。
 * 2. Prisma 错误统一脱敏为业务语义信息（见 mapPrismaError）。
 * 3. production 环境隐藏 details / stack / errorName，仅返回 code + message。
 * 4. 5xx 全量记日志（含 stack）；4xx 仅记简短 warn，避免日志噪音。
 * 5. 输出 traceId（沿用上游 X-Request-Id 或随机 8 位），便于排障关联。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = this.getTraceId(request);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorName = 'InternalServerError';
    let details: unknown = undefined;

    // 1) Nest HttpException —— 信任 message，但仍按生产模式裁剪
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (exceptionResponse && typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, unknown>;
        const rawMessage = responseObj.message ?? exception.message;
        message = Array.isArray(rawMessage)
          ? rawMessage.join('; ')
          : String(rawMessage);
        errorName =
          (responseObj.error as string) || exception.name || errorName;
        details = responseObj.details;
      }
    }
    // 2) Prisma 错误 —— 必须脱敏，绝不允许把 SQL/字段/约束名透出去
    else if (
      exception instanceof Prisma.PrismaClientKnownRequestError ||
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError ||
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientInitializationError
    ) {
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      message = mapped.message;
      errorName = mapped.errorName;
    }
    // 3) 其它运行时错误 —— 全量隐藏，仅返回通用提示
    else if (exception instanceof Error) {
      // 不要把 exception.message 直接当 message 给客户端：
      // 例如 "ECONNREFUSED 127.0.0.1:5432" 会暴露内网拓扑
      errorName = exception.name || errorName;
      // 仅在非生产把原始 message 透出，方便联调
      if (!this.isProduction) {
        message = exception.message || message;
      }
    }

    // 5xx 全量记日志（含 stack）；4xx 仅 warn
    const logPayload = `[${request.method}] ${request.url} - ${status} - ${message} (trace=${traceId})`;
    if (status >= 500) {
      this.logger.error(
        logPayload,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else if (status >= 400) {
      this.logger.warn(logPayload);
    }

    // 在响应头透传 traceId，便于客户端上报
    response.setHeader('X-Request-Id', traceId);

    // 标准响应体；production 不返回 errorName / details
    const body: Record<string, unknown> = {
      code: status,
      message,
      success: false,
      data: null,
      traceId,
    };
    if (!this.isProduction) {
      body.error = errorName;
      if (details !== undefined) {
        body.details = details;
      }
    }

    response.status(status).json(body);
  }

  /**
   * 把 Prisma 错误码映射为业务语义错误。
   * 不返回任何内部字段名 / 表名 / 约束名 / SQL。
   * 完整错误码对照表：https://www.prisma.io/docs/orm/reference/error-reference
   */
  private mapPrismaError(exception: unknown): {
    status: number;
    message: string;
    errorName: string;
  } {
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          // Unique constraint violation
          return {
            status: HttpStatus.CONFLICT,
            message: 'Resource already exists',
            errorName: 'ConflictError',
          };
        case 'P2003':
          // Foreign key constraint violation
          return {
            status: HttpStatus.BAD_REQUEST,
            message: 'Related resource not found',
            errorName: 'BadRequestError',
          };
        case 'P2025':
          // Record not found
          return {
            status: HttpStatus.NOT_FOUND,
            message: 'Resource not found',
            errorName: 'NotFoundError',
          };
        case 'P2034':
          // Transaction conflict / deadlock
          return {
            status: HttpStatus.CONFLICT,
            message: 'Concurrent modification, please retry',
            errorName: 'ConflictError',
          };
        default:
          return {
            status: HttpStatus.BAD_REQUEST,
            message: 'Database constraint violation',
            errorName: 'DatabaseError',
          };
      }
    }
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Invalid request data',
        errorName: 'ValidationError',
      };
    }
    // Unknown / Rust panic / Init —— 一律降级为 500
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database service unavailable',
      errorName: 'DatabaseError',
    };
  }

  private getTraceId(request: Request): string {
    const incoming =
      (request.headers['x-request-id'] as string | undefined) ||
      (request.headers['x-cloud-trace-context'] as string | undefined);
    if (incoming) {
      // Cloud Trace 格式 "TRACE_ID/SPAN_ID;o=1"，只取 TRACE_ID
      return incoming.split('/')[0].split(';')[0].trim().slice(0, 64);
    }
    return Math.random().toString(36).slice(2, 10);
  }
}
