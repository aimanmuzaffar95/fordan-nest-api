import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from './../src/common/interceptors/success-response.interceptor';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api (GET)', async () => {
    const response: Response = await request(app.getHttpServer())
      .get('/api')
      .expect(200);

    const body: unknown = response.body;
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();

    const result = body as Record<string, unknown>;

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.message).toBe('Request successful');
    expect(result.data).toBe('Hello Aiman!');
    expect(typeof result.timestamp).toBe('string');
    expect(result.path).toBe('/api');
  });
});
