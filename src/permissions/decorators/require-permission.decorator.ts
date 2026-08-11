import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../permission-catalog';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Declares that a route requires the caller's *effective* permission grants
 * (role profile + per-user overrides, resolved fresh per request) to include
 * ALL of the given catalog keys. Composes with @Roles(...)/RolesGuard, which
 * remains a coarse outer layer — this is the fine-grained layer.
 *
 * Enforced by PermissionsGuard. Fails closed: if the metadata is present and
 * the resolved user is missing any key, the request is rejected with 403.
 */
export const RequirePermission = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, keys);
