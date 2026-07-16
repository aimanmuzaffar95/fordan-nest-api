import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';

/**
 * An API key an admin issues so an AI assistant (via the MCP server) can reach
 * the CRM. The key is bound to a staff `boundUserId` — THAT account's role is
 * what bounds everything the AI can see, reusing the CRM's own RBAC. Only a
 * SHA-256 hash of the key is stored; the plaintext is shown once at creation.
 */
@Entity('mcp_access_keys')
export class McpAccessKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  // sha256(rawKey) hex — the lookup + verification handle. Never reversible.
  @Index('idx_mcp_access_keys_token_hash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  // Non-secret hint for the UI, e.g. "fcrm_mcp_a1b2c3…7f9d".
  @Column({ type: 'varchar', length: 64 })
  displayHint: string;

  // The staff account whose role/scope bounds this key's access.
  @Index('idx_mcp_access_keys_bound_user')
  @Column({ type: 'uuid' })
  boundUserId: string;

  @Column({ type: 'boolean', default: false })
  allowWrites: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  expiresAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'uuid' })
  createdByUserId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  revokedByUserId: string | null;
}
