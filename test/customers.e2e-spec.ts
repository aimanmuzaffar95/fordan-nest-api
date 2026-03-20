import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from '../src/common/interceptors/success-response.interceptor';
import { UserCredential } from '../src/auth/entities/user-credential.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { JobAuditLog } from '../src/jobs/entities/job-audit-log.entity';
import { Job } from '../src/jobs/entities/job.entity';
import { StaffRole } from '../src/staff/entities/staff-role.entity';
import { User } from '../src/users/entities/user.entity';

type SuccessBody<T> = {
  success: boolean;
  data: T;
};

describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let customersRepository: Repository<Customer>;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          autoSave: false,
          synchronize: true,
          entities: [
            Customer,
            Job,
            JobAuditLog,
            StaffRole,
            User,
            UserCredential,
          ],
        }),
        CustomersModule,
      ],
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

    customersRepository = moduleFixture.get<Repository<Customer>>(
      getRepositoryToken(Customer),
    );

    const jwtService = moduleFixture.get(JwtService);
    accessToken = jwtService.sign({ sub: 'e2e-user-id', role: 'admin' });

    await app.init();
  });

  beforeEach(async () => {
    await customersRepository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a customer (201)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: '  Jane  ',
        lastName: '  Doe ',
        address: '123 Main St',
        phone: '  +15550001111 ',
        email: '  jane@example.com ',
      })
      .expect(201);

    const body = response.body as SuccessBody<Record<string, unknown>>;

    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      firstName: 'Jane',
      lastName: 'Doe',
      address: '123 Main St',
      phone: '+15550001111',
      email: 'jane@example.com',
    });
    expect(typeof body.data.id).toBe('string');
    expect(typeof body.data.createdAt).toBe('string');
    expect(typeof body.data.updatedAt).toBe('string');
  });

  it('returns 400 for invalid create payload', async () => {
    await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: '  ',
        lastName: 'Doe',
        phone: '  ',
        email: 'not-an-email',
      })
      .expect(400);
  });

  it('lists customers with pagination params (200)', async () => {
    await customersRepository.save(
      customersRepository.create([
        {
          firstName: 'John',
          lastName: 'One',
          phone: '1',
          email: 'john1@example.com',
          address: null,
        },
        {
          firstName: 'John',
          lastName: 'Two',
          phone: '2',
          email: 'john2@example.com',
          address: null,
        },
      ]),
    );

    const response = await request(app.getHttpServer())
      .get('/api/customers?page=1&limit=1')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = response.body as SuccessBody<{
      page: number;
      limit: number;
      total: number;
      items: unknown[];
    }>;

    expect(body.success).toBe(true);
    expect(body.data).toEqual(
      expect.objectContaining({
        page: 1,
        limit: 1,
        total: 2,
      }),
    );
    expect(body.data.items).toHaveLength(1);
  });

  it('returns 400 when list limit is above cap', async () => {
    await request(app.getHttpServer())
      .get('/api/customers?page=1&limit=101')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('gets customer by id (200)', async () => {
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Alex',
        lastName: 'Smith',
        phone: '123',
        email: 'alex@example.com',
        address: 'Road',
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const body = response.body as SuccessBody<{ id: string; email: string }>;
    expect(body.data.id).toBe(customer.id);
    expect(body.data.email).toBe('alex@example.com');
  });

  it('updates customer (200)', async () => {
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Mark',
        lastName: 'Old',
        phone: '777',
        email: 'mark@example.com',
        address: null,
      }),
    );

    const response = await request(app.getHttpServer())
      .patch(`/api/customers/${customer.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: '  Marcus ',
        email: '  marcus@example.com ',
      })
      .expect(200);

    const body = response.body as SuccessBody<{
      firstName: string;
      email: string;
    }>;
    expect(body.data.firstName).toBe('Marcus');
    expect(body.data.email).toBe('marcus@example.com');
  });

  it('searches by name, email, and phone with name matches first (200)', async () => {
    await customersRepository.save(
      customersRepository.create([
        {
          firstName: 'Person',
          lastName: 'EmailOnly',
          phone: '+155500',
          email: 'aiman.lookup@example.com',
          address: '1 Address Lane',
        },
        {
          firstName: 'Aiman',
          lastName: 'Khan',
          phone: '+155501',
          email: 'name.match@example.com',
          address: '12 Green Street',
        },
        {
          firstName: 'Bob',
          lastName: 'Stone',
          phone: '+155502',
          email: 'bob@example.com',
          address: '88 Blue Avenue',
        },
      ]),
    );

    const byName = await request(app.getHttpServer())
      .get('/api/customers/search?q=aiman')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const byEmail = await request(app.getHttpServer())
      .get('/api/customers/search?q=bob@example.com')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const byPhone = await request(app.getHttpServer())
      .get('/api/customers/search?q=+155502')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const nameBody = byName.body as SuccessBody<{
      items: Array<{ email: string }>;
    }>;
    const emailBody = byEmail.body as SuccessBody<{
      items: Array<{ email: string }>;
    }>;
    const phoneBody = byPhone.body as SuccessBody<{
      items: Array<{ email: string }>;
    }>;

    expect(nameBody.data.items[0]?.email).toBe('name.match@example.com');
    expect(nameBody.data.items.map((item) => item.email)).toContain(
      'aiman.lookup@example.com',
    );
    expect(emailBody.data.items.map((item) => item.email)).toContain(
      'bob@example.com',
    );
    expect(phoneBody.data.items.map((item) => item.email)).toContain(
      'bob@example.com',
    );
  });

  it('returns 400 when search query is missing', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/search')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('returns 404 on missing id', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/01f4a9d1-8f35-4ddd-8d98-6630f58c4c2b')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('returns 404 when updating a missing customer', async () => {
    await request(app.getHttpServer())
      .patch('/api/customers/01f4a9d1-8f35-4ddd-8d98-6630f58c4c2b')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Updated' })
      .expect(404);
  });

  it('returns 409 on duplicate email', async () => {
    await customersRepository.save(
      customersRepository.create({
        firstName: 'Dup',
        lastName: 'One',
        phone: '111',
        email: 'dup@example.com',
        address: null,
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        firstName: 'Dup',
        lastName: 'Two',
        phone: '222',
        email: 'dup@example.com',
      })
      .expect(409);

    const body = response.body as { message: string };
    expect(body.message).toBe('Email already exists');
  });
});
