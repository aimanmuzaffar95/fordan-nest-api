import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { Alert } from './entities/alert.entity';
import { Job } from '../jobs/entities/job.entity';
import { MeterApplication } from '../metering/entities/meter-application.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { InvoiceStatus } from '../invoices/entities/invoice-status.enum';
import {
  AdminSettings,
  ADMIN_SETTINGS_SINGLETON_ID,
} from '../runtime-settings/admin-settings.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';

// ─── Typed mock call helpers ──────────────────────────────────────────────────

type AlertCreateArg = {
  type: string;
  severity: string;
  jobId: string;
  message: string;
  resolvedAt: null;
  resolvedByUserId: null;
};

type AlertSaveArg = {
  type: string;
  severity: string;
  jobId: string;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

function getCreateCalls(repo: ReturnType<typeof mockRepo>): AlertCreateArg[] {
  return (repo.create.mock.calls as [AlertCreateArg][]).map(([d]) => d);
}

function getSaveCalls(repo: ReturnType<typeof mockRepo>): AlertSaveArg[] {
  return (repo.save.mock.calls as [AlertSaveArg][]).map(([a]) => a);
}

function getFindFirstArg(repo: ReturnType<typeof mockRepo>): unknown {
  return (repo.find.mock.calls as [[unknown]])[0]?.[0];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const addDays = (base: Date, n: number): string => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
};

const TODAY = new Date('2026-04-06');

const makeJob = (overrides: Partial<Job> = {}): Job =>
  ({
    id: 'job-1',
    managerId: 'manager-1',
    installDate: null,
    ...overrides,
  }) as Job;

const makeMeter = (
  overrides: Partial<MeterApplication> = {},
): MeterApplication =>
  ({
    id: 'meter-1',
    jobId: 'job-1',
    type: 'pre_meter',
    status: 'approved',
    ...overrides,
  }) as MeterApplication;

const makeInvoice = (overrides: Partial<Invoice> = {}): Invoice =>
  ({
    id: 'inv-1',
    jobId: 'job-1',
    dueDate: addDays(TODAY, -20),
    status: 'SENT',
    ...overrides,
  }) as Invoice;

const makeAlert = (overrides: Partial<Alert> = {}): Alert =>
  ({
    id: 'alert-1',
    jobId: 'job-1',
    type: 'PRE_METER_PENDING_7_DAYS',
    severity: 'high',
    message: 'test',
    createdAt: new Date(),
    resolvedAt: null,
    resolvedByUserId: null,
    ...overrides,
  }) as Alert;

const defaultSettings: AdminSettings = {
  id: ADMIN_SETTINGS_SINGLETON_ID,
  preMeterPendingDays: 7,
  installWarningDays: 3,
  postMeterDeadlineDays: 2,
  invoiceOverdueDays: 14,
  overridePreMeter: false,
  calendarScopeEnforced: true,
  updatedByUserId: null,
  updatedByUser: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Mock Repository Factory ───────────────────────────────────────────────────

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  count: jest.fn(),
});

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('AlertsService', () => {
  let service: AlertsService;

  let alertRepo: ReturnType<typeof mockRepo>;
  let jobRepo: ReturnType<typeof mockRepo>;
  let meterRepo: ReturnType<typeof mockRepo>;
  let invoiceRepo: ReturnType<typeof mockRepo>;
  let settingsRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    alertRepo = mockRepo();
    jobRepo = mockRepo();
    meterRepo = mockRepo();
    invoiceRepo = mockRepo();
    settingsRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(Alert), useValue: alertRepo },
        { provide: getRepositoryToken(Job), useValue: jobRepo },
        { provide: getRepositoryToken(MeterApplication), useValue: meterRepo },
        { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
        { provide: getRepositoryToken(AdminSettings), useValue: settingsRepo },
        {
          provide: NotificationsService,
          useValue: {
            sendToRole: jest.fn(),
            sendToUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);

    // Default: settings found, no active alerts
    settingsRepo.findOne.mockResolvedValue(defaultSettings);
    alertRepo.find.mockResolvedValue([]);
    alertRepo.save.mockImplementation((e) => Promise.resolve(e));
    alertRepo.create.mockImplementation((data: AlertCreateArg) => ({
      ...data,
    }));
  });

  // ─── evaluateAndSync ─────────────────────────────────────────────────────────

  describe('evaluateAndSync()', () => {
    describe('R1 — PRE_METER_PENDING_7_DAYS', () => {
      it('creates alert when installDate is 5 days away and no approved pre_meter', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 5) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]); // no approved pre_meter
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        const r1Call = creates.find(
          (d) => d.type === 'PRE_METER_PENDING_7_DAYS',
        );
        expect(r1Call).toBeDefined();
        expect(r1Call?.severity).toBe('high');
        expect(r1Call?.jobId).toBe('job-1');
      });

      it('does NOT create alert when installDate is 5 days away but has approved pre_meter', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 5) });
        const meter = makeMeter({
          jobId: 'job-1',
          type: 'pre_meter',
          status: 'approved',
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([meter]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find((d) => d.type === 'PRE_METER_PENDING_7_DAYS'),
        ).toBeUndefined();
      });

      it('does NOT create R1 alert when installDate is outside the preMeterPendingDays window', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 10) }); // 10 days > 7
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find((d) => d.type === 'PRE_METER_PENDING_7_DAYS'),
        ).toBeUndefined();
      });
    });

    describe('R2 — INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED', () => {
      it('creates alert when installDate is 2 days away and no approved pre_meter', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 2) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        const r2Call = creates.find(
          (d) => d.type === 'INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED',
        );
        expect(r2Call).toBeDefined();
        expect(r2Call?.severity).toBe('high');
      });

      it('does NOT create R2 alert when installDate is 2 days away but has approved pre_meter', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 2) });
        const meter = makeMeter({
          jobId: 'job-1',
          type: 'pre_meter',
          status: 'approved',
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([meter]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find(
            (d) => d.type === 'INSTALL_WITHIN_3_DAYS_PRE_METER_NOT_APPROVED',
          ),
        ).toBeUndefined();
      });
    });

    describe('R3 — POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL', () => {
      it('creates alert when installDate was 3 days ago and no post_meter exists', async () => {
        const job = makeJob({ installDate: addDays(TODAY, -3) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]); // no post_meter
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        const r3Call = creates.find(
          (d) => d.type === 'POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL',
        );
        expect(r3Call).toBeDefined();
        expect(r3Call?.severity).toBe('medium');
      });

      it('does NOT create R3 alert when installDate was 1 day ago (within postMeterDeadlineDays=2)', async () => {
        const job = makeJob({ installDate: addDays(TODAY, -1) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find(
            (d) => d.type === 'POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL',
          ),
        ).toBeUndefined();
      });

      it('does NOT create R3 alert when the pipeline reached post_meter_submitted, even with the pending placeholder row from job creation', async () => {
        const job = makeJob({
          installDate: addDays(TODAY, -3),
          pipelineStage: 'post_meter_submitted',
        });
        // Job creation seeds a pending post_meter placeholder for every job;
        // its existence must NOT suppress R3 (that made the rule dead) —
        // pipeline progress is what counts.
        const placeholder = makeMeter({
          jobId: 'job-1',
          type: 'post_meter',
          status: 'pending',
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([placeholder]);
        invoiceRepo.find.mockResolvedValue([]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find(
            (d) => d.type === 'POST_METER_NOT_SUBMITTED_2_DAYS_AFTER_INSTALL',
          ),
        ).toBeUndefined();
      });
    });

    describe('R4 — INVOICE_NOT_PAID_AFTER_X_DAYS', () => {
      it('creates alert when invoice dueDate was 20 days ago, status SENT, invoiceOverdueDays=14', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 5) });
        const invoice = makeInvoice({
          jobId: 'job-1',
          dueDate: addDays(TODAY, -20),
          status: InvoiceStatus.SENT,
        });
        // Approved pre_meter to suppress R1/R2
        const meter = makeMeter({
          jobId: 'job-1',
          type: 'pre_meter',
          status: 'approved',
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([meter]);
        invoiceRepo.find.mockResolvedValue([invoice]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        const r4Call = creates.find(
          (d) => d.type === 'INVOICE_NOT_PAID_AFTER_X_DAYS',
        );
        expect(r4Call).toBeDefined();
        expect(r4Call?.severity).toBe('medium');
      });

      it('does NOT create R4 alert when invoice status is PAID', async () => {
        const job = makeJob({ installDate: null });
        const invoice = makeInvoice({
          jobId: 'job-1',
          dueDate: addDays(TODAY, -20),
          status: InvoiceStatus.PAID,
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([invoice]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find((d) => d.type === 'INVOICE_NOT_PAID_AFTER_X_DAYS'),
        ).toBeUndefined();
      });

      it('does NOT create R4 alert when invoice status is CANCELLED', async () => {
        const job = makeJob({ installDate: null });
        const invoice = makeInvoice({
          jobId: 'job-1',
          dueDate: addDays(TODAY, -20),
          status: InvoiceStatus.CANCELLED,
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([invoice]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find((d) => d.type === 'INVOICE_NOT_PAID_AFTER_X_DAYS'),
        ).toBeUndefined();
      });

      it('does NOT create R4 alert when dueDate + invoiceOverdueDays is in the future', async () => {
        const job = makeJob({ installDate: null });
        // dueDate 5 days ago, invoiceOverdueDays=14 → deadline is 5 < 14, not overdue yet
        const invoice = makeInvoice({
          jobId: 'job-1',
          dueDate: addDays(TODAY, -5),
          status: InvoiceStatus.SENT,
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([invoice]);

        await service.evaluateAndSync(TODAY);

        const creates = getCreateCalls(alertRepo);
        expect(
          creates.find((d) => d.type === 'INVOICE_NOT_PAID_AFTER_X_DAYS'),
        ).toBeUndefined();
      });
    });

    describe('auto-resolve', () => {
      it('sets resolvedAt on existing active alert whose rule condition is no longer true', async () => {
        // Job with installDate far in the future (no R1/R2 condition fires) but an active R1 alert exists
        const job = makeJob({ installDate: addDays(TODAY, 30) }); // outside 7-day window
        const existingAlert = makeAlert({
          jobId: 'job-1',
          type: 'PRE_METER_PENDING_7_DAYS',
          resolvedAt: null,
        });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);
        alertRepo.find.mockResolvedValue([existingAlert]);

        await service.evaluateAndSync(TODAY);

        const saves = getSaveCalls(alertRepo);
        const resolvedSave = saves.find(
          (a) => a.type === 'PRE_METER_PENDING_7_DAYS' && a.resolvedAt !== null,
        );
        expect(resolvedSave).toBeDefined();
        expect(resolvedSave?.resolvedByUserId).toBeNull();
      });
    });

    describe('idempotency', () => {
      it('does NOT create duplicate alerts when evaluateAndSync is called twice', async () => {
        const job = makeJob({ installDate: addDays(TODAY, 5) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);

        // First call — no existing alerts
        alertRepo.find.mockResolvedValue([]);
        await service.evaluateAndSync(TODAY);
        const firstCallCreates = getCreateCalls(alertRepo).length;

        // Second call — existing active alert is returned
        const createdAlert = makeAlert({
          jobId: 'job-1',
          type: 'PRE_METER_PENDING_7_DAYS',
          resolvedAt: null,
        });
        alertRepo.find.mockResolvedValue([createdAlert]);
        alertRepo.create.mockClear();
        await service.evaluateAndSync(TODAY);
        const secondCallCreates = getCreateCalls(alertRepo).filter(
          (d) => d.type === 'PRE_METER_PENDING_7_DAYS',
        ).length;

        expect(firstCallCreates).toBeGreaterThan(0);
        expect(secondCallCreates).toBe(0);
      });
    });

    describe('settings fallback', () => {
      it('uses default settings when AdminSettings row is not found', async () => {
        settingsRepo.findOne.mockResolvedValue(null); // no settings row
        const job = makeJob({ installDate: addDays(TODAY, 5) });
        jobRepo.find.mockResolvedValue([job]);
        meterRepo.find.mockResolvedValue([]);
        invoiceRepo.find.mockResolvedValue([]);

        await expect(service.evaluateAndSync(TODAY)).resolves.not.toThrow();
      });
    });
  });

  // ─── findAlerts ──────────────────────────────────────────────────────────────

  describe('findAlerts()', () => {
    it('returns all active alerts for admin with no managerId filter', async () => {
      const alert = makeAlert();
      alertRepo.find.mockResolvedValue([alert]);

      const result = await service.findAlerts(
        { status: 'active' },
        { userId: 'admin-1', role: UserRole.ADMIN },
      );

      expect(result.total).toBe(1);
      expect(result.items[0].id).toBe('alert-1');
      const findArg = getFindFirstArg(alertRepo);
      // Admin: no managerId join filter expected in the where clause targeting jobs
      expect(JSON.stringify(findArg)).not.toContain('managerId');
    });

    it('applies managerId filter for manager role', async () => {
      alertRepo.find.mockResolvedValue([]);

      await service.findAlerts(
        { status: 'active' },
        { userId: 'manager-1', role: UserRole.MANAGER },
      );

      const findArg = getFindFirstArg(alertRepo);
      expect(JSON.stringify(findArg)).toContain('manager-1');
    });

    it('returns both active and resolved when status=all', async () => {
      const activeAlert = makeAlert({ resolvedAt: null });
      const resolvedAlert = makeAlert({
        id: 'alert-2',
        resolvedAt: new Date(),
      });
      alertRepo.find.mockResolvedValue([activeAlert, resolvedAlert]);

      const result = await service.findAlerts(
        { status: 'all' },
        { userId: 'admin-1', role: UserRole.ADMIN },
      );

      expect(result.total).toBe(2);
    });

    it('filters by severity when provided', async () => {
      alertRepo.find.mockResolvedValue([]);

      await service.findAlerts(
        { status: 'active', severity: 'high' },
        { userId: 'admin-1', role: UserRole.ADMIN },
      );

      const findCall: unknown = (
        alertRepo.find.mock.calls as [[unknown]]
      )[0]?.[0];
      expect(JSON.stringify(findCall)).toContain('high');
    });

    it('filters by type when provided', async () => {
      alertRepo.find.mockResolvedValue([]);

      await service.findAlerts(
        { status: 'active', type: 'PRE_METER_PENDING_7_DAYS' },
        { userId: 'admin-1', role: UserRole.ADMIN },
      );

      const findCall: unknown = (
        alertRepo.find.mock.calls as [[unknown]]
      )[0]?.[0];
      expect(JSON.stringify(findCall)).toContain('PRE_METER_PENDING_7_DAYS');
    });
  });

  // ─── resolveAlert ────────────────────────────────────────────────────────────

  describe('resolveAlert()', () => {
    it('resolves an alert when admin calls it', async () => {
      const alert = makeAlert({ jobId: 'job-1', resolvedAt: null });
      alertRepo.findOne.mockResolvedValue(alert);
      alertRepo.save.mockResolvedValue({
        ...alert,
        resolvedAt: new Date(),
        resolvedByUserId: 'admin-1',
      });

      const result = await service.resolveAlert(
        'alert-1',
        'admin-1',
        UserRole.ADMIN,
      );

      expect(alertRepo.save).toHaveBeenCalled();
      expect(result.resolvedAt).not.toBeNull();
    });

    it('throws NotFoundException when alert does not exist', async () => {
      alertRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveAlert('nonexistent', 'admin-1', UserRole.ADMIN),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when alert is already resolved', async () => {
      const alert = makeAlert({ resolvedAt: new Date() });
      alertRepo.findOne.mockResolvedValue(alert);

      await expect(
        service.resolveAlert('alert-1', 'admin-1', UserRole.ADMIN),
      ).rejects.toThrow(ConflictException);
    });

    it("throws ForbiddenException when manager tries to resolve another manager's job alert", async () => {
      const alert = makeAlert({ jobId: 'job-1', resolvedAt: null });
      // Job belongs to different manager
      const job = makeJob({ id: 'job-1', managerId: 'other-manager' });
      alertRepo.findOne.mockResolvedValue(alert);
      jobRepo.findOne.mockResolvedValue(job);

      await expect(
        service.resolveAlert('alert-1', 'manager-1', UserRole.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows manager to resolve their own job alert', async () => {
      const alert = makeAlert({ jobId: 'job-1', resolvedAt: null });
      const job = makeJob({ id: 'job-1', managerId: 'manager-1' });
      alertRepo.findOne.mockResolvedValue(alert);
      jobRepo.findOne.mockResolvedValue(job);
      alertRepo.save.mockResolvedValue({
        ...alert,
        resolvedAt: new Date(),
        resolvedByUserId: 'manager-1',
      });

      const result = await service.resolveAlert(
        'alert-1',
        'manager-1',
        UserRole.MANAGER,
      );

      expect(result.resolvedAt).not.toBeNull();
    });
  });

  // ─── resolveAll ─────────────────────────────────────────────────────────────

  describe('resolveAll()', () => {
    it('resolves all active alerts in scope for admin', async () => {
      const alerts = [makeAlert({ id: 'a1' }), makeAlert({ id: 'a2' })];
      alertRepo.find.mockResolvedValue(alerts);
      alertRepo.save.mockImplementation((items) =>
        Promise.resolve(Array.isArray(items) ? items : [items]),
      );

      const result = await service.resolveAll({
        userId: 'admin-1',
        role: UserRole.ADMIN,
      });

      expect(result.resolved).toBe(2);
    });

    it('only resolves manager-scoped alerts for manager role', async () => {
      const alerts = [makeAlert({ id: 'a1', jobId: 'job-1' })];
      alertRepo.find.mockResolvedValue(alerts);
      alertRepo.save.mockImplementation((items) =>
        Promise.resolve(Array.isArray(items) ? items : [items]),
      );

      const result = await service.resolveAll({
        userId: 'manager-1',
        role: UserRole.MANAGER,
      });

      expect(result.resolved).toBe(1);
      const findCall: unknown = (
        alertRepo.find.mock.calls as [[unknown]]
      )[0]?.[0];
      expect(JSON.stringify(findCall)).toContain('manager-1');
    });
  });
});
