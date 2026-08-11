import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import type { PermissionKey } from '../permission-catalog';

/**
 * Per-user override layer on top of the role profile (ServiceTitan-style
 * "individual permissions"). Reconciliation rule (documented, enforced in
 * PermissionsService.getEffectiveForUser): an override always wins over the
 * user's role-profile grant for that key — `enabled: true` adds a permission
 * the role doesn't carry, `enabled: false` revokes one the role does carry.
 * Overrides are NOT durable against role reassignment: changing a user's
 * `role` (staffType) clears all of that user's overrides, mirroring
 * ServiceTitan's "system updates reset individual permissions to match the
 * role." Every create/update/delete is recorded via SystemAuditLogService.
 */
@Entity('permission_overrides')
@Unique(['userId', 'permissionKey'])
export class PermissionOverride {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 120 })
  permissionKey: PermissionKey;

  @Column({ type: 'boolean' })
  enabled: boolean;

  @Column({ type: 'uuid', nullable: true })
  grantedByUserId: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
