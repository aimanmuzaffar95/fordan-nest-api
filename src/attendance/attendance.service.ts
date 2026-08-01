import {
  BadRequestException,
  Logger,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Readable } from 'node:stream';
import { DataSource, IsNull, QueryFailedError, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { File as FileEntity } from '../files/entities/file.entity';
import { FilesStorageService } from '../files/files-storage.service';
import { UploadedBinaryFile } from '../files/uploaded-binary-file.type';
import { Job } from '../jobs/entities/job.entity';
import { JobsService, JobListViewer } from '../jobs/jobs.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { TimelineEvent } from '../timeline/entities/timeline-event.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { AttendanceLocationDto } from './dto/attendance-location.dto';
import {
  GlobalClockInDto,
  GlobalClockOutDto,
} from './dto/global-attendance.dto';
import { AttendanceRecord } from './entities/attendance-record.entity';

type AuthViewer = JobListViewer;

type AttendanceRecordResponse = {
  id: string;
  jobId: string;
  staffId: string;
  clockInAt: string;
  clockInLat: number | null;
  clockInLng: number | null;
  clockInAccuracyM: number | null;
  clockOutAt: string | null;
  clockOutLat: number | null;
  clockOutLng: number | null;
  clockOutAccuracyM: number | null;
  locationStatus: string;
  photoUrl: string | null;
  correctedBy: string | null;
  correctionNote: string | null;
  correctedAt: string | null;
  createdAt: string;
};

type AttendanceListItem = AttendanceRecordResponse & {
  staff: {
    id: string;
    name: string;
  };
  durationMinutes: number | null;
  status: 'open' | 'complete';
};

type AttendancePhotoUploadResponse = {
  photoUrl: string;
};

type AttendancePhotoDownload = {
  file: FileEntity;
  stream: Readable;
  contentLength?: number;
};

export type AttendanceSessionSummary = {
  id: string;
  userId: string;
  jobId: string | null;
  assignmentId: string | null;
  clockInAt: string;
  clockOutAt: string | null;
  durationMinutes: number | null;
  geofenceFlaggedIn: boolean;
  geofenceFlaggedOut: boolean;
  distanceFromSiteMetersIn: number | null;
  distanceFromSiteMetersOut: number | null;
  offSiteAcknowledgedReasonIn: string | null;
  offSiteAcknowledgedReasonOut: string | null;
  correctionNote: string | null;
  correctedAt: string | null;
  correctedByUserId: string | null;
};

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly attendanceRepo: Repository<AttendanceRecord>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(FileEntity)
    private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jobsService: JobsService,
    private readonly notificationsService: NotificationsService,
    private readonly filesStorageService: FilesStorageService,
    private readonly dataSource: DataSource,
  ) {}

  async clockInGlobal(
    dto: GlobalClockInDto,
    actor: AuthViewer,
  ): Promise<AttendanceSessionSummary> {
    if (!dto.jobId) {
      throw new BadRequestException('jobId is required to clock in');
    }
    const record = await this.clockIn(dto.jobId, dto, actor);
    return this.toSessionSummary(record, actor.userId);
  }

  async clockOutGlobal(
    dto: GlobalClockOutDto,
    actor: AuthViewer,
  ): Promise<AttendanceSessionSummary> {
    const open = await this.attendanceRepo.findOne({
      where: { staffId: actor.userId, clockOutAt: IsNull() },
      order: { clockInAt: 'DESC' },
    });
    if (!open) {
      throw new BadRequestException('No open attendance session');
    }
    const record = await this.clockOut(open.jobId, dto, actor);
    return this.toSessionSummary(record, actor.userId);
  }

  async getMyOpenSession(
    userId: string,
  ): Promise<AttendanceSessionSummary | null> {
    const open = await this.attendanceRepo.findOne({
      where: { staffId: userId, clockOutAt: IsNull() },
      order: { clockInAt: 'DESC' },
    });
    if (!open) return null;
    return this.toSessionSummary(this.toRecordResponse(open), userId);
  }

  async listMySessions(
    userId: string,
    from: string,
    to: string,
  ): Promise<AttendanceSessionSummary[]> {
    const fromDate = new Date(`${from}T00:00:00.000Z`);
    const toDate = new Date(`${to}T23:59:59.999Z`);
    const records = await this.attendanceRepo
      .createQueryBuilder('a')
      .where('a.staffId = :userId', { userId })
      .andWhere('a.clockInAt >= :fromDate', { fromDate })
      .andWhere('a.clockInAt <= :toDate', { toDate })
      .orderBy('a.clockInAt', 'DESC')
      .getMany();
    return records.map((r) =>
      this.toSessionSummary(this.toRecordResponse(r), userId),
    );
  }

  /** Team-wide session list for admins/managers (mobile team attendance screen). */
  async listTeamSessions(
    from: string | undefined,
    to: string | undefined,
    userId: string | undefined,
  ): Promise<AttendanceSessionSummary[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .orderBy('a.clockInAt', 'DESC')
      .take(500);
    if (from) {
      qb.andWhere('a.clockInAt >= :fromDate', {
        fromDate: new Date(`${from}T00:00:00.000Z`),
      });
    }
    if (to) {
      qb.andWhere('a.clockInAt <= :toDate', {
        toDate: new Date(`${to}T23:59:59.999Z`),
      });
    }
    if (userId) {
      qb.andWhere('a.staffId = :userId', { userId });
    }
    const records = await qb.getMany();
    return records.map((r) =>
      this.toSessionSummary(this.toRecordResponse(r), r.staffId),
    );
  }

  async patchSessionCorrection(
    sessionId: string,
    correctionNote: string | undefined,
    actorUserId: string,
  ): Promise<AttendanceSessionSummary> {
    const record = await this.attendanceRepo.findOne({
      where: { id: sessionId },
    });
    if (!record) {
      throw new NotFoundException('Attendance session not found');
    }
    if (typeof correctionNote === 'string') {
      record.correctionNote = correctionNote;
      record.correctedAt = new Date();
      record.correctedBy = actorUserId;
    }
    const saved = await this.attendanceRepo.save(record);
    return this.toSessionSummary(this.toRecordResponse(saved), saved.staffId);
  }

  async clockIn(
    jobId: string,
    dto: AttendanceLocationDto,
    actor: AuthViewer,
  ): Promise<AttendanceRecordResponse> {
    await this.ensureInstallerAssigned(jobId, actor.userId);
    const openRecord = await this.attendanceRepo.findOne({
      where: {
        staffId: actor.userId,
        clockOutAt: IsNull(),
      },
      relations: {
        job: true,
      },
      order: {
        clockInAt: 'DESC',
      },
    });

    if (openRecord) {
      throw await this.buildAlreadyClockedInError(openRecord);
    }

    let created: AttendanceRecord;
    try {
      created = await this.dataSource.transaction(async (manager) => {
      const attendanceRepository = manager.getRepository(AttendanceRecord);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const now = new Date();
      // BE-ATTEND-02: lat/lng/accuracy/locationStatus are client-reported and
      // cannot be server-verified. They are already bounds-checked in the DTO
      // (lat -90..90, lng -180..180) and are persisted verbatim as advisory
      // data; the geofence outcome is derived server-side, not trusted from the
      // client.
      const record = attendanceRepository.create({
        jobId,
        staffId: actor.userId,
        clockInAt: now,
        clockInLat: this.toCoordinateValue(dto.latitude),
        clockInLng: this.toCoordinateValue(dto.longitude),
        clockInAccuracyM: dto.accuracyM ?? null,
        clockOutAt: null,
        clockOutLat: null,
        clockOutLng: null,
        clockOutAccuracyM: null,
        locationStatus: dto.locationStatus,
        photoUrl: null,
        correctedBy: null,
        correctionNote: null,
        correctedAt: null,
      });
      const saved = await attendanceRepository.save(record);

      await timelineRepository.save(
        timelineRepository.create({
          jobId,
          type: 'attendance_clock_in',
          payload: {
            attendanceId: saved.id,
            staffUserId: actor.userId,
            locationStatus: saved.locationStatus,
          } as unknown,
          createdByUserId: actor.userId,
        }),
      );

      return saved;
      });
    } catch (error) {
      // BE-ATTEND-03: a concurrent clock-in that wins the race commits first;
      // this transaction then violates the partial-unique index
      // `uq_attendance_open_session_per_staff` (one un-clocked-out session per
      // staff). Map that 23505 to the same 409 "already clocked in" semantics
      // as the pre-check above, closing the check-then-insert race window.
      const driverError = (
        error as QueryFailedError & { driverError?: { code?: string } }
      ).driverError;
      if (error instanceof QueryFailedError && driverError?.code === '23505') {
        const conflicting = await this.attendanceRepo.findOne({
          where: { staffId: actor.userId, clockOutAt: IsNull() },
          relations: { job: true },
          order: { clockInAt: 'DESC' },
        });
        if (conflicting) {
          throw await this.buildAlreadyClockedInError(conflicting);
        }
        throw new ConflictException({
          message: `You're already clocked in. Please clock out first.`,
          code: 'CONFLICT',
        });
      }
      throw error;
    }

    await this.sendAttendanceEventNotifications(created, 'clock_in');

    return this.toRecordResponse(created);
  }

  private async buildAlreadyClockedInError(
    openRecord: AttendanceRecord,
  ): Promise<ConflictException> {
    const jobLabel = await this.buildJobLabel(
      openRecord.jobId,
      openRecord.job,
    );
    return new ConflictException({
      message: `You're already clocked in to ${jobLabel}. Please clock out first.`,
      code: 'CONFLICT',
    });
  }

  async clockOut(
    jobId: string,
    dto: AttendanceLocationDto,
    actor: AuthViewer,
  ): Promise<AttendanceRecordResponse> {
    const record = await this.attendanceRepo.findOne({
      where: {
        jobId,
        staffId: actor.userId,
        clockOutAt: IsNull(),
      },
    });

    if (!record) {
      throw new NotFoundException(
        'No open attendance record found for this job',
      );
    }

    const updated = await this.dataSource.transaction(async (manager) => {
      const attendanceRepository = manager.getRepository(AttendanceRecord);
      const timelineRepository = manager.getRepository(TimelineEvent);
      const now = new Date();
      const nextRecord = {
        ...record,
        clockOutAt: now,
        clockOutLat: this.toCoordinateValue(dto.latitude),
        clockOutLng: this.toCoordinateValue(dto.longitude),
        clockOutAccuracyM: dto.accuracyM ?? null,
        locationStatus: dto.locationStatus,
      };

      const saved = await attendanceRepository.save(nextRecord);

      await timelineRepository.save(
        timelineRepository.create({
          jobId,
          type: 'attendance_clock_out',
          payload: {
            attendanceId: saved.id,
            staffUserId: actor.userId,
            locationStatus: saved.locationStatus,
          } as unknown,
          createdByUserId: actor.userId,
        }),
      );

      return saved;
    });

    await this.sendAttendanceEventNotifications(updated, 'clock_out');

    return this.toRecordResponse(updated);
  }

  async listForJob(
    jobId: string,
    viewer: JobListViewer,
  ): Promise<{ records: AttendanceListItem[] }> {
    await this.jobsService.getOne(jobId, viewer);
    const records = await this.attendanceRepo.find({
      where: { jobId },
      relations: {
        staff: true,
      },
      order: {
        clockInAt: 'DESC',
      },
    });

    return {
      records: records.map((record) => ({
        ...this.toRecordResponse(record),
        staff: {
          id: record.staff.id,
          name: `${record.staff.firstName} ${record.staff.lastName}`.trim(),
        },
        durationMinutes: this.calculateDurationMinutes(
          record.clockInAt,
          record.clockOutAt,
        ),
        status: record.clockOutAt ? 'complete' : 'open',
      })),
    };
  }

  async getMyStatus(
    jobId: string,
    actor: AuthViewer,
  ): Promise<{
    status: 'clocked_in' | 'clocked_out' | 'not_started';
    record: AttendanceRecordResponse | null;
  }> {
    await this.ensureInstallerAssigned(jobId, actor.userId);
    const records = await this.attendanceRepo.find({
      where: {
        jobId,
        staffId: actor.userId,
      },
      order: {
        clockInAt: 'DESC',
      },
      take: 1,
    });

    const latestRecord = records[0] ?? null;
    if (!latestRecord) {
      return {
        status: 'not_started',
        record: null,
      };
    }

    return {
      status: latestRecord.clockOutAt ? 'clocked_out' : 'clocked_in',
      record: this.toRecordResponse(latestRecord),
    };
  }

  async uploadPhoto(
    attendanceId: string,
    uploadedFile: UploadedBinaryFile | undefined,
    actor: AuthViewer,
  ): Promise<AttendancePhotoUploadResponse> {
    const record = await this.attendanceRepo.findOne({
      where: { id: attendanceId },
    });

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    if (record.staffId !== actor.userId) {
      throw new ForbiddenException(
        'You can only upload a photo for your own attendance record',
      );
    }

    if (!uploadedFile) {
      throw new BadRequestException('file is required');
    }

    const stored = await this.filesStorageService.store({
      ownerType: 'attendance',
      ownerId: attendanceId,
      kind: 'photos',
      originalName: uploadedFile.originalname,
      contentType: uploadedFile.mimetype,
      buffer: uploadedFile.buffer,
    });

    const existingPhotoFile = await this.fileRepo.findOne({
      where: {
        ownerType: 'attendance',
        ownerId: attendanceId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (existingPhotoFile) {
      await this.fileRepo.save({
        ...existingPhotoFile,
        storageDriver: stored.storageDriver,
        storageBucket: stored.storageBucket,
        storageKey: stored.storageKey,
        originalName: uploadedFile.originalname,
        displayName: 'Attendance photo',
        contentType: uploadedFile.mimetype,
        sizeBytes: String(uploadedFile.size),
        uploadedByUserId: actor.userId,
      });
    } else {
      await this.fileRepo.save(
        this.fileRepo.create({
          ownerType: 'attendance',
          ownerId: attendanceId,
          kind: 'photos',
          storageDriver: stored.storageDriver,
          storageBucket: stored.storageBucket,
          storageKey: stored.storageKey,
          originalName: uploadedFile.originalname,
          displayName: 'Attendance photo',
          contentType: uploadedFile.mimetype,
          sizeBytes: String(uploadedFile.size),
          uploadedByUserId: actor.userId,
        }),
      );
    }

    const photoUrl = this.buildAttendancePhotoPath(attendanceId);
    await this.attendanceRepo.save({
      ...record,
      photoUrl,
    });

    return { photoUrl };
  }

  async getPhotoDownload(
    attendanceId: string,
    actor: AuthViewer,
  ): Promise<AttendancePhotoDownload> {
    const record = await this.attendanceRepo.findOne({
      where: { id: attendanceId },
    });

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    await this.assertAttendanceRecordAccess(record, actor);

    const file = await this.fileRepo.findOne({
      where: {
        ownerType: 'attendance',
        ownerId: attendanceId,
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!file) {
      throw new NotFoundException('Attendance photo not found');
    }

    const storedFile = await this.filesStorageService.getStoredFile(file);

    return {
      file,
      stream: storedFile.stream,
      contentLength: storedFile.contentLength,
    };
  }

  private async ensureInstallerAssigned(
    jobId: string,
    userId: string,
  ): Promise<Job> {
    const job = await this.jobsRepo.findOne({
      where: { id: jobId },
      select: ['id', 'orderNumber', 'customerId', 'assignedStaffUserId'],
    });

    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.assignedStaffUserId === userId) {
      return job;
    }

    const assignment = await this.assignmentsRepo.findOne({
      where: {
        jobId,
        staffUserId: userId,
      },
      select: ['id'],
    });

    if (!assignment) {
      throw new ForbiddenException('You are not assigned to this job');
    }

    return job;
  }

  private toSessionSummary(
    record: AttendanceRecordResponse,
    userId: string,
  ): AttendanceSessionSummary {
    const clockIn = new Date(record.clockInAt);
    const clockOut = record.clockOutAt ? new Date(record.clockOutAt) : null;
    return {
      id: record.id,
      userId,
      jobId: record.jobId,
      assignmentId: null,
      clockInAt: record.clockInAt,
      clockOutAt: record.clockOutAt,
      durationMinutes: this.calculateDurationMinutes(clockIn, clockOut),
      geofenceFlaggedIn: record.locationStatus === 'off_site',
      geofenceFlaggedOut: record.locationStatus === 'off_site',
      distanceFromSiteMetersIn: null,
      distanceFromSiteMetersOut: null,
      offSiteAcknowledgedReasonIn: null,
      offSiteAcknowledgedReasonOut: null,
      correctionNote: record.correctionNote,
      correctedAt: record.correctedAt,
      correctedByUserId: record.correctedBy,
    };
  }

  private toRecordResponse(record: AttendanceRecord): AttendanceRecordResponse {
    return {
      id: record.id,
      jobId: record.jobId,
      staffId: record.staffId,
      clockInAt: record.clockInAt.toISOString(),
      clockInLat: this.toNumberOrNull(record.clockInLat),
      clockInLng: this.toNumberOrNull(record.clockInLng),
      clockInAccuracyM: record.clockInAccuracyM,
      clockOutAt: record.clockOutAt?.toISOString() ?? null,
      clockOutLat: this.toNumberOrNull(record.clockOutLat),
      clockOutLng: this.toNumberOrNull(record.clockOutLng),
      clockOutAccuracyM: record.clockOutAccuracyM,
      locationStatus: record.locationStatus,
      photoUrl: record.photoUrl,
      correctedBy: record.correctedBy,
      correctionNote: record.correctionNote,
      correctedAt: record.correctedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private calculateDurationMinutes(
    clockInAt: Date,
    clockOutAt: Date | null,
  ): number | null {
    if (!clockOutAt) {
      return null;
    }

    return Math.round(
      (clockOutAt.getTime() - clockInAt.getTime()) / (1000 * 60),
    );
  }

  private toCoordinateValue(value?: number | null): string | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return value.toFixed(7);
  }

  private toNumberOrNull(value: string | null): number | null {
    if (value === null) {
      return null;
    }

    return Number(value);
  }

  private async buildJobLabel(jobId: string, job?: Job): Promise<string> {
    const targetJob =
      job ??
      (await this.jobsRepo.findOne({
        where: { id: jobId },
        select: ['id', 'orderNumber'],
      }));

    if (!targetJob?.orderNumber) {
      return `job ${jobId.slice(0, 8).toUpperCase()}`;
    }

    return `job ${targetJob.orderNumber}`;
  }

  private async sendAttendanceEventNotifications(
    record: AttendanceRecord,
    event: 'clock_in' | 'clock_out',
  ): Promise<void> {
    try {
      const job = await this.jobsRepo.findOne({
        where: { id: record.jobId },
        select: ['id', 'orderNumber', 'managerId'],
      });
      const staffUser = await this.usersRepo.findOne({
        where: { id: record.staffId },
        select: ['id', 'firstName', 'lastName'],
      });

      if (!job || !staffUser) {
        return;
      }

      const adminUsers = await this.usersRepo.find({
        where: {
          role: UserRole.ADMIN,
          active: true,
          deletedAt: IsNull(),
        },
        select: ['id'],
      });

      const staffName =
        `${staffUser.firstName} ${staffUser.lastName}`.trim() || 'Staff member';
      const jobLabel = `Job ${job.orderNumber}`;
      const eventTime = this.formatNotificationTime(
        event === 'clock_in' ? record.clockInAt : record.clockOutAt,
      );
      const durationLabel =
        event === 'clock_out'
          ? this.formatDurationForNotification(
              this.calculateDurationMinutes(
                record.clockInAt,
                record.clockOutAt,
              ),
            )
          : null;
      const body =
        event === 'clock_in'
          ? `${staffName} clocked in to ${jobLabel} at ${eventTime}.`
          : `${staffName} clocked out of ${jobLabel} at ${eventTime}${durationLabel ? ` - ${durationLabel} on site` : ''}.`;

      await this.notificationsService.sendToUsers(
        [
          ...adminUsers.map((user) => user.id),
          ...(job.managerId ? [job.managerId] : []),
        ],
        {
          type:
            event === 'clock_in'
              ? NOTIFICATION_TYPE.ATTENDANCE_CLOCKED_IN
              : NOTIFICATION_TYPE.ATTENDANCE_CLOCKED_OUT,
          title:
            event === 'clock_in' ? 'Staff clocked in' : 'Staff clocked out',
          body,
          metadata: {
            jobId: job.id,
            attendanceId: record.id,
            staffUserId: record.staffId,
            orderNumber: job.orderNumber,
            section: 'attendance',
          },
          dedupeKey: `attendance:${event}:${record.id}`,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fan out attendance notifications for record ${record.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async assertAttendanceRecordAccess(
    record: AttendanceRecord,
    actor: AuthViewer,
  ): Promise<void> {
    if (actor.role === UserRole.INSTALLER) {
      if (record.staffId !== actor.userId) {
        throw new ForbiddenException('Attendance photo not found');
      }

      await this.ensureInstallerAssigned(record.jobId, actor.userId);
      return;
    }

    await this.jobsService.getOne(record.jobId, {
      userId: actor.userId,
      role: actor.role,
    });
  }

  private buildAttendancePhotoPath(attendanceId: string): string {
    return `/api/attendance/${attendanceId}/photo`;
  }

  private formatNotificationTime(value: Date | null): string {
    if (!value) {
      return 'Unknown time';
    }

    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC',
      timeZoneName: 'short',
    }).format(value);
  }

  private formatDurationForNotification(minutes: number | null): string | null {
    if (minutes === null || minutes < 0) {
      return null;
    }

    const hours = Math.floor(minutes / 60);
    const remainderMinutes = minutes % 60;

    if (hours > 0 && remainderMinutes > 0) {
      return `${hours}h ${remainderMinutes}m`;
    }

    if (hours > 0) {
      return `${hours}h`;
    }

    return `${remainderMinutes}m`;
  }
}
