import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, QueryFailedError, Repository } from 'typeorm';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer } from './entities/customer.entity';

type PaginatedCustomers = {
  items: CustomerResponseDto[];
  page: number;
  limit: number;
  total: number;
};

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
  ) {}

  async create(dto: CreateCustomerDto): Promise<CustomerResponseDto> {
    const existing = await this.customersRepository.findOne({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const customer = this.customersRepository.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      address: dto.address ?? null,
      phone: dto.phone,
      email: dto.email,
    });

    const saved = await this.customersRepository.save(customer);
    return CustomerResponseDto.fromEntity(saved);
  }

  async findAll(page = 1, limit = 20): Promise<PaginatedCustomers> {
    const [items, total] = await this.customersRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      items: items.map((item) => CustomerResponseDto.fromEntity(item)),
      page,
      limit,
      total,
    };
  }

  async search(
    query: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedCustomers> {
    const term = `%${query.toLowerCase()}%`;
    const escape =
      (
        this.customersRepository.manager as
          | { connection?: { driver?: { escape: (value: string) => string } } }
          | undefined
      )?.connection?.driver?.escape ?? ((value: string) => value);
    const firstNameColumn = `customer.${escape('firstName')}`;
    const lastNameColumn = `customer.${escape('lastName')}`;
    const emailColumn = `customer.${escape('email')}`;
    const phoneColumn = `customer.${escape('phone')}`;
    const createdAtColumn = `customer.${escape('createdAt')}`;
    const fullNameExpression = `CONCAT(${firstNameColumn}, ' ', ${lastNameColumn})`;

    const searchQueryBuilder = this.customersRepository
      .createQueryBuilder('customer')
      .where(
        new Brackets((qb) => {
          qb.where(`LOWER(${firstNameColumn}) LIKE :term`, { term })
            .orWhere(`LOWER(${lastNameColumn}) LIKE :term`, { term })
            .orWhere(`LOWER(${fullNameExpression}) LIKE :term`, { term })
            .orWhere(`LOWER(${emailColumn}) LIKE :term`, { term })
            .orWhere(`LOWER(${phoneColumn}) LIKE :term`, { term });
        }),
      )
      .addSelect(
        `
          CASE
            WHEN LOWER(${firstNameColumn}) LIKE :term THEN 0
            WHEN LOWER(${lastNameColumn}) LIKE :term THEN 0
            WHEN LOWER(${fullNameExpression}) LIKE :term THEN 0
            WHEN LOWER(${emailColumn}) LIKE :term THEN 1
            WHEN LOWER(${phoneColumn}) LIKE :term THEN 2
            ELSE 3
          END
        `,
        'matchpriority',
      )
      .orderBy('matchpriority', 'ASC')
      .addOrderBy(createdAtColumn, 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await searchQueryBuilder.getManyAndCount();

    return {
      items: items.map((item) => CustomerResponseDto.fromEntity(item)),
      page,
      limit,
      total,
    };
  }

  async findOne(id: string): Promise<CustomerResponseDto> {
    const customer = await this.customersRepository.findOne({ where: { id } });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return CustomerResponseDto.fromEntity(customer);
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerResponseDto> {
    const customer = await this.customersRepository.findOne({ where: { id } });

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    if (dto.email && dto.email !== customer.email) {
      const duplicate = await this.customersRepository.findOne({
        where: { email: dto.email },
      });

      if (duplicate) {
        throw new ConflictException('Email already exists');
      }
    }

    if (typeof dto.firstName !== 'undefined') {
      customer.firstName = dto.firstName;
    }
    if (typeof dto.lastName !== 'undefined') {
      customer.lastName = dto.lastName;
    }
    if (typeof dto.address !== 'undefined') {
      customer.address = dto.address;
    }
    if (typeof dto.phone !== 'undefined') {
      customer.phone = dto.phone;
    }
    if (typeof dto.email !== 'undefined') {
      customer.email = dto.email;
    }

    try {
      const updated = await this.customersRepository.save(customer);
      return CustomerResponseDto.fromEntity(updated);
    } catch (error) {
      const driverError = (
        error as QueryFailedError & { driverError?: { code?: string } }
      ).driverError;
      if (error instanceof QueryFailedError && driverError?.code === '23505') {
        throw new ConflictException('Email already exists');
      }

      throw error;
    }
  }
}
