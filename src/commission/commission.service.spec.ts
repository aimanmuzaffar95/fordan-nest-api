import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { SystemAuditLogService } from '../system-audit/system-audit-log.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import {
  CommissionEvent,
  CommissionEventType,
  CommissionStatus,
} from './entities/commission-event.entity';
import { CommissionService } from './commission.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };
const REP = { userId: 'rep-1', role: UserRole.INSTALLER };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.commission.enabled = true;
  return flags;
};

describe('CommissionService', () => {
  let service: CommissionService;
  let eventRepo: Mocked<Repository<CommissionEvent>>;
  let settings: Mocked<RuntimeSettingsService>;

  const event = (over: Partial<CommissionEvent> = {}): CommissionEvent =>
    ({
      id: 'ce-1',
      userId: 'rep-1',
      jobId: 'job-1',
      eventType: CommissionEventType.CONTRACT_SIGNED,
      status: CommissionStatus.PENDING,
      amount: '500.00',
      currency: 'AUD',
      ...over,
    }) as CommissionEvent;

  beforeEach(async () => {
    eventRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(event()),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
    } as unknown as Mocked<Repository<CommissionEvent>>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: getRepositoryToken(CommissionEvent), useValue: eventRepo },
        { provide: RuntimeSettingsService, useValue: settings },
        {
          provide: SystemAuditLogService,
          useValue: { record: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = moduleRef.get(CommissionService);
  });

  describe('access control', () => {
    it('stops a rep reading someone else’s commission', async () => {
      await expect(service.summary('other-rep', REP)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets a rep read their own', async () => {
      await expect(service.summary(REP.userId, REP)).resolves.toMatchObject({
        userId: REP.userId,
      });
    });

    it('rejects a rep asking for another user’s list', async () => {
      // An explicit deny, not a silently-rewritten query — the caller should
      // learn their filter was refused rather than get someone else's shape.
      await expect(
        service.list({ userId: 'other-rep' }, REP),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('defaults a rep’s unfiltered list to their own records', async () => {
      await service.list({}, REP);
      const [options] = eventRepo.find.mock.calls[0] as [
        { where: { userId?: string } },
      ];
      expect(options.where.userId).toBe(REP.userId);
    });

    it('stops non-admins creating commission records', async () => {
      await expect(
        service.create(
          {
            userId: REP.userId,
            eventType: CommissionEventType.BONUS,
            amount: 100,
          },
          REP,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('create', () => {
    it('requires a basis whenever a rate is given', async () => {
      await expect(
        service.create(
          {
            userId: REP.userId,
            eventType: CommissionEventType.CONTRACT_SIGNED,
            amount: 500,
            ratePercent: 3,
          },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a negative amount on an earning event', async () => {
      await expect(
        service.create(
          {
            userId: REP.userId,
            eventType: CommissionEventType.CONTRACT_SIGNED,
            amount: -500,
          },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a positive clawback', async () => {
      await expect(
        service.create(
          {
            userId: REP.userId,
            eventType: CommissionEventType.CLAWBACK,
            amount: 500,
          },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a negative clawback and starts it pending', async () => {
      const created = await service.create(
        {
          userId: REP.userId,
          eventType: CommissionEventType.CLAWBACK,
          amount: -500,
        },
        ADMIN,
      );
      expect(created.status).toBe(CommissionStatus.PENDING);
      expect(created.amount).toBe('-500.00');
    });
  });

  describe('status transitions', () => {
    it('blocks paying an unapproved record directly', async () => {
      await expect(
        service.update('ce-1', { status: CommissionStatus.PAID }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a reason to void', async () => {
      await expect(
        service.update('ce-1', { status: CommissionStatus.VOID }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses to re-price a paid record', async () => {
      eventRepo.findOne.mockResolvedValue(
        event({ status: CommissionStatus.PAID }),
      );
      await expect(
        service.update('ce-1', { amount: 999 }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stamps approver and time on approval', async () => {
      const saved = await service.update(
        'ce-1',
        { status: CommissionStatus.APPROVED },
        ADMIN,
      );
      expect(saved.approvedByUserId).toBe(ADMIN.userId);
      expect(saved.approvedAt).toBeInstanceOf(Date);
    });
  });

  describe('recordPayout', () => {
    it('refuses to pay anything not approved', async () => {
      eventRepo.find.mockResolvedValue([
        event({ id: 'a', status: CommissionStatus.APPROVED }),
        event({ id: 'b', status: CommissionStatus.PENDING }),
      ]);
      await expect(
        service.recordPayout(
          { eventIds: ['a', 'b'], payoutReference: 'RUN-1' },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('pays an approved batch under one reference', async () => {
      eventRepo.find.mockResolvedValue([
        event({ id: 'a', status: CommissionStatus.APPROVED, amount: '500.00' }),
        event({ id: 'b', status: CommissionStatus.APPROVED, amount: '250.50' }),
      ]);
      const result = await service.recordPayout(
        { eventIds: ['a', 'b'], payoutReference: 'RUN-1' },
        ADMIN,
      );
      expect(result).toEqual({ paid: 2, total: 750.5 });
    });

    it('is admin-only', async () => {
      await expect(
        service.recordPayout(
          { eventIds: ['a'], payoutReference: 'RUN-1' },
          REP,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('summary', () => {
    it('totals by status without float drift', async () => {
      eventRepo.find.mockResolvedValue([
        event({ status: CommissionStatus.PENDING, amount: '0.10' }),
        event({ status: CommissionStatus.PENDING, amount: '0.20' }),
        event({ status: CommissionStatus.APPROVED, amount: '100.00' }),
        event({ status: CommissionStatus.PAID, amount: '900.00' }),
        event({ status: CommissionStatus.CLAWED_BACK, amount: '-50.00' }),
      ]);
      const summary = await service.summary(REP.userId, ADMIN);
      expect(summary.pending).toBe(0.3);
      expect(summary.approved).toBe(100);
      expect(summary.paid).toBe(900);
      expect(summary.clawedBack).toBe(-50);
      expect(summary.outstanding).toBe(100.3);
    });
  });
});
