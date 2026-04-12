import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
import { CustomerAuditLog } from './entities/customer-audit-log.entity';
import { Customer } from './entities/customer.entity';
import { CustomerAcquisitionSource } from './constants/customer-acquisition-source.constants';

type TimelineEventDto = {
  event: string;
  actorName: string;
  createdAt: string;
  meta: Record<string, unknown>;
};

type CustomerAuditChange = {
  eventType: string;
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

type GeocodeCoordinatesDto = {
  lat: number;
  lng: number;
};

const NOMINATIM_TIMEOUT_MS = 5000;
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_USER_AGENT = 'FordanCRM/1.0 (ops@fordan.com)';

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

    const { acquisitionSource, acquisitionSourceOther } =
      this.normalizeAcquisitionSourceValues(
        dto.acquisitionSource,
        dto.acquisitionSourceOther,
      );

    const customer = this.customersRepository.create({
      firstName: dto.firstName,
      lastName: dto.lastName,
      address: dto.address ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      phone: dto.phone,
      secondaryPhone: dto.secondaryPhone ?? null,
      email: dto.email,
      acquisitionSource,
      acquisitionSourceOther,
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
        WHEN LOWER(COALESCE(customer.secondaryPhone, '')) LIKE :term THEN 2
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
            .orWhere('LOWER(customer.phone) LIKE :term', { term })
            .orWhere(
              "LOWER(COALESCE(customer.secondaryPhone, '')) LIKE :term",
              {
                term,
              },
            );
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

    const original = {
      firstName: customer.firstName,
      lastName: customer.lastName,
      address: customer.address,
      lat: customer.lat,
      lng: customer.lng,
      phone: customer.phone,
      secondaryPhone: customer.secondaryPhone,
      email: customer.email,
      acquisitionSource: customer.acquisitionSource,
      acquisitionSourceOther: customer.acquisitionSourceOther,
    };
    const addressChanged =
      typeof dto.address !== 'undefined' && dto.address !== original.address;

    if (typeof dto.firstName !== 'undefined') {
      customer.firstName = dto.firstName;
    }
    if (typeof dto.lastName !== 'undefined') {
      customer.lastName = dto.lastName;
    }
    if (typeof dto.address !== 'undefined') {
      customer.address = dto.address;
    }
    if (typeof dto.lat !== 'undefined') {
      customer.lat = dto.lat;
    }
    if (typeof dto.lng !== 'undefined') {
      customer.lng = dto.lng;
    }

    if (
      addressChanged &&
      typeof dto.lat === 'undefined' &&
      typeof dto.lng === 'undefined'
    ) {
      customer.lat = null;
      customer.lng = null;
    }
    if (typeof dto.phone !== 'undefined') {
      customer.phone = dto.phone;
    }
    if (typeof dto.secondaryPhone !== 'undefined') {
      customer.secondaryPhone = dto.secondaryPhone;
    }
    if (typeof dto.email !== 'undefined') {
      customer.email = dto.email;
    }

    const nextAcquisitionSource =
      dto.acquisitionSource ?? customer.acquisitionSource;
    const nextAcquisitionSourceOtherRaw =
      typeof dto.acquisitionSourceOther !== 'undefined'
        ? dto.acquisitionSourceOther
        : customer.acquisitionSourceOther;
    const {
      acquisitionSource: normalizedAcquisitionSource,
      acquisitionSourceOther: normalizedAcquisitionSourceOther,
    } = this.normalizeAcquisitionSourceValues(
      nextAcquisitionSource,
      nextAcquisitionSourceOtherRaw ?? undefined,
    );
    customer.acquisitionSource = normalizedAcquisitionSource;
    customer.acquisitionSourceOther = normalizedAcquisitionSourceOther;

    try {
      const updated = await this.customersRepository.save(customer);
      const auditChanges = this.buildCustomerAuditChanges(original, customer);

      if (auditChanges.length > 0) {
        const customerAuditLogsRepo =
          this.dataSource.getRepository(CustomerAuditLog);
        await customerAuditLogsRepo.save(
          auditChanges.map((change) =>
            customerAuditLogsRepo.create({
              customerId: customer.id,
              performedByUserId: viewer?.userId ?? null,
              eventType: change.eventType,
              payload: change.meta,
            }),
          ),
        );
      }

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

    const customerAuditLogs = await this.dataSource
      .getRepository(CustomerAuditLog)
      .find({
        where: { customerId },
        relations: { performedByUser: true },
        order: { createdAt: 'ASC' },
      });

    for (const auditLog of customerAuditLogs) {
      const actorName = auditLog.performedByUser
        ? `${auditLog.performedByUser.firstName} ${auditLog.performedByUser.lastName}`.trim()
        : 'System';
      events.push({
        event: this.describeCustomerAuditEvent(auditLog.eventType),
        actorName: actorName.length > 0 ? actorName : 'System',
        createdAt: auditLog.createdAt.toISOString(),
        meta: this.normalizeMeta(auditLog.payload),
      });
    }

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

  async geocodeAddress(address: string): Promise<GeocodeCoordinatesDto> {
    const normalizedAddress = address.trim();
    if (normalizedAddress.length === 0) {
      throw new BadRequestException('Address is required');
    }

    const requestUrl = new URL(NOMINATIM_URL);
    requestUrl.searchParams.set('format', 'json');
    requestUrl.searchParams.set('limit', '1');
    requestUrl.searchParams.set('q', normalizedAddress);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(requestUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': NOMINATIM_USER_AGENT,
          Accept: 'application/json',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('Geocoding service timed out');
      }
      throw new ServiceUnavailableException('Geocoding service unavailable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new ServiceUnavailableException('Geocoding service rate limited');
      }
      throw new ServiceUnavailableException('Geocoding lookup failed');
    }

    const payload = (await response.json()) as Array<{
      lat?: string;
      lon?: string;
    }>;

    const firstResult = payload[0];
    if (!firstResult?.lat || !firstResult.lon) {
      throw new NotFoundException('Address coordinates not found');
    }

    const lat = Number.parseFloat(firstResult.lat);
    const lng = Number.parseFloat(firstResult.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadGatewayException('Invalid geocoding coordinates returned');
    }

    return { lat, lng };
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

  private buildCustomerAuditChanges(
    previous: {
      firstName: string;
      lastName: string;
      address: string | null;
      lat: number | null;
      lng: number | null;
      phone: string;
      secondaryPhone: string | null;
      email: string;
      acquisitionSource: string | null;
      acquisitionSourceOther: string | null;
    },
    current: Customer,
  ): CustomerAuditChange[] {
    const changes: CustomerAuditChange[] = [];

    if (
      previous.firstName !== current.firstName ||
      previous.lastName !== current.lastName
    ) {
      changes.push({
        eventType: 'name_updated',
        meta: {
          oldFirstName: previous.firstName,
          oldLastName: previous.lastName,
          newFirstName: current.firstName,
          newLastName: current.lastName,
        },
      });
    }

    if (previous.phone !== current.phone) {
      changes.push({
        eventType: 'phone_updated',
        meta: { oldPhone: previous.phone, newPhone: current.phone },
      });
    }

    if (previous.secondaryPhone !== current.secondaryPhone) {
      changes.push({
        eventType: 'secondary_phone_updated',
        meta: {
          oldSecondaryPhone: previous.secondaryPhone,
          newSecondaryPhone: current.secondaryPhone,
        },
      });
    }

    if (previous.email !== current.email) {
      changes.push({
        eventType: 'email_updated',
        meta: { oldEmail: previous.email, newEmail: current.email },
      });
    }

    if (previous.address !== current.address) {
      changes.push({
        eventType: 'address_updated',
        meta: { oldAddress: previous.address, newAddress: current.address },
      });
    }

    if (previous.lat !== current.lat || previous.lng !== current.lng) {
      changes.push({
        eventType: 'coordinates_updated',
        meta: {
          oldLat: previous.lat,
          oldLng: previous.lng,
          newLat: current.lat,
          newLng: current.lng,
        },
      });
    }

    if (
      previous.acquisitionSource !== current.acquisitionSource ||
      previous.acquisitionSourceOther !== current.acquisitionSourceOther
    ) {
      changes.push({
        eventType: 'acquisition_source_updated',
        meta: {
          oldAcquisitionSource: previous.acquisitionSource,
          oldAcquisitionSourceOther: previous.acquisitionSourceOther,
          newAcquisitionSource: current.acquisitionSource,
          newAcquisitionSourceOther: current.acquisitionSourceOther,
        },
      });
    }

    return changes;
  }

  private describeCustomerAuditEvent(eventType: string): string {
    switch (eventType) {
      case 'name_updated':
        return 'Name updated';
      case 'phone_updated':
        return 'Phone number updated';
      case 'secondary_phone_updated':
        return 'Secondary phone updated';
      case 'email_updated':
        return 'Email updated';
      case 'address_updated':
        return 'Address updated';
      case 'coordinates_updated':
        return 'Map location updated';
      case 'acquisition_source_updated':
        return 'Acquisition source updated';
      default:
        return 'Customer record updated';
    }
  }

  private normalizeAcquisitionSourceValues(
    source?: string | null,
    other?: string,
  ): {
    acquisitionSource: CustomerAcquisitionSource | null;
    acquisitionSourceOther: string | null;
  } {
    if (!source) {
      return { acquisitionSource: null, acquisitionSourceOther: null };
    }

    if (source !== 'other') {
      return {
        acquisitionSource: source as CustomerAcquisitionSource,
        acquisitionSourceOther: null,
      };
    }

    const normalizedOther = typeof other === 'string' ? other.trim() : '';
    if (!normalizedOther) {
      throw new BadRequestException(
        'acquisitionSourceOther is required when acquisitionSource is other',
      );
    }

    return {
      acquisitionSource: 'other',
      acquisitionSourceOther: normalizedOther,
    };
  }

  private normalizeMeta(payload: unknown): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }

    return payload as Record<string, unknown>;
  }
}
