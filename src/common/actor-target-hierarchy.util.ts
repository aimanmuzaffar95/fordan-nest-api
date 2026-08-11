import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/entities/user-role.enum';

/**
 * Object-level ownership/hierarchy check shared by every staff-mutation
 * surface: ADMIN may act on anyone; MANAGER may act on INSTALLER/EMPLOYEE
 * staff but never on another MANAGER (peer-manager account takeover — the
 * original hole this closed was in `staff.service.ts`; the same class of
 * bug later turned up ungated on `PUT /employee-forms/user/:userId`, which
 * is why this now lives in `common` instead of being re-derived per
 * feature). Anything below MANAGER should never reach this check at all —
 * routes calling it are already role-gated to ADMIN/MANAGER.
 */
export function assertActorCanActOnTarget(
  actorRole: UserRole,
  targetRole: UserRole,
): void {
  if (actorRole === UserRole.ADMIN) return;
  if (actorRole === UserRole.MANAGER && targetRole === UserRole.MANAGER) {
    throw new ForbiddenException(
      'Managers cannot modify another manager account',
    );
  }
}
