import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { setupSwagger } from './core/swagger/swagger.config';
import { Config } from './core/config/configuration';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get<ConfigService<Config>>(ConfigService);
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);

  app.useLogger(logger);

  // 开启详细的验证错误信息（Debug模式）
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false, // 暂时关闭以便调试
      // 关闭严格模式，允许额外字段（会自动过滤）
      forbidNonWhitelisted: false,
      // 开启详细错误信息
      disableErrorMessages: false,
      // 验证错误时返回详细信息
      validationError: {
        target: true,
        value: true,
      },
    }),
  );

  const apiPrefix =
    configService.get<string>('app.apiPrefix', { infer: true }) || 'api';
  app.setGlobalPrefix(apiPrefix);

  // 设置 CORS
  app.enableCors();

  // 设置 Swagger
  setupSwagger(app);

  app.useStaticAssets(join(__dirname, '..', 'static'));

  const port = configService.get<number>('app.port', { infer: true }) || 3000;
  await app.listen(port);

  const appUrl = await app.getUrl();
  Logger.log(`应用运行在: ${appUrl}`);
  Logger.log(`Swagger文档: ${appUrl}/${apiPrefix}/docs`);
}

void bootstrap();
