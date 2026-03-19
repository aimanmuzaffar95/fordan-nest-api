import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/entities/user-role.enum';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

describe('JobsController', () => {
  let controller: JobsController;

  const jobsService = {
    findAll: jest.fn(),
  } as Partial<JobsService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [JobsController],
      providers: [
        {
          provide: JobsService,
          useValue: jobsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = moduleRef.get(JobsController);
    jest.clearAllMocks();
  });

  it('allows admin to fetch with optional manager filter', () => {
    void controller.findAll(
      { page: 1, limit: 20, managerId: 'manager-x' },
      {
        user: { sub: 'admin-1', role: UserRole.ADMIN },
      } as never,
    );

    expect(jobsService.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      managerId: 'manager-x',
      installerId: undefined,
      includeDeleted: false,
    });
  });

  it('forces manager scope to authenticated manager id', () => {
    void controller.findAll(
      { page: 1, limit: 20, managerId: 'different-manager' },
      {
        user: { sub: 'manager-123', role: UserRole.MANAGER },
      } as never,
    );

    expect(jobsService.findAll).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      managerId: 'manager-123',
      installerId: undefined,
      includeDeleted: false,
    });
  });
});
