import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { User } from '../users/entities/user.entity';
import { Job } from './entities/job.entity';
import { JobAuditLog } from './entities/job-audit-log.entity';
import { JobAuditAction } from './enums/job-audit-action.enum';
import { JobStatus, JobSystemType } from './enums/job.enums';
import { JobsService } from './jobs.service';

describe('JobsService', () => {
  let service: JobsService;
  let dataSource: { transaction: jest.Mock };

  const createRepositoryMock = () =>
    ({
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
      softDelete: jest.fn(),
      restore: jest.fn(),
      findAndCount: jest.fn(),
    }) as unknown as jest.Mocked<Repository<Job>>;

  beforeEach(async () => {
    dataSource = {
      transaction: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobsService,
        {
          provide: getRepositoryToken(Job),
          useValue: createRepositoryMock(),
        },
        {
          provide: getRepositoryToken(JobAuditLog),
          useValue: createRepositoryMock(),
        },
        {
          provide: getRepositoryToken(User),
          useValue: createRepositoryMock(),
        },
        {
          provide: getRepositoryToken(Customer),
          useValue: createRepositoryMock(),
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
      ],
    }).compile();

    service = moduleRef.get(JobsService);
  });

  it('logs installer assignment and removal as separate events', async () => {
    const txJobsRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'job-1',
        customerId: 'customer-1',
        managerId: 'manager-1',
        systemType: JobSystemType.SOLAR,
        contractSigned: false,
        depositPaid: false,
        installDate: null,
        preMeterStatus: 'not_started',
        postMeterStatus: 'not_started',
        jobStatus: JobStatus.LEAD,
        notes: null,
        internalComments: null,
        installers: [{ id: 'installer-a' }, { id: 'installer-b' }],
      }),
      save: jest.fn(),
    };

    const txUsersRepository = {
      find: jest.fn().mockResolvedValue([
        { id: 'installer-b', role: UserRole.INSTALLER },
        { id: 'installer-c', role: UserRole.INSTALLER },
      ]),
    };

    const txAuditRepository = {
      create: jest.fn((payload: unknown) => payload),
      save: jest.fn(),
    };

    const txEntityManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Job) return txJobsRepository;
        if (entity === User) return txUsersRepository;
        if (entity === JobAuditLog) return txAuditRepository;
        return { findOne: jest.fn() };
      }),
    };

    dataSource.transaction.mockImplementation(async (cb: (m: unknown) => unknown) =>
      cb(txEntityManager),
    );

    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'job-1' } as Job);

    await service.update(
      'job-1',
      {
        installerIds: ['installer-b', 'installer-c'],
      },
      'admin-1',
    );

    expect(txAuditRepository.save).toHaveBeenCalledTimes(1);

    const savedLogs = txAuditRepository.save.mock.calls[0]?.[0] as Array<{
      action: JobAuditAction;
      oldValue: string | null;
      newValue: string | null;
    }>;

    expect(savedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: JobAuditAction.INSTALLER_ASSIGNED,
          oldValue: null,
          newValue: 'installer-c',
        }),
        expect.objectContaining({
          action: JobAuditAction.INSTALLER_REMOVED,
          oldValue: 'installer-a',
          newValue: null,
        }),
      ]),
    );
  });

  it('does not create audit logs for notes or internal comments updates', async () => {
    const txJobsRepository = {
      findOne: jest.fn().mockResolvedValue({
        id: 'job-1',
        customerId: 'customer-1',
        managerId: 'manager-1',
        systemType: JobSystemType.SOLAR,
        contractSigned: false,
        depositPaid: false,
        installDate: null,
        preMeterStatus: 'not_started',
        postMeterStatus: 'not_started',
        jobStatus: JobStatus.LEAD,
        notes: null,
        internalComments: null,
        installers: [],
      }),
      save: jest.fn(),
    };

    const txAuditRepository = {
      create: jest.fn((payload: unknown) => payload),
      save: jest.fn(),
    };

    const txEntityManager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Job) return txJobsRepository;
        if (entity === JobAuditLog) return txAuditRepository;
        return { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
      }),
    };

    dataSource.transaction.mockImplementation(async (cb: (m: unknown) => unknown) =>
      cb(txEntityManager),
    );

    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'job-1' } as Job);

    await service.update(
      'job-1',
      {
        notes: 'changed notes',
        internalComments: 'changed internal comments',
      },
      'manager-1',
    );

    expect(txJobsRepository.save).toHaveBeenCalledTimes(1);
    expect(txAuditRepository.save).not.toHaveBeenCalled();
  });
});
