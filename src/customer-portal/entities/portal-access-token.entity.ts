import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';

/**
 * A magic-link token granting a customer read-only access to one job's status
 * (PRD v2 Phase 4).
 *
 * Only the SHA-256 hash is stored. The plaintext exists once, in the email —
 * a database leak must not hand an attacker working portal links, and this is
 * a public, unauthenticated surface.
 */
@Entity('portal_access_tokens')
@Index('idx_portal_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_portal_tokens_customer', ['customerId'])
export class PortalAccessToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** SHA-256 of the token. Never the token itself. */
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ type: 'uuid' })
  customerId: string;

  /** Scoped to a single job — one link must not expose a whole account. */
  @Column({ type: 'uuid' })
  jobId: string;

  @Column({ type: resolveTimestampColumnType() })
  expiresAt: Date;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  revokedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lastAccessedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  accessCount: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
