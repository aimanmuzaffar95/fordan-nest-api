import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/api (GET)', async () => {
    const response = await request(app.getHttpServer()).get('/api').expect(200);

    expect(response.body).toEqual({
      success: true,
      statusCode: 200,
      message: 'Request successful',
      data: 'Hello World!',
      timestamp: expect.any(String),
      path: '/api',
    });
  });
});
