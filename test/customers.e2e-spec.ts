import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { SuccessResponseInterceptor } from '../src/common/interceptors/success-response.interceptor';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { UserCredential } from '../src/auth/entities/user-credential.entity';
import { AssignmentsModule } from '../src/assignments/assignments.module';
import { Assignment } from '../src/assignments/entities/assignment.entity';
import { CustomersModule } from '../src/customers/customers.module';
import { Customer } from '../src/customers/entities/customer.entity';
import { Job } from '../src/jobs/entities/job.entity';
import { MeterApplication } from '../src/metering/entities/meter-application.entity';
import { Team } from '../src/teams/entities/team.entity';
import { MeteringModule } from '../src/metering/metering.module';
import { ScheduleModule } from '../src/schedule/schedule.module';
import { TeamsModule } from '../src/teams/teams.module';
import { TimelineEvent } from '../src/timeline/entities/timeline-event.entity';
import { User } from '../src/users/entities/user.entity';
import { UserRole } from '../src/users/entities/user-role.enum';

/** E2E acts as manager without signing JWT. */
const e2eManagerJwtGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      user?: { sub: string; role: UserRole };
    }>();
    req.user = { sub: E2E_MANAGER_USER_ID, role: UserRole.MANAGER };
    return true;
  },
};

const e2eInstallerJwtGuard: CanActivate = {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<{
      user?: { sub: string; role: UserRole };
    }>();
    req.user = { sub: 'e2e-installer-id', role: UserRole.INSTALLER };
    return true;
  },
};

type SuccessBody<T> = {
  success: boolean;
  data: T;
};

/** Valid UUID for JWT `sub` / `users.id` (CreateAssignmentDto enforces `@IsUUID()`). */
const E2E_MANAGER_USER_ID = 'a0000000-0000-4000-8000-000000000001';

describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let customersRepository: Repository<Customer>;
  let jobsRepository: Repository<Job>;
  let meterRepository: Repository<MeterApplication>;
  let timelineRepository: Repository<TimelineEvent>;
  let usersRepository: Repository<User>;
  let teamsRepository: Repository<Team>;
  let assignmentRepository: Repository<Assignment>;

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
            MeterApplication,
            TimelineEvent,
            User,
            UserCredential,
            Team,
            Assignment,
          ],
        }),
        CustomersModule,
        TeamsModule,
        AssignmentsModule,
        ScheduleModule,
        MeteringModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(e2eManagerJwtGuard)
      .compile();

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
    jobsRepository = moduleFixture.get<Repository<Job>>(
      getRepositoryToken(Job),
    );
    meterRepository = moduleFixture.get<Repository<MeterApplication>>(
      getRepositoryToken(MeterApplication),
    );
    timelineRepository = moduleFixture.get<Repository<TimelineEvent>>(
      getRepositoryToken(TimelineEvent),
    );
    usersRepository = moduleFixture.get<Repository<User>>(
      getRepositoryToken(User),
    );
    teamsRepository = moduleFixture.get<Repository<Team>>(
      getRepositoryToken(Team),
    );
    assignmentRepository = moduleFixture.get<Repository<Assignment>>(
      getRepositoryToken(Assignment),
    );

    await app.init();

    await usersRepository.save(
      usersRepository.create({
        id: E2E_MANAGER_USER_ID,
        firstName: 'E2e',
        lastName: 'Manager',
        emailAddress: 'e2e-manager@test.com',
        phoneNumber: '+15550001111',
        role: UserRole.MANAGER,
        active: true,
      }),
    );
  });

  beforeEach(async () => {
    await timelineRepository.clear();
    await meterRepository.clear();
    await assignmentRepository.clear();
    await jobsRepository.clear();
    await customersRepository.clear();
    await teamsRepository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a customer (201)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
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

  it('creates a job under customer (201) and returns it from GET /jobs', async () => {
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Job',
        lastName: 'Parent',
        phone: '888',
        email: 'jobparent@example.com',
        address: '1 Test St',
      }),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 6.5,
        projectPrice: 12000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const created = createRes.body as SuccessBody<{
      id: string;
      customerId: string;
    }>;
    expect(created.success).toBe(true);
    expect(created.data.customerId).toBe(customer.id);

    const listRes = await request(app.getHttpServer())
      .get('/api/jobs?page=1&pageSize=20')
      .expect(200);

    const listBody = listRes.body as SuccessBody<{
      items: Array<{ id: string }>;
      total: number;
    }>;
    expect(listBody.data.total).toBeGreaterThanOrEqual(1);
    expect(listBody.data.items.some((j) => j.id === created.data.id)).toBe(
      true,
    );
  });

  it('PATCH /meter-applications/:id approves pre-meter (200) and writes timeline', async () => {
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Meter',
        lastName: 'Parent',
        phone: '887',
        email: 'meterparent@example.com',
        address: '9 Test St',
      }),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 4,
        projectPrice: 9000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const jobId = (createRes.body as SuccessBody<{ id: string }>).data.id;
    const preMeter = await meterRepository.findOne({
      where: { jobId, type: 'pre_meter' },
    });
    expect(preMeter).toBeTruthy();

    const patchRes = await request(app.getHttpServer())
      .patch(`/api/meter-applications/${preMeter!.id}`)
      .send({ status: 'approved' })
      .expect(200);

    const patched = patchRes.body as SuccessBody<{ status: string }>;
    expect(patched.data.status).toBe('approved');

    const events = await timelineRepository.find({ where: { jobId } });
    expect(events.some((e) => e.type === 'meter_status_change')).toBe(true);
  });

  it('PATCH /meter-applications/:id rejected requires rejectionReason (400)', async () => {
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Reject',
        lastName: 'Meter',
        phone: '886',
        email: 'rejectmeter@example.com',
        address: '8 Test St',
      }),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 3,
        projectPrice: 7000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const jobId = (createRes.body as SuccessBody<{ id: string }>).data.id;
    const preMeter = await meterRepository.findOne({
      where: { jobId, type: 'pre_meter' },
    });
    expect(preMeter).toBeTruthy();

    await request(app.getHttpServer())
      .patch(`/api/meter-applications/${preMeter!.id}`)
      .send({ status: 'rejected' })
      .expect(400);
  });

  it('creates assignment for job (201) and rejects second assignment (409)', async () => {
    const team = await teamsRepository.save(
      teamsRepository.create({
        name: 'North Crew',
        dailyCapacityKw: '100.00',
      }),
    );
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Assign',
        lastName: 'Parent',
        phone: '889',
        email: 'assignparent@example.com',
        address: '2 Test St',
      }),
    );

    const createRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 5,
        projectPrice: 8000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const jobId = (createRes.body as SuccessBody<{ id: string }>).data.id;

    const assignRes = await request(app.getHttpServer())
      .post(`/api/jobs/${jobId}/assignments`)
      .send({
        scheduledDate: '2026-06-15',
        slot: 'AM',
        teamId: team.id,
        staffUserId: E2E_MANAGER_USER_ID,
      })
      .expect(201);

    const assignBody = assignRes.body as SuccessBody<{
      id: string;
      jobId: string;
    }>;
    expect(assignBody.success).toBe(true);
    expect(assignBody.data.jobId).toBe(jobId);

    await request(app.getHttpServer())
      .post(`/api/jobs/${jobId}/assignments`)
      .send({
        scheduledDate: '2026-06-16',
        slot: 'PM',
        teamId: team.id,
        staffUserId: E2E_MANAGER_USER_ID,
      })
      .expect(409);
  });

  it('locks assignment (delete blocked), unlock, then delete', async () => {
    const team = await teamsRepository.save(
      teamsRepository.create({
        name: 'Lock Crew',
        dailyCapacityKw: '50.00',
      }),
    );
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Lock',
        lastName: 'Parent',
        phone: '890',
        email: 'lockparent@example.com',
        address: '3 Test St',
      }),
    );

    const jobRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 4,
        projectPrice: 6000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const jobId = (jobRes.body as SuccessBody<{ id: string }>).data.id;

    const assignRes = await request(app.getHttpServer())
      .post(`/api/jobs/${jobId}/assignments`)
      .send({
        scheduledDate: '2026-07-01',
        slot: 'PM',
        teamId: team.id,
        staffUserId: E2E_MANAGER_USER_ID,
      })
      .expect(201);

    const assignmentId = (assignRes.body as SuccessBody<{ id: string }>).data
      .id;

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/lock`)
      .send({ locked: true, reason: 'Week finalized' })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/jobs/${jobId}/assignments/${assignmentId}`)
      .expect(409);

    await request(app.getHttpServer())
      .post(`/api/assignments/${assignmentId}/lock`)
      .send({ locked: false })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/jobs/${jobId}/assignments/${assignmentId}`)
      .expect(200);
  });

  it('GET /schedule returns assignments and dailyKwByTeam in range (200)', async () => {
    const team = await teamsRepository.save(
      teamsRepository.create({
        name: 'Schedule Crew',
        dailyCapacityKw: '40.00',
      }),
    );
    const customer = await customersRepository.save(
      customersRepository.create({
        firstName: 'Sched',
        lastName: 'Parent',
        phone: '891',
        email: 'schedparent@example.com',
        address: '4 Cal St',
      }),
    );

    const jobRes = await request(app.getHttpServer())
      .post(`/api/customers/${customer.id}/jobs`)
      .send({
        systemType: 'solar',
        systemSizeKw: 5.5,
        projectPrice: 7000,
        contractSigned: false,
        depositPaid: false,
        depositAmount: 0,
        pipelineStage: 'lead',
        preMeterStatus: 'pending',
        postMeterStatus: 'pending',
      })
      .expect(201);

    const jobId = (jobRes.body as SuccessBody<{ id: string }>).data.id;

    await request(app.getHttpServer())
      .post(`/api/jobs/${jobId}/assignments`)
      .send({
        scheduledDate: '2026-08-10',
        slot: 'AM',
        teamId: team.id,
        staffUserId: E2E_MANAGER_USER_ID,
      })
      .expect(201);

    const schedRes = await request(app.getHttpServer())
      .get('/api/schedule?from=2026-08-01&to=2026-08-31')
      .expect(200);

    const body = schedRes.body as SuccessBody<{
      from: string;
      to: string;
      teamId: string | null;
      items: Array<{ jobId: string; scheduledDate: string; systemSizeKw: number }>;
      dailyKwByTeam: Array<{
        scheduledDate: string;
        bookedKw: number;
        capacityKw: number;
      }>;
    }>;

    expect(body.data.from).toBe('2026-08-01');
    expect(body.data.to).toBe('2026-08-31');
    expect(body.data.teamId).toBeNull();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].jobId).toBe(jobId);
    expect(body.data.items[0].scheduledDate).toBe('2026-08-10');
    expect(body.data.items[0].systemSizeKw).toBe(5.5);

    expect(body.data.dailyKwByTeam).toHaveLength(1);
    expect(body.data.dailyKwByTeam[0].scheduledDate).toBe('2026-08-10');
    expect(body.data.dailyKwByTeam[0].bookedKw).toBe(5.5);
    expect(body.data.dailyKwByTeam[0].capacityKw).toBe(40);
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
      .expect(200);
    const byEmail = await request(app.getHttpServer())
      .get('/api/customers/search?q=bob@example.com')
      .expect(200);
    const byPhone = await request(app.getHttpServer())
      .get('/api/customers/search?q=+155502')
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
    await request(app.getHttpServer()).get('/api/customers/search').expect(400);
  });

  it('returns 404 on missing id', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/01f4a9d1-8f35-4ddd-8d98-6630f58c4c2b')
      .expect(404);
  });

  it('returns 404 when updating a missing customer', async () => {
    await request(app.getHttpServer())
      .patch('/api/customers/01f4a9d1-8f35-4ddd-8d98-6630f58c4c2b')
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

describe('Customers as installer (e2e)', () => {
  let app: INestApplication<App>;
  let customersRepository: Repository<Customer>;

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
            MeterApplication,
            TimelineEvent,
            User,
            UserCredential,
          ],
        }),
        CustomersModule,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(e2eInstallerJwtGuard)
      .compile();

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

    await app.init();
  });

  beforeEach(async () => {
    await customersRepository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('installer can create a customer (201)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/customers')
      .send({
        firstName: 'Field',
        lastName: 'Lead',
        phone: '+15559990000',
        email: 'field-lead@example.com',
      })
      .expect(201);

    const body = response.body as SuccessBody<{ email: string }>;
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('field-lead@example.com');
  });

  it('installer cannot list customers (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/customers?page=1&limit=10')
      .expect(403);
  });

  it('installer cannot search customers (403)', async () => {
    await request(app.getHttpServer())
      .get('/api/customers/search?q=test&page=1&limit=10')
      .expect(403);
  });

  it('installer cannot get customer by id (403)', async () => {
    const row = await customersRepository.save(
      customersRepository.create({
        firstName: 'Hidden',
        lastName: 'FromInstaller',
        phone: '1',
        email: 'hidden@example.com',
        address: null,
      }),
    );

    await request(app.getHttpServer())
      .get(`/api/customers/${row.id}`)
      .expect(403);
  });

  it('installer cannot patch customer (403)', async () => {
    const row = await customersRepository.save(
      customersRepository.create({
        firstName: 'No',
        lastName: 'Patch',
        phone: '2',
        email: 'nopatch@example.com',
        address: null,
      }),
    );

    await request(app.getHttpServer())
      .patch(`/api/customers/${row.id}`)
      .send({ firstName: 'X' })
      .expect(403);
  });

  it('installer cannot create job under customer (403)', async () => {
    const row = await customersRepository.save(
      customersRepository.create({
        firstName: 'Job',
        lastName: 'Blocked',
        phone: '3',
        email: 'jobblocked@example.com',
        address: null,
      }),
    );

    await request(app.getHttpServer())
      .post(`/api/customers/${row.id}/jobs`)
      .send({})
      .expect(403);
  });
});
