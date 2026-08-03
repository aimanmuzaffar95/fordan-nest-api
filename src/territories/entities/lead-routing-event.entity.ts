import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum RoutingOutcome {
  /** A member was picked and the lead was assigned. */
  ASSIGNED = 'assigned',
  /** An SLA timer expired and the lead moved to the next member. */
  REASSIGNED = 'reassigned',
  /** A territory matched but had no eligible member. */
  NO_ELIGIBLE_MEMBER = 'no_eligible_member',
  /** No territory claimed the address. */
  NO_TERRITORY_MATCH = 'no_territory_match',
  /** Routing is off (feature flag or no configured territories). */
  SKIPPED = 'skipped',
}

/**
 * Append-only routing audit (PRD v2 Phase 1) — answers "why did this lead go
 * to this rep?" without having to replay the rotation.
 */
@Entity('lead_routing_events')
@Index('idx_lead_routing_customer', ['customerId'])
@Index('idx_lead_routing_created', ['createdAt'])
export class LeadRoutingEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  customerId: string;

  @Column({ type: 'uuid', nullable: true })
  jobId: string | null;

  @Column({ type: 'uuid', nullable: true })
  territoryId: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  territoryName: string | null;

  @Column({ type: 'varchar', length: 30 })
  outcome: RoutingOutcome;

  @Column({ type: 'varchar', length: 30, nullable: true })
  strategy: string | null;

  /** Rep the lead was routed to (null unless outcome is assigned/reassigned). */
  @Column({ type: 'uuid', nullable: true })
  assignedUserId: string | null;

  /** Previous owner on a reassignment. */
  @Column({ type: 'uuid', nullable: true })
  previousUserId: string | null;

  /** Human-readable explanation, e.g. the matched postcode or SLA breach. */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
