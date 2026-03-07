import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '../../users/entities/user-role.enum';

type AuthenticatedRequest = {
  user?: {
    role?: UserRole;
  };
};

function assertRole(
  context: ExecutionContext,
  requiredRole: UserRole,
): boolean {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  const role = request.user?.role;

  if (!role) {
    throw new UnauthorizedException('User role not found in token');
  }

  if (role !== requiredRole) {
    throw new ForbiddenException('Insufficient role permissions');
  }

  return true;
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return assertRole(context, UserRole.ADMIN);
  }
}

@Injectable()
export class ManagerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return assertRole(context, UserRole.MANAGER);
  }
}

@Injectable()
export class InstallerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return assertRole(context, UserRole.INSTALLER);
  }
}
