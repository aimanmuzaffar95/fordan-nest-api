import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController', () => {
  let controller: CustomersController;
  const customersService = {
    create: jest.fn(),
    findAll: jest.fn(),
    search: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: customersService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = moduleRef.get(CustomersController);
    jest.clearAllMocks();
  });

  it('uses default pagination values in findAll', () => {
    void controller.findAll({});

    expect(customersService.findAll).toHaveBeenCalledWith(1, 20);
  });

  it('forwards pagination values in findAll', () => {
    void controller.findAll({ page: 2, limit: 50 });

    expect(customersService.findAll).toHaveBeenCalledWith(2, 50);
  });

  it('forwards search query params', () => {
    void controller.search({ q: 'aiman', page: 2, limit: 10 });

    expect(customersService.search).toHaveBeenCalledWith('aiman', 2, 10);
  });
});
