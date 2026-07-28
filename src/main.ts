import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { setupOpenApi } from './openapi-setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Security headers. This is a JSON API (no server-rendered HTML), so the
  // default helmet CSP is unnecessary; keep the rest (HSTS, no-sniff, frameguard, etc.).
  app.use(helmet({ contentSecurityPolicy: false }));

  // Explicit request-body cap. The largest legitimate JSON payload is a base64
  // signature PNG (public-signature); 5mb covers it with headroom.
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  app.enableCors({
    origin: [
      'http://localhost:8080', // docker dev web
      'http://localhost:8081', // local staging (vite preview)
      'http://localhost:5173', // host dev web (common vite default)
      'http://127.0.0.1:8080',
      'http://127.0.0.1:8081',
      'http://127.0.0.1:5173',
      'https://crm.fordan.com.au',
      'https://api.fordan.com.au',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Installer-Setup-Token',
      'X-Public-Lead-Secret',
      'X-Public-Web-Base-Url',
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
  // Avoid IPv4-only binding so `localhost` checks work both on host and inside
  // the dev container, where `localhost` can resolve to `::1`.
  await app.listen(port);
  if (openApi) {
    logger.log(`OpenAPI UI: http://localhost:${port}/api/docs`);
  }
}
void bootstrap();
