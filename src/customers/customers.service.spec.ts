import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Customer } from './entities/customer.entity';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let repository: jest.Mocked<Repository<Customer>>;

  const createRepositoryMock = () =>
    ({
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    }) as unknown as jest.Mocked<Repository<Customer>>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomersService,
        {
          provide: getRepositoryToken(Customer),
          useValue: createRepositoryMock(),
        },
      ],
    }).compile();

    service = moduleRef.get(CustomersService);
    repository = moduleRef.get(getRepositoryToken(Customer));
  });

  it('creates customer and defaults address to null', async () => {
    repository.findOne.mockResolvedValue(null);

    const created = {
      firstName: 'Jane',
      lastName: 'Doe',
      address: null,
      phone: '+15550001111',
      email: 'jane@example.com',
    } as Customer;

    const saved = {
      ...created,
      id: '24d00d3c-d0af-4560-8866-dfbe2ec9fd58',
      createdAt: new Date('2026-03-12T00:00:00.000Z'),
      updatedAt: new Date('2026-03-12T00:00:00.000Z'),
    } as Customer;

    repository.create.mockReturnValue(created);
    repository.save.mockResolvedValue(saved);

    const result = await service.create({
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+15550001111',
      email: 'jane@example.com',
    });

    expect(repository.create.mock.calls[0]?.[0]).toEqual({
      firstName: 'Jane',
      lastName: 'Doe',
      address: null,
      phone: '+15550001111',
      email: 'jane@example.com',
    });
    expect(result).toMatchObject({
      id: saved.id,
      email: 'jane@example.com',
      address: null,
    });
  });

  it('throws conflict when creating with duplicate email', async () => {
    repository.findOne.mockResolvedValue({ id: '1' } as Customer);

    await expect(
      service.create({
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+15550001111',
        email: 'jane@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns paginated customers from findAll', async () => {
    const now = new Date('2026-03-12T00:00:00.000Z');
    repository.findAndCount.mockResolvedValue([
      [
        {
          id: '1',
          firstName: 'A',
          lastName: 'B',
          address: null,
          phone: '1',
          email: 'a@example.com',
          createdAt: now,
          updatedAt: now,
        } as Customer,
      ],
      1,
    ]);

    const result = await service.findAll(1, 20);

    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.email).toBe('a@example.com');
  });

  it('searches and returns mapped results', async () => {
    const now = new Date('2026-03-12T00:00:00.000Z');
    const filteredQb = {
      where: jest.fn().mockReturnThis(),
      clone: jest.fn(),
    };
    const itemsQb = {
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        {
          id: '1',
          firstName: 'Aiman',
          lastName: 'Khan',
          address: null,
          phone: '+1555',
          email: 'aiman@example.com',
          createdAt: now,
          updatedAt: now,
        } as Customer,
      ]),
    };
    const countQb = {
      getCount: jest.fn().mockResolvedValue(1),
    };
    filteredQb.clone
      .mockReturnValueOnce(itemsQb as unknown as ReturnType<Repository<Customer>['createQueryBuilder']>)
      .mockReturnValueOnce(countQb as unknown as ReturnType<Repository<Customer>['createQueryBuilder']>);

    repository.createQueryBuilder.mockReturnValue(
      filteredQb as unknown as ReturnType<Repository<Customer>['createQueryBuilder']>,
    );

    const result = await service.search('aiman', 1, 20);

    expect(repository.createQueryBuilder.mock.calls[0]?.[0]).toBe('customer');
    expect(itemsQb.orderBy).toHaveBeenCalled();
    expect(result.items[0]?.email).toBe('aiman@example.com');
  });

  it('throws not found when customer does not exist', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.findOne('24d00d3c-d0af-4560-8866-dfbe2ec9fd58'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates an existing customer', async () => {
    const existing = {
      id: '24d00d3c-d0af-4560-8866-dfbe2ec9fd58',
      firstName: 'Old',
      lastName: 'Name',
      address: null,
      phone: '123',
      email: 'old@example.com',
      createdAt: new Date('2026-03-12T00:00:00.000Z'),
      updatedAt: new Date('2026-03-12T00:00:00.000Z'),
    } as Customer;

    repository.findOne
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    repository.save.mockResolvedValue({
      ...existing,
      firstName: 'New',
      email: 'new@example.com',
    } as Customer);

    const result = await service.update(existing.id, {
      firstName: 'New',
      email: 'new@example.com',
    });

    expect(repository.save.mock.calls.length).toBeGreaterThan(0);
    expect(result.firstName).toBe('New');
    expect(result.email).toBe('new@example.com');
  });

  it('throws not found when updating missing customer', async () => {
    repository.findOne.mockResolvedValue(null);

    await expect(
      service.update('24d00d3c-d0af-4560-8866-dfbe2ec9fd58', {
        firstName: 'New',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws conflict when updating to duplicate email', async () => {
    repository.findOne
      .mockResolvedValueOnce({
        id: '24d00d3c-d0af-4560-8866-dfbe2ec9fd58',
        email: 'old@example.com',
      } as Customer)
      .mockResolvedValueOnce({
        id: 'other-id',
        email: 'dup@example.com',
      } as Customer);

    await expect(
      service.update('24d00d3c-d0af-4560-8866-dfbe2ec9fd58', {
        email: 'dup@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('maps database unique violation to conflict on update', async () => {
    repository.findOne
      .mockResolvedValueOnce({
        id: '24d00d3c-d0af-4560-8866-dfbe2ec9fd58',
        email: 'old@example.com',
      } as Customer)
      .mockResolvedValueOnce(null);

    repository.save.mockRejectedValue(
      new QueryFailedError('UPDATE customers', [], { code: '23505' } as unknown as Error),
    );

    await expect(
      service.update('24d00d3c-d0af-4560-8866-dfbe2ec9fd58', {
        email: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
