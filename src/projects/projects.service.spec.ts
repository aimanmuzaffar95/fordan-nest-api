import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { TasksService } from '../tasks/tasks.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import { Project, ProjectStage } from './entities/project.entity';
import { INSTALL_READINESS_ITEMS, ProjectsService } from './projects.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };
const MANAGER = { userId: 'mgr-1', role: UserRole.MANAGER };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.projectSplit.enabled = true;
  return flags;
};

const allTicked = (): Record<string, boolean> =>
  Object.fromEntries(INSTALL_READINESS_ITEMS.map((i) => [i.id, true]));

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectRepo: Mocked<Repository<Project>>;
  let jobRepo: Mocked<Repository<Job>>;
  let settings: Mocked<RuntimeSettingsService>;

  const project = (over: Partial<Project> = {}): Project =>
    ({
      id: 'proj-1',
      jobId: 'job-1',
      projectNumber: 'P-ORD-1',
      customerId: 'cust-1',
      stage: ProjectStage.READY_FOR_INSTALL,
      projectManagerUserId: MANAGER.userId,
      readinessChecklist: {},
      actualInstallDate: null,
      ...over,
    }) as Project;

  beforeEach(async () => {
    projectRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(project()),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<Project>>;

    jobRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'job-1',
        orderNumber: 'ORD-1',
        customerId: 'cust-1',
        contractSigned: true,
        managerId: MANAGER.userId,
        systemSizeKw: '6.60',
        projectPrice: '15000.00',
        installDate: null,
        batterySizeKwh: null,
      } as Job),
    } as unknown as Mocked<Repository<Job>>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: getRepositoryToken(Project), useValue: projectRepo },
        { provide: getRepositoryToken(Job), useValue: jobRepo },
        {
          provide: getRepositoryToken(Customer),
          useValue: {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'cust-1', address: '12 Smith St' }),
          },
        },
        { provide: RuntimeSettingsService, useValue: settings },
        {
          provide: TasksService,
          useValue: { create: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = moduleRef.get(ProjectsService);
  });

  describe('createFromSignedJob', () => {
    it('does nothing when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(
        service.createFromSignedJob('job-1', ADMIN.userId),
      ).resolves.toBeNull();
      expect(projectRepo.save).not.toHaveBeenCalled();
    });

    it('is idempotent — an existing project is returned unchanged', async () => {
      const existing = project();
      projectRepo.findOne.mockResolvedValue(existing);
      await expect(
        service.createFromSignedJob('job-1', ADMIN.userId),
      ).resolves.toBe(existing);
      expect(projectRepo.save).not.toHaveBeenCalled();
    });

    it('snapshots the job context at signing', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      const created = await service.createFromSignedJob('job-1', ADMIN.userId);
      expect(created?.projectNumber).toBe('P-ORD-1');
      expect(created?.contractValue).toBe('15000.00');
      expect(created?.systemSizeKw).toBe('6.60');
      expect(created?.siteAddress).toBe('12 Smith St');
      expect(created?.stage).toBe(ProjectStage.INITIATED);
    });

    it('refuses to create one for an unsigned job', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      jobRepo.findOne.mockResolvedValue({
        id: 'job-1',
        contractSigned: false,
      } as Job);
      await expect(
        service.createFromSignedJob('job-1', ADMIN.userId),
      ).resolves.toBeNull();
    });

    it('never throws — signing must not fail because of the project', async () => {
      projectRepo.findOne.mockResolvedValue(null);
      projectRepo.save.mockRejectedValue(new Error('db down'));
      await expect(
        service.createFromSignedJob('job-1', ADMIN.userId),
      ).resolves.toBeNull();
    });
  });

  describe('stage gating', () => {
    it('blocks scheduling until readiness is complete', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ readinessChecklist: { crew_assigned: true } }),
      );
      await expect(
        service.update('proj-1', { stage: ProjectStage.SCHEDULED }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows scheduling once every readiness item is ticked', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ readinessChecklist: allTicked() }),
      );
      const saved = await service.update(
        'proj-1',
        { stage: ProjectStage.SCHEDULED },
        ADMIN,
      );
      expect(saved.stage).toBe(ProjectStage.SCHEDULED);
    });

    it('blocks PTO before an install date exists', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ stage: ProjectStage.INSPECTION, actualInstallDate: null }),
      );
      await expect(
        service.update('proj-1', { stage: ProjectStage.PTO }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks moving an installed project back before installation', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({
          stage: ProjectStage.INSTALLED,
          actualInstallDate: '2026-07-01',
        }),
      );
      await expect(
        service.update('proj-1', { stage: ProjectStage.PERMITTING }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a reason to put a project on hold', async () => {
      await expect(
        service.update('proj-1', { stage: ProjectStage.ON_HOLD }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses stage changes on a cancelled project', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ stage: ProjectStage.CANCELLED }),
      );
      await expect(
        service.update('proj-1', { stage: ProjectStage.PERMITTING }, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('readiness checklist', () => {
    it('merges partial ticks rather than replacing the map', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ readinessChecklist: { crew_assigned: true } }),
      );
      const saved = await service.update(
        'proj-1',
        { readinessChecklist: { deposit_received: true } },
        ADMIN,
      );
      expect(saved.readinessChecklist).toMatchObject({
        crew_assigned: true,
        deposit_received: true,
      });
    });

    it('rejects an unknown readiness item', async () => {
      await expect(
        service.update(
          'proj-1',
          { readinessChecklist: { invented_item: true } },
          ADMIN,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stamps confirmation only when everything is ticked', async () => {
      projectRepo.findOne.mockResolvedValue(project());
      const partial = await service.update(
        'proj-1',
        { readinessChecklist: { crew_assigned: true } },
        ADMIN,
      );
      expect(partial.readinessConfirmedAt).toBeNull();

      projectRepo.findOne.mockResolvedValue(project());
      const full = await service.update(
        'proj-1',
        { readinessChecklist: allTicked() },
        ADMIN,
      );
      expect(full.readinessConfirmedAt).toBeInstanceOf(Date);
      expect(full.readinessConfirmedByUserId).toBe(ADMIN.userId);
    });
  });

  describe('scoping', () => {
    it('hides another manager’s project', async () => {
      projectRepo.findOne.mockResolvedValue(
        project({ projectManagerUserId: 'other-mgr' }),
      );
      await expect(service.findOne('proj-1', MANAGER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses everything when the flag is off for the role', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(service.list(ADMIN)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
