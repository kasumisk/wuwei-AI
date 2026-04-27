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

  // ─── V6.4 P0: 请求体大小限制（防 DoS） ───
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));

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

  // 允许所有来源，无 CORS 限制
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['*'],
  });

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
