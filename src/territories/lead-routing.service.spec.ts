import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { defaultFeatureFlags } from '../feature-flags/feature-flags.config';
import {
  LeadRoutingEvent,
  RoutingOutcome,
} from './entities/lead-routing-event.entity';
import { TerritoryMember } from './entities/territory-member.entity';
import { RoutingStrategy, Territory } from './entities/territory.entity';
import { LeadRoutingService } from './lead-routing.service';

type Mocked<T> = { [K in keyof T]: jest.Mock };

const flagsOn = () => {
  const flags = defaultFeatureFlags();
  flags.territoryRouting.enabled = true;
  return flags;
};

describe('LeadRoutingService', () => {
  let service: LeadRoutingService;
  let territoryRepo: Mocked<Repository<Territory>>;
  let memberRepo: Mocked<Repository<TerritoryMember>>;
  let eventRepo: Mocked<Repository<LeadRoutingEvent>>;
  let customerRepo: Mocked<Repository<Customer>>;
  let settings: Mocked<RuntimeSettingsService>;

  const territory = (over: Partial<Territory> = {}): Territory =>
    ({
      id: 'terr-1',
      name: 'Inner East',
      postcodes: ['3121', '3122'],
      regions: ['richmond'],
      routingStrategy: RoutingStrategy.ROUND_ROBIN,
      ownerUserId: 'owner-1',
      reassignAfterHours: null,
      rotationCursor: 0,
      active: true,
      priority: 100,
      ...over,
    }) as Territory;

  const member = (over: Partial<TerritoryMember> = {}): TerritoryMember =>
    ({
      id: 'm1',
      territoryId: 'terr-1',
      userId: 'rep-1',
      weight: 1,
      active: true,
      assignedCount: 0,
      ...over,
    }) as TerritoryMember;

  beforeEach(async () => {
    territoryRepo = {
      find: jest.fn().mockResolvedValue([territory()]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<Territory>>;

    memberRepo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Mocked<Repository<TerritoryMember>>;

    eventRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => v),
    } as unknown as Mocked<Repository<LeadRoutingEvent>>;

    customerRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'cust-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        leadOwnershipHistory: [],
      } as unknown as Customer),
      save: jest.fn((v: unknown) => v),
    } as unknown as Mocked<Repository<Customer>>;

    settings = {
      getFeatureFlags: jest.fn().mockResolvedValue(flagsOn()),
    } as unknown as Mocked<RuntimeSettingsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadRoutingService,
        { provide: getRepositoryToken(Territory), useValue: territoryRepo },
        { provide: getRepositoryToken(TerritoryMember), useValue: memberRepo },
        { provide: getRepositoryToken(LeadRoutingEvent), useValue: eventRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        {
          provide: getRepositoryToken(User),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: NotificationsService,
          useValue: { sendToUsers: jest.fn().mockResolvedValue([]) },
        },
        { provide: RuntimeSettingsService, useValue: settings },
      ],
    }).compile();

    service = moduleRef.get(LeadRoutingService);
  });

  describe('matchTerritory', () => {
    it('matches on a postcode inside a free-text address', async () => {
      const match = await service.matchTerritory('12 Smith St Richmond 3121');
      expect(match?.territory.id).toBe('terr-1');
      expect(match?.reason).toContain('3121');
    });

    it('matches on an explicit postcode', async () => {
      const match = await service.matchTerritory(null, '3122');
      expect(match?.territory.id).toBe('terr-1');
    });

    it('falls back to a region substring when no postcode matches', async () => {
      const match = await service.matchTerritory('40 Ocean Rd, RICHMOND');
      expect(match?.reason).toContain('Region');
    });

    it('returns null when nothing claims the address', async () => {
      expect(await service.matchTerritory('9 Ocean Dr Bondi 2026')).toBeNull();
    });

    it('prefers a postcode match over a region match on another territory', async () => {
      territoryRepo.find.mockResolvedValue([
        territory({ id: 'region-terr', postcodes: [], regions: ['richmond'] }),
        territory({ id: 'pc-terr', postcodes: ['3121'], regions: [] }),
      ]);
      const match = await service.matchTerritory('Richmond 3121');
      expect(match?.territory.id).toBe('pc-terr');
    });
  });

  describe('routeLead', () => {
    it('skips entirely when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      const result = await service.routeLead({
        customerId: 'cust-1',
        address: 'Richmond 3121',
      });
      expect(result.outcome).toBe(RoutingOutcome.SKIPPED);
      expect(eventRepo.save).not.toHaveBeenCalled();
    });

    it('records a no-match outcome instead of failing', async () => {
      const result = await service.routeLead({
        customerId: 'cust-1',
        address: 'Bondi 2026',
      });
      expect(result.outcome).toBe(RoutingOutcome.NO_TERRITORY_MATCH);
      expect(eventRepo.save).toHaveBeenCalled();
    });

    it('rotates round-robin across active members', async () => {
      memberRepo.find.mockResolvedValue([
        member({ id: 'm1', userId: 'rep-1' }),
        member({ id: 'm2', userId: 'rep-2' }),
      ]);
      const first = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(first.assignedUserId).toBe('rep-1');
      // The cursor advance is persisted, so the next lead moves on.
      expect(territoryRepo.update).toHaveBeenCalledWith(
        { id: 'terr-1' },
        { rotationCursor: 1 },
      );

      territoryRepo.find.mockResolvedValue([territory({ rotationCursor: 1 })]);
      const second = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(second.assignedUserId).toBe('rep-2');
    });

    it('skips inactive and zero-weight members', async () => {
      memberRepo.find.mockImplementation(
        ({ where }: { where: { active?: boolean } }) =>
          Promise.resolve(
            where.active
              ? [member({ id: 'm2', userId: 'rep-2', weight: 1 })]
              : [],
          ) as never,
      );
      const result = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(result.assignedUserId).toBe('rep-2');
    });

    it('picks the member furthest below their fair share when weighted', async () => {
      territoryRepo.find.mockResolvedValue([
        territory({ routingStrategy: RoutingStrategy.WEIGHTED }),
      ]);
      memberRepo.find.mockResolvedValue([
        member({ id: 'm1', userId: 'rep-1', weight: 1, assignedCount: 5 }),
        member({ id: 'm2', userId: 'rep-2', weight: 3, assignedCount: 6 }),
      ]);
      // rep-1 is at 5.0 per unit weight, rep-2 at 2.0 — rep-2 is owed more.
      const result = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(result.assignedUserId).toBe('rep-2');
    });

    it('falls back to the territory owner when no member is active', async () => {
      memberRepo.find.mockResolvedValue([]);
      const result = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(result.assignedUserId).toBe('owner-1');
      expect(result.reason).toContain('owner');
    });

    it('reports no eligible member when there is no owner either', async () => {
      territoryRepo.find.mockResolvedValue([territory({ ownerUserId: null })]);
      memberRepo.find.mockResolvedValue([]);
      const result = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(result.outcome).toBe(RoutingOutcome.NO_ELIGIBLE_MEMBER);
      expect(result.assignedUserId).toBeNull();
    });

    it('uses the owner directly under owner_only', async () => {
      territoryRepo.find.mockResolvedValue([
        territory({ routingStrategy: RoutingStrategy.OWNER_ONLY }),
      ]);
      const result = await service.routeLead({
        customerId: 'cust-1',
        postcode: '3121',
      });
      expect(result.assignedUserId).toBe('owner-1');
      expect(memberRepo.find).not.toHaveBeenCalled();
    });

    it('appends to the ownership history rather than replacing it', async () => {
      memberRepo.find.mockResolvedValue([member()]);
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        leadOwnershipHistory: [
          {
            userId: 'old-rep',
            assignedAt: '2026-01-01T00:00:00.000Z',
            assignedByUserId: null,
          },
        ],
      } as unknown as Customer);

      await service.routeLead({ customerId: 'cust-1', postcode: '3121' });

      const [saved] = customerRepo.save.mock.calls[0] as [Customer];
      expect(saved.leadOwnershipHistory).toHaveLength(2);
      expect(saved.leadOwnershipHistory?.[0].userId).toBe('old-rep');
      expect(saved.leadOwnerUserId).toBe('rep-1');
    });

    it('never throws — a routing failure must not reject a captured lead', async () => {
      territoryRepo.find.mockRejectedValue(new Error('db down'));
      await expect(
        service.routeLead({ customerId: 'cust-1', postcode: '3121' }),
      ).resolves.toMatchObject({ outcome: RoutingOutcome.SKIPPED });
    });
  });

  describe('reassignStaleLeads', () => {
    it('does nothing when the flag is off', async () => {
      settings.getFeatureFlags.mockResolvedValue(defaultFeatureFlags());
      await expect(service.reassignStaleLeads()).resolves.toEqual({
        reassigned: 0,
      });
    });

    it('leaves a lead alone once its owner has changed', async () => {
      territoryRepo.find.mockResolvedValue([
        territory({ reassignAfterHours: 4 }),
      ]);
      eventRepo.find.mockResolvedValue([
        {
          customerId: 'cust-1',
          jobId: null,
          assignedUserId: 'rep-1',
        } as LeadRoutingEvent,
      ]);
      // A human already took it over.
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        leadOwnerUserId: 'someone-else',
        leadOwnershipHistory: [],
      } as unknown as Customer);

      await expect(service.reassignStaleLeads()).resolves.toEqual({
        reassigned: 0,
      });
    });

    it('reassigns an untouched lead to the next rep', async () => {
      territoryRepo.find.mockResolvedValue([
        territory({ reassignAfterHours: 4 }),
      ]);
      eventRepo.find.mockResolvedValue([
        {
          customerId: 'cust-1',
          jobId: null,
          assignedUserId: 'rep-1',
        } as LeadRoutingEvent,
      ]);
      customerRepo.findOne.mockResolvedValue({
        id: 'cust-1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        leadOwnerUserId: 'rep-1',
        leadOwnershipHistory: [],
      } as unknown as Customer);
      memberRepo.find.mockResolvedValue([
        member({ id: 'm2', userId: 'rep-2' }),
      ]);

      await expect(service.reassignStaleLeads()).resolves.toEqual({
        reassigned: 1,
      });
    });
  });
});
