import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PermissionKey } from '../permission-catalog';
import { PermissionsService } from '../permissions.service';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';

type AuthenticatedRequest = Request & { user?: { sub?: string } };

/**
 * Fine-grained permission gate. No-ops (passes through) when a route carries
 * no @RequirePermission metadata, so it composes safely with JwtAuthGuard +
 * RolesGuard on every existing controller. When metadata IS present, it
 * fails closed: missing user context, missing effective grant, or any
 * lookup error all result in a rejection, never a silent allow.
 *
 * Grants are resolved fresh from PermissionsService.getEffectiveForUser on
 * every request (role profile + per-user overrides) — nothing is trusted
 * from the JWT, so revocation is immediate.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      PermissionKey[] | undefined
    >(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('Missing authenticated user context');
    }

    // Fail closed on lookup errors too, not just missing/insufficient
    // grants: a DB error (or anything else thrown resolving effective
    // permissions) must not fall through to Nest's default exception
    // filter as an uncaught 500 — that would leak internals and, worse, is
    // not a decision this guard is meant to leave undecided. Any
    // already-thrown HTTP exception (e.g. NotFoundException for a deleted
    // user) is re-thrown as-is; anything else is converted to a 403.
    let effective;
    try {
      effective = await this.permissions.getEffectiveForUser(userId);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof UnauthorizedException
      ) {
        throw error;
      }
      throw new ForbiddenException('Unable to resolve permissions');
    }

    for (const key of required) {
      if (!this.permissions.hasPermission(effective, key)) {
        throw new ForbiddenException('Missing required permission');
      }
    }

    return true;
  }
}
