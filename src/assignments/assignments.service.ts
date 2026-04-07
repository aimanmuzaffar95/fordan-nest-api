import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { JobsService, JobListViewer } from '../jobs/jobs.service';
import { Job } from '../jobs/entities/job.entity';
import { Team } from '../teams/entities/team.entity';
import { User } from '../users/entities/user.entity';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { Assignment } from './entities/assignment.entity';
import { AssignmentResponseDto } from './dto/assignment-response.dto';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { LockAssignmentDto } from './dto/lock-assignment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { UserRole } from '../users/entities/user-role.enum';

@Injectable()
export class AssignmentsService {
  private readonly logger = new Logger(AssignmentsService.name);

  constructor(
    @InjectRepository(Assignment)
    private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(Team)
    private readonly teamsRepo: Repository<Team>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jobsService: JobsService,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async listForJob(
    jobId: string,
    viewer: JobListViewer,
  ): Promise<{ items: AssignmentResponseDto[] }> {
    await this.jobsService.getOne(jobId, viewer);
    const rows = await this.assignmentRepo.find({
      where: { jobId },
      order: { scheduledDate: 'ASC', slot: 'ASC' },
    });
    return { items: rows.map((a) => AssignmentResponseDto.fromEntity(a)) };
  }

  async create(
    jobId: string,
    dto: CreateAssignmentDto,
    viewer: JobListViewer,
  ): Promise<AssignmentResponseDto> {
    const job = await this.jobsService.getOne(jobId, viewer);

    const staff = await this.usersRepo.findOne({
      where: { id: dto.staffUserId },
      select: ['id', 'teamId', 'active'],
    });
    if (!staff) throw new NotFoundException('Staff user not found');
    if (!staff.active) {
      throw new ConflictException({
        message: 'Staff user is inactive',
        code: 'CONFLICT',
      });
    }

    const effectiveTeamId = dto.teamId ?? staff.teamId ?? null;
    let team: Team | null = null;
    if (effectiveTeamId) {
      team = await this.teamsRepo.findOne({ where: { id: effectiveTeamId } });
      if (!team) throw new NotFoundException('Team not found');
    }

    const existingForJob = await this.assignmentRepo.find({
      where: { jobId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const duplicateInstaller = existingForJob.find(
      (assignment) => assignment.staffUserId === dto.staffUserId,
    );
    if (duplicateInstaller) {
      throw new ConflictException({
        message: 'This installer is already assigned to this job.',
        code: 'CONFLICT',
      });
    }

    const primaryJobAssignment = existingForJob[0] ?? null;
    if (
      primaryJobAssignment &&
      (primaryJobAssignment.scheduledDate !== dto.scheduledDate ||
        primaryJobAssignment.slot !== dto.slot ||
        (primaryJobAssignment.teamId ?? null) !== effectiveTeamId)
    ) {
      throw new ConflictException({
        message:
          'All installers on a job must share the same date, slot, and team.',
        code: 'CONFLICT',
      });
    }

    if (team && effectiveTeamId) {
      const sameDay = await this.assignmentRepo.find({
        where: { teamId: effectiveTeamId, scheduledDate: dto.scheduledDate },
        relations: { job: true },
      });
      const scheduledJobIds = new Set<string>();
      const usedKw = sameDay.reduce((sum, assignment) => {
        if (
          scheduledJobIds.has(assignment.jobId) ||
          assignment.jobId === jobId
        ) {
          return sum;
        }
        scheduledJobIds.add(assignment.jobId);
        return sum + Number(assignment.job.systemSizeKw);
      }, 0);
      const addKw = primaryJobAssignment ? 0 : Number(job.job.systemSizeKw);
      const capKw = Number(team.dailyCapacityKw);
      if (usedKw + addKw > capKw + 1e-6) {
        throw new ConflictException({
          message: `Team daily capacity (${capKw} kW) would be exceeded on ${dto.scheduledDate}.`,
          code: 'CONFLICT',
        });
      }
    }

    try {
      const createdAssignment = await this.dataSource.transaction(
        async (manager) => {
          const aRepo = manager.getRepository(Assignment);
          const jRepo = manager.getRepository(Job);

          const assignment = aRepo.create({
            jobId,
            teamId: effectiveTeamId,
            staffUserId: dto.staffUserId,
            scheduledDate: dto.scheduledDate,
            slot: dto.slot,
            locked: false,
            lockedAt: null,
            lockedByUserId: null,
            lockReason: null,
          });
          const saved = await aRepo.save(assignment);

          const primaryAssignment = primaryJobAssignment ?? saved;
          await this.syncJobScheduleFields(jRepo, jobId, {
            assignedTeamId: primaryAssignment.teamId,
            assignedStaffUserId: primaryAssignment.staffUserId,
            scheduledDate: primaryAssignment.scheduledDate,
            scheduledSlot: primaryAssignment.slot,
          });

          return AssignmentResponseDto.fromEntity(saved);
        },
      );

      await this.sendNotificationSafely(
        () =>
          this.notificationsService.sendToUser(dto.staffUserId, {
            type: NOTIFICATION_TYPE.JOB_ASSIGNED_TO_INSTALLER,
            title: 'New installer assignment',
            body: `You were assigned to job ${job.job.orderNumber}.`,
            metadata: {
              jobId,
              orderNumber: job.job.orderNumber,
              customerName:
                job.customer &&
                `${job.customer.firstName} ${job.customer.lastName}`.trim(),
              assignedByUserId: viewer.userId,
              assignedStaffUserId: dto.staffUserId,
              teamId: effectiveTeamId,
            },
            dedupeKey: `installer-assignment:${jobId}:${dto.staffUserId}:${dto.scheduledDate}:${dto.slot}`,
          }),
        `assignment-create:${jobId}:${dto.staffUserId}`,
      );

      return createdAssignment;
    } catch (e) {
      if (e instanceof QueryFailedError) {
        const driver = e.driverError as { code?: string; errno?: number };
        if (
          driver?.code === '23505' ||
          driver?.code === 'SQLITE_CONSTRAINT' ||
          driver?.errno === 1062
        ) {
          throw new ConflictException({
            message:
              'This staff member is already assigned to another job for this date and slot.',
            code: 'CONFLICT',
          });
        }
      }
      throw e;
    }
  }

  async remove(
    jobId: string,
    assignmentId: string,
    viewer: JobListViewer,
  ): Promise<{ id: string }> {
    await this.jobsService.getOne(jobId, viewer);

    const row = await this.assignmentRepo.findOne({
      where: { id: assignmentId, jobId },
    });
    if (!row) throw new NotFoundException('Assignment not found');

    if (row.locked) {
      throw new ConflictException({
        message: 'Cannot delete a locked assignment — unlock it first.',
        code: 'CONFLICT',
      });
    }

    await this.dataSource.transaction(async (manager) => {
      const aRepo = manager.getRepository(Assignment);
      const jRepo = manager.getRepository(Job);

      await aRepo.remove(row);

      const remainingAssignments = await aRepo.find({
        where: { jobId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
      const primaryAssignment = remainingAssignments[0] ?? null;

      await this.syncJobScheduleFields(
        jRepo,
        jobId,
        primaryAssignment
          ? {
              assignedTeamId: primaryAssignment.teamId,
              assignedStaffUserId: primaryAssignment.staffUserId,
              scheduledDate: primaryAssignment.scheduledDate,
              scheduledSlot: primaryAssignment.slot,
            }
          : {
              assignedTeamId: null,
              assignedStaffUserId: null,
              scheduledDate: null,
              scheduledSlot: null,
            },
      );
    });

    await this.sendNotificationSafely(
      () =>
        this.notificationsService.sendToUser(row.staffUserId, {
          type: NOTIFICATION_TYPE.JOB_UNASSIGNED_FROM_INSTALLER,
          title: 'Installer assignment removed',
          body: `You were unassigned from job ${jobId}.`,
          metadata: {
            jobId,
            assignmentId,
            removedByUserId: viewer.userId,
            assignedStaffUserId: row.staffUserId,
          },
          dedupeKey: `installer-unassigned:${assignmentId}`,
        }),
      `assignment-remove:${jobId}:${assignmentId}`,
    );

    const jobAfterRemoval = await this.jobsService.getOne(jobId, viewer);
    if (
      ['scheduled', 'pre_meter_approved'].includes(
        jobAfterRemoval.job.pipelineStage,
      ) &&
      !jobAfterRemoval.job.assignedStaffUserId
    ) {
      const managerId = jobAfterRemoval.job.managerId;
      if (managerId) {
        await this.sendNotificationSafely(
          () =>
            this.notificationsService.sendToUser(
              managerId,
              {
                type: NOTIFICATION_TYPE.JOB_NEEDS_ASSIGNMENT,
                title: 'Job needs installer assignment',
                body: `Job ${jobAfterRemoval.job.orderNumber} is ready to be assigned.`,
                metadata: {
                  jobId,
                  orderNumber: jobAfterRemoval.job.orderNumber,
                  managerId,
                },
                dedupeKey: `needs-assignment:${jobId}:${managerId}`,
              },
            ),
          `needs-assignment-manager:${jobId}:${managerId}`,
        );
      } else {
        await this.sendNotificationSafely(
          () =>
            this.notificationsService.sendToRole(UserRole.ADMIN, {
              type: NOTIFICATION_TYPE.JOB_NEEDS_ASSIGNMENT,
              title: 'Job needs installer assignment',
              body: `Job ${jobAfterRemoval.job.orderNumber} is ready to be assigned.`,
              metadata: {
                jobId,
                orderNumber: jobAfterRemoval.job.orderNumber,
              },
              dedupeKey: `needs-assignment:${jobId}:admins`,
            }),
          `needs-assignment-admins:${jobId}`,
        );
      }
    }

    return { id: assignmentId };
  }

  private async syncJobScheduleFields(
    jobsRepo: Repository<Job>,
    jobId: string,
    values: {
      assignedTeamId: string | null;
      assignedStaffUserId: string | null;
      scheduledDate: string | null;
      scheduledSlot: string | null;
    },
  ) {
    await jobsRepo.update({ id: jobId }, values);
  }

  private async sendNotificationSafely(
    action: () => Promise<unknown>,
    context: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification skipped for ${context}: ${message}`);
    }
  }

  async setLock(
    assignmentId: string,
    dto: LockAssignmentDto,
    userId: string,
    viewer: JobListViewer,
  ): Promise<AssignmentResponseDto> {
    const row = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
    });
    if (!row) throw new NotFoundException('Assignment not found');

    await this.jobsService.getOne(row.jobId, viewer);

    if (dto.locked) {
      const r = dto.reason?.trim();
      if (!r) {
        throw new BadRequestException(
          'reason is required and must be non-empty when locking',
        );
      }
    }

    const wasLocked = row.locked;
    const reasonTrim = (dto.reason ?? '').trim();

    if (wasLocked === dto.locked) {
      if (dto.locked && (row.lockReason ?? '') === reasonTrim) {
        return AssignmentResponseDto.fromEntity(row);
      }
      if (!dto.locked) {
        return AssignmentResponseDto.fromEntity(row);
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const aRepo = manager.getRepository(Assignment);
      const tRepo = manager.getRepository(TimelineEvent);

      row.locked = dto.locked;
      if (dto.locked) {
        row.lockedAt = new Date();
        row.lockedByUserId = userId;
        row.lockReason = reasonTrim;
      } else {
        row.lockedAt = null;
        row.lockedByUserId = null;
        row.lockReason = null;
      }

      const saved = await aRepo.save(row);

      await tRepo.save(
        tRepo.create({
          jobId: row.jobId,
          type: 'assignment_lock_change',
          payload: {
            assignmentId: row.id,
            locked: dto.locked,
            reason: reasonTrim || null,
            previousLocked: wasLocked,
          } as unknown,
          createdByUserId: userId,
        }),
      );

      return AssignmentResponseDto.fromEntity(saved);
    });
  }
}
