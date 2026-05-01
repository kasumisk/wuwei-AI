import { NestFactory } from '@nestjs/core';
import {
  ValidationPipe,
  Logger,
  BadRequestException,
  ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { setupSwagger } from './core/swagger/swagger.config';
import { Config } from './core/config/configuration';
import { I18nService } from './core/i18n';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as bodyParser from 'body-parser';
import helmet from 'helmet';

async function bootstrap() {
  // ─── V6.4 P0: JWT 密钥启动校验 ───
  // 生产环境下必须设置 JWT_SECRET，否则拒绝启动
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  if (!process.env.JWT_SECRET) {
    if (isProduction) {
      Logger.error(
        '❌ JWT_SECRET 环境变量未设置！生产环境禁止使用默认密钥。',
        'Bootstrap',
      );
      process.exit(1);
    } else {
      Logger.warn(
        '⚠️ JWT_SECRET 未设置，使用开发默认值。生产环境必须配置此变量！',
        'Bootstrap',
      );
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get<ConfigService<Config>>(ConfigService);
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);

  app.useLogger(logger);

  // ─── V6.4 P0: 优雅关机 ───
  // 确保 SIGTERM/SIGINT 时正确关闭连接（Prisma、Redis、BullMQ）
  app.enableShutdownHooks();

  // ─── P0: Cloud Run / 反向代理信任 ───
  // 启用后 req.ip 才会从 X-Forwarded-For 取真实用户 IP（限流、审计依赖）
  app.set('trust proxy', 1);

  // ─── P0: 安全响应头（helmet） ───
  // - contentSecurityPolicy 关掉：仅 JSON API，未直出 HTML，开启反而会打架 Swagger 资源
  // - crossOriginEmbedderPolicy 关掉：避免影响第三方资源（图片 / Firebase）
  // - hidePoweredBy / noSniff / frameguard / hsts 等保留默认
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // ─── P0: 请求体大小限制（防 DoS） ───
  // 图片上传走 multipart/form-data（FileInterceptor），不受这里限制；
  // JSON / urlencoded 1MB 足够，超出 = 攻击或客户端 bug。
  app.use(bodyParser.json({ limit: '1mb' }));
  app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));

  const apiPrefix =
    configService.get<string>('app.apiPrefix', { infer: true }) || 'api';

  // ─── i18n: 翻译 class-validator 错误信息 ───
  // DTO 中 message 写 i18n key（如 'common.validation.emailInvalid'），
  // 这里在抛 400 前根据 CLS 中的 locale 翻译为最终字符串
  const i18nService = app.get(I18nService);
  const i18nKeyPrefixes = [
    'common.',
    'auth.',
    'user.',
    'diet.',
    'food.',
    'recipe.',
    'coach.',
    'decision.',
    'recommendation.',
    'notification.',
    'gamification.',
    'subscription.',
    'admin.',
    'file.',
    'rbac.',
    'provider.',
    'feature-flag.',
    'app-version.',
    'analytics.',
    'client.',
  ];
  const isI18nKey = (s: string): boolean =>
    typeof s === 'string' && i18nKeyPrefixes.some((p) => s.startsWith(p));
  const translateConstraints = (
    constraints: Record<string, string> | undefined,
  ): Record<string, string> | undefined => {
    if (!constraints) return constraints;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(constraints)) {
      out[k] = isI18nKey(v) ? i18nService.t(v) : v;
    }
    return out;
  };
  const walk = (errors: ValidationError[]): ValidationError[] =>
    errors.map((e) => {
      const cloned: ValidationError = {
        ...e,
        constraints: translateConstraints(e.constraints),
        children: e.children ? walk(e.children) : e.children,
      };
      return cloned;
    });

  // ─── V6.4 P0: 开启白名单验证（防 Mass Assignment） ───
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // 自动剥离 DTO 中未声明的字段（whitelist 静默丢弃，防 Mass Assignment）
      whitelist: true,
      // 不拒绝未知字段：前端框架会在 query 里附加 _t / _ 等防缓存参数，
      // 拒绝会导致大量正常请求 400。whitelist:true 已足够防止 Mass Assignment。
      forbidNonWhitelisted: false,
      // 开启错误信息（仅包含字段名和违反规则，不暴露原始值）
      disableErrorMessages: false,
      // V6.4 P0: 不泄露 DTO 结构和原始输入值
      validationError: {
        target: false,
        value: false,
      },
      exceptionFactory: (errors: ValidationError[]) => {
        const translated = walk(errors);
        // 收集首条错误信息作为 message
        const firstMsg = (() => {
          const collect = (es: ValidationError[]): string | undefined => {
            for (const e of es) {
              if (e.constraints) {
                const v = Object.values(e.constraints)[0];
                if (v) return v;
              }
              if (e.children?.length) {
                const c = collect(e.children);
                if (c) return c;
              }
            }
            return undefined;
          };
          return collect(translated);
        })();
        return new BadRequestException({
          statusCode: 400,
          message: firstMsg ?? i18nService.t('common.validation.invalid'),
          errors: translated,
        });
      },
    }),
  );

  app.setGlobalPrefix(apiPrefix);

  // ─── P0: CORS 白名单 ───
  // 从 ENV CORS_ORIGINS 读取（逗号分隔），未配置时：
  //   - 生产：完全禁用跨域（同源 API only）
  //   - 非生产：放开 origin:true 便于本地开发
  const corsOriginsEnv = (process.env.CORS_ORIGINS || '').trim();
  const corsOrigins = corsOriginsEnv
    ? corsOriginsEnv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (corsOrigins.length > 0) {
    app.enableCors({
      origin: (origin, callback) => {
        // 同源请求 / 移动端原生请求（无 Origin 头）一律放行
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        return callback(
          new Error(`CORS blocked: origin ${origin} not in whitelist`),
          false,
        );
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Accept-Language',
        'X-Request-Id',
        'X-Client-Version',
        'X-Platform',
      ],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    });
    Logger.log(
      `CORS whitelist enabled: ${corsOrigins.join(', ')}`,
      'Bootstrap',
    );
  } else if (!isProduction) {
    app.enableCors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    Logger.warn(
      'CORS_ORIGINS 未配置，开发环境放开所有 origin',
      'Bootstrap',
    );
  } else {
    // 生产环境且未配置：默认拒绝跨域（移动端 Flutter 走原生 HTTP，不受影响）
    Logger.log(
      'CORS_ORIGINS 未配置，生产环境默认禁用 CORS（仅同源访问）',
      'Bootstrap',
    );
  }

  // 设置 Swagger（仅非生产环境，或通过 ENABLE_SWAGGER=true 手动开启）
  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
    setupSwagger(app);
  }

  app.useStaticAssets(join(__dirname, '..', 'static'));

  const port = configService.get<number>('app.port', { infer: true }) || 3000;
  await app.listen(port, '0.0.0.0');

  const appUrl = await app.getUrl();
  Logger.log(`应用运行在: ${appUrl}`, 'Bootstrap');
  Logger.log(`环境: ${nodeEnv}`, 'Bootstrap');
  if (!isProduction || process.env.ENABLE_SWAGGER === 'true') {
    Logger.log(`Swagger文档: ${appUrl}/${apiPrefix}/docs`, 'Bootstrap');
  }
}

void bootstrap();
