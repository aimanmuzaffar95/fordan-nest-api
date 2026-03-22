import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { setupOpenApi } from './openapi-setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin: [
      'http://localhost:8080', // docker dev web
      'http://localhost:8081', // local staging (vite preview)
      'http://localhost:5173', // host dev web (common vite default)
      'https://crm.fordan.com.au',
      'https://api.fordan.com.au',
      'https://dbprovider.us-west-1.clawcloudrun.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Installer-Setup-Token',
      'X-Public-Lead-Secret',
    ],
    credentials: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new SuccessResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const openApi = setupOpenApi(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  if (openApi) {
    logger.log(`OpenAPI UI: http://localhost:${port}/api/docs`);
  }
}
void bootstrap();
