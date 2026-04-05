import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Config } from '../config/configuration';

export function setupSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService<Config>);
  const apiPrefix =
    configService.get('app.apiPrefix', { infer: true }) || 'api';
  const apiVersion =
    configService.get('app.apiVersion', { infer: true }) || 'v1';

  const config = new DocumentBuilder()
    .setTitle('Card3 Provider API')
    .setDescription('Card3 Provider API documentation')
    .setVersion(apiVersion)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
}
