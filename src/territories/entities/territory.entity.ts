import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** How a lead is picked from a territory's members. */
export enum RoutingStrategy {
  /** Even rotation through active members. */
  ROUND_ROBIN = 'round_robin',
  /** Rotation biased by each member's `weight`. */
  WEIGHTED = 'weighted',
  /** Always the territory owner; no rotation. */
  OWNER_ONLY = 'owner_only',
}

/**
 * A sales territory (PRD v2 Phase 1).
 *
 * Matching is postcode-first because that's what the public lead form
 * captures; `regions` is a free-text fallback matched against the customer
 * address when no postcode matches.
 */
@Entity('territories')
@Index('idx_territories_active', ['active'])
export class Territory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Postcodes claimed by this territory. Exact string match, normalised. */
  @Column({ type: 'json', nullable: true })
  postcodes: string[] | null;

  /** Lowercased suburb/region names, matched as substrings of the address. */
  @Column({ type: 'json', nullable: true })
  regions: string[] | null;

  @Column({ type: 'varchar', length: 30, default: RoutingStrategy.ROUND_ROBIN })
  routingStrategy: RoutingStrategy;

  /** Fallback owner: used by `owner_only`, and when no member is eligible. */
  @Column({ type: 'uuid', nullable: true })
  ownerUserId: string | null;

  /**
   * Hours a routed lead may sit untouched before it is reassigned by the SLA
   * sweep. Null disables reassignment for this territory.
   */
  @Column({ type: 'int', nullable: true })
  reassignAfterHours: number | null;

  /**
   * Cursor for round-robin. Stored so rotation survives restarts; wraps at the
   * member count on read, so removing members can never park it out of range.
   */
  @Column({ type: 'int', default: 0 })
  rotationCursor: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  /**
   * Lower numbers win when several territories match the same address. Ties
   * break on name, so routing is deterministic.
   */
  @Column({ type: 'int', default: 100 })
  priority: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt: Date | null;
}
