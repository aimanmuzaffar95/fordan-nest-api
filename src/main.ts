import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from './common/interceptors/success-response.interceptor';
import { setupOpenApi } from './openapi-setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  const corsExtra =
    process.env.CORS_EXTRA_ORIGINS?.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0) ?? [];

  const staticOrigins = [
    'http://localhost:8080', // docker dev web
    'http://localhost:8081', // local staging (vite preview)
    'http://localhost:5173', // host dev web (common vite default)
    'http://localhost:8090', // Flutter staff app web (see apps/staff_mobile README)
    'http://127.0.0.1:8090',
    'https://crm.fordan.com.au',
    'https://api.fordan.com.au',
    'https://dbprovider.us-west-1.clawcloudrun.com',
    ...corsExtra,
  ];

  const allowLocalhostPorts =
    process.env.CORS_ALLOW_LOCALHOST_PORTS === 'true' ||
    process.env.CORS_ALLOW_LOCALHOST_PORTS === '1';

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (staticOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      if (allowLocalhostPorts) {
        try {
          const { hostname } = new URL(origin);
          if (hostname === 'localhost' || hostname === '127.0.0.1') {
            callback(null, true);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Installer-Setup-Token',
      'X-Public-Lead-Secret',
    ],
    credentials: false,
    optionsSuccessStatus: 204,
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
