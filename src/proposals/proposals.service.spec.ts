import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import {
  PricingMode,
  ProposalStatus,
  ProposalVersion,
} from './entities/proposal-version.entity';
import { ProposalsService } from './proposals.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };
const MANAGER = { userId: 'mgr-1', role: UserRole.MANAGER };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.proposalVersioning.enabled = true;
  return flags;
};

describe('ProposalsService', () => {
  let service: ProposalsService;
  let versionRepo: Mocked<Repository<ProposalVersion>>;
  let jobRepo: Mocked<Repository<Job>>;
  let settings: Mocked<RuntimeSettingsService>;

  const version = (over: Partial<ProposalVersion> = {}): ProposalVersion =>
    ({
      id: 'pv-1',
      jobId: 'job-1',
      versionNumber: 1,
      status: ProposalStatus.DRAFT,
      pricingMode: PricingMode.CASH,
      totalPrice: '15000.00',
      depositAmount: '1500.00',
      viewCount: 0,
      expiresAt: null,
      firstViewedAt: null,
      ...over,
    }) as ProposalVersion;

  beforeEach(async () => {
    versionRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(version()),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<ProposalVersion>>;

    jobRepo = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'job-1', managerId: MANAGER.userId } as Job),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<Job>>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) =>
        cb({ getRepository: () => versionRepo }),
      ),
    } as unknown as DataSource;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProposalsService,
        { provide: getRepositoryToken(ProposalVersion), useValue: versionRepo },
        { provide: getRepositoryToken(Job), useValue: jobRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: RuntimeSettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(ProposalsService);
  });

  describe('createVersion', () => {
    it('is refused when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(
        service.createVersion('job-1', {}, ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allocates the next version number', async () => {
      versionRepo.findOne.mockResolvedValue(version({ versionNumber: 4 }));
      const created = await service.createVersion(
        'job-1',
        { totalPrice: 20000 },
        ADMIN,
      );
      expect(created.versionNumber).toBe(5);
      expect(created.status).toBe(ProposalStatus.DRAFT);
    });

    it('starts at version 1 for a job with no proposals', async () => {
      versionRepo.findOne.mockResolvedValue(null);
      const created = await service.createVersion('job-1', {}, ADMIN);
      expect(created.versionNumber).toBe(1);
    });

    it('requires finance terms for loan and lease', async () => {
      await expect(
        service.createVersion(
          'job-1',
          { pricingMode: PricingMode.LOAN, totalPrice: 20000 },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a per-kWh rate for PPA', async () => {
      await expect(
        service.createVersion(
          'job-1',
          { pricingMode: PricingMode.PPA, totalPrice: 0 },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a cash proposal carrying a finance term', async () => {
      await expect(
        service.createVersion(
          'job-1',
          { pricingMode: PricingMode.CASH, termMonths: 60 },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks a manager on someone else’s job', async () => {
      jobRepo.findOne.mockResolvedValue({
        id: 'job-1',
        managerId: 'other-mgr',
      } as Job);
      await expect(
        service.createVersion('job-1', {}, MANAGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('send', () => {
    it('supersedes other live versions so only one is open', async () => {
      await service.send('pv-1', {}, ADMIN);
      // One update per live status (sent, viewed).
      expect(versionRepo.update).toHaveBeenCalledTimes(2);
      const [saved] = versionRepo.save.mock.calls[0] as [ProposalVersion];
      expect(saved.status).toBe(ProposalStatus.SENT);
      expect(saved.sentAt).toBeInstanceOf(Date);
    });

    it('refuses to re-send an accepted proposal', async () => {
      versionRepo.findOne.mockResolvedValue(
        version({ status: ProposalStatus.ACCEPTED }),
      );
      await expect(service.send('pv-1', {}, ADMIN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('recordView', () => {
    it('sets the first-view timestamp once and counts every open', async () => {
      versionRepo.findOne.mockResolvedValue(
        version({ status: ProposalStatus.SENT, viewCount: 0 }),
      );
      await service.recordView('pv-1');
      const [, patch] = versionRepo.update.mock.calls[0] as [
        unknown,
        { firstViewedAt: Date; viewCount: number; status: ProposalStatus },
      ];
      expect(patch.status).toBe(ProposalStatus.VIEWED);
      expect(patch.viewCount).toBe(1);
      expect(patch.firstViewedAt).toBeInstanceOf(Date);

      versionRepo.update.mockClear();
      const alreadyViewed = new Date('2026-01-01T00:00:00.000Z');
      versionRepo.findOne.mockResolvedValue(
        version({
          status: ProposalStatus.VIEWED,
          viewCount: 3,
          firstViewedAt: alreadyViewed,
        }),
      );
      await service.recordView('pv-1');
      const [, patch2] = versionRepo.update.mock.calls[0] as [
        unknown,
        { firstViewedAt: Date; viewCount: number },
      ];
      expect(patch2.firstViewedAt).toBe(alreadyViewed);
      expect(patch2.viewCount).toBe(4);
    });

    it('ignores views of a proposal that is no longer live', async () => {
      versionRepo.findOne.mockResolvedValue(
        version({ status: ProposalStatus.EXPIRED }),
      );
      await service.recordView('pv-1');
      expect(versionRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('accept', () => {
    it('pushes the accepted price onto the job', async () => {
      versionRepo.findOne.mockResolvedValue(
        version({ status: ProposalStatus.VIEWED }),
      );
      await service.accept('pv-1', ADMIN);
      expect(jobRepo.update).toHaveBeenCalledWith(
        { id: 'job-1' },
        { projectPrice: '15000.00', depositAmount: '1500.00' },
      );
    });

    it('refuses to accept an expired proposal', async () => {
      versionRepo.findOne.mockResolvedValue(
        version({
          status: ProposalStatus.SENT,
          expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        }),
      );
      await expect(service.accept('pv-1', ADMIN)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(jobRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('expireOverdue', () => {
    it('expires only live proposals past their date', async () => {
      const past = new Date('2026-01-01T00:00:00.000Z');
      const future = new Date('2099-01-01T00:00:00.000Z');
      versionRepo.find.mockResolvedValue([
        version({ id: 'a', status: ProposalStatus.SENT, expiresAt: past }),
        version({ id: 'b', status: ProposalStatus.SENT, expiresAt: future }),
        version({ id: 'c', status: ProposalStatus.VIEWED, expiresAt: null }),
      ]);
      const result = await service.expireOverdue(
        new Date('2026-06-01T00:00:00.000Z'),
      );
      expect(result.expired).toBe(1);
      const [saved] = versionRepo.save.mock.calls[0] as [ProposalVersion[]];
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe('a');
    });

    it('does nothing when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(service.expireOverdue()).resolves.toEqual({ expired: 0 });
    });
  });
});
