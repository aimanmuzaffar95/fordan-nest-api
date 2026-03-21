import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { Server } from 'node:http';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from '../src/common/interceptors/success-response.interceptor';
import { InstallerPublicController } from '../src/installer/installer-public.controller';
import { DatabaseSetupService } from '../src/installer/database-setup.service';
import { InstallerService } from '../src/installer/installer.service';

const SETUP_TOKEN = 'test-setup-token-16';

type SuccessBody<T> = {
  success: boolean;
  statusCode: number;
  data: T;
};

describe('Installer public (e2e)', () => {
  let app: INestApplication;
  let databaseSetup: {
    isPublicDatabaseStateEnabled: jest.Mock;
    getPublicDatabaseState: jest.Mock;
    assertSetupToken: jest.Mock;
  };
  let installer: {
    migrate: jest.Mock;
    seed: jest.Mock;
    getRunLog: jest.Mock;
  };

  async function createApp(publicEnabled: boolean) {
    databaseSetup = {
      isPublicDatabaseStateEnabled: jest.fn().mockReturnValue(publicEnabled),
      getPublicDatabaseState: jest.fn().mockResolvedValue({
        databaseReachable: true,
        databaseSynchronize: false,
        dialect: 'postgres',
        migrationsTableExists: true,
        executedMigrationCount: 1,
        executedMigrationNamesSample: ['TestMigration'],
        usersTableExists: true,
        needsMigration: false,
        publicDatabaseStateEnabled: publicEnabled,
        setupTokenConfigured: true,
      }),
      assertSetupToken: jest.fn((headerToken: string | undefined) => {
        if (headerToken?.trim() !== SETUP_TOKEN) {
          throw new UnauthorizedException('Invalid setup token.');
        }
      }),
    };

    installer = {
      migrate: jest.fn().mockResolvedValue({ id: 'run-migrate-1' }),
      seed: jest.fn().mockResolvedValue({ id: 'run-seed-1' }),
      getRunLog: jest.fn().mockResolvedValue('log line 1\n'),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [InstallerPublicController],
      providers: [
        { provide: DatabaseSetupService, useValue: databaseSetup },
        { provide: InstallerService, useValue: installer },
      ],
    }).compile();

    const nest = moduleFixture.createNestApplication();
    nest.setGlobalPrefix('api');
    nest.useGlobalInterceptors(new SuccessResponseInterceptor());
    nest.useGlobalFilters(new HttpExceptionFilter());
    nest.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await nest.init();
    return nest;
  }

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /installer/public/database-state returns 404 when public installer is disabled', async () => {
    app = await createApp(false);
    await request(app.getHttpServer() as Server)
      .get('/api/installer/public/database-state')
      .expect(404);
  });

  it('GET /installer/public/database-state returns 200 and state payload when enabled', async () => {
    app = await createApp(true);
    const res = await request(app.getHttpServer() as Server)
      .get('/api/installer/public/database-state')
      .expect(200);

    const body = res.body as SuccessBody<Record<string, unknown>>;
    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    expect(body.data).toMatchObject({
      databaseReachable: true,
      publicDatabaseStateEnabled: true,
    });
    expect(databaseSetup.getPublicDatabaseState).toHaveBeenCalled();
  });

  it('POST /installer/public/migrations returns 201 Created with runId when token is valid', async () => {
    app = await createApp(true);
    const res = await request(app.getHttpServer() as Server)
      .post('/api/installer/public/migrations')
      .set('X-Installer-Setup-Token', SETUP_TOKEN)
      .expect(201);

    const body = res.body as SuccessBody<{ runId: string }>;
    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(201);
    expect(body.data).toEqual({ runId: 'run-migrate-1' });
    expect(installer.migrate).toHaveBeenCalled();
  });

  it('POST /installer/public/seed returns 201 Created with runId when token is valid', async () => {
    app = await createApp(true);
    const res = await request(app.getHttpServer() as Server)
      .post('/api/installer/public/seed')
      .set('X-Installer-Setup-Token', SETUP_TOKEN)
      .expect(201);

    const body = res.body as SuccessBody<{ runId: string }>;
    expect(body.data).toEqual({ runId: 'run-seed-1' });
    expect(installer.seed).toHaveBeenCalled();
  });

  it('POST /installer/public/migrations returns 401 without setup token', async () => {
    app = await createApp(true);
    await request(app.getHttpServer() as Server)
      .post('/api/installer/public/migrations')
      .expect(401);
    expect(installer.migrate).not.toHaveBeenCalled();
  });
});
