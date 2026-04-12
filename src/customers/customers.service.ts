import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  In,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { Note } from '../notes/entities/note.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerResponseDto } from './dto/customer-response.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { Customer } from './entities/customer.entity';

type TimelineEventDto = {
  event: string;
  actorName: string;
  createdAt: string;
  meta: Record<string, unknown>;
};

type PaginatedCustomers = {
  items: CustomerResponseDto[];
  page: number;
  limit: number;
  total: number;
};

type CustomerViewer = {
  userId: string;
  role: UserRole;
};

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private readonly customersRepository: Repository<Customer>,
    private readonly dataSource: DataSource,
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

  async findAll(
    page = 1,
    limit = 20,
    viewer?: CustomerViewer,
  ): Promise<PaginatedCustomers> {
    const qb = this.customersRepository.createQueryBuilder('customer');
    this.applyViewerScope(qb, viewer);

    const [items, total] = await Promise.all([
      qb
        .clone()
        .orderBy('customer.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit)
        .getMany(),
      qb.clone().getCount(),
    ]);

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
    viewer?: CustomerViewer,
  ): Promise<PaginatedCustomers> {
    const term = `%${query.toLowerCase()}%`;
    const fullNameExpr =
      "LOWER(CONCAT(COALESCE(customer.firstName, ''), ' ', COALESCE(customer.lastName, '')))";
    const matchPriorityExpr = `
      CASE
        WHEN LOWER(customer.firstName) LIKE :term THEN 0
        WHEN LOWER(customer.lastName) LIKE :term THEN 0
        WHEN ${fullNameExpr} LIKE :term THEN 0
        WHEN LOWER(customer.email) LIKE :term THEN 1
        WHEN LOWER(customer.phone) LIKE :term THEN 2
        ELSE 3
      END
    `;

    const filteredQueryBuilder = this.customersRepository
      .createQueryBuilder('customer')
      .where(
        new Brackets((qb) => {
          qb.where('LOWER(customer.firstName) LIKE :term', { term })
            .orWhere('LOWER(customer.lastName) LIKE :term', { term })
            .orWhere(`${fullNameExpr} LIKE :term`, { term })
            .orWhere('LOWER(customer.email) LIKE :term', { term })
            .orWhere('LOWER(customer.phone) LIKE :term', { term });
        }),
      );
    this.applyViewerScope(filteredQueryBuilder, viewer);

    const [items, total] = await Promise.all([
      filteredQueryBuilder
        .clone()
        .addSelect(matchPriorityExpr, 'matchPriority')
        .orderBy(matchPriorityExpr, 'ASC')
        .addOrderBy('customer.createdAt', 'DESC')
        .skip((page - 1) * limit)
        .take(limit)
        .getMany(),
      filteredQueryBuilder.clone().getCount(),
    ]);

    return {
      items: items.map((item) => CustomerResponseDto.fromEntity(item)),
      page,
      limit,
      total,
    };
  }

  async findOne(
    id: string,
    viewer?: CustomerViewer,
  ): Promise<CustomerResponseDto> {
    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id });
    this.applyViewerScope(qb, viewer);
    const customer = await qb.getOne();

    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    return CustomerResponseDto.fromEntity(customer);
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    viewer?: CustomerViewer,
  ): Promise<CustomerResponseDto> {
    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id });
    this.applyViewerScope(qb, viewer);
    const customer = await qb.getOne();

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

  async getTimeline(customerId: string): Promise<TimelineEventDto[]> {
    const customer = await this.customersRepository.findOne({
      where: { id: customerId },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const events: TimelineEventDto[] = [];

    events.push({
      event: 'Customer created',
      actorName: 'System',
      createdAt: customer.createdAt.toISOString(),
      meta: {},
    });

    const jobs = await this.dataSource.getRepository(Job).find({
      where: { customerId },
      order: { createdAt: 'ASC' },
    });

    for (const job of jobs) {
      events.push({
        event: `Job created (${job.orderNumber ?? job.id.slice(0, 8)})`,
        actorName: 'System',
        createdAt: job.createdAt.toISOString(),
        meta: { jobId: job.id, stage: job.pipelineStage },
      });
    }

    const jobIds = jobs.map((j) => j.id);
    if (jobIds.length > 0) {
      const notes = await this.dataSource.getRepository(Note).find({
        where: { jobId: In(jobIds) },
        relations: { createdByUser: true },
        order: { createdAt: 'ASC' },
      });
      for (const note of notes) {
        events.push({
          event: 'Note added',
          actorName: note.createdByUser
            ? `${note.createdByUser.firstName} ${note.createdByUser.lastName}`
            : 'Unknown',
          createdAt: note.createdAt.toISOString(),
          meta: { jobId: note.jobId, preview: note.body?.slice(0, 80) },
        });
      }
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return events;
  }

  private applyViewerScope(
    qb: SelectQueryBuilder<Customer>,
    viewer?: CustomerViewer,
  ) {
    if (viewer?.role !== UserRole.MANAGER) {
      return qb;
    }

    return qb
      .innerJoin(
        Job,
        'job_scope',
        'job_scope.customerId = customer.id AND job_scope.managerId = :managerUserId',
        { managerUserId: viewer.userId },
      )
      .distinct(true);
  }
}
