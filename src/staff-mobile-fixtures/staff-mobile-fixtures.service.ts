import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';
import { FindJobsQueryDto } from '../jobs/dto/find-jobs-query.dto';
import { CreateJobTextEntryDto } from '../jobs/dto/create-job-text-entry.dto';
import { ClockInDto } from '../attendance/dto/clock-in.dto';
import { ClockOutDto } from '../attendance/dto/clock-out.dto';
import { PutAvailabilityDto } from '../availability/dto/put-availability.dto';
import { ListMyAvailabilityQueryDto } from '../availability/dto/list-availability-query.dto';
import { ListMyAttendanceSessionsQueryDto } from '../attendance/dto/list-attendance-sessions-query.dto';
import { GetScheduleQueryDto } from '../schedule/dto/get-schedule-query.dto';

/** Stable UUIDs aligned with `apps/staff_mobile` mock store. */
export const FIXTURE_JOB_ID_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const FIXTURE_JOB_ID_2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const FIXTURE_ASSIGNMENT_ID_1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
export const FIXTURE_ASSIGNMENT_ID_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
export const FIXTURE_USER_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

type NoteRow = {
  id: string;
  body: string;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
};

type SessionRow = {
  id: string;
  userId: string;
  jobId: string | null;
  assignmentId: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  geofenceFlaggedIn: boolean;
  geofenceFlaggedOut: boolean;
  offSiteAcknowledgedReasonIn: string | null;
  offSiteAcknowledgedReasonOut: string | null;
};

type AvailabilityRow = {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  notes: string | null;
  recurrenceRule: string | null;
  source: string;
};

@Injectable()
export class StaffMobileFixturesService implements OnModuleInit {
  private readonly notesByJob = new Map<string, NoteRow[]>();
  private readonly internalByJob = new Map<string, NoteRow[]>();
  private openSession: SessionRow | null = null;
  private closedSessions: SessionRow[] = [];
  private availability: AvailabilityRow[] = [];

  onModuleInit(): void {
    this.reset();
  }

  /** Reset mutable state (useful after hot-reload tests). */
  reset(): void {
    const now = new Date();
    this.notesByJob.clear();
    this.internalByJob.clear();
    this.openSession = null;
    this.closedSessions = [];
    this.availability = [];

    this.notesByJob.set(FIXTURE_JOB_ID_1, [
      {
        id: '10000000-0000-4000-8000-000000000001',
        body: 'Fixture: site access confirmed.',
        createdAt: new Date(now.getTime() - 5 * 3600_000).toISOString(),
        createdBy: { firstName: 'Alex', lastName: 'Installer' },
      },
    ]);
    this.notesByJob.set(FIXTURE_JOB_ID_2, []);

    this.internalByJob.set(FIXTURE_JOB_ID_1, [
      {
        id: '20000000-0000-4000-8000-000000000001',
        body: 'Fixture internal: paperwork received.',
        createdAt: new Date(now.getTime() - 86400_000).toISOString(),
        createdBy: { firstName: 'Office', lastName: 'Admin' },
      },
    ]);
    this.internalByJob.set(FIXTURE_JOB_ID_2, []);

    const avStart = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        8,
        0,
        0,
        0,
      ),
    );
    const avEnd = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        16,
        0,
        0,
        0,
      ),
    );
    this.availability.push({
      id: '30000000-0000-4000-8000-000000000001',
      userId: FIXTURE_USER_ID,
      startsAt: avStart,
      endsAt: avEnd,
      notes: 'Fixture availability (today UTC window)',
      recurrenceRule: null,
      source: 'mobile',
    });

    const y = new Date(now);
    y.setUTCDate(y.getUTCDate() - 1);
    const cin = new Date(
      Date.UTC(
        y.getUTCFullYear(),
        y.getUTCMonth(),
        y.getUTCDate(),
        8,
        0,
        0,
        0,
      ),
    );
    const cout = new Date(
      Date.UTC(
        y.getUTCFullYear(),
        y.getUTCMonth(),
        y.getUTCDate(),
        16,
        30,
        0,
        0,
      ),
    );
    this.closedSessions.push({
      id: 'fixture-closed-yesterday',
      userId: FIXTURE_USER_ID,
      jobId: FIXTURE_JOB_ID_1,
      assignmentId: FIXTURE_ASSIGNMENT_ID_1,
      clockInAt: cin,
      clockOutAt: cout,
      geofenceFlaggedIn: false,
      geofenceFlaggedOut: false,
      offSiteAcknowledgedReasonIn: null,
      offSiteAcknowledgedReasonOut: null,
    });
  }

  login(): { accessToken: string; role: UserRole } {
    return {
      accessToken: 'fixture.staff-mobile.jwt',
      role: UserRole.INSTALLER,
    };
  }

  me() {
    return {
      id: FIXTURE_USER_ID,
      role: UserRole.INSTALLER,
      firstName: 'Demo',
      lastName: 'Installer',
      emailAddress: 'demo.installer@example.com',
      phoneNumber: '+61 400 000 000',
      teamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    };
  }

  schedule(query: GetScheduleQueryDto) {
    const from = query.from.slice(0, 10);
    const to = query.to.slice(0, 10);
    return {
      from,
      to,
      teamId: null,
      items: [
        {
          assignmentId: FIXTURE_ASSIGNMENT_ID_1,
          jobId: FIXTURE_JOB_ID_1,
          customerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          systemSizeKw: 6.5,
          teamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          teamName: 'Mock Crew Alpha',
          teamDailyCapacityKw: 50,
          staffUserId: FIXTURE_USER_ID,
          scheduledDate: from,
          slot: 'AM',
          locked: false,
        },
        {
          assignmentId: FIXTURE_ASSIGNMENT_ID_2,
          jobId: FIXTURE_JOB_ID_2,
          customerId: 'dddddddd-dddd-4ddd-8ddd-ddddddddddde',
          systemSizeKw: 8.2,
          teamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          teamName: 'Mock Crew Alpha',
          teamDailyCapacityKw: 50,
          staffUserId: FIXTURE_USER_ID,
          scheduledDate: from,
          slot: 'PM',
          locked: false,
        },
      ],
      dailyKwByTeam: [
        {
          scheduledDate: from,
          teamId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          teamName: 'Mock Crew Alpha',
          bookedKw: 14.7,
          capacityKw: 50,
        },
      ],
    };
  }

  jobs(query: FindJobsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const today = this.todayIso();
    if (page > 1) {
      return { items: [], total: 2, page, pageSize };
    }
    return {
      items: [
        {
          id: FIXTURE_JOB_ID_1,
          orderNumber: 'MOCK-1001',
          jobStatus: 'scheduled',
          pipelineStage: 'scheduled',
          scheduledDate: today,
          scheduledSlot: 'am',
          systemSizeKw: '6.50',
          customer: { firstName: 'River', lastName: 'Family' },
        },
        {
          id: FIXTURE_JOB_ID_2,
          orderNumber: 'MOCK-1002',
          jobStatus: 'scheduled',
          pipelineStage: 'install',
          scheduledDate: today,
          scheduledSlot: 'pm',
          systemSizeKw: '8.20',
          customer: { firstName: 'Hill', lastName: 'Homes' },
        },
      ],
      total: 2,
      page: 1,
      pageSize,
    };
  }

  jobDetail(jobId: string) {
    if (jobId !== FIXTURE_JOB_ID_1 && jobId !== FIXTURE_JOB_ID_2) {
      throw new NotFoundException('Job not found');
    }
    const order = jobId === FIXTURE_JOB_ID_1 ? 'MOCK-1001' : 'MOCK-1002';
    const stage = jobId === FIXTURE_JOB_ID_1 ? 'scheduled' : 'install';
    const custFirst = jobId === FIXTURE_JOB_ID_1 ? 'River' : 'Hill';
    const custLast = jobId === FIXTURE_JOB_ID_1 ? 'Family' : 'Homes';
    const today = this.todayIso();
    return {
      job: {
        id: jobId,
        orderNumber: order,
        customerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        jobStatus: 'scheduled',
        pipelineStage: stage,
        systemSizeKw: jobId === FIXTURE_JOB_ID_1 ? '6.50' : '8.20',
        scheduledDate: today,
        scheduledSlot: jobId === FIXTURE_JOB_ID_1 ? 'am' : 'pm',
        installDate: today,
      },
      customer: {
        firstName: custFirst,
        lastName: custLast,
      },
      notes: [...(this.notesByJob.get(jobId) ?? [])],
      internalComments: [...(this.internalByJob.get(jobId) ?? [])],
      timeline: [
        {
          id: '40000000-0000-4000-8000-000000000001',
          source: 'timeline_event',
          action: 'job_created',
          description: 'Job created (fixture)',
          createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
          performedBy: { firstName: 'CRM', lastName: 'User' },
        },
      ],
    };
  }

  addNote(jobId: string, dto: CreateJobTextEntryDto) {
    if (jobId !== FIXTURE_JOB_ID_1 && jobId !== FIXTURE_JOB_ID_2) {
      throw new NotFoundException('Job not found');
    }
    const row: NoteRow = {
      id: `n-${Date.now()}`,
      body: dto.body,
      createdAt: new Date().toISOString(),
      createdBy: { firstName: 'You', lastName: '(fixture)' },
    };
    const list = this.notesByJob.get(jobId) ?? [];
    list.push(row);
    this.notesByJob.set(jobId, list);
    return row;
  }

  addInternal(jobId: string, dto: CreateJobTextEntryDto) {
    if (jobId !== FIXTURE_JOB_ID_1 && jobId !== FIXTURE_JOB_ID_2) {
      throw new NotFoundException('Job not found');
    }
    const row: NoteRow = {
      id: `i-${Date.now()}`,
      body: dto.body,
      createdAt: new Date().toISOString(),
      createdBy: { firstName: 'You', lastName: '(fixture)' },
    };
    const list = this.internalByJob.get(jobId) ?? [];
    list.push(row);
    this.internalByJob.set(jobId, list);
    return row;
  }

  getOpenSession() {
    const s = this.openSession;
    return {
      session: s ? this.toSessionSummary(s) : null,
    };
  }

  clockIn(dto: ClockInDto) {
    if (this.openSession) {
      throw new ConflictException({
        message: 'An attendance session is already open.',
        code: 'CONFLICT',
      });
    }
    const now = new Date();
    this.openSession = {
      id: `mock-att-${now.getTime()}`,
      userId: FIXTURE_USER_ID,
      jobId: dto.jobId ?? null,
      assignmentId: dto.assignmentId ?? null,
      clockInAt: now,
      clockOutAt: null,
      geofenceFlaggedIn: false,
      geofenceFlaggedOut: false,
      offSiteAcknowledgedReasonIn:
        dto.offSiteAcknowledgedReason?.trim() ?? null,
      offSiteAcknowledgedReasonOut: null,
    };
    return { session: this.toSessionSummary(this.openSession) };
  }

  clockOut(dto: ClockOutDto) {
    const open = this.openSession;
    if (!open) {
      throw new BadRequestException('No open attendance session.');
    }
    const out = new Date();
    open.clockOutAt = out;
    open.geofenceFlaggedOut = false;
    open.offSiteAcknowledgedReasonOut =
      dto.offSiteAcknowledgedReason?.trim() ?? null;
    const summary = this.toSessionSummary(open);
    this.closedSessions.unshift({ ...open });
    this.openSession = null;
    return { session: summary };
  }

  listMySessions(query: ListMyAttendanceSessionsQueryDto) {
    const start = new Date(`${query.from}T00:00:00.000Z`);
    const end = new Date(`${query.to}T23:59:59.999Z`);
    const items: SessionRow[] = [];
    for (const s of this.closedSessions) {
      if (s.clockInAt >= start && s.clockInAt <= end) {
        items.push(s);
      }
    }
    if (
      this.openSession &&
      this.openSession.clockInAt >= start &&
      this.openSession.clockInAt <= end
    ) {
      items.push(this.openSession);
    }
    items.sort((a, b) => b.clockInAt.getTime() - a.clockInAt.getTime());
    return { items: items.map((s) => this.toSessionSummary(s)) };
  }

  listMyAvailability(query: ListMyAvailabilityQueryDto) {
    let rows = [...this.availability];
    if (query.from && query.to) {
      const rangeStart = new Date(`${query.from}T00:00:00.000Z`);
      const rangeEnd = new Date(`${query.to}T23:59:59.999Z`);
      rows = rows.filter(
        (a) => a.startsAt <= rangeEnd && a.endsAt >= rangeStart,
      );
    }
    rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { items: rows.map((r) => this.toAvailabilityItem(r)) };
  }

  putMyAvailability(dto: PutAvailabilityDto) {
    const effective = new Date(`${dto.effectiveFrom}T00:00:00.000Z`);
    const parsed = dto.items.map((item) => ({
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
      notes: item.notes?.trim() ?? null,
      recurrenceRule: item.recurrenceRule?.trim() ?? null,
    }));
    for (const p of parsed) {
      if (
        Number.isNaN(p.startsAt.getTime()) ||
        Number.isNaN(p.endsAt.getTime())
      ) {
        throw new BadRequestException('Invalid startsAt or endsAt');
      }
      if (p.endsAt <= p.startsAt) {
        throw new BadRequestException('endsAt must be after startsAt');
      }
      if (p.startsAt < effective) {
        throw new BadRequestException(
          'Each window must start on or after effectiveFrom',
        );
      }
    }
    const sorted = [...parsed].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startsAt < sorted[i - 1].endsAt) {
        throw new ConflictException({
          message: 'Availability windows must not overlap.',
          code: 'CONFLICT',
        });
      }
    }
    this.availability = this.availability.filter((a) => a.endsAt <= effective);
    const saved: AvailabilityRow[] = [];
    for (const p of parsed) {
      const row: AvailabilityRow = {
        id: `mock-av-${p.startsAt.getTime()}`,
        userId: FIXTURE_USER_ID,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        notes: p.notes,
        recurrenceRule: p.recurrenceRule,
        source: 'mobile',
      };
      saved.push(row);
      this.availability.push(row);
    }
    this.availability.sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
    );
    return { items: saved.map((r) => this.toAvailabilityItem(r)) };
  }

  meta() {
    return {
      description:
        'In-memory responses for Fordan Staff Mobile. No database; no JWT validation.',
      basePath: '/api/dev/staff-mobile-fixtures/v1',
      flutterApiBaseUrlExample:
        'http://localhost:3000/api/dev/staff-mobile-fixtures/v1',
      jobIds: [FIXTURE_JOB_ID_1, FIXTURE_JOB_ID_2],
      resetHint:
        'POST .../dev/staff-mobile-fixtures/v1/_reset (same module flag)',
    };
  }

  private todayIso(): string {
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, '0');
    const d = String(n.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private toSessionSummary(s: SessionRow) {
    let durationMinutes: number | null = null;
    if (s.clockOutAt) {
      durationMinutes = Math.round(
        (s.clockOutAt.getTime() - s.clockInAt.getTime()) / 60000,
      );
    }
    return {
      id: s.id,
      userId: s.userId,
      jobId: s.jobId,
      assignmentId: s.assignmentId,
      clockInAt: s.clockInAt.toISOString(),
      clockOutAt: s.clockOutAt?.toISOString() ?? null,
      durationMinutes,
      geofenceFlaggedIn: s.geofenceFlaggedIn,
      geofenceFlaggedOut: s.geofenceFlaggedOut,
      distanceFromSiteMetersIn: null,
      distanceFromSiteMetersOut: null,
      offSiteAcknowledgedReasonIn: s.offSiteAcknowledgedReasonIn,
      offSiteAcknowledgedReasonOut: s.offSiteAcknowledgedReasonOut,
      correctionNote: null,
      correctedAt: null,
      correctedByUserId: null,
    };
  }

  private toAvailabilityItem(r: AvailabilityRow) {
    return {
      id: r.id,
      userId: r.userId,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      notes: r.notes,
      recurrenceRule: r.recurrenceRule,
      source: r.source,
    };
  }
}
