import { UserRole } from './entities/user-role.enum';

/**
 * A manager with a future `adminUntil` acts as ADMIN until it lapses. Single
 * source of truth for the JWT guard, PermissionsService and /auth/me so the
 * three can never disagree about who is currently elevated.
 */
export function hasActiveTemporaryAdmin(user: {
  role: UserRole;
  adminUntil?: Date | string | null;
}): boolean {
  if (user.role !== UserRole.MANAGER || !user.adminUntil) return false;
  return new Date(user.adminUntil).getTime() > Date.now();
}

/** Longest a single grant may run. Temporary means temporary. */
export const MAX_TEMPORARY_ADMIN_DAYS = 30;
