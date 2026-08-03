import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NOTIFICATION_TYPE } from '../notifications/notification-type.constants';
import { RuntimeSettingsService } from '../runtime-settings/runtime-settings.service';
import { isFeatureEnabled } from '../feature-flags/feature-flags.config';
import {
  LeadRoutingEvent,
  RoutingOutcome,
} from './entities/lead-routing-event.entity';
import { TerritoryMember } from './entities/territory-member.entity';
import { RoutingStrategy, Territory } from './entities/territory.entity';

export type RoutingResult = {
  outcome: RoutingOutcome;
  territoryId: string | null;
  assignedUserId: string | null;
  reason: string;
};

/** Australian postcodes are 4 digits; keep only those from a free-text address. */
const POSTCODE_PATTERN = /\b(\d{4})\b/g;

function normalizePostcode(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Territory matching + lead routing (PRD v2 Phase 1).
 *
 * Deliberately never throws into its callers: a routing problem must not fail
 * the lead capture that triggered it — an unrouted lead is recoverable, a
 * rejected lead is not.
 */
@Injectable()
export class LeadRoutingService {
  private readonly logger = new Logger(LeadRoutingService.name);

  constructor(
    @InjectRepository(Territory)
    private readonly territoryRepo: Repository<Territory>,
    @InjectRepository(TerritoryMember)
    private readonly memberRepo: Repository<TerritoryMember>,
    @InjectRepository(LeadRoutingEvent)
    private readonly eventRepo: Repository<LeadRoutingEvent>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly settings: RuntimeSettingsService,
  ) {}

  // ─── Matching ─────────────────────────────────────────────────────────────

  /**
   * Best-matching territory for an address. Postcode beats region (it's exact),
   * then lower `priority`, then name — so the result is stable.
   */
  async matchTerritory(
    address: string | null | undefined,
    explicitPostcode?: string | null,
  ): Promise<{ territory: Territory; reason: string } | null> {
    const territories = await this.territoryRepo.find({
      where: { active: true },
      order: { priority: 'ASC', name: 'ASC' },
    });
    if (territories.length === 0) return null;

    const addressText = (address ?? '').trim();
    const postcodes = new Set<string>();
    if (explicitPostcode?.trim()) {
      postcodes.add(normalizePostcode(explicitPostcode));
    }
    for (const match of addressText.matchAll(POSTCODE_PATTERN)) {
      postcodes.add(normalizePostcode(match[1]));
    }

    for (const territory of territories) {
      for (const raw of territory.postcodes ?? []) {
        if (typeof raw !== 'string') continue;
        const candidate = normalizePostcode(raw);
        if (candidate && postcodes.has(candidate)) {
          return {
            territory,
            reason: `Postcode ${candidate} matched territory "${territory.name}"`,
          };
        }
      }
    }

    const lowerAddress = addressText.toLowerCase();
    if (lowerAddress) {
      for (const territory of territories) {
        for (const raw of territory.regions ?? []) {
          if (typeof raw !== 'string') continue;
          const region = raw.trim().toLowerCase();
          if (region && lowerAddress.includes(region)) {
            return {
              territory,
              reason: `Region "${region}" matched territory "${territory.name}"`,
            };
          }
        }
      }
    }

    return null;
  }

  // ─── Routing ──────────────────────────────────────────────────────────────

  /**
   * Route a freshly-captured lead to a rep and record why. Safe to call on
   * every capture: it no-ops when the flag is off or nothing matches.
   */
  async routeLead(params: {
    customerId: string;
    jobId?: string | null;
    address?: string | null;
    postcode?: string | null;
  }): Promise<RoutingResult> {
    const skipped: RoutingResult = {
      outcome: RoutingOutcome.SKIPPED,
      territoryId: null,
      assignedUserId: null,
      reason: 'Territory routing is disabled',
    };

    try {
      const flags = await this.settings.getFeatureFlags();
      if (!isFeatureEnabled(flags, 'territoryRouting')) return skipped;

      const match = await this.matchTerritory(params.address, params.postcode);
      if (!match) {
        const result: RoutingResult = {
          outcome: RoutingOutcome.NO_TERRITORY_MATCH,
          territoryId: null,
          assignedUserId: null,
          reason: 'No territory claimed this address',
        };
        await this.record(params, result, null);
        return result;
      }

      const picked = await this.pickMember(match.territory);
      if (!picked) {
        const result: RoutingResult = {
          outcome: RoutingOutcome.NO_ELIGIBLE_MEMBER,
          territoryId: match.territory.id,
          assignedUserId: null,
          reason: `Territory "${match.territory.name}" has no eligible member`,
        };
        await this.record(params, result, match.territory);
        return result;
      }

      await this.assignOwner(params.customerId, picked.userId, match.reason);

      const result: RoutingResult = {
        outcome: RoutingOutcome.ASSIGNED,
        territoryId: match.territory.id,
        assignedUserId: picked.userId,
        reason: `${match.reason}; ${picked.reason}`,
      };
      await this.record(params, result, match.territory);
      await this.notifyOwner(picked.userId, params.customerId, match.territory);
      return result;
    } catch (err: unknown) {
      this.logger.error(
        `Lead routing failed for customer ${params.customerId}`,
        err,
      );
      return skipped;
    }
  }

  /**
   * Choose the next member, advancing the rotation cursor.
   *
   * `weighted` picks the member furthest below their fair share
   * (`assignedCount / weight`), which self-corrects after a member is paused
   * and re-enabled — plain modulo rotation would not.
   */
  private async pickMember(
    territory: Territory,
  ): Promise<{ userId: string; reason: string } | null> {
    if (territory.routingStrategy === RoutingStrategy.OWNER_ONLY) {
      if (!territory.ownerUserId) return null;
      return {
        userId: territory.ownerUserId,
        reason: 'routed to the territory owner (owner_only)',
      };
    }

    const members = await this.memberRepo.find({
      where: { territoryId: territory.id, active: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    const eligible = members.filter((m) => m.weight > 0);

    if (eligible.length === 0) {
      if (!territory.ownerUserId) return null;
      return {
        userId: territory.ownerUserId,
        reason: 'no active members; fell back to the territory owner',
      };
    }

    let chosen: TerritoryMember;
    let reason: string;

    if (territory.routingStrategy === RoutingStrategy.WEIGHTED) {
      chosen = eligible.reduce((best, m) =>
        m.assignedCount / m.weight < best.assignedCount / best.weight
          ? m
          : best,
      );
      reason = `weighted rotation (weight ${chosen.weight}, ${chosen.assignedCount} assigned)`;
    } else {
      // Modulo on read, so a shrunken member list can't leave the cursor stale.
      const index = territory.rotationCursor % eligible.length;
      chosen = eligible[index];
      reason = `round-robin position ${index + 1} of ${eligible.length}`;
      await this.territoryRepo.update(
        { id: territory.id },
        { rotationCursor: (territory.rotationCursor + 1) % eligible.length },
      );
    }

    await this.memberRepo.update(
      { id: chosen.id },
      {
        assignedCount: chosen.assignedCount + 1,
        lastAssignedAt: new Date(),
      },
    );

    return { userId: chosen.userId, reason };
  }

  private async assignOwner(
    customerId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
    });
    if (!customer) return;
    customer.leadOwnerUserId = userId;
    customer.leadOwnershipHistory = [
      ...(customer.leadOwnershipHistory ?? []),
      {
        userId,
        assignedAt: new Date().toISOString(),
        assignedByUserId: null,
        reason,
      },
    ];
    await this.customerRepo.save(customer);
  }

  private async record(
    params: { customerId: string; jobId?: string | null },
    result: RoutingResult,
    territory: Territory | null,
    previousUserId: string | null = null,
  ): Promise<void> {
    await this.eventRepo.save(
      this.eventRepo.create({
        customerId: params.customerId,
        jobId: params.jobId ?? null,
        territoryId: result.territoryId,
        territoryName: territory?.name ?? null,
        outcome: result.outcome,
        strategy: territory?.routingStrategy ?? null,
        assignedUserId: result.assignedUserId,
        previousUserId,
        reason: result.reason,
      }),
    );
  }

  private async notifyOwner(
    userId: string,
    customerId: string,
    territory: Territory,
  ): Promise<void> {
    const customer = await this.customerRepo.findOne({
      where: { id: customerId },
      select: { id: true, firstName: true, lastName: true },
    });
    const name = customer
      ? `${customer.firstName} ${customer.lastName}`.trim()
      : 'A new lead';
    await this.notifications.sendToUsers([userId], {
      type: NOTIFICATION_TYPE.LEAD_ASSIGNED,
      title: 'New lead assigned to you',
      body: `${name} — ${territory.name}`,
      metadata: { customerId, territoryId: territory.id },
    });
  }

  // ─── SLA reassignment ─────────────────────────────────────────────────────

  /**
   * Move leads that have sat untouched past their territory's SLA to the next
   * rep in the rotation. Called by the sweep; also exposed to admins.
   */
  async reassignStaleLeads(now: Date = new Date()): Promise<{
    reassigned: number;
  }> {
    const flags = await this.settings.getFeatureFlags();
    if (!isFeatureEnabled(flags, 'territoryRouting')) return { reassigned: 0 };

    const territories = await this.territoryRepo.find({
      where: { active: true, reassignAfterHours: Not(IsNull()) },
    });
    if (territories.length === 0) return { reassigned: 0 };

    let reassigned = 0;

    for (const territory of territories) {
      const hours = territory.reassignAfterHours;
      if (!hours || hours <= 0) continue;
      const cutoff = new Date(now.getTime() - hours * 60 * 60 * 1000);

      // Candidates: routed to this territory, still owned by that rep, and
      // captured before the cutoff.
      const events = await this.eventRepo.find({
        where: {
          territoryId: territory.id,
          outcome: RoutingOutcome.ASSIGNED,
          createdAt: LessThanOrEqual(cutoff),
        },
        order: { createdAt: 'DESC' },
        take: 200,
      });

      const seen = new Set<string>();
      for (const event of events) {
        if (seen.has(event.customerId)) continue;
        seen.add(event.customerId);

        const customer = await this.customerRepo.findOne({
          where: { id: event.customerId },
        });
        // Owner changed since routing → a human already engaged; leave it.
        if (!customer || customer.leadOwnerUserId !== event.assignedUserId) {
          continue;
        }

        const picked = await this.pickMember(territory);
        if (!picked || picked.userId === customer.leadOwnerUserId) continue;

        const previousUserId = customer.leadOwnerUserId;
        const reason = `No contact within ${hours}h SLA; reassigned from the previous owner`;
        await this.assignOwner(customer.id, picked.userId, reason);
        await this.record(
          { customerId: customer.id, jobId: event.jobId },
          {
            outcome: RoutingOutcome.REASSIGNED,
            territoryId: territory.id,
            assignedUserId: picked.userId,
            reason: `${reason}; ${picked.reason}`,
          },
          territory,
          previousUserId,
        );
        await this.notifyOwner(picked.userId, customer.id, territory);
        reassigned += 1;
      }
    }

    if (reassigned > 0) {
      this.logger.log(`Lead SLA sweep reassigned ${reassigned} lead(s)`);
    }
    return { reassigned };
  }

  /** Routing history for a customer, newest first. */
  async historyForCustomer(customerId: string): Promise<LeadRoutingEvent[]> {
    return this.eventRepo.find({
      where: { customerId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }
}
