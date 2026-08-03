import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import { Project } from '../projects/entities/project.entity';
import { PortalAccessToken } from './entities/portal-access-token.entity';
import { CustomerPortalService } from './customer-portal.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };
const MANAGER = { userId: 'mgr-1', role: UserRole.MANAGER };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.customerPortal.enabled = true;
  return flags;
};

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('CustomerPortalService', () => {
  let service: CustomerPortalService;
  let tokenRepo: Mocked<Repository<PortalAccessToken>>;
  let jobRepo: Mocked<Repository<Job>>;
  let settings: Mocked<RuntimeSettingsService>;

  const futureDate = new Date(Date.now() + 86_400_000);

  const tokenRecord = (
    over: Partial<PortalAccessToken> = {},
  ): PortalAccessToken =>
    ({
      id: 'tok-1',
      tokenHash: 'unused',
      customerId: 'cust-1',
      jobId: 'job-1',
      expiresAt: futureDate,
      revokedAt: null,
      accessCount: 0,
      ...over,
    }) as PortalAccessToken;

  beforeEach(async () => {
    tokenRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<PortalAccessToken>>;

    jobRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'job-1',
        orderNumber: 'ORD-1',
        customerId: 'cust-1',
        managerId: MANAGER.userId,
        pipelineStage: 'scheduled',
        systemSizeKw: '6.60',
        batterySizeKwh: null,
        installDate: '2026-09-01',
        scheduledDate: null,
        projectPrice: '15000.00',
      } as Job),
    } as unknown as Mocked<Repository<Job>>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        CustomerPortalService,
        { provide: getRepositoryToken(PortalAccessToken), useValue: tokenRepo },
        { provide: getRepositoryToken(Job), useValue: jobRepo },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'cust-1', firstName: 'Ada' }),
          },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        { provide: RuntimeSettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(CustomerPortalService);
  });

  describe('issueToken', () => {
    it('is refused when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(service.issueToken('job-1', ADMIN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('stores only the hash, never the plaintext token', async () => {
      const { token } = await service.issueToken('job-1', ADMIN);
      const [saved] = tokenRepo.save.mock.calls[0] as [PortalAccessToken];
      expect(saved.tokenHash).toBe(sha256(token));
      expect(saved.tokenHash).not.toBe(token);
      expect(JSON.stringify(saved)).not.toContain(token);
    });

    it('mints unguessable, non-repeating tokens', async () => {
      const a = await service.issueToken('job-1', ADMIN);
      const b = await service.issueToken('job-1', ADMIN);
      expect(a.token).not.toBe(b.token);
      // 32 random bytes, base64url — comfortably beyond brute force.
      expect(a.token.length).toBeGreaterThanOrEqual(40);
    });

    it('scopes the link to a single job', async () => {
      await service.issueToken('job-1', ADMIN);
      const [saved] = tokenRepo.save.mock.calls[0] as [PortalAccessToken];
      expect(saved.jobId).toBe('job-1');
      expect(saved.customerId).toBe('cust-1');
    });

    it('blocks a manager issuing a link on someone else’s job', async () => {
      jobRepo.findOne.mockResolvedValue({
        id: 'job-1',
        managerId: 'other-mgr',
      } as Job);
      await expect(service.issueToken('job-1', MANAGER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('statusForToken', () => {
    it('rejects a short or empty token without hitting the database', async () => {
      await expect(service.statusForToken('')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.statusForToken('abc')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tokenRepo.findOne).not.toHaveBeenCalled();
    });

    it('returns a generic 404 for an unknown token', async () => {
      tokenRepo.findOne.mockResolvedValue(null);
      await expect(
        service.statusForToken('x'.repeat(43)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the same 404 for an expired token', async () => {
      tokenRepo.findOne.mockResolvedValue(
        tokenRecord({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(
        service.statusForToken('x'.repeat(43)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the same 404 for a revoked token', async () => {
      tokenRepo.findOne.mockResolvedValue(
        tokenRecord({ revokedAt: new Date() }),
      );
      await expect(
        service.statusForToken('x'.repeat(43)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is unavailable entirely when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(
        service.statusForToken('x'.repeat(43)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a customer-safe view with no internal data', async () => {
      tokenRepo.findOne.mockResolvedValue(tokenRecord());
      const view = await service.statusForToken('x'.repeat(43));

      expect(view.customerFirstName).toBe('Ada');
      expect(view.orderReference).toBe('ORD-1');
      // The specific leaks this endpoint must never produce.
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('15000');
      expect(serialized).not.toContain('mgr-1');
      expect(serialized).not.toContain('pre_meter');
      expect(serialized).not.toContain('pipelineStage');
    });

    it('marks milestones done/current/upcoming from the internal stage', async () => {
      tokenRepo.findOne.mockResolvedValue(tokenRecord());
      const view = await service.statusForToken('x'.repeat(43));
      const byKey = new Map(view.milestones.map((m) => [m.key, m.status]));
      // `scheduled` is index 4 of the customer journey.
      expect(byKey.get('agreement')).toBe('done');
      expect(byKey.get('scheduled')).toBe('current');
      expect(byKey.get('connected')).toBe('upcoming');
    });

    it('counts each access', async () => {
      tokenRepo.findOne.mockResolvedValue(tokenRecord({ accessCount: 4 }));
      await service.statusForToken('x'.repeat(43));
      expect(tokenRepo.update).toHaveBeenCalledWith(
        { id: 'tok-1' },
        expect.objectContaining({ accessCount: 5 }),
      );
    });
  });

  describe('revokeAllForJob', () => {
    it('revokes every live link', async () => {
      tokenRepo.find.mockResolvedValue([
        tokenRecord(),
        tokenRecord({ id: 't2' }),
      ]);
      await expect(service.revokeAllForJob('job-1', ADMIN)).resolves.toEqual({
        revoked: 2,
      });
      const [saved] = tokenRepo.save.mock.calls[0] as [PortalAccessToken[]];
      expect(saved.every((t) => t.revokedAt instanceof Date)).toBe(true);
    });
  });
});
