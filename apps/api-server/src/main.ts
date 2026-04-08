import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { setupSwagger } from './infrastructure/swagger/swagger.config';
import { Config } from './infrastructure/config/configuration';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get<ConfigService<Config>>(ConfigService);
  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);

  app.useLogger(logger);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      disableErrorMessages: false,
    }),
  );

  // No global prefix — routes already contain 'api/' segment
  app.enableCors();
  setupSwagger(app);

  app.useStaticAssets(join(__dirname, '..', 'static'));

  const port = configService.get<number>('app.port', { infer: true }) || 3000;
  await app.listen(port);

  const appUrl = await app.getUrl();
  Logger.log(`应用运行在: ${appUrl}`);
  Logger.log(`Swagger文档: ${appUrl}/api/docs`);
}

void bootstrap();
