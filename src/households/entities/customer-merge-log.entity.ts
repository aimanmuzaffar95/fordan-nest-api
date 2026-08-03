import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Audit of a customer merge (PRD v2 Phase 1).
 *
 * Merges move jobs, invoices and notes between records, so the trail records
 * both what moved and the losing record's full field snapshot — enough to
 * reconstruct it by hand if a merge turns out to be wrong.
 */
@Entity('customer_merge_logs')
@Index('idx_customer_merge_survivor', ['survivorCustomerId'])
@Index('idx_customer_merge_merged', ['mergedCustomerId'])
export class CustomerMergeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The record that remains. */
  @Column({ type: 'uuid' })
  survivorCustomerId: string;

  /** The record that was folded in and soft-retired. */
  @Column({ type: 'uuid' })
  mergedCustomerId: string;

  @Column({ type: 'uuid', nullable: true })
  performedByUserId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  reason: string | null;

  /** Full snapshot of the merged record before the merge. */
  @Column({ type: 'json', nullable: true })
  mergedSnapshot: Record<string, unknown> | null;

  /** `{ jobs: 3, invoices: 1, notes: 8, ... }` — what was reparented. */
  @Column({ type: 'json', nullable: true })
  movedCounts: Record<string, number> | null;

  /** Fields copied from the merged record because the survivor was blank. */
  @Column({ type: 'json', nullable: true })
  filledFields: string[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
