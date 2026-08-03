import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import {
  FinancingApplication,
  FinancingStatus,
} from './entities/financing-application.entity';
import { FinancingService } from './financing.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.financing.enabled = true;
  return flags;
};

describe('FinancingService', () => {
  let service: FinancingService;
  let appRepo: Mocked<Repository<FinancingApplication>>;
  let notifications: Mocked<NotificationsService>;
  let settings: Mocked<RuntimeSettingsService>;

  const application = (
    over: Partial<FinancingApplication> = {},
  ): FinancingApplication =>
    ({
      id: 'fa-1',
      jobId: 'job-1',
      status: FinancingStatus.SUBMITTED,
      lenderName: 'Green Bank',
      approvalExpiresAt: null,
      declineReason: null,
      expiryReminderSentAt: null,
      job: { id: 'job-1', managerId: 'mgr-1', orderNumber: 'ORD-1' } as Job,
      ...over,
    }) as FinancingApplication;

  beforeEach(async () => {
    appRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(application()),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
    } as unknown as Mocked<Repository<FinancingApplication>>;

    notifications = {
      sendToUsers: jest.fn().mockResolvedValue([]),
    } as unknown as Mocked<NotificationsService>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        FinancingService,
        {
          provide: getRepositoryToken(FinancingApplication),
          useValue: appRepo,
        },
        {
          provide: getRepositoryToken(Job),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'job-1', managerId: 'mgr-1' } as Job),
          },
        },
        { provide: NotificationsService, useValue: notifications },
        { provide: RuntimeSettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(FinancingService);
  });

  describe('status transitions', () => {
    it('is refused entirely when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(
        service.update('fa-1', { status: FinancingStatus.APPROVED }, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks an illegal jump from declined to settled', async () => {
      appRepo.findOne.mockResolvedValue(
        application({ status: FinancingStatus.DECLINED }),
      );
      await expect(
        service.update('fa-1', { status: FinancingStatus.SETTLED }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks approving straight from intent', async () => {
      appRepo.findOne.mockResolvedValue(
        application({ status: FinancingStatus.INTENT }),
      );
      await expect(
        service.update(
          'fa-1',
          {
            status: FinancingStatus.APPROVED,
            approvalExpiresAt: '2026-12-01T00:00:00.000Z',
          },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses an approval with no expiry date', async () => {
      await expect(
        service.update('fa-1', { status: FinancingStatus.APPROVED }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an approval that carries an expiry', async () => {
      const saved = await service.update(
        'fa-1',
        {
          status: FinancingStatus.APPROVED,
          approvalExpiresAt: '2026-12-01T00:00:00.000Z',
          approvedAmount: 18000,
        },
        ADMIN,
      );
      expect(saved.status).toBe(FinancingStatus.APPROVED);
      expect(saved.decisionAt).toBeInstanceOf(Date);
      expect(saved.approvedAmount).toBe('18000');
    });

    it('refuses a decline with no reason', async () => {
      await expect(
        service.update('fa-1', { status: FinancingStatus.DECLINED }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a decline that carries a reason', async () => {
      const saved = await service.update(
        'fa-1',
        {
          status: FinancingStatus.DECLINED,
          declineReason: 'Serviceability',
        },
        ADMIN,
      );
      expect(saved.status).toBe(FinancingStatus.DECLINED);
    });

    it('clears the reminder flag when an approval is re-dated', async () => {
      appRepo.findOne.mockResolvedValue(
        application({
          status: FinancingStatus.APPROVED,
          expiryReminderSentAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );
      const saved = await service.update(
        'fa-1',
        { approvalExpiresAt: '2027-01-01T00:00:00.000Z' },
        ADMIN,
      );
      expect(saved.expiryReminderSentAt).toBeNull();
    });
  });

  describe('sweepExpiries', () => {
    it('does nothing when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(service.sweepExpiries()).resolves.toEqual({
        warned: 0,
        expired: 0,
      });
    });

    it('expires lapsed approvals and warns on nearing ones', async () => {
      const lapsed = application({
        id: 'lapsed',
        status: FinancingStatus.APPROVED,
        approvalExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const nearing = application({
        id: 'nearing',
        status: FinancingStatus.APPROVED,
        approvalExpiresAt: new Date('2026-06-05T00:00:00.000Z'),
      });
      appRepo.find
        .mockResolvedValueOnce([lapsed])
        .mockResolvedValueOnce([nearing]);

      const result = await service.sweepExpiries(
        new Date('2026-06-01T00:00:00.000Z'),
      );
      expect(result).toEqual({ warned: 1, expired: 1 });
      expect(lapsed.status).toBe(FinancingStatus.EXPIRED);
      // The job's manager is the one who can act on it.
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        ['mgr-1'],
        expect.objectContaining({ title: 'Financing approval expiring soon' }),
      );
      expect(nearing.expiryReminderSentAt).toBeInstanceOf(Date);
    });
  });
});
