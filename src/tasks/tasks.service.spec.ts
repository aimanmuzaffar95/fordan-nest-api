import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../jobs/entities/job.entity';
import { JobPipelineStage } from '../jobs/job-pipeline-stage.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { LeadRoutingService } from '../territories/lead-routing.service';
import { ProposalsService } from '../proposals/proposals.service';
import { FinancingService } from '../financing/financing.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import { defaultPipelineStageConfig } from '../pipeline-stages/pipeline-stage.config';
import { Task } from './entities/task.entity';
import {
  TaskPriority,
  TaskSource,
  TaskStatus,
} from './entities/task-status.enum';
import { TasksService } from './tasks.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const ADMIN = { userId: 'admin-1', role: UserRole.ADMIN };
const MANAGER = { userId: 'mgr-1', role: UserRole.MANAGER };
const INSTALLER = { userId: 'inst-1', role: UserRole.INSTALLER };

describe('TasksService', () => {
  let service: TasksService;
  let taskRepo: Mocked<Repository<Task>>;
  let jobRepo: Mocked<Repository<Job>>;
  let userRepo: Mocked<Repository<User>>;
  let notifications: Mocked<NotificationsService>;
  let settings: Mocked<RuntimeSettingsService>;

  const makeJob = (over: Partial<Job> = {}): Job =>
    ({
      id: 'job-1',
      orderNumber: 'ORD-1',
      managerId: MANAGER.userId,
      assignedStaffUserId: INSTALLER.userId,
      pipelineStage: JobPipelineStage.LEAD,
      ...over,
    }) as Job;

  beforeEach(async () => {
    taskRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) =>
        Array.isArray(v)
          ? v.map((row, i) => ({
              id: `task-${i}`,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...(row as object),
            }))
          : {
              id: 'task-0',
              createdAt: new Date(),
              updatedAt: new Date(),
              ...(v as object),
            },
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<Task>>;

    jobRepo = {
      findOne: jest.fn().mockResolvedValue(makeJob()),
    } as unknown as Mocked<Repository<Job>>;

    userRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 'someone' }),
    } as unknown as Mocked<Repository<User>>;

    notifications = {
      sendToUsers: jest.fn().mockResolvedValue([]),
    } as unknown as Mocked<NotificationsService>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(defaultFeatureFlags()),
      getPipelineStageConfig: jest
        .fn()
        .mockResolvedValue(defaultPipelineStageConfig()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: getRepositoryToken(Task), useValue: taskRepo },
        { provide: getRepositoryToken(Job), useValue: jobRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: NotificationsService, useValue: notifications },
        { provide: RuntimeSettingsService, useValue: settings },
        {
          // The sweep timer also drives lead, proposal and financing expiry
          // rules; stub them so these tests only exercise task SLAs.
          provide: LeadRoutingService,
          useValue: {
            reassignStaleLeads: jest.fn().mockResolvedValue({ reassigned: 0 }),
          },
        },
        {
          provide: ProposalsService,
          useValue: {
            expireOverdue: jest.fn().mockResolvedValue({ expired: 0 }),
          },
        },
        {
          provide: FinancingService,
          useValue: {
            sweepExpiries: jest
              .fn()
              .mockResolvedValue({ warned: 0, expired: 0 }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(TasksService);
  });

  afterEach(() => service.onModuleDestroy());

  describe('stage template materialisation', () => {
    it('creates the configured tasks for the stage entered', async () => {
      const created = await service.materialiseStageTasks(
        'job-1',
        JobPipelineStage.WON,
        ADMIN.userId,
      );
      // The `won` defaults are the pre-meter submission and deposit tasks.
      expect(created).toHaveLength(2);
      expect(created.map((t) => t.templateId).sort()).toEqual([
        'won_collect_deposit',
        'won_submit_pre_meter',
      ]);
      expect(created[0].source).toBe(TaskSource.STAGE_TEMPLATE);
    });

    it('is idempotent — templates already materialised are skipped', async () => {
      taskRepo.find.mockResolvedValue([
        { id: 'existing', templateId: 'won_submit_pre_meter' },
      ]);
      const created = await service.materialiseStageTasks(
        'job-1',
        JobPipelineStage.WON,
        ADMIN.userId,
      );
      expect(created).toHaveLength(1);
      expect(created[0].templateId).toBe('won_collect_deposit');
    });

    it('resolves assignees from the job', async () => {
      const created = await service.materialiseStageTasks(
        'job-1',
        JobPipelineStage.SCHEDULED,
        ADMIN.userId,
      );
      const byTemplate = new Map(created.map((t) => [t.templateId, t]));
      expect(byTemplate.get('scheduled_confirm_customer')?.assigneeUserId).toBe(
        MANAGER.userId,
      );
      expect(byTemplate.get('scheduled_crew_brief')?.assigneeUserId).toBe(
        INSTALLER.userId,
      );
    });

    it('does nothing when the task engine flag is off', async () => {
      const flags = defaultFeatureFlags();
      flags.taskEngine.enabled = false;
      settings.getFeatureFlags.mockResolvedValue(flags);
      await expect(
        service.materialiseStageTasks('job-1', JobPipelineStage.WON, null),
      ).resolves.toEqual([]);
      expect(taskRepo.save).not.toHaveBeenCalled();
    });

    it('swallows failures so a stage move is never rolled back', async () => {
      taskRepo.save.mockRejectedValue(new Error('db down'));
      await expect(
        service.materialiseStageTasks('job-1', JobPipelineStage.WON, null),
      ).resolves.toEqual([]);
    });

    it('sets due and SLA dates from the template offset', async () => {
      const now = new Date('2026-08-03T00:00:00.000Z');
      const created = await service.materialiseStageTasks(
        'job-1',
        JobPipelineStage.COMPLETED,
        ADMIN.userId,
        now,
      );
      // completed_raise_invoice is due 24h after entering the stage.
      expect(created[0].dueAt?.toISOString()).toBe('2026-08-04T00:00:00.000Z');
      expect(created[0].slaDueAt).toEqual(created[0].dueAt);
    });
  });

  describe('authorisation', () => {
    it('refuses everything when the flag is off for the caller’s role', async () => {
      const flags = defaultFeatureFlags();
      flags.taskEngine.roles = [UserRole.ADMIN];
      settings.getFeatureFlags.mockResolvedValue(flags);
      await expect(service.findAll({}, MANAGER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('stops an installer creating a task on someone else’s job', async () => {
      jobRepo.findOne.mockResolvedValue(
        makeJob({ assignedStaffUserId: 'other-installer' }),
      );
      await expect(
        service.create({ jobId: 'job-1', title: 'Sneak' }, INSTALLER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('stops an installer assigning work to someone else', async () => {
      await expect(
        service.create(
          {
            jobId: 'job-1',
            title: 'Yours now',
            assigneeUserId: 'someone-else',
          },
          INSTALLER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('self-assigns tasks created by non-privileged users', async () => {
      const task = await service.create(
        { jobId: 'job-1', title: 'Mine' },
        INSTALLER,
      );
      expect(task.assigneeUserId).toBe(INSTALLER.userId);
    });

    it('hides tasks outside the viewer’s scope behind a 404', async () => {
      taskRepo.findOne.mockResolvedValue({
        id: 'task-9',
        assigneeUserId: 'someone-else',
        job: makeJob({ managerId: 'other-manager' }),
      } as unknown as Task);
      await expect(service.findOne('task-9', INSTALLER)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lets a non-privileged assignee change only the status', async () => {
      taskRepo.findOne.mockResolvedValue({
        id: 'task-9',
        assigneeUserId: INSTALLER.userId,
        status: TaskStatus.OPEN,
        priority: TaskPriority.NORMAL,
        escalationLevel: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Task);

      await expect(
        service.update('task-9', { title: 'Renamed' }, INSTALLER),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const updated = await service.update(
        'task-9',
        { status: TaskStatus.DONE },
        INSTALLER,
      );
      expect(updated.status).toBe(TaskStatus.DONE);
      expect(updated.completedAt).not.toBeNull();
    });

    it('refuses deletion by a non-privileged user', async () => {
      taskRepo.findOne.mockResolvedValue({
        id: 'task-9',
        assigneeUserId: INSTALLER.userId,
      } as unknown as Task);
      await expect(service.remove('task-9', INSTALLER)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('forces scope=mine for installers even when they ask for all', async () => {
      await service.findAll({ scope: 'all' }, INSTALLER);
      const [options] = taskRepo.findAndCount.mock.calls[0] as [
        { where: { assigneeUserId?: string } },
      ];
      const where = options.where;
      expect(where.assigneeUserId).toBe(INSTALLER.userId);
    });
  });

  describe('SLA sweep', () => {
    const breachable = (over: Partial<Task> = {}): Task =>
      ({
        id: 'task-sla',
        status: TaskStatus.OPEN,
        slaDueAt: new Date('2026-08-01T00:00:00.000Z'),
        slaBreachedAt: null,
        escalationLevel: 0,
        job: makeJob(),
        assigneeUserId: INSTALLER.userId,
        title: 'Overdue thing',
        ...over,
      }) as Task;

    it('marks newly-breached tasks and escalates them', async () => {
      const now = new Date('2026-08-03T00:00:00.000Z');
      const task = breachable();
      taskRepo.find
        .mockResolvedValueOnce([task]) // newly breached
        .mockResolvedValueOnce([
          { ...task, slaBreachedAt: task.slaDueAt } as Task,
        ]); // escalation candidates

      const result = await service.sweepSlas(now);
      expect(result.breached).toBe(1);
      expect(result.escalated).toBe(1);
      expect(notifications.sendToUsers).toHaveBeenCalled();
    });

    it('escalates straight to the level the overdue age warrants', async () => {
      // 5 days overdue clears every step (0h, 24h, 72h) at once.
      const now = new Date('2026-08-06T00:00:00.000Z');
      taskRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          breachable({ slaBreachedAt: new Date('2026-08-01T00:00:00.000Z') }),
        ]);
      await service.sweepSlas(now);
      const lastSave = taskRepo.save.mock.calls.at(-1) as [Task[]];
      expect(lastSave[0][0].escalationLevel).toBe(3);
    });

    it('notifies admins only at the top escalation level', async () => {
      userRepo.find.mockResolvedValue([{ id: 'admin-a' }, { id: 'admin-b' }]);
      const now = new Date('2026-08-06T00:00:00.000Z');
      taskRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          breachable({ slaBreachedAt: new Date('2026-08-01T00:00:00.000Z') }),
        ]);
      await service.sweepSlas(now);
      const lastCall = notifications.sendToUsers.mock.calls.at(-1) as [
        string[],
      ];
      expect(lastCall[0]).toEqual(
        expect.arrayContaining([INSTALLER.userId, MANAGER.userId, 'admin-a']),
      );
    });

    it('does nothing when the task engine is off', async () => {
      const flags = defaultFeatureFlags();
      flags.taskEngine.enabled = false;
      settings.getFeatureFlags.mockResolvedValue(flags);
      await expect(service.sweepSlas()).resolves.toEqual({
        breached: 0,
        escalated: 0,
      });
    });
  });

  it('resets the breach state when an SLA is renegotiated', async () => {
    taskRepo.findOne.mockResolvedValue({
      id: 'task-9',
      status: TaskStatus.OPEN,
      priority: TaskPriority.NORMAL,
      assigneeUserId: INSTALLER.userId,
      slaBreachedAt: new Date('2026-08-01T00:00:00.000Z'),
      escalationLevel: 2,
      escalatedAt: new Date('2026-08-02T00:00:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Task);

    const updated = await service.update(
      'task-9',
      { slaDueAt: '2026-09-01T00:00:00.000Z' },
      ADMIN,
    );
    expect(updated.slaBreachedAt).toBeNull();
    expect(updated.escalationLevel).toBe(0);
  });
});
