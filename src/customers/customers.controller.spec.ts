import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JobsService } from '../jobs/jobs.service';
import { UserRole } from '../users/entities/user-role.enum';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController', () => {
  let controller: CustomersController;
  const customersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    search: jest.fn(),
    geocodeAddress: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const jobsService = {
    createJob: jest.fn(),
  };
  const jwtAuthGuard = { canActivate: jest.fn().mockReturnValue(true) };
  const rolesGuard = { canActivate: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    const builder = Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: customersService,
        },
        {
          provide: JobsService,
          useValue: jobsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwtAuthGuard)
      .overrideGuard(RolesGuard)
      .useValue(rolesGuard);

    const moduleRef = await builder.compile();

    controller = moduleRef.get(CustomersController);
    jest.clearAllMocks();
  });

  it('uses default pagination values in findAll', () => {
    void controller.findAll({}, {
      user: { sub: 'user-id', role: UserRole.ADMIN },
    } as never);

    expect(customersService.findAll).toHaveBeenCalledWith(1, 20, {
      userId: 'user-id',
      role: UserRole.ADMIN,
    });
  });

  it('forwards pagination values in findAll', () => {
    void controller.findAll({ page: 2, limit: 50 }, {
      user: { sub: 'user-id', role: UserRole.MANAGER },
    } as never);

    expect(customersService.findAll).toHaveBeenCalledWith(2, 50, {
      userId: 'user-id',
      role: UserRole.MANAGER,
    });
  });

  it('forwards search query params', () => {
    void controller.search({ q: 'aiman', page: 2, limit: 10 }, {
      user: { sub: 'user-id', role: UserRole.ADMIN },
    } as never);

    expect(customersService.search).toHaveBeenCalledWith('aiman', 2, 10, {
      userId: 'user-id',
      role: UserRole.ADMIN,
    });
  });

  it('forwards geocode address query', () => {
    void controller.geocodeAddress({ address: '123 Solar Street, Melbourne' });

    expect(customersService.geocodeAddress).toHaveBeenCalledWith(
      '123 Solar Street, Melbourne',
    );
  });
});
