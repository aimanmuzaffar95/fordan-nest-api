import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PreconditionFailedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Between, In, IsNull, Repository } from 'typeorm';
import { Assignment } from '../assignments/entities/assignment.entity';
import { Job } from '../jobs/entities/job.entity';
import { JobsService, JobListViewer } from '../jobs/jobs.service';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { parseAttendanceGeofenceMode } from './attendance-geofence-mode';
import { AttendanceSession } from './entities/attendance-session.entity';
import { ClockInDto } from './dto/clock-in.dto';
import { ClockOutDto } from './dto/clock-out.dto';
import {
  ListAttendanceSessionsQueryDto,
  ListMyAttendanceSessionsQueryDto,
} from './dto/list-attendance-sessions-query.dto';
import { PatchAttendanceSessionDto } from './dto/patch-attendance-session.dto';
import { haversineDistanceMeters } from './haversine';

type GpsSample = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt?: Date;
};

function jobSiteCoords(job: Job | null): { lat: number; lon: number } | null {
  if (!job?.jobSiteLatitude || !job?.jobSiteLongitude) {
    return null;
  }
  const lat = Number(job.jobSiteLatitude);
  const lon = Number(job.jobSiteLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }
  return { lat, lon };
}

function toDecimalString(n: number, fractionDigits: number): string {
  return n.toFixed(fractionDigits);
}

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceSession)
    private readonly sessionsRepo: Repository<AttendanceSession>,
    @InjectRepository(Assignment)
    private readonly assignmentsRepo: Repository<Assignment>,
    @InjectRepository(Job)
    private readonly jobsRepo: Repository<Job>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jobsService: JobsService,
    private readonly runtimeSettings: RuntimeSettingsService,
  ) {}

  private async getGeofenceConfig() {
    const s = await this.runtimeSettings.getSettings();
    return {
      mode: parseAttendanceGeofenceMode(s.attendanceGeofenceMode),
      radiusMeters: s.attendanceGeofenceRadiusMeters,
      maxAccuracyMeters: s.attendanceMaxGpsAccuracyMeters,
    };
  }

  private async resolveJobContext(
    jobId: string | undefined,
    assignmentId: string | undefined,
    viewer: JobListViewer,
  ): Promise<{ job: Job | null; assignment: Assignment | null }> {
    if (assignmentId) {
      const assignment = await this.assignmentsRepo.findOne({
        where: { id: assignmentId },
        relations: { job: true },
      });
      if (!assignment) {
        throw new NotFoundException('Assignment not found');
      }
      if (
        viewer.role === UserRole.INSTALLER &&
        assignment.staffUserId !== viewer.userId
      ) {
        throw new ForbiddenException(
          'Cannot clock in for another installer assignment.',
        );
      }
      if (jobId && jobId !== assignment.jobId) {
        throw new BadRequestException('jobId does not match assignment');
      }
      const job = await this.jobsService.loadJobWithViewerAccess(
        assignment.jobId,
        viewer,
      );
      return { job, assignment };
    }
    if (jobId) {
      const job = await this.jobsService.loadJobWithViewerAccess(jobId, viewer);
      return { job, assignment: null };
    }
    return { job: null, assignment: null };
  }

  private toGps(dtoLoc?: {
    latitude: number;
    longitude: number;
    accuracyMeters?: number;
    capturedAt?: string;
  }): GpsSample | undefined {
    if (!dtoLoc) {
      return undefined;
    }
    return {
      latitude: dtoLoc.latitude,
      longitude: dtoLoc.longitude,
      accuracyMeters: dtoLoc.accuracyMeters,
      capturedAt: dtoLoc.capturedAt ? new Date(dtoLoc.capturedAt) : undefined,
    };
  }

  async clockIn(userId: string, role: UserRole, dto: ClockInDto) {
    const open = await this.sessionsRepo.findOne({
      where: { userId, clockOutAt: IsNull() },
    });
    if (open) {
      throw new ConflictException({
        message: 'An attendance session is already open.',
        code: 'CONFLICT',
      });
    }

    const viewer: JobListViewer = { userId, role };
    const { job, assignment } = await this.resolveJobContext(
      dto.jobId,
      dto.assignmentId,
      viewer,
    );

    const { mode, radiusMeters, maxAccuracyMeters } =
      await this.getGeofenceConfig();
    const loc = this.toGps(dto.location);
    const site = job ? jobSiteCoords(job) : null;
    const reasonIn = dto.offSiteAcknowledgedReason?.trim() || null;

    if (mode === 'soft' || mode === 'hard') {
      if (!loc) {
        throw new BadRequestException(
          'GPS location is required for this geofence mode.',
        );
      }
      if (!site) {
        throw new BadRequestException(
          'Geofence enforcement requires a job with site coordinates.',
        );
      }
    }

    if (
      mode === 'hard' &&
      loc &&
      loc.accuracyMeters != null &&
      loc.accuracyMeters > maxAccuracyMeters
    ) {
      throw new PreconditionFailedException({
        message: 'GPS accuracy is too low for clock-in.',
        code: 'PRECONDITION_FAILED',
      });
    }

    let distanceFromSiteMetersIn: string | null = null;
    let geofenceFlaggedIn = false;

    if (mode !== 'off' && loc && site) {
      const d = haversineDistanceMeters(
        loc.latitude,
        loc.longitude,
        site.lat,
        site.lon,
      );
      distanceFromSiteMetersIn = toDecimalString(d, 2);
      const outside = d > radiusMeters;
      if (mode === 'audit_only') {
        geofenceFlaggedIn = outside;
      } else if (mode === 'soft') {
        geofenceFlaggedIn = outside;
        if (outside && !reasonIn) {
          throw new PreconditionFailedException({
            message:
              'Clock-in is outside the job geofence. Provide offSiteAcknowledgedReason or move on-site.',
            code: 'PRECONDITION_FAILED',
          });
        }
      } else if (mode === 'hard') {
        geofenceFlaggedIn = outside;
        if (outside) {
          throw new PreconditionFailedException({
            message: 'Clock-in is outside the job geofence.',
            code: 'PRECONDITION_FAILED',
          });
        }
      }
    }

    const session = this.sessionsRepo.create({
      userId,
      jobId: job?.id ?? null,
      assignmentId: assignment?.id ?? null,
      clockInAt: new Date(),
      clockInLatitude: loc ? toDecimalString(loc.latitude, 7) : null,
      clockInLongitude: loc ? toDecimalString(loc.longitude, 7) : null,
      clockInAccuracyMeters:
        loc?.accuracyMeters != null
          ? toDecimalString(loc.accuracyMeters, 2)
          : null,
      clockInCapturedAt: loc?.capturedAt ?? null,
      distanceFromSiteMetersIn,
      geofenceFlaggedIn,
      offSiteAcknowledgedReasonIn: reasonIn,
    });

    const saved = await this.sessionsRepo.save(session);
    return { session: this.toSummary(saved) };
  }

  async clockOut(userId: string, dto: ClockOutDto) {
    const open = await this.sessionsRepo.findOne({
      where: { userId, clockOutAt: IsNull() },
      relations: { job: true },
    });
    if (!open) {
      throw new BadRequestException('No open attendance session.');
    }

    const { mode, radiusMeters } = await this.getGeofenceConfig();
    const loc = this.toGps(dto.location);
    const job = open.job ?? null;
    const site = jobSiteCoords(job);
    const reasonOut = dto.offSiteAcknowledgedReason?.trim() || null;

    let distanceFromSiteMetersOut: string | null = null;
    let geofenceFlaggedOut = false;

    if (mode !== 'off' && loc && site) {
      const d = haversineDistanceMeters(
        loc.latitude,
        loc.longitude,
        site.lat,
        site.lon,
      );
      distanceFromSiteMetersOut = toDecimalString(d, 2);
      geofenceFlaggedOut = d > radiusMeters;
    }

    open.clockOutAt = new Date();
    open.clockOutLatitude = loc ? toDecimalString(loc.latitude, 7) : null;
    open.clockOutLongitude = loc ? toDecimalString(loc.longitude, 7) : null;
    open.clockOutAccuracyMeters =
      loc?.accuracyMeters != null
        ? toDecimalString(loc.accuracyMeters, 2)
        : null;
    open.clockOutCapturedAt = loc?.capturedAt ?? null;
    open.distanceFromSiteMetersOut = distanceFromSiteMetersOut;
    open.geofenceFlaggedOut = geofenceFlaggedOut;
    open.offSiteAcknowledgedReasonOut = reasonOut;

    const saved = await this.sessionsRepo.save(open);
    return { session: this.toSummary(saved) };
  }

  async getMyOpenSession(userId: string) {
    const session = await this.sessionsRepo.findOne({
      where: { userId, clockOutAt: IsNull() },
    });
    return { session: session ? this.toSummary(session) : null };
  }

  async listMySessions(
    userId: string,
    query: ListMyAttendanceSessionsQueryDto,
  ) {
    const start = new Date(`${query.from}T00:00:00.000Z`);
    const end = new Date(`${query.to}T23:59:59.999Z`);
    const items = await this.sessionsRepo.find({
      where: { userId, clockInAt: Between(start, end) },
      order: { clockInAt: 'DESC' },
      take: 500,
    });
    return { items: items.map((s) => this.toSummary(s)) };
  }

  async listSessions(
    userId: string,
    role: UserRole,
    query: ListAttendanceSessionsQueryDto,
  ) {
    const qb = this.sessionsRepo
      .createQueryBuilder('session')
      .orderBy('session.clockInAt', 'DESC')
      .take(500);

    if (query.userId) {
      qb.andWhere('session.userId = :filterUserId', {
        filterUserId: query.userId,
      });
    }

    if (query.from && query.to) {
      const start = new Date(`${query.from}T00:00:00.000Z`);
      const end = new Date(`${query.to}T23:59:59.999Z`);
      qb.andWhere('session.clockInAt BETWEEN :start AND :end', {
        start,
        end,
      });
    }

    if (role === UserRole.MANAGER) {
      const staffIds = await this.resolveManagerStaffUserIds(userId);
      qb.andWhere(
        new Brackets((w) => {
          w.where(
            `session.jobId IN (SELECT j.id FROM jobs j WHERE j.managerId = :mid)`,
            { mid: userId },
          );
          if (staffIds.length > 0) {
            w.orWhere('session.userId IN (:...staffIds)', { staffIds });
          }
        }),
      );
    }

    const rows = await qb.getMany();
    return { items: rows.map((s) => this.toSummary(s)) };
  }

  async patchSession(
    sessionId: string,
    actorUserId: string,
    role: UserRole,
    dto: PatchAttendanceSessionDto,
  ) {
    const session = await this.sessionsRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Attendance session not found');
    }

    if (role === UserRole.INSTALLER) {
      throw new ForbiddenException();
    }

    const visible = await this.sessionVisibleToManagerOrAdmin(
      session,
      actorUserId,
      role,
    );
    if (!visible) {
      throw new NotFoundException('Attendance session not found');
    }

    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one field is required');
    }

    if (dto.clockInAt) {
      session.clockInAt = new Date(dto.clockInAt);
    }
    if (dto.clockOutAt !== undefined) {
      session.clockOutAt = dto.clockOutAt ? new Date(dto.clockOutAt) : null;
    }
    if (dto.correctionNote !== undefined) {
      session.correctionNote = dto.correctionNote?.trim() || null;
    }
    session.correctedAt = new Date();
    session.correctedByUserId = actorUserId;

    if (session.clockOutAt && session.clockOutAt < session.clockInAt) {
      throw new BadRequestException('clockOutAt must be after clockInAt');
    }

    const saved = await this.sessionsRepo.save(session);
    return { session: this.toSummary(saved) };
  }

  private async sessionVisibleToManagerOrAdmin(
    session: AttendanceSession,
    actorUserId: string,
    role: UserRole,
  ): Promise<boolean> {
    if (role === UserRole.ADMIN) {
      return true;
    }
    const jobScoped = session.jobId
      ? await this.jobsRepo.exist({
          where: { id: session.jobId, managerId: actorUserId },
        })
      : false;
    if (jobScoped) {
      return true;
    }
    const staffIds = await this.resolveManagerStaffUserIds(actorUserId);
    return staffIds.includes(session.userId);
  }

  private async resolveManagerStaffUserIds(
    managerUserId: string,
  ): Promise<string[]> {
    const jobs = await this.jobsRepo.find({
      where: { managerId: managerUserId },
      select: ['assignedStaffUserId', 'assignedTeamId'],
    });
    const ids = new Set<string>();
    const teamIds = new Set<string>();
    for (const j of jobs) {
      if (j.assignedStaffUserId) {
        ids.add(j.assignedStaffUserId);
      }
      if (j.assignedTeamId) {
        teamIds.add(j.assignedTeamId);
      }
    }
    if (teamIds.size === 0) {
      return [...ids];
    }
    const teamUsers = await this.usersRepo.find({
      where: { teamId: In([...teamIds]) },
      select: ['id'],
    });
    for (const u of teamUsers) {
      ids.add(u.id);
    }
    return [...ids];
  }

  private toSummary(session: AttendanceSession) {
    let durationMinutes: number | null = null;
    if (session.clockOutAt) {
      durationMinutes = Math.round(
        (session.clockOutAt.getTime() - session.clockInAt.getTime()) / 60000,
      );
    }
    return {
      id: session.id,
      userId: session.userId,
      jobId: session.jobId,
      assignmentId: session.assignmentId,
      clockInAt: session.clockInAt.toISOString(),
      clockOutAt: session.clockOutAt?.toISOString() ?? null,
      durationMinutes,
      geofenceFlaggedIn: session.geofenceFlaggedIn,
      geofenceFlaggedOut: session.geofenceFlaggedOut,
      distanceFromSiteMetersIn:
        session.distanceFromSiteMetersIn != null
          ? Number(session.distanceFromSiteMetersIn)
          : null,
      distanceFromSiteMetersOut:
        session.distanceFromSiteMetersOut != null
          ? Number(session.distanceFromSiteMetersOut)
          : null,
      offSiteAcknowledgedReasonIn: session.offSiteAcknowledgedReasonIn,
      offSiteAcknowledgedReasonOut: session.offSiteAcknowledgedReasonOut,
      correctionNote: session.correctionNote,
      correctedAt: session.correctedAt?.toISOString() ?? null,
      correctedByUserId: session.correctedByUserId,
    };
  }
}
