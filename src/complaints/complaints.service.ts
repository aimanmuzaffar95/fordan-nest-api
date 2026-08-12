import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type SelectQueryBuilder } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { CreateComplaintMessageDto } from './dto/create-complaint-message.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import {
  ComplaintEventResponseDto,
  ComplaintResponseDto,
  ComplaintsListResponseDto,
} from './dto/complaint-response.dto';
import { ComplaintsQueryDto } from './dto/complaints-query.dto';
import { UpdateComplaintDto } from './dto/update-complaint.dto';
import { ComplaintEvent } from './entities/complaint-event.entity';
import { ComplaintEventType } from './entities/complaint-event-type.enum';
import { Complaint } from './entities/complaint.entity';
import {
  ComplaintPriority,
  ComplaintStatus,
} from './entities/complaint-status.enum';

type Viewer = { userId: string; role: UserRole };

/** Roles allowed to see every complaint, not just their own assignments. */
const PRIVILEGED_ROLES = new Set([UserRole.ADMIN, UserRole.MANAGER]);

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(Complaint)
    private readonly complaintRepo: Repository<Complaint>,
    @InjectRepository(ComplaintEvent)
    private readonly eventRepo: Repository<ComplaintEvent>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  async create(
    dto: CreateComplaintDto,
    viewer: Viewer,
  ): Promise<ComplaintResponseDto> {
    if (dto.customerId) await this.assertCustomerExists(dto.customerId);
    if (dto.jobId) await this.assertJobExists(dto.jobId);
    if (dto.assigneeUserId) await this.assertAssigneeExists(dto.assigneeUserId);

    const saved = await this.complaintRepo.save(
      this.complaintRepo.create({
        subject: dto.subject,
        status: ComplaintStatus.NEW,
        priority: dto.priority ?? ComplaintPriority.NORMAL,
        customerId: dto.customerId ?? null,
        jobId: dto.jobId ?? null,
        assigneeUserId: dto.assigneeUserId ?? null,
        createdByUserId: viewer.userId,
        solvedAt: null,
        closedAt: null,
      }),
    );

    await this.eventRepo.save(
      this.eventRepo.create([
        {
          complaintId: saved.id,
          type: ComplaintEventType.CREATED,
          body: null,
          actorUserId: viewer.userId,
        },
        // The complaint body doubles as the first message in the thread —
        // matches the Zendesk/HubSpot pattern of the original ticket
        // description appearing as the opening reply.
        {
          complaintId: saved.id,
          type: ComplaintEventType.REPLY,
          body: dto.body,
          actorUserId: viewer.userId,
        },
      ]),
    );

    if (saved.assigneeUserId && saved.assigneeUserId !== viewer.userId) {
      await this.notifyAssigned(saved);
    }

    return this.findOne(saved.id, viewer);
  }

  async findAll(
    filters: ComplaintsQueryDto,
    viewer: Viewer,
  ): Promise<ComplaintsListResponseDto> {
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const offset = Math.max(0, filters.offset ?? 0);

    const qb = this.complaintRepo
      .createQueryBuilder('complaint')
      .leftJoinAndSelect('complaint.customer', 'customer')
      .leftJoinAndSelect('complaint.job', 'job')
      .leftJoinAndSelect('complaint.assigneeUser', 'assigneeUser')
      .leftJoinAndSelect('complaint.createdByUser', 'createdByUser')
      .orderBy('complaint.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    this.applyFilters(qb, filters, viewer);

    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((c) => this.toResponse(c)),
      total,
    };
  }

  async findOne(id: string, viewer: Viewer): Promise<ComplaintResponseDto> {
    const complaint = await this.loadVisibleComplaint(id, viewer);
    const events = await this.eventRepo.find({
      where: { complaintId: id },
      relations: { actorUser: true },
      order: { createdAt: 'ASC' },
    });
    return this.toResponse(complaint, events);
  }

  async update(
    id: string,
    dto: UpdateComplaintDto,
    viewer: Viewer,
  ): Promise<ComplaintResponseDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    const complaint = await this.loadVisibleComplaint(id, viewer);
    this.assertNotClosed(complaint);

    const eventsToSave: Partial<ComplaintEvent>[] = [];

    if (dto.subject !== undefined) complaint.subject = dto.subject;
    if (dto.priority !== undefined) complaint.priority = dto.priority;

    if (dto.status !== undefined) {
      this.applyStatusChange(complaint, dto.status, viewer, eventsToSave);
    }

    if (dto.assigneeUserId !== undefined) {
      await this.applyAssigneeChange(
        complaint,
        dto.assigneeUserId,
        viewer,
        eventsToSave,
      );
    }

    const saved = await this.complaintRepo.save(complaint);
    if (eventsToSave.length > 0) {
      await this.eventRepo.save(
        eventsToSave.map((e) => ({ ...e, complaintId: saved.id })),
      );
    }

    return this.findOne(saved.id, viewer);
  }

  async addMessage(
    id: string,
    dto: CreateComplaintMessageDto,
    viewer: Viewer,
  ): Promise<ComplaintResponseDto> {
    const complaint = await this.loadVisibleComplaint(id, viewer);
    this.assertNotClosed(complaint);

    const eventsToSave: Partial<ComplaintEvent>[] = [
      {
        type:
          dto.visibility === 'note'
            ? ComplaintEventType.NOTE
            : ComplaintEventType.REPLY,
        body: dto.body,
        actorUserId: viewer.userId,
      },
    ];

    if (dto.status !== undefined) {
      this.applyStatusChange(complaint, dto.status, viewer, eventsToSave);
    }

    const saved = await this.complaintRepo.save(complaint);
    await this.eventRepo.save(
      eventsToSave.map((e) => ({ ...e, complaintId: saved.id })),
    );

    return this.findOne(saved.id, viewer);
  }

  // ─── Status / assignment transition rules ─────────────────────────────────

  /**
   * Mutates `complaint.status` (and `solvedAt`/`closedAt`) in place and
   * appends the resulting `status_change` event to `events`. No-ops when the
   * status is unchanged. Callers must already have asserted the complaint is
   * not closed (see `assertNotClosed`).
   */
  private applyStatusChange(
    complaint: Complaint,
    nextStatus: ComplaintStatus,
    viewer: Viewer,
    events: Partial<ComplaintEvent>[],
  ): void {
    if (nextStatus === complaint.status) return;

    if (nextStatus === ComplaintStatus.NEW) {
      // `new` is entry-only — once a complaint has moved on, it can never
      // be moved back, matching the Zendesk lifecycle this module mirrors.
      throw new BadRequestException(
        'A complaint cannot be moved back to `new` once it has left that status',
      );
    }

    const statusFrom = complaint.status;
    complaint.status = nextStatus;

    if (nextStatus === ComplaintStatus.SOLVED && !complaint.solvedAt) {
      complaint.solvedAt = new Date();
    }
    if (nextStatus === ComplaintStatus.CLOSED) {
      complaint.closedAt = new Date();
    }

    events.push({
      type: ComplaintEventType.STATUS_CHANGE,
      statusFrom,
      statusTo: nextStatus,
      actorUserId: viewer.userId,
    });
  }

  private async applyAssigneeChange(
    complaint: Complaint,
    nextAssigneeUserId: string | null,
    viewer: Viewer,
    events: Partial<ComplaintEvent>[],
  ): Promise<void> {
    if (nextAssigneeUserId === complaint.assigneeUserId) return;
    if (nextAssigneeUserId) await this.assertAssigneeExists(nextAssigneeUserId);

    const assigneeFrom = complaint.assigneeUserId;
    complaint.assigneeUserId = nextAssigneeUserId;

    events.push({
      type: ComplaintEventType.ASSIGNMENT_CHANGE,
      assigneeFromUserId: assigneeFrom,
      assigneeToUserId: nextAssigneeUserId,
      actorUserId: viewer.userId,
    });

    if (nextAssigneeUserId && nextAssigneeUserId !== viewer.userId) {
      await this.notifyAssigned(complaint);
    }
  }

  private assertNotClosed(complaint: Complaint): void {
    if (complaint.status === ComplaintStatus.CLOSED) {
      throw new BadRequestException(
        'This complaint is closed and can no longer be updated',
      );
    }
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  private async notifyAssigned(complaint: Complaint): Promise<void> {
    if (!complaint.assigneeUserId) return;
    await this.notifications.sendToUsers([complaint.assigneeUserId], {
      type: NOTIFICATION_TYPE.TASK_ASSIGNED,
      title: 'Complaint assigned to you',
      body: complaint.subject,
      metadata: {
        complaintId: complaint.id,
        jobId: complaint.jobId,
        customerId: complaint.customerId,
      },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertCustomerExists(customerId: string): Promise<void> {
    const exists = await this.customerRepo.exists({
      where: { id: customerId },
    });
    if (!exists) {
      throw new BadRequestException(`Customer ${customerId} not found`);
    }
  }

  private async assertJobExists(jobId: string): Promise<void> {
    const exists = await this.jobRepo.exists({ where: { id: jobId } });
    if (!exists) {
      throw new BadRequestException(`Job ${jobId} not found`);
    }
  }

  private async assertAssigneeExists(userId: string): Promise<void> {
    const exists = await this.userRepo.exists({
      where: { id: userId, active: true },
    });
    if (!exists) {
      throw new BadRequestException(`Assignee ${userId} is not an active user`);
    }
  }

  /**
   * Apply visibility + filters to the list query builder. Installers are
   * always pinned to `assigneeUserId = self` regardless of the requested
   * `scope` — they never see anyone else's complaints.
   */
  private applyFilters(
    qb: SelectQueryBuilder<Complaint>,
    filters: ComplaintsQueryDto,
    viewer: Viewer,
  ): void {
    const unsolvedStatuses = [
      ComplaintStatus.NEW,
      ComplaintStatus.OPEN,
      ComplaintStatus.PENDING,
      ComplaintStatus.ON_HOLD,
    ];

    if (filters.view === 'unsolved' || filters.view === 'unassigned') {
      qb.andWhere('complaint.status IN (:...unsolvedStatuses)', {
        unsolvedStatuses,
      });
      if (filters.view === 'unassigned') {
        qb.andWhere('complaint.assigneeUserId IS NULL');
      }
    } else if (filters.status) {
      qb.andWhere('complaint.status = :status', { status: filters.status });
    }

    if (filters.priority) {
      qb.andWhere('complaint.priority = :priority', {
        priority: filters.priority,
      });
    }
    if (filters.customerId) {
      qb.andWhere('complaint.customerId = :customerId', {
        customerId: filters.customerId,
      });
    }
    if (filters.jobId) {
      qb.andWhere('complaint.jobId = :jobId', { jobId: filters.jobId });
    }
    if (filters.q && filters.q.trim() !== '') {
      qb.andWhere('LOWER(complaint.subject) LIKE :q', {
        q: `%${filters.q.trim().toLowerCase()}%`,
      });
    }

    const privileged = PRIVILEGED_ROLES.has(viewer.role);
    const scope = privileged ? (filters.scope ?? 'all') : 'mine';

    if (scope === 'mine') {
      qb.andWhere('complaint.assigneeUserId = :selfId', {
        selfId: viewer.userId,
      });
      return;
    }
    // scope === 'all' and privileged: honor an explicit assignee filter,
    // otherwise every complaint in scope is visible.
    // Skip assignee filter when view=unassigned (already IS NULL).
    if (filters.assigneeUserId && filters.view !== 'unassigned') {
      qb.andWhere('complaint.assigneeUserId = :assigneeUserId', {
        assigneeUserId: filters.assigneeUserId,
      });
    }
  }

  private async loadVisibleComplaint(
    id: string,
    viewer: Viewer,
  ): Promise<Complaint> {
    const complaint = await this.complaintRepo.findOne({
      where: { id },
      relations: {
        customer: true,
        job: true,
        assigneeUser: true,
        createdByUser: true,
      },
    });
    if (!complaint) throw new NotFoundException(`Complaint ${id} not found`);

    if (PRIVILEGED_ROLES.has(viewer.role)) return complaint;
    if (complaint.assigneeUserId === viewer.userId) return complaint;
    // Don't leak existence to viewers outside the visibility scope.
    throw new NotFoundException(`Complaint ${id} not found`);
  }

  private toResponse(
    complaint: Complaint,
    events?: ComplaintEvent[],
  ): ComplaintResponseDto {
    const assignee = complaint.assigneeUser;
    const createdBy = complaint.createdByUser;
    return {
      id: complaint.id,
      subject: complaint.subject,
      status: complaint.status,
      priority: complaint.priority,
      customerId: complaint.customerId,
      customerName: complaint.customer
        ? `${complaint.customer.firstName} ${complaint.customer.lastName}`.trim()
        : null,
      customerEmail: complaint.customer?.email?.trim() || null,
      customerPhone: complaint.customer?.phone?.trim() || null,
      jobId: complaint.jobId,
      jobOrderNumber: complaint.job?.orderNumber ?? null,
      jobStage: complaint.job?.pipelineStage ?? null,
      assigneeUserId: complaint.assigneeUserId,
      assigneeName: assignee
        ? `${assignee.firstName ?? ''} ${assignee.lastName ?? ''}`.trim() ||
          null
        : null,
      createdByUserId: complaint.createdByUserId,
      createdByName: createdBy
        ? `${createdBy.firstName ?? ''} ${createdBy.lastName ?? ''}`.trim() ||
          null
        : null,
      solvedAt: complaint.solvedAt ? complaint.solvedAt.toISOString() : null,
      closedAt: complaint.closedAt ? complaint.closedAt.toISOString() : null,
      createdAt: complaint.createdAt.toISOString(),
      updatedAt: complaint.updatedAt.toISOString(),
      ...(events
        ? { timeline: events.map((e) => this.toEventResponse(e)) }
        : {}),
    };
  }

  private toEventResponse(event: ComplaintEvent): ComplaintEventResponseDto {
    const actor = event.actorUser;
    return {
      id: event.id,
      type: event.type,
      body: event.body,
      statusFrom: event.statusFrom,
      statusTo: event.statusTo,
      priorityTo: event.priorityTo,
      assigneeFromUserId: event.assigneeFromUserId,
      assigneeToUserId: event.assigneeToUserId,
      actorUserId: event.actorUserId,
      actorName: actor
        ? `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || null
        : null,
      createdAt: event.createdAt.toISOString(),
    };
  }
}
