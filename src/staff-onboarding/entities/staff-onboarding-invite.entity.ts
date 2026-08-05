import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { resolveTimestampColumnType } from '../../common/timestamp-column-type.util';
import { UserRole } from '../../users/entities/user-role.enum';

/**
 * A magic-link invite asking someone to complete their onboarding form.
 *
 * Two shapes, both issued by an admin or manager:
 *  - `userId` set    — an existing staff member fills their own form without
 *                      having to log in.
 *  - `userId` null   — a brand-new hire; submitting the form creates their
 *                      user account with the role chosen here at invite time.
 *
 * `intendedRole` is captured when the invite is issued and is never taken from
 * the submission, so a public endpoint can never be talked into minting an
 * admin. Only the SHA-256 hash of the token is stored — the plaintext exists
 * once, in the email.
 */
@Entity('staff_onboarding_invites')
@Index('idx_staff_onboarding_invites_hash', ['tokenHash'], { unique: true })
@Index('idx_staff_onboarding_invites_email', ['email'])
export class StaffOnboardingInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** SHA-256 of the token. Never the token itself. */
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  /** Where the link was sent. */
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  /** Null until the invite is accepted for a brand-new hire. */
  @Column({ type: 'uuid', nullable: true })
  userId: string | null;

  /**
   * Role the account gets when this invite creates one. Restricted to staff
   * roles at the point of issue; admin is never permitted here.
   */
  @Column({ type: 'varchar', length: 30 })
  intendedRole: UserRole;

  /** Required when `intendedRole` is EMPLOYEE — non-technical staff must have one. */
  @Column({ type: 'uuid', nullable: true })
  employeeRoleId: string | null;

  /** Required for INSTALLER; managers must not have one. */
  @Column({ type: 'uuid', nullable: true })
  staffRoleId: string | null;

  @Column({ type: resolveTimestampColumnType() })
  expiresAt: Date;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  acceptedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  revokedAt: Date | null;

  @Column({ type: resolveTimestampColumnType(), nullable: true })
  lastSentAt: Date | null;

  @Column({ type: 'int', default: 0 })
  sendCount: number;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId: string | null;

  @CreateDateColumn({ type: resolveTimestampColumnType() })
  createdAt: Date;
}
